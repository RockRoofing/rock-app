import { get, set } from './db'
import { Redis } from '@upstash/redis'

// MONTHLY GP MARGIN SNAPSHOTS, per estimator.
//
// The GP margin card had no month dimension at all: it summed every project currently
// in progress and divided, ignoring the month entirely. Every month on the chart showed
// the same number and the trendline was flat by construction.
//
// This records a real figure for each month so the card can show movement.
//
// TAKEN AFTER THE 21st, for the month before - so the EOM report has settled and late
// invoices and costs are in. Each run also RE-SNAPSHOTS the previous 6 months, because
// things get processed late and a month's figure should improve as the picture completes.
//
// THE PART THAT NEEDED CARE
// -------------------------
// A project's live/defects/complete status is a MANUAL flag in the retention tracker.
// There is no record of when it changed. So "which projects were live in July" cannot be
// reconstructed after the fact - only "which are live now".
//
// If a re-snapshot re-derived the project list, a job that moved to defects in September
// would vanish from July's figure, and July would change months later for a reason that
// has nothing to do with July. History would quietly rewrite itself.
//
// So the project SET is recorded once, with the first snapshot of that month, and reused
// on every re-run. Only the MONEY is recomputed. That gives you exactly what you asked
// for - late costs and invoices captured - without the membership drifting.

const KEY = 'crm:gp-snapshots'
const MONTHS_BACK = 6

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
})

const monthEnd = (mk) => {
  const [y, m] = mk.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

export async function getGpSnapshots() {
  const v = await get(KEY)
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}
}

// Everything invoiced and spent on one project up to the end of a month.
// Both line stores carry a date, which is what makes a past month recomputable at all.
async function projectTotalsToDate(xeroId, cutoff) {
  let grossInvoiced = 0, totalCosts = 0
  try {
    const lines = await redis.get(`invoiced:lines:${xeroId}`)
    if (Array.isArray(lines)) {
      const inWindow = lines.filter((l) => l.date && String(l.date).slice(0, 10) <= cutoff)
      // Mirrors the live card: prefer the Sales 200 total, fall back to ex-VAT subtotal.
      const s200 = inWindow.reduce((s, l) => s + (l.sales200 || 0), 0)
      grossInvoiced = s200 > 0 ? s200 : inWindow.reduce((s, l) => s + (l.subTotal || 0), 0)
    }
  } catch { /* no invoice lines for this project */ }
  try {
    const lines = await redis.get(`costs:lines:${xeroId}`)
    if (Array.isArray(lines)) {
      totalCosts = lines
        .filter((l) => l.date && String(l.date).slice(0, 10) <= cutoff)
        .reduce((s, l) => s + (l.amount || 0), 0)
    }
  } catch { /* no cost lines for this project */ }
  return { grossInvoiced, totalCosts }
}

// Build one month. projectSet is the list of xeroIds to use; pass null to take the ones
// live right now (only correct for the month just gone).
async function buildMonth(monthKey, projects, projectSet) {
  const cutoff = monthEnd(monthKey)
  // The field is `status`, not `stage`. /api/dashboard computes a variable called stage
  // and returns it as `status` - I filtered on the variable name rather than the key, so
  // nothing matched and every month recorded zero projects.
  // `stage` accepted too, in case that endpoint is ever tidied up.
  const ids = projectSet || projects
    .filter((p) => (p.status || p.stage) === 'INPROGRESS')
    .map((p) => String(p.xeroId))
  const byId = new Map(projects.map((p) => [String(p.xeroId), p]))

  const byEstimator = {}
  for (const id of ids) {
    const p = byId.get(String(id))
    // A project can leave the Xero list entirely. Skip rather than guess at its figures.
    if (!p) continue
    const est = (p.estimator || '').trim() || 'Unassigned'
    const { grossInvoiced, totalCosts } = await projectTotalsToDate(id, cutoff)
    const e = byEstimator[est] || (byEstimator[est] = { grossInvoiced: 0, totalCosts: 0, count: 0 })
    e.grossInvoiced += grossInvoiced
    e.totalCosts += totalCosts
    e.count++
  }
  for (const e of Object.values(byEstimator)) {
    e.profit = e.grossInvoiced - e.totalCosts
    e.margin = e.grossInvoiced > 0 ? e.profit / e.grossInvoiced : null
  }
  return { takenAt: new Date().toISOString(), cutoff, projects: ids, byEstimator }
}

// projects: the array from /api/dashboard - needs xeroId, stage and estimator on each.
export async function refreshGpSnapshots(projects, { months = MONTHS_BACK, only = '' } = {}) {
  if (!Array.isArray(projects) || !projects.length) {
    return { ok: false, error: 'No project data supplied - is /api/dashboard returning projects?' }
  }
  // Say what was seen. A run that reports zero projects with no explanation is exactly
  // how the last one wasted a deploy.
  const liveNow = projects.filter((p) => (p.status || p.stage) === 'INPROGRESS').length
  const statusCounts = {}
  for (const p of projects) { const k = String(p.status || p.stage || 'undefined'); statusCounts[k] = (statusCounts[k] || 0) + 1 }
  const store = await getGpSnapshots()

  // Months to (re)build: last month, then the 5 before it.
  const now = new Date()
  const targets = []
  if (only) targets.push(only)
  else {
    for (let i = 1; i <= months; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
      targets.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
    }
  }

  const done = []
  for (const mk of targets) {
    const existing = store[mk]
    // Reuse the recorded membership. Only the newest month, seen for the first time,
    // takes today's live set - see the note at the top of this file.
    //
    // An EMPTY recorded set is not a set worth protecting - it is the mark of a failed
    // run, and reusing it would keep the month permanently empty with no way back short
    // of deleting the key by hand. So an empty one is rebuilt.
    const reusable = existing && Array.isArray(existing.projects) && existing.projects.length > 0
    const built = await buildMonth(mk, projects, reusable ? existing.projects : null)
    built.projectSetFrom = reusable ? (existing.projectSetFrom || 'reused') : 'live at first snapshot'
    store[mk] = built
    done.push({ month: mk, projects: built.projects.length, estimators: Object.keys(built.byEstimator).length, reusedSet: reusable })
  }
  await set(KEY, store)
  const result = { ok: true, projectsSeen: projects.length, liveNow, statusCounts, months: done }
  if (!liveNow) result.warning = 'No projects came back as INPROGRESS - check statusCounts against what Project Financials shows.'
  return result
}
