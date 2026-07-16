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

// ── Direct Wages (320) via Manual Journals, tagged to this project only ──
async function fetchWages(accessToken, tenantId, trackingOptionId, fromDate) {
  const lines = []
  let page = 1
  // Only pull journals modified in the overlap window (keeps paging light).
  const modifiedSince = new Date(fromDate + 'T00:00:00Z').toUTCString()
  while (true) {
    const url = `https://api.xero.com/api.xro/2.0/ManualJournals?page=${page}&pageSize=100`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json',
        'If-Modified-Since': modifiedSince,
      }
    })
    if (!res.ok) break
    const data = await res.json()
    const journals = data.ManualJournals || []
    if (journals.length === 0) break
    for (const j of journals) {
      const dateStr = (j.Date && String(j.Date).match(/\d{4}-\d{2}-\d{2}/)) ? String(j.Date).slice(0, 10)
        : (j.DateString ? j.DateString.slice(0, 10) : null)
      if (dateStr && dateStr < fromDate) continue
      for (const jl of (j.JournalLines || [])) {
        if (jl.AccountCode !== '320') continue
        const tagged = (jl.Tracking || []).some(t => t.TrackingOptionID === trackingOptionId)
        if (!tagged) continue                 // only project-tagged wage lines
        // In tracking-transfer journals the project line is a debit (positive).
        const amount = (jl.LineAmount || 0)
        if (amount <= 0) continue             // skip the contra/credit side
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
    if (journals.length < 100) break
    page++; await sleep(300)
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
    const wageLines = await fetchWages(tokens.access_token, tenantId, projectId, fromDateStr)
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
            months[from.slice(0, 7)] = pl.accounts
            benchmarkMonths++
            await sleep(300)
          } catch (e) { console.error('P&L pull failed for', from, e.message) }
        }
        await redis.set('xero:pl-benchmark', { months, updatedAt: new Date().toISOString() })
      }
    } catch (e) { console.error('benchmark error:', e.message) }

    res.json({
      ok: true,
      project: cp.jobNo, fromDate: fromDateStr,
      billsAdded: billsMerge.added, wagesAdded: wagesMerge.added, salesFetched: salesLines.length,
      billLabour, billMaterials, wageTotal, totalInvoiced, dueTotal,
      benchmarkMonths,
      nextProject: active[(pointer + 1) % active.length]?.jobNo,
    })
  } catch (e) {
    console.error('Deep sync error:', e)
    res.status(500).json({ error: e.message })
  }
}
