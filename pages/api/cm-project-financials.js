import { Redis } from '@upstash/redis'
import { computeProjectWip } from '../../lib/wipCalc'
import { nameMatches, normJobNo } from '../../lib/cmSiteApp'
import { getOpsProjects } from '../../lib/db'

// High-level project financials for the Contracts Manager Site App.
//
// GET /api/cm-project-financials?no=<projectNo>&xeroId=<id>&name=<cm name>
//
// xeroId is supplied by the page, which resolves it from /api/dashboard the same way the
// CM Applications screen already does. When it is supplied this reads the UNDERLYING
// stores directly - project:<xeroId>, costs:latest:<xeroId>, costs:lines:<xeroId>,
// invoiced:lines:<xeroId> - so it no longer depends on the dashboard snapshot existing,
// being fresh, or being any particular shape. Without xeroId it falls back to the snapshot.
//
// Margin is on the SAME basis as the EOM report (last completed month's valuation date,
// including WIP) via the shared computeProjectWip, so site and Commercial agree.

const redis = new Redis({
  url: process.env.kv_KV_REST_API_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.kv_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
})

const numOr0 = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const no = String(req.query.no || '').trim()
  const who = String(req.query.name || '').trim()
  let xeroId = String(req.query.xeroId || '').trim()
  if (!no) return res.status(400).json({ error: 'Project number required' })
  if (!who) return res.status(401).json({ error: 'Not identified' })

  // ---- Access: the caller must be the Contracts Manager on this project. ----
  // Checked against the OPS project list, the same source the Site App uses to decide
  // whose projects are whose.
  //
  // CAREFUL: getOpsProjects() returns the RAW records, where the fields live nested under
  // .data - { projectNo, data: { contractsManager, ... } }. It is /api/ops-projects that
  // flattens them for the app. Reading x.contractsManager off a raw record is always
  // undefined, which is why a project could appear in the CM's list and then refuse to
  // open. Read both shapes so it works either way.
  let opsProject = null
  try {
    const opsProjects = (await getOpsProjects()) || []
    opsProject = opsProjects.find(x => normJobNo(x.projectNo) === normJobNo(no)) || null
  } catch {}
  const opsCM = (opsProject && (opsProject.data?.contractsManager || opsProject.contractsManager)) || ''
  let allowed = !!(opsCM && nameMatches(who, opsCM))

  // ---- Resolve the project's financial record ----
  let p = null
  if (xeroId) {
    const settings = (await redis.get(`project:${xeroId}`).catch(() => null)) || {}
    const costCache = (await redis.get(`costs:latest:${xeroId}`).catch(() => null)) || {}
    const vars = Array.isArray(settings.variations) ? settings.variations : []
    const instructed = vars.filter(v => v.instructed)
    p = {
      xeroId,
      jobNo: no,
      name: (opsProject && (opsProject.data?.projectName || opsProject.projectName)) || settings.projectName || '',
      contractsManager: settings.contractsManager || '',
      overrideCM: (settings.peopleOverride && settings.peopleOverride.contractsManager) || '',
      labourBudget: numOr0(settings.labourBudget) + instructed.reduce((s, v) => s + numOr0(v.labour), 0),
      materialsBudget: numOr0(settings.materialsBudget) + instructed.reduce((s, v) => s + numOr0(v.materials), 0),
      labourSpend: numOr0(costCache.labourSpend),
      materialsSpend: numOr0(costCache.materialsSpend),
      valuationDay: settings.valuationDay || null,
      dateOverrides: settings.dateOverrides || {},
      wipMarginOverride: (settings.wipMarginOverride != null && settings.wipMarginOverride !== '') ? settings.wipMarginOverride : null,
      wipAdjustments: (await redis.get(`wip:adjustments:${xeroId}`).catch(() => null)) || [],
    }
  } else {
    // Fallback: the dashboard snapshot. Stored as a BARE ARRAY, not { projects: [...] }.
    let snap = null
    try { snap = await redis.get('dashboard:cache') } catch {}
    const rows = Array.isArray(snap) ? snap : (snap && Array.isArray(snap.projects) ? snap.projects : [])
    if (!rows.length) {
      return res.status(503).json({ error: 'Financial data has not been built yet. Open Project Financials in the portal once, then try again.' })
    }
    p = rows.find(r => normJobNo(r.jobNo || r.projectNo) === normJobNo(no)) || null
    if (!p) return res.status(404).json({ error: 'This project has no financial record in Xero yet.' })
    xeroId = p.xeroId
  }

  // A CM named on the financial record counts too - covers projects where the Ops record
  // has no CM but Commercial have set one, including a commercial override (which is what
  // Edit Project Details shows and therefore what the person will expect).
  if (!allowed && p.contractsManager && nameMatches(who, p.contractsManager)) allowed = true
  if (!allowed && p.overrideCM && nameMatches(who, p.overrideCM)) allowed = true
  if (!allowed) {
    return res.status(403).json({
      error: `You are not listed as the Contracts Manager on ${no}.`
        + (opsCM ? ` It is currently set to ${opsCM}.` : ' No Contracts Manager is set on this project.')
        + ' Check the Contracts Manager in Ops > Projects > Project Details.',
    })
  }

  // ---- Margin on the EOM basis: last COMPLETED month's valuation date, inc WIP ----
  const nowD = new Date()
  const lastFull = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1)
  const eomYear = lastFull.getFullYear()
  const eomMonth = lastFull.getMonth() + 1
  const eomMonthKey = `${eomYear}-${String(eomMonth).padStart(2, '0')}`
  const monthEndStr = new Date(Date.UTC(eomYear, eomMonth, 0)).toISOString().split('T')[0]

  let valStr = null
  const ov = p.dateOverrides && p.dateOverrides[eomMonthKey] && p.dateOverrides[eomMonthKey].valuationDate
  if (ov) valStr = ov
  else if (p.valuationDay) {
    const dim = new Date(eomYear, eomMonth, 0).getDate()
    const day = Math.min(parseInt(p.valuationDay), dim)
    valStr = new Date(Date.UTC(eomYear, eomMonth - 1, day)).toISOString().split('T')[0]
  }

  const cLines = (await redis.get(`costs:lines:${xeroId}`).catch(() => null)) || []
  const iLines = (await redis.get(`invoiced:lines:${xeroId}`).catch(() => null)) || []

  let margin = null, invoicedIncWip = 0, profitIncWip = 0
  if (valStr) {
    try {
      const invVal = (i) => (i.sales200 != null ? i.sales200 : (i.subTotal != null ? i.subTotal : 0))
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

  // ---- Cost lines, split labour / materials ----
  // Bills lines carry a Labour/Materials type. Wages lines predate that field, so fall
  // back to the same account-code rule the importer uses (config first, then 320/321).
  let catConfig = {}
  try { catConfig = (await redis.get('config:account-categorisation')) || {} } catch {}
  const DEFAULT_LABOUR_CODES = ['320', '321']
  const isLabourLine = (l) => {
    if (l.type) return String(l.type).toLowerCase() === 'labour'
    const code = String(l.accountCode || '')
    const cfg = catConfig[code]
    if (cfg && cfg.category) return cfg.category === 'labour'
    return DEFAULT_LABOUR_CODES.includes(code)
  }

  let costs = (Array.isArray(cLines) ? cLines : []).map(l => ({
    date: l.date || '',
    supplier: l.supplier || '',
    description: l.description || '',
    reference: l.reference || '',
    amount: numOr0(l.amount),
    type: isLabourLine(l) ? 'Labour' : 'Materials',
  }))
  costs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))

  const CAP = 400
  const costsTruncated = costs.length > CAP
  const costTotals = {
    labour: costs.filter(c => c.type === 'Labour').reduce((s, c) => s + c.amount, 0),
    materials: costs.filter(c => c.type === 'Materials').reduce((s, c) => s + c.amount, 0),
    count: costs.length,
  }
  if (costsTruncated) costs = costs.slice(0, CAP)

  // ---- Budgets vs spend. Budgets include instructed variations. ----
  const labourBudget = numOr0(p.labourBudget)
  const materialsBudget = numOr0(p.materialsBudget)
  // Spend from the aggregate cost cache; if that is empty but we have lines, total the
  // lines instead so the page is never blank just because the aggregate is stale.
  const labourSpend = numOr0(p.labourSpend) || costTotals.labour
  const materialsSpend = numOr0(p.materialsSpend) || costTotals.materials

  const block = (budget, spend) => ({
    budget, spend,
    remaining: budget - spend,
    pctUsed: budget > 0 ? (spend / budget) : null,
    over: budget > 0 && spend > budget,
  })

  return res.json({
    projectNo: p.jobNo || no,
    projectName: p.name || '',
    asAt: valStr,
    asAtMonth: eomMonthKey,
    margin,
    invoicedIncWip,
    profitIncWip,
    labour: block(labourBudget, labourSpend),
    materials: block(materialsBudget, materialsSpend),
    total: block(labourBudget + materialsBudget, labourSpend + materialsSpend),
    costs,
    costTotals,
    costsTruncated,
    stale: !valStr,
  })
}
