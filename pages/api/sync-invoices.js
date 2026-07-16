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

async function fetchSalesInvoices(at, tid, trackingOptionId, trackingCategoryId, fromDate) {
  const byNumber = new Map()
  let page = 1
  while (true) {
    let url = `https://api.xero.com/api.xro/2.0/Invoices?Type=ACCREC&page=${page}&pageSize=100&DateFrom=${fromDate}`
    if (trackingCategoryId) url += `&TrackingCategoryID=${trackingCategoryId}&TrackingOptionID=${trackingOptionId}`
    const res = await xget(url, at, tid)
    if (!res.ok) break
    const data = await res.json()
    const invoices = data.Invoices || []
    if (invoices.length === 0) break
    for (const inv of invoices) {
      await sleep(80)
      const r2 = await xget(`https://api.xero.com/api.xro/2.0/Invoices/${inv.InvoiceID}`, at, tid)
      if (!r2.ok) continue
      const full = ((await r2.json()).Invoices || [])[0]
      if (!full) continue
      const tagged = (full.LineItems || []).some(line => (line.Tracking || []).some(t => t.TrackingOptionID === trackingOptionId))
      if (!tagged) continue
      byNumber.set(full.InvoiceNumber || full.InvoiceID, {
        invoiceNumber: full.InvoiceNumber || '', xeroInvoiceId: full.InvoiceID || null,
        date: full.DateString?.slice(0, 10), dueDate: full.DueDateString?.slice(0, 10) || '',
        contact: full.Contact?.Name || '', reference: full.Reference || '',
        total: full.Total || 0, amountPaid: full.AmountPaid || 0, amountDue: full.AmountDue || 0,
        status: full.Status || '',
      })
    }
    if (invoices.length < 100) break
    page++; await sleep(300)
  }
  return [...byNumber.values()]
}

// On-demand: refresh Sales Invoices for ALL projects over a window (default 6 mo).
// Exact-mirror within the window (older invoices preserved). Cheap-ish; batched.
export default async function handler(req, res) {
  if (!requireRole(req, res, ['accounts', 'management', 'admin'])) return
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  // Throttle: no more than once per 45s.
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

    const cats = await getProjectsFromCategories(tokens.access_token, tenantId)
    let projectsDone = 0, invoicesTotal = 0
    for (const cp of cats) {
      const pid = cp.trackingOptionId, pcat = cp.trackingCategoryId
      try {
        const sLines = await fetchSalesInvoices(tokens.access_token, tenantId, pid, pcat, winStr)
        const existing = (await redis.get(`invoiced:lines:${pid}`).catch(() => null)) || []
        const outside = existing.filter(l => !l.date || l.date < winStr)   // keep older than window
        const merged = [...outside, ...sLines]
        const tot = merged.reduce((s, l) => s + (l.total || 0), 0)
        const paid = merged.reduce((s, l) => s + (l.amountPaid || 0), 0)
        const due = merged.reduce((s, l) => s + (l.amountDue || 0), 0)
        await redis.set(`invoiced:lines:${pid}`, merged)
        await redis.set(`invoiced:latest:${pid}`, { totalInvoiced: tot, paidTotal: paid, dueTotal: due, invoiceCount: merged.length, calculatedAt: new Date().toISOString(), source: 'sync_button' })
        projectsDone++; invoicesTotal += sLines.length
        await sleep(120)
      } catch (e) { console.error('sync invoices failed', cp.jobNo, e.message) }
    }

    await redis.del('dashboard:cache')
    await redis.set('sync-invoices:at', new Date().toISOString())
    res.json({ ok: true, months, projectsDone, invoicesRefreshed: invoicesTotal })
  } catch (e) {
    console.error('sync-invoices error:', e)
    res.status(500).json({ error: e.message })
  }
}
