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
  for (const p of (Array.isArray(dashCache) ? dashCache : [])) {
    if (p && p.xeroId) meta[String(p.xeroId)] = { name: p.name || '', jobNo: p.jobNo || '' }
  }
  const projectIds = Object.keys(settingsMap)

  const out = []
  let totalWip = 0

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

    // Margin: override if set, else derive from settings budgets (labour+materials vs
    // contract value). Fall back to 0 so WIP is just the cost if no margin known.
    let margin = null
    if (settings.wipMarginOverride) margin = parseFloat(settings.wipMarginOverride) / 100
    else {
      const cv = parseFloat(settings.contractValue || 0)
      const budget = parseFloat(settings.labourBudget || 0) + parseFloat(settings.materialsBudget || 0)
      if (cv > 0 && budget > 0) margin = (cv - budget) / cv
    }

    const adjustedCosts = postValTotal + adjTotal
    const wipValue = (margin != null && margin < 1 && adjustedCosts > 0) ? adjustedCosts / (1 - margin) : Math.max(0, adjustedCosts)

    // Only include projects that have something to show this month.
    const hasContent = postValCosts.length > 0 || creditNotes.length > 0 || thisMonthAdj.length > 0 || lastMonthAdj.length > 0
    if (!hasContent && wipValue === 0) continue

    // Total WIP = costs + margin + manual adjustments only. Credit notes are shown
    // for information (right column) and are NOT deducted from WIP.
    totalWip += wipValue
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
    })
  }

  out.sort((a, b) => (a.jobNo || a.name).localeCompare(b.jobNo || b.name, undefined, { numeric: true }))

  return res.json({ month, monthEnd: monthEndStr, projects: out, totalWip })
}
