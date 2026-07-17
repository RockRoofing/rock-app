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
  const out = []
  let page = 1
  const [wy, wm, wd] = fromDate.split('-').map(n => parseInt(n, 10))
  const where = encodeURIComponent(`Type=="ACCREC" AND Date>=DateTime(${wy},${wm},${wd})`)
  while (true) {
    // The Invoices list endpoint returns full LineItems (incl. Tracking) per
    // invoice — so we read tracking straight from the page. NO per-invoice
    // re-fetch (that fired hundreds of calls and hit Xero's 60/min rate limit,
    // silently dropping invoices). One paged call = 100 invoices with tracking.
    const url = `https://api.xero.com/api.xro/2.0/Invoices?where=${where}&page=${page}&pageSize=100`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${at}`, 'Xero-Tenant-Id': tid, Accept: 'application/json' } })
    if (!res.ok) {
      // If rate-limited on the LIST call, wait and retry the same page.
      if (res.status === 429) { await sleep(2000); continue }
      break
    }
    const data = await res.json()
    const invoices = data.Invoices || []
    if (invoices.length === 0) break
    for (const full of invoices) {
      const dateStr = full.DateString?.slice(0, 10) || (full.Date && String(full.Date).match(/\d{4}-\d{2}-\d{2}/) ? String(full.Date).slice(0, 10) : null)
      if (dateStr && dateStr < fromDate) continue
      if (full.Type !== 'ACCREC') continue
      if (full.Status === 'DELETED' || full.Status === 'VOIDED') continue

      // Read tracking from the list row. If this invoice row has NO line items at
      // all (Xero sometimes omits them on list pages), re-fetch just this one —
      // with 429 backoff so we never silently drop it.
      let lineItems = full.LineItems
      if (!Array.isArray(lineItems) || lineItems.length === 0) {
        lineItems = await fetchInvoiceLineItems(at, tid, full.InvoiceID)
      }
      const trackingNames = new Set()
      for (const line of (lineItems || [])) {
        for (const t of (line.Tracking || [])) {
          if (t.Option) trackingNames.add(String(t.Option).trim().toLowerCase())
        }
      }
      out.push({
        invoiceNumber: full.InvoiceNumber || '', xeroInvoiceId: full.InvoiceID || null,
        date: dateStr, dueDate: full.DueDateString?.slice(0, 10) || '',
        contact: full.Contact?.Name || '', reference: full.Reference || '',
        total: full.Total || 0, subTotal: full.SubTotal != null ? full.SubTotal : (full.Total || 0),
        totalTax: full.TotalTax || 0,
        amountPaid: full.AmountPaid || 0, amountDue: full.AmountDue || 0,
        status: full.Status || '', trackingNames: [...trackingNames],
      })
    }
    if (invoices.length < 100) break
    page++; await sleep(1200)   // ~well under 60/min on the list calls
  }
  return out
}

// Re-fetch one invoice's line items, retrying on 429 so it's never dropped.
async function fetchInvoiceLineItems(at, tid, invoiceId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}`, {
      headers: { Authorization: `Bearer ${at}`, 'Xero-Tenant-Id': tid, Accept: 'application/json' }
    })
    if (r.status === 429) {
      const retry = parseInt(r.headers.get('Retry-After') || '2', 10)
      await sleep((retry + 1) * 1000)
      continue
    }
    if (!r.ok) return []
    const full = ((await r.json()).Invoices || [])[0]
    await sleep(400)   // gentle spacing between individual fetches
    return full?.LineItems || []
  }
  return []
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
