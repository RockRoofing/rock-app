import { getTokens, saveTokens } from '../../../lib/db'
import { refreshXeroToken, getProjectsFromCategories, fetchProfitAndLoss } from '../../../lib/xero'
import { mergeCosts } from '../../../lib/mergeCosts'
import { costLineKey as costKey, invoiceLineKey as invoiceKey } from '../../../lib/costDedupe'

// Nightly incremental Xero sync. Rotates ONE project per run (deep-sync:pointer)
// and, for that project, tops up the last OVERLAP_DAYS from Xero:
//   • Bills (ACCPAY)          -> materials + subcontractor labour  -> costs:bills:<id>
//   • Direct Wages (320)      -> from Manual Journals, tagged lines -> costs:wages:<id>
//   • Sales Invoices (ACCREC) -> invoiced/paid/due                  -> invoiced:*:<id>
// Everything is de-duplicated within the overlap window so re-scanning recent
// transactions never double-counts. Uploads seed the history; this keeps it current.

const OVERLAP_DAYS = 120
const LABOUR_ACCOUNT_CODES = ['321', '320']
const COST_OF_SALE_ACCOUNTS = ['321', '322', '310', '311', '331', '330', '329', '333', '334', '335', '336']

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

const xget = (url, accessToken, tenantId) => fetch(url, {
  headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' }
})

// ── Bills (ACCPAY): materials + subbie labour, EXCLUDING 320 (wages come via journals) ──
async function fetchBills(accessToken, tenantId, trackingOptionId, trackingCategoryId, fromDate) {
  const lines = []
  let page = 1
  while (true) {
    let url = `https://api.xero.com/api.xro/2.0/Invoices?Type=ACCPAY&page=${page}&pageSize=100&DateFrom=${fromDate}`
    if (trackingCategoryId) url += `&TrackingCategoryID=${trackingCategoryId}&TrackingOptionID=${trackingOptionId}`
    const res = await xget(url, accessToken, tenantId)
    if (!res.ok) break
    const data = await res.json()
    const invoices = data.Invoices || []
    if (invoices.length === 0) break
    for (const inv of invoices) {
      await sleep(80)
      const r2 = await xget(`https://api.xero.com/api.xro/2.0/Invoices/${inv.InvoiceID}`, accessToken, tenantId)
      if (!r2.ok) continue
      const full = ((await r2.json()).Invoices || [])[0]
      if (!full) continue
      const matched = (full.LineItems || []).filter(line => (line.Tracking || []).some(t => t.TrackingOptionID === trackingOptionId))
      for (const line of matched) {
        if (!COST_OF_SALE_ACCOUNTS.includes(line.AccountCode)) continue
        if (line.AccountCode === '320') continue   // wages handled via journals
        const amount = line.LineAmount || 0
        if (amount === 0) continue
        const isLabour = LABOUR_ACCOUNT_CODES.includes(line.AccountCode)
        lines.push({
          date: full.DateString?.slice(0, 10),
          supplier: full.Contact?.Name || '',
          description: line.Description || '',
          reference: full.InvoiceNumber || '',
          amount, accountCode: line.AccountCode,
          type: isLabour ? 'Labour' : 'Materials', source: 'bills',
          xeroLineId: line.LineItemID || null,
          xeroInvoiceId: full.InvoiceID || null,
        })
      }
    }
    if (invoices.length < 100) break
    page++; await sleep(300)
  }
  return lines
}

// ── Untagged / overhead bills sweep: ALL ACCPAY bills in the window, keeping
//    lines that have NO project tracking tag (overheads + untagged cost-of-sale).
//    Runs once per day (heavier — pulls all bills, not project-filtered).
async function fetchUntaggedBills(accessToken, tenantId, fromDate) {
  const lines = []
  let page = 1
  while (true) {
    const url = `https://api.xero.com/api.xro/2.0/Invoices?Type=ACCPAY&page=${page}&pageSize=100&DateFrom=${fromDate}`
    const res = await xget(url, accessToken, tenantId)
    if (!res.ok) break
    const data = await res.json()
    const invoices = data.Invoices || []
    if (invoices.length === 0) break
    for (const inv of invoices) {
      await sleep(80)
      const r2 = await xget(`https://api.xero.com/api.xro/2.0/Invoices/${inv.InvoiceID}`, accessToken, tenantId)
      if (!r2.ok) continue
      const full = ((await r2.json()).Invoices || [])[0]
      if (!full) continue
      for (const line of (full.LineItems || [])) {
        const hasTag = (line.Tracking || []).length > 0
        if (hasTag) continue                 // tagged lines are handled per-project
        const amount = line.LineAmount || 0
        if (amount === 0) continue
        if (line.AccountCode === '320') continue   // wages handled separately
        lines.push({
          date: full.DateString?.slice(0, 10),
          supplier: full.Contact?.Name || '',
          description: line.Description || '',
          reference: full.InvoiceNumber || '',
          amount, accountCode: line.AccountCode || '',
          source: 'bills',
          xeroLineId: line.LineItemID || null,
          xeroInvoiceId: full.InvoiceID || null,
        })
      }
    }
    if (invoices.length < 100) break
    page++; await sleep(300)
  }
  return lines
}


// Parse Xero's Microsoft-JSON date "/Date(1551312000000+0000)/" -> "YYYY-MM-DD".
// The ManualJournals list gives ONLY this format in `Date` (no DateString).
function parseXeroJournalDate(v) {
  if (!v) return null
  const s = String(v)
  const m = s.match(/\/Date\((-?\d+)/)
  if (m) return new Date(parseInt(m[1], 10)).toISOString().slice(0, 10)
  const iso = s.match(/\d{4}-\d{2}-\d{2}/)
  return iso ? iso[0] : null
}

// Nightly wages for ONE project. Mirrors the fixed manual sync-wages:
//  • date parsed from /Date(ms)/  (was null before)
//  • JournalLines read straight from the LIST  (no per-item fetch)
//  • tracking matched by NAME, not GUID  (GUID silently returned 0 before)
//  • order=Date DESC + early-exit once past the window  (fast)
async function fetchWages(accessToken, tenantId, projectName, fromDate) {
  const lines = []
  const wantName = String(projectName || '').trim().toLowerCase()
  if (!wantName) return lines
  let page = 1
  let guard = 0
  while (guard++ < 100) {
    const url = `https://api.xero.com/api.xro/2.0/ManualJournals?order=${encodeURIComponent('Date DESC')}&page=${page}&pageSize=100`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' } })
    if (res.status === 429) { await sleep((parseInt(res.headers.get('Retry-After') || '2', 10) + 1) * 1000); continue }
    if (!res.ok) break
    const data = await res.json()
    const journals = data.ManualJournals || []
    if (journals.length === 0) break
    let allOlder = journals.length > 0
    for (const j of journals) {
      const dateStr = parseXeroJournalDate(j.Date)
      if (dateStr && dateStr >= fromDate) allOlder = false
      if (dateStr && dateStr < fromDate) continue
      for (const jl of (j.JournalLines || [])) {
        if (String(jl.AccountCode) !== '320') continue
        const tagged = (jl.Tracking || []).some(t => t.Option && String(t.Option).trim().toLowerCase() === wantName)
        if (!tagged) continue                 // only lines tracked to THIS project (by name)
        const amount = (jl.LineAmount || 0)
        if (amount <= 0) continue             // debit (project cost) side only
        lines.push({
          date: dateStr,
          supplier: 'Direct Wages',
          description: jl.Description || 'Direct Wages',
          reference: j.Narration || j.ManualJournalID || '',
          amount, accountCode: '320',
          type: 'Labour', source: 'wages',
          xeroLineId: jl.JournalLineID || null,
          xeroJournalId: j.ManualJournalID || null,
        })
      }
    }
    if (allOlder) break                        // newest-first: whole page older than window -> done
    if (journals.length < 100) break
    page++; await sleep(400)
  }
  return lines
}

// ── Sales Invoices (ACCREC) for this project ──
async function fetchSalesInvoices(accessToken, tenantId, trackingOptionId, trackingCategoryId, fromDate) {
  const byNumber = new Map()
  let page = 1
  while (true) {
    let url = `https://api.xero.com/api.xro/2.0/Invoices?Type=ACCREC&page=${page}&pageSize=100&DateFrom=${fromDate}`
    if (trackingCategoryId) url += `&TrackingCategoryID=${trackingCategoryId}&TrackingOptionID=${trackingOptionId}`
    const res = await xget(url, accessToken, tenantId)
    if (!res.ok) break
    const data = await res.json()
    const invoices = data.Invoices || []
    if (invoices.length === 0) break
    for (const inv of invoices) {
      // Confirm the invoice actually has a line tagged to this project.
      await sleep(80)
      const r2 = await xget(`https://api.xero.com/api.xro/2.0/Invoices/${inv.InvoiceID}`, accessToken, tenantId)
      if (!r2.ok) continue
      const full = ((await r2.json()).Invoices || [])[0]
      if (!full) continue
      const tagged = (full.LineItems || []).some(line => (line.Tracking || []).some(t => t.TrackingOptionID === trackingOptionId))
      if (!tagged) continue
      byNumber.set(full.InvoiceNumber || full.InvoiceID, {
        invoiceNumber: full.InvoiceNumber || '',
        xeroInvoiceId: full.InvoiceID || null,
        date: full.DateString?.slice(0, 10),
        dueDate: full.DueDateString?.slice(0, 10) || '',
        contact: full.Contact?.Name || '',
        reference: full.Reference || '',
        total: full.Total || 0,
        amountPaid: full.AmountPaid || 0,
        amountDue: full.AmountDue || 0,
        status: full.Status || '',
      })
    }
    if (invoices.length < 100) break
    page++; await sleep(300)
  }
  return [...byNumber.values()]
}

// Merge new lines into existing per-source lines, deduped within the window.
function mergeWindow(existing, incoming, fromDateStr, keyFn) {
  const old = existing.filter(l => l.date && l.date < fromDateStr)
  const recent = existing.filter(l => !l.date || l.date >= fromDateStr)
  const recentKeys = new Set(recent.map(keyFn))
  const trulyNew = incoming.filter(l => !recentKeys.has(keyFn(l)))
  return { merged: [...old, ...recent, ...trulyNew], added: trulyNew.length }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis connection' })

  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'No tokens' })
    const nt = await refreshXeroToken(tokens.refresh_token)
    tokens = { ...tokens, ...nt }; await saveTokens(tokens)

    const tenantId = tokens.tenant_id
    const all = await getProjectsFromCategories(tokens.access_token, tenantId)
    const active = all.filter(p => p.status !== 'ARCHIVED')
    if (active.length === 0) return res.json({ ok: true, message: 'No active projects' })

    let pointer = 0
    try { const s = await redis.get('deep-sync:pointer'); if (s !== null) pointer = parseInt(s) || 0 } catch {}
    if (pointer >= active.length) pointer = 0

    const cp = active[pointer]
    const projectId = cp.trackingOptionId
    const catId = cp.trackingCategoryId

    const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - OVERLAP_DAYS)
    const fromDateStr = fromDate.toISOString().split('T')[0]

    // ── 1. Bills ──
    const billLines = await fetchBills(tokens.access_token, tenantId, projectId, catId, fromDateStr)
    let existingBills = (await redis.get(`costs:bills:${projectId}`).catch(() => null))?.lines || []
    const billsMerge = mergeWindow(existingBills, billLines, fromDateStr, costKey)
    const billLabour = billsMerge.merged.filter(l => LABOUR_ACCOUNT_CODES.includes(l.accountCode)).reduce((s, l) => s + l.amount, 0)
    const billMaterials = billsMerge.merged.filter(l => !LABOUR_ACCOUNT_CODES.includes(l.accountCode)).reduce((s, l) => s + l.amount, 0)
    await redis.set(`costs:bills:${projectId}`, { labourSpend: billLabour, materialsSpend: billMaterials, totalCosts: billLabour + billMaterials, lines: billsMerge.merged, calculatedAt: new Date().toISOString(), source: 'deep_sync' })

    // ── 2. Direct Wages ──
    const wageLines = await fetchWages(tokens.access_token, tenantId, cp.name, fromDateStr)
    let existingWages = (await redis.get(`costs:wages:${projectId}`).catch(() => null))?.lines || []
    const wagesMerge = mergeWindow(existingWages, wageLines, fromDateStr, costKey)
    const wageTotal = wagesMerge.merged.reduce((s, l) => s + l.amount, 0)
    await redis.set(`costs:wages:${projectId}`, { labourSpend: wageTotal, materialsSpend: 0, totalCosts: wageTotal, lines: wagesMerge.merged, calculatedAt: new Date().toISOString(), source: 'deep_sync' })

    // Combine cost sources into the dashboard figure.
    await mergeCosts(redis, projectId)

    // ── 3. Sales Invoices ──
    const salesLines = await fetchSalesInvoices(tokens.access_token, tenantId, projectId, catId, fromDateStr)
    let existingInv = (await redis.get(`invoiced:lines:${projectId}`).catch(() => null)) || []
    const invMerge = mergeWindow(existingInv, salesLines, fromDateStr, invoiceKey)
    // Refresh amounts for invoices we already had but that changed (paid/due) in-window.
    const byNum = new Map(invMerge.merged.map(l => [invoiceKey(l), l]))
    for (const s of salesLines) byNum.set(invoiceKey(s), s)
    const mergedInv = [...byNum.values()]
    const totalInvoiced = mergedInv.reduce((s, l) => s + (l.total || 0), 0)
    const paidTotal = mergedInv.reduce((s, l) => s + (l.amountPaid || 0), 0)
    const dueTotal = mergedInv.reduce((s, l) => s + (l.amountDue || 0), 0)
    await redis.set(`invoiced:lines:${projectId}`, mergedInv)
    await redis.set(`invoiced:latest:${projectId}`, { totalInvoiced, paidTotal, dueTotal, invoiceCount: mergedInv.length, calculatedAt: new Date().toISOString(), source: 'deep_sync' })

    await redis.set('deep-sync:pointer', (pointer + 1) % active.length)
    await redis.del('dashboard:cache')

    // ── Bookkeeping benchmark: pull P&L per month (cheap — 1 call/month) ──
    // Only refresh once per day (guard so it doesn't run on every manual trigger).
    let benchmarkMonths = 0
    try {
      const lastBench = await redis.get('xero:pl-benchmark').catch(() => null)
      const today = new Date().toISOString().slice(0, 10)
      if (!lastBench || (lastBench.updatedAt || '').slice(0, 10) !== today) {
        const months = {}
        const now2 = new Date()
        for (let k = 0; k < 4; k++) {   // current + previous 3 months
          const d = new Date(now2.getFullYear(), now2.getMonth() - k, 1)
          const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
          const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
          const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
          try {
            const pl = await fetchProfitAndLoss(tokens.access_token, tenantId, from, to)
            months[from.slice(0, 7)] = {
              accounts: pl.accounts, bySection: pl.bySection,
              incomeTotal: pl.incomeTotal, costOfSalesTotal: pl.costOfSalesTotal,
            }
            benchmarkMonths++
            await sleep(300)
          } catch (e) { console.error('P&L pull failed for', from, e.message) }
        }
        await redis.set('xero:pl-benchmark', { months, updatedAt: new Date().toISOString() })
      }
    } catch (e) { console.error('benchmark error:', e.message) }

    // ── Untagged / overhead bills sweep (once per day) ──
    let untaggedAdded = 0
    try {
      const lastSweep = await redis.get('untagged-sweep:at').catch(() => null)
      const today = new Date().toISOString().slice(0, 10)
      if (!lastSweep || String(lastSweep).slice(0, 10) !== today) {
        const untaggedLines = await fetchUntaggedBills(tokens.access_token, tenantId, fromDateStr)
        const existingUn = (await redis.get('costs:untagged:bills').catch(() => null)) || []
        const { merged, added } = mergeWindow(existingUn, untaggedLines, fromDateStr, costKey)
        untaggedAdded = added
        await redis.set('costs:untagged:bills', merged)
        await redis.set('untagged-sweep:at', new Date().toISOString())
      }
    } catch (e) { console.error('untagged sweep error:', e.message) }

    // ── Global Sales + Wages refresh across ALL projects (once per day) ──
    // Bills stay per-project rotation (expensive per-bill detail); sales & wages
    // are cheap (batched endpoints), so we refresh every project daily using a
    // 6-month window. Exact-mirror per project within the window.
    let globalSalesProjects = 0, globalWagesProjects = 0
    try {
      const lastGlobal = await redis.get('global-sync:at').catch(() => null)
      const today = new Date().toISOString().slice(0, 10)
      if (!lastGlobal || String(lastGlobal).slice(0, 10) !== today) {
        const winDays = 183   // ~6 months
        const win = new Date(); win.setDate(win.getDate() - winDays)
        const winStr = win.toISOString().split('T')[0]
        for (const p of active) {
          const pid = p.trackingOptionId, pcat = p.trackingCategoryId
          // Sales
          try {
            const sLines = await fetchSalesInvoices(tokens.access_token, tenantId, pid, pcat, winStr)
            const existing = (await redis.get(`invoiced:lines:${pid}`).catch(() => null)) || []
            const outside = existing.filter(l => !l.date || l.date < winStr)   // keep older than window
            const mergedInv = [...outside, ...sLines]
            const tot = mergedInv.reduce((s, l) => s + (l.total || 0), 0)
            const paid = mergedInv.reduce((s, l) => s + (l.amountPaid || 0), 0)
            const due = mergedInv.reduce((s, l) => s + (l.amountDue || 0), 0)
            await redis.set(`invoiced:lines:${pid}`, mergedInv)
            await redis.set(`invoiced:latest:${pid}`, { totalInvoiced: tot, paidTotal: paid, dueTotal: due, invoiceCount: mergedInv.length, calculatedAt: new Date().toISOString(), source: 'global_sync' })
            globalSalesProjects++
            await sleep(120)
          } catch (e) { console.error('global sales failed', p.jobNo, e.message) }
          // Wages
          try {
            const wLines = await fetchWages(tokens.access_token, tenantId, p.name, winStr)
            const existing = (await redis.get(`costs:wages:${pid}`).catch(() => null))?.lines || []
            // NO-WIPE GUARD: if the fetch returned nothing, leave existing wages
            // untouched rather than dropping in-window lines.
            if (wLines.length === 0) { await sleep(120); continue }
            const outside = existing.filter(l => !l.date || l.date < winStr)
            const combined = [...outside, ...wLines]
            const wTot = combined.reduce((s, l) => s + (l.amount || 0), 0)
            await redis.set(`costs:wages:${pid}`, { labourSpend: wTot, materialsSpend: 0, totalCosts: wTot, lines: combined, calculatedAt: new Date().toISOString(), source: 'global_sync' })
            await mergeCosts(redis, pid)
            globalWagesProjects++
            await sleep(120)
          } catch (e) { console.error('global wages failed', p.jobNo, e.message) }
        }
        await redis.set('global-sync:at', new Date().toISOString())
      }
    } catch (e) { console.error('global sync error:', e.message) }

    res.json({
      ok: true,
      project: cp.jobNo, fromDate: fromDateStr,
      billsAdded: billsMerge.added, wagesAdded: wagesMerge.added, salesFetched: salesLines.length,
      billLabour, billMaterials, wageTotal, totalInvoiced, dueTotal,
      benchmarkMonths, untaggedAdded,
      globalSalesProjects, globalWagesProjects,
      nextProject: active[(pointer + 1) % active.length]?.jobNo,
    })
  } catch (e) {
    console.error('Deep sync error:', e)
    res.status(500).json({ error: e.message })
  }
}
