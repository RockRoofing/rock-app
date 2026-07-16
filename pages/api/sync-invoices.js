import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, getProjectsFromCategories } from '../../lib/xero'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const xget = (url, at, tid) => fetch(url, { headers: { Authorization: `Bearer ${at}`, 'Xero-Tenant-Id': tid, Accept: 'application/json' } })

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

// Pull ALL ACCREC (sales) invoices modified/dated in the window, ONE pass, and
// return them with the tracking OPTION NAME(s) on their line items. We match by
// NAME (e.g. "J242-Winnersh") — the same reliable text match the CSV upload uses,
// NOT by tracking-option GUID (which was returning 0).
async function fetchAllSalesInvoices(at, tid, fromDate) {
  const out = []            // { invoiceNumber, ..., trackingNames:[] }
  let page = 1
  while (true) {
    const url = `https://api.xero.com/api.xro/2.0/Invoices?Type=ACCREC&page=${page}&pageSize=100&order=Date%20DESC`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${at}`, 'Xero-Tenant-Id': tid, Accept: 'application/json' } })
    if (!res.ok) break
    const data = await res.json()
    const invoices = data.Invoices || []
    if (invoices.length === 0) break
    let anyInWindow = false
    for (const inv of invoices) {
      const dateStr = inv.DateString?.slice(0, 10) || (inv.Date && String(inv.Date).match(/\d{4}-\d{2}-\d{2}/) ? String(inv.Date).slice(0, 10) : null)
      if (dateStr && dateStr < fromDate) continue   // older than window — skip
      anyInWindow = true
      // The paged list often omits LineItems — re-fetch full invoice for tracking.
      await sleep(80)
      const r2 = await xget(`https://api.xero.com/api.xro/2.0/Invoices/${inv.InvoiceID}`, at, tid)
      if (!r2.ok) continue
      const full = ((await r2.json()).Invoices || [])[0]
      if (!full) continue
      const trackingNames = new Set()
      for (const line of (full.LineItems || [])) {
        for (const t of (line.Tracking || [])) {
          // t.Option is the option label, e.g. "J242-Winnersh". t.Name is the
          // category ("Projects"). Match on the option label by name.
          if (t.Option) trackingNames.add(String(t.Option).trim().toLowerCase())
        }
      }
      out.push({
        invoiceNumber: full.InvoiceNumber || '', xeroInvoiceId: full.InvoiceID || null,
        date: full.DateString?.slice(0, 10), dueDate: full.DueDateString?.slice(0, 10) || '',
        contact: full.Contact?.Name || '', reference: full.Reference || '',
        total: full.Total || 0, amountPaid: full.AmountPaid || 0, amountDue: full.AmountDue || 0,
        status: full.Status || '', trackingNames: [...trackingNames],
      })
    }
    if (invoices.length < 100) break
    if (!anyInWindow) break   // sorted newest-first: no more in window
    page++; await sleep(300)
  }
  return out
}

// On-demand: refresh Sales Invoices for ALL projects over a window (default 6 mo).
// Exact-mirror within the window (older invoices preserved).
export default async function handler(req, res) {
  if (!requireRole(req, res, ['accounts', 'management', 'admin'])) return
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  const last = await redis.get('sync-invoices:at').catch(() => null)
  if (last && Date.now() - new Date(last).getTime() < 45000) {
    return res.status(429).json({ error: 'Just synced — please wait a moment before syncing again.' })
  }

  try {
    let tokens = await getTokens()
    if (!tokens?.refresh_token) return res.status(400).json({ error: 'Xero not connected.' })
    try { const nt = await refreshXeroToken(tokens.refresh_token); if (nt?.access_token) { tokens = { ...tokens, ...nt }; await saveTokens(tokens) } }
    catch { return res.status(400).json({ error: 'Could not refresh Xero token — reconnect Xero.' }) }
    const tenantId = tokens.tenant_id

    const months = Math.min(24, Math.max(1, parseInt(req.body?.months) || 6))
    const win = new Date(); win.setMonth(win.getMonth() - months)
    const winStr = win.toISOString().split('T')[0]

    // Map tracking-option NAME -> project id (same basis as the CSV importer).
    const cats = await getProjectsFromCategories(tokens.access_token, tenantId)
    const nameToId = new Map()
    for (const cp of cats) nameToId.set((cp.name || '').trim().toLowerCase(), cp.trackingOptionId)

    // One pass: fetch all sales invoices in the window.
    const all = await fetchAllSalesInvoices(tokens.access_token, tenantId, winStr)

    // Group per project by tracking-name match; unmatched -> __UNASSIGNED__.
    const byProject = new Map()   // pid -> invoices[]
    let matchedInv = 0, unassignedInv = 0
    for (const inv of all) {
      let pid = null
      for (const tn of inv.trackingNames) { if (nameToId.has(tn)) { pid = nameToId.get(tn); break } }
      const key = pid || '__UNASSIGNED__'
      if (!byProject.has(key)) byProject.set(key, [])
      byProject.get(key).push(inv)
      if (pid) matchedInv++; else unassignedInv++
    }

    // Store per project — exact-mirror within window (keep older invoices).
    for (const [pid, invoices] of byProject.entries()) {
      const existing = (await redis.get(`invoiced:lines:${pid}`).catch(() => null)) || []
      const outside = existing.filter(l => !l.date || l.date < winStr)
      const merged = [...outside, ...invoices]
      const tot = merged.reduce((s, l) => s + (l.total || 0), 0)
      const paid = merged.reduce((s, l) => s + (l.amountPaid || 0), 0)
      const due = merged.reduce((s, l) => s + (l.amountDue || 0), 0)
      await redis.set(`invoiced:lines:${pid}`, merged)
      await redis.set(`invoiced:latest:${pid}`, { totalInvoiced: tot, paidTotal: paid, dueTotal: due, invoiceCount: merged.length, calculatedAt: new Date().toISOString(), source: 'sync_button' })
    }

    await redis.del('dashboard:cache')
    await redis.set('sync-invoices:at', new Date().toISOString())
    res.json({ ok: true, months, invoicesFetched: all.length, invoicesMatched: matchedInv, invoicesUnassigned: unassignedInv, projectsTouched: byProject.size })
  } catch (e) {
    console.error('sync-invoices error:', e)
    res.status(500).json({ error: e.message })
  }
}
