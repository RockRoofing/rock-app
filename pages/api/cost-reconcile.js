import { requireRole } from '../../lib/portalAuth'
import { get } from '../../lib/db'

// READ-ONLY diagnostic. Reconciles a single project's cost figures across the
// three bases so we can see WHY the Budget Tracker, EOM Report and Project page
// can differ:
//   1) cached costs:latest (all-time, import-time labour/materials split)
//   2) recomputed from costs:lines, ALL-TIME, labour = codes 320/321
//   3) recomputed from costs:lines, up to a given ?date=YYYY-MM-DD
//
// Usage: /api/cost-reconcile?id=<xeroId>&date=2027-06-30
export default async function handler(req, res) {
  const auth = await requireRole(req, res, ['post-contract', 'management', 'admin'])
  if (!auth) return

  const { id, date } = req.query
  if (!id) return res.status(400).json({ error: 'id (xero project id) required' })

  const LAB = ['320', '321']
  const cache = (await get(`costs:latest:${id}`)) || null
  const lines = (await get(`costs:lines:${id}`)) || []

  const sum = (arr) => arr.reduce((s, l) => s + (l.amount || 0), 0)
  const labOf = (arr) => sum(arr.filter(l => LAB.includes(String(l.accountCode || ''))))

  // All-time, recomputed from lines with the 320/321 rule.
  const allTotal = sum(lines)
  const allLabour = labOf(lines)
  const allMaterials = allTotal - allLabour

  // Up to date (if supplied).
  let dated = null
  if (date) {
    const inWin = lines.filter(l => l.date && l.date <= date)
    const t = sum(inWin), lab = labOf(inWin)
    dated = { date, total: t, labour: lab, materials: t - lab, lineCount: inWin.length }
  }

  // Break down all-time lines by account code so we can spot mis-classification.
  const byCode = {}
  for (const l of lines) {
    const c = String(l.accountCode || 'none')
    if (!byCode[c]) byCode[c] = { code: c, amount: 0, lineCount: 0, sampleType: l.type || '' }
    byCode[c].amount += (l.amount || 0)
    byCode[c].lineCount += 1
  }
  const codeBreakdown = Object.values(byCode).sort((a, b) => b.amount - a.amount)

  // How many lines carry a type of 'Labour' vs how many are coded 320/321 — this
  // exposes cache-vs-recompute classification drift.
  const typedLabour = sum(lines.filter(l => l.type === 'Labour'))
  const codedLabour = allLabour

  return res.json({
    id,
    cached_costs_latest: cache ? {
      labourSpend: cache.labourSpend, materialsSpend: cache.materialsSpend,
      totalCosts: cache.totalCosts, calculatedAt: cache.calculatedAt, source: cache.source,
    } : null,
    recomputed_all_time_320_321: { total: allTotal, labour: allLabour, materials: allMaterials, lineCount: lines.length },
    recomputed_to_date: dated,
    classification_check: {
      labour_by_type_field: typedLabour,
      labour_by_code_320_321: codedLabour,
      difference: typedLabour - codedLabour,
      note: 'If non-zero, some lines are labelled Labour by the import config but are NOT coded 320/321 (or vice-versa) — that is the cache-vs-recompute labour mismatch.',
    },
    account_code_breakdown: codeBreakdown,
  })
}
