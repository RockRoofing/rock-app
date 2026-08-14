import { Redis } from '@upstash/redis'
import { computeProjectWip } from '../../lib/wipCalc'
import { nameMatches, normJobNo } from '../../lib/cmSiteApp'

// High-level project financials for the Contracts Manager Site App.
//
// GET /api/cm-project-financials?no=<projectNo>&name=<cm name>
//
// Deliberately HIGH LEVEL and READ ONLY - margin, and budget vs spend vs remaining for
// labour and materials. No invoice lines, no cost lines, no retention, no WIP detail.
//
// The margin is calculated on the SAME basis as the EOM report (last completed month's
// valuation date, including WIP) using the shared computeProjectWip, so the number a CM
// sees on site matches the number Commercial sees.
//
// ACCESS: the caller must be named as the Contracts Manager on the project. The Site App
// has no portal cookie, so the name is supplied by the client - the same trust model the
// other CM Site App screens already use.

const redis = new Redis({
  url: process.env.kv_KV_REST_API_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.kv_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
})

const numOr0 = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const no = String(req.query.no || '').trim()
  const who = String(req.query.name || '').trim()
  if (!no) return res.status(400).json({ error: 'Project number required' })
  if (!who) return res.status(401).json({ error: 'Not identified' })

  // Dashboard snapshot carries the budgets, spends and the per-project date settings.
  let snap = null
  try { snap = await redis.get('dashboard:cache') } catch {}
  const rows = (snap && Array.isArray(snap.projects)) ? snap.projects : []
  const p = rows.find(r => normJobNo(r.jobNo || r.projectNo) === normJobNo(no))
  if (!p) return res.status(404).json({ error: 'No financial data for this project yet.' })

  // Only the project's own Contracts Manager may see this.
  if (!nameMatches(who, p.contractsManager || '')) {
    return res.status(403).json({ error: 'You are not the Contracts Manager on this project.' })
  }

  // ---- Margin on the EOM basis: last COMPLETED month's valuation date, inc WIP ----
  const nowD = new Date()
  const lastFull = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1)
  const eomYear = lastFull.getFullYear()
  const eomMonth = lastFull.getMonth() + 1
  const eomMonthKey = `${eomYear}-${String(eomMonth).padStart(2, '0')}`
  const monthEndStr = new Date(Date.UTC(eomYear, eomMonth, 0)).toISOString().split('T')[0]

  // Valuation date: a per-month override wins, otherwise the project's valuation day.
  let valStr = null
  const ov = p.dateOverrides && p.dateOverrides[eomMonthKey] && p.dateOverrides[eomMonthKey].valuationDate
  if (ov) valStr = ov
  else if (p.valuationDay) {
    const dim = new Date(eomYear, eomMonth, 0).getDate()
    const day = Math.min(parseInt(p.valuationDay), dim)
    valStr = new Date(Date.UTC(eomYear, eomMonth - 1, day)).toISOString().split('T')[0]
  }

  let margin = null, invoicedIncWip = 0, profitIncWip = 0
  if (valStr) {
    try {
      const invVal = (i) => (i.sales200 != null ? i.sales200 : (i.subTotal != null ? i.subTotal : 0))
      const cLines = (await redis.get(`costs:lines:${p.xeroId}`).catch(() => null)) || []
      const iLines = (await redis.get(`invoiced:lines:${p.xeroId}`).catch(() => null)) || []
      const costsToDate = cLines.filter(l => l.date && l.date <= valStr).reduce((s, l) => s + (l.amount || 0), 0)
      const grossToDate = iLines.filter(l => l.date && l.date <= valStr).reduce((s, l) => s + invVal(l), 0)
      const monthAdj = Array.isArray(p.wipAdjustments) ? p.wipAdjustments.filter(a => a.month === eomMonthKey) : []
      const w = computeProjectWip({
        costLines: cLines, invoiceLines: iLines, valStr, monthEndStr,
        adjustments: monthAdj, marginOverride: p.wipMarginOverride,
      })
      invoicedIncWip = grossToDate + (w.wipValue || 0)
      profitIncWip = (grossToDate - costsToDate) + (w.wipProfit || 0)
      margin = invoicedIncWip > 0 ? profitIncWip / invoicedIncWip : null
    } catch { margin = null }
  }

  // ---- Budget vs spend. Budgets already include instructed variations. ----
  const labourBudget = numOr0(p.labourBudget)
  const labourSpend = numOr0(p.labourSpend)
  const materialsBudget = numOr0(p.materialsBudget)
  const materialsSpend = numOr0(p.materialsSpend)

  const block = (budget, spend) => ({
    budget, spend,
    remaining: budget - spend,
    pctUsed: budget > 0 ? (spend / budget) : null,
    over: budget > 0 && spend > budget,
  })

  return res.json({
    projectNo: p.jobNo || no,
    projectName: p.name || '',
    contractsManager: p.contractsManager || '',
    asAt: valStr,                                  // the valuation date the margin is at
    asAtMonth: eomMonthKey,
    margin,                                        // 0-1, or null when not calculable
    invoicedIncWip,
    profitIncWip,
    labour: block(labourBudget, labourSpend),
    materials: block(materialsBudget, materialsSpend),
    total: block(labourBudget + materialsBudget, labourSpend + materialsSpend),
    stale: !valStr,
  })
}
