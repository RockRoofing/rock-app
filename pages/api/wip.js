import { requireRole } from '../../lib/portalAuth'
import { getAllProjectSettings } from '../../lib/db'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const prevMonthKey = (mk) => { const [y, m] = mk.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

// GET /api/wip?month=YYYY-MM  (defaults to the current month)
// Returns per-project WIP for the chosen month: post-valuation costs (day after the
// valuation date → end of month), credit notes against the project, this month's
// manual adjustments, and last month's adjustments (for information only).
export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  const now = new Date()
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [my, mm] = month.split('-').map(Number)
  const monthStart = new Date(my, mm - 1, 1)
  const monthEnd = new Date(my, mm, 0)                 // last day of the month
  const monthEndStr = iso(monthEnd)

  const settingsMap = await getAllProjectSettings()
  // Real project names/job numbers live on the Xero tracking categories, surfaced via
  // the dashboard cache (keyed by xeroId). Settings alone only has the GUID key, so
  // use the cache to resolve display names.
  const dashCache = (await redis.get('dashboard:cache').catch(() => null)) || []
  const meta = {}
  const missingDates = []
  for (const p of (Array.isArray(dashCache) ? dashCache : [])) {
    if (p && p.xeroId) meta[String(p.xeroId)] = { name: p.name || '', jobNo: p.jobNo || '' }
    // Projects missing application/valuation days (same test as the Applications page):
    // no applicationDay/valuationDay and no per-month date overrides.
    const hasAppDay = !!(parseInt(p.applicationDay) || Object.keys(p.dateOverrides || {}).length)
    const hasValDay = !!(parseInt(p.valuationDay) || Object.keys(p.dateOverrides || {}).length)
    if (p && p.xeroId && p.name && !(hasAppDay && hasValDay)) {
      missingDates.push({ xeroId: String(p.xeroId), jobNo: p.jobNo || '', name: p.name || '' })
    }
  }
  const projectIds = Object.keys(settingsMap)

  const out = []
  let totalWip = 0
  let totalWipProfit = 0

  for (const id of projectIds) {
    const settings = settingsMap[id] || {}
    // Real name/job number from the dashboard cache; fall back to settings.
    const m = meta[String(id)] || {}
    const name = m.name || settings.name || settings.projectName || ''
    const jobNo = m.jobNo || settings.jobNo || ''
    // If we can't resolve a real name, this GUID isn't a live tracked project — skip
    // so we never show a raw ID.
    if (!name && !jobNo) continue

    // Resolve the valuation date FOR THIS MONTH: a per-month override wins, else the
    // fixed valuation day applied to this month.
    let valDate = null
    const ov = settings.dateOverrides?.[month]?.valuationDate
    if (ov) valDate = new Date(ov + 'T00:00:00Z')
    else if (settings.valuationDay) {
      const day = Math.min(parseInt(settings.valuationDay), monthEnd.getDate())
      valDate = new Date(Date.UTC(my, mm - 1, day))
    }
    // If we still have no valuation date, skip (can't compute WIP window).
    if (!valDate) continue
    const valStr = iso(valDate)

    // Costs from the DAY AFTER the valuation date to end of month. If the valuation
    // date is the end of the month, this window is empty.
    const costLines = (await redis.get(`costs:lines:${id}`).catch(() => null)) || []
    const postValCosts = costLines.filter(l => l.date && l.date > valStr && l.date <= monthEndStr)
    const postValTotal = postValCosts.reduce((s, l) => s + (l.amount || 0), 0)

    // Credit notes issued against the project (from the invoice lines, flagged).
    const invLines = (await redis.get(`invoiced:lines:${id}`).catch(() => null)) || []
    const creditNotes = invLines
      .filter(l => l.creditNote)
      .map(l => ({
        date: l.date || '',
        number: l.invoiceNumber || '',
        appliedTo: l.appliedToInvoice || l.reference || '',
        amount: Math.abs(l.sales200 != null ? l.sales200 : (l.subTotal || l.total || 0)),
        contact: l.contact || '',
      }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

    // Manual WIP adjustments for this month, and last month's (info only).
    const adjustments = (await redis.get(`wip:adjustments:${id}`).catch(() => null)) || []
    const thisMonthAdj = adjustments.filter(a => a.month === month)
    const lastMonthAdj = adjustments.filter(a => a.month === prevMonthKey(month))
    const adjTotal = thisMonthAdj.reduce((s, a) => s + (a.amount || 0), 0)

    // Margin: per-project override wins. Otherwise use the LIVE ACHIEVED margin —
    // (invoiced − costs to the valuation date) ÷ invoiced — the same basis as
    // Project Financials / EOM, so the two pages reconcile.
    let margin = null
    if (settings.wipMarginOverride) {
      margin = parseFloat(settings.wipMarginOverride) / 100
    } else {
      const costsToDate = costLines.filter(l => l.date && l.date <= valStr).reduce((s, l) => s + (l.amount || 0), 0)
      const invVal = (i) => (i.sales200 != null ? i.sales200 : (i.subTotal != null ? i.subTotal : 0))
      const invoicedToDate = invLines
        .filter(l => l.date && l.date <= valStr)
        .reduce((s, l) => s + invVal(l), 0)   // credit notes are negative and net off
      margin = invoicedToDate > 0 ? (invoicedToDate - costsToDate) / invoicedToDate : null
    }

    const adjustedCosts = postValTotal + adjTotal
    // WIP = post-valuation costs grossed up at the PROJECT margin, PLUS each manual
    // adjustment grossed up at ITS OWN margin (which defaults to the project margin
    // when the adjustment doesn't specify one).
    // Gross an amount up to its WIP value at a given margin. Works for POSITIVE and
    // NEGATIVE amounts identically (amt / (1 - margin)), so an equal-and-opposite
    // adjustment at the SAME margin cancels the cost exactly. A margin of 0 (or none)
    // means the amount passes through unchanged.
    const gross = (amt, mgn) => {
      const m = (mgn != null && mgn < 1) ? mgn : 0
      return (amt || 0) / (1 - m)
    }
    let wipValue = gross(postValTotal, margin)
    for (const a of thisMonthAdj) {
      const am = (a.margin != null && a.margin !== '') ? Number(a.margin) / 100 : margin
      wipValue += gross(a.amount || 0, am)
    }
    wipValue = Math.max(0, wipValue)
    // Calculated profit in £ = WIP value − the cost that generated it (post-valuation
    // costs + manual adjustment amounts). This is the margin portion of the WIP.
    const wipCost = postValTotal + adjTotal
    const wipProfit = wipValue - wipCost

    // Only include projects that have something to show this month.
    const hasContent = postValCosts.length > 0 || creditNotes.length > 0 || thisMonthAdj.length > 0 || lastMonthAdj.length > 0
    if (!hasContent && wipValue === 0) continue

    // Total WIP = costs + margin + manual adjustments only. Credit notes are shown
    // for information (right column) and are NOT deducted from WIP.
    totalWip += wipValue
    totalWipProfit += wipProfit
    out.push({
      id, name, jobNo,
      valuationDate: valStr,
      valuationIsMonthEnd: valStr >= monthEndStr,
      postValCosts: postValCosts.map(l => ({ date: l.date, supplier: l.supplier || '', reference: l.reference || '', accountCode: l.accountCode || '', accountName: l.accountName || '', type: l.type || '', amount: l.amount || 0 })),
      postValTotal,
      creditNotes,
      thisMonthAdj,
      lastMonthAdj,
      adjTotal,
      margin,
      wipValue,
      wipProfit,
    })
  }

  out.sort((a, b) => (a.jobNo || a.name).localeCompare(b.jobNo || b.name, undefined, { numeric: true }))

  return res.json({ month, monthEnd: monthEndStr, projects: out, totalWip, totalWipProfit, missingDates })
}
