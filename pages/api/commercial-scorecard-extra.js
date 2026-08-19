import { get } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { canAccessArea } from '../../lib/roles'

// Extra Commercial Scorecard metrics, computed server-side:
//   - weeklyTaskPct / monthlyTaskPct: % of task cells marked "Yes" from the Commercial
//     Tasks page, per period, from 30 Jul 2026 (tracking start) up to the current period.
//   - weeklyReports: per week, how many required project reports were completed.
//       Required = projects with at least one 'actual' planning day that week.
//       Completed for a project = at least one report dated within that week (capped at
//       100% per project - 2 reports for one project is still 100%).
//
// GET  ?weeks=12&months=12  -> { weeklyTask:[{key,pct}], monthlyTask:[{key,pct}],
//                                weeklyReports:[{key, required, completed, pct}] }

const OBJ_KEY = 'commercial:objectives'
const REPORTS_KEY = 'ops:project-reports'
const ALLOC_KEY = 'ops:planning-allocations'

// Weekly objective ids (must match the Tasks page).
const WEEKLY_IDS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']
const MONTHLY_IDS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']

const START_DATE = new Date(2026, 6, 30)   // 30 Jul 2026 - tracking start

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
function thursdayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + (4 - x.getDay())); return x }
const weekKey = (d) => iso(thursdayOf(d))
// Monday..Sunday range for the week containing a Thursday key.
function weekRange(thursISO) {
  const [y, m, dd] = thursISO.split('-').map(Number)
  const thu = new Date(y, m - 1, dd)
  const mon = new Date(thu); mon.setDate(thu.getDate() - 3)
  const sun = new Date(thu); sun.setDate(thu.getDate() + 3)
  return { start: iso(mon), end: iso(sun) }
}
function cellStatus(cell) {
  if (!cell) return null
  if (Array.isArray(cell)) return 'confirmed'
  return cell.status || 'confirmed'
}

export default async function handler(req, res) {
  const u = verifySessionToken(readCookie(req, SESSION_COOKIE))
  if (!u || !canAccessArea(u.role, 'commercial')) return res.status(403).json({ error: 'No access' })

  const nWeeks = Math.min(parseInt(req.query.weeks, 10) || 12, 60)
  const nMonths = Math.min(parseInt(req.query.months, 10) || 12, 36)

  const [objs, reports, alloc] = await Promise.all([
    get(OBJ_KEY).then(v => v || { weekly: {}, monthly: {} }),
    get(REPORTS_KEY).then(v => v || []),
    get(ALLOC_KEY).then(v => v || {}),
  ])

  const today = new Date()
  const startWeek = weekKey(START_DATE)
  const startMonth = monthKey(START_DATE)

  // ---- Weekly task % (per week, start..now) ----
  const weeklyTask = []
  {
    const t0 = thursdayOf(today)
    for (let i = nWeeks - 1; i >= 0; i--) {
      const d = new Date(t0); d.setDate(t0.getDate() - i * 7)
      const key = iso(d)
      if (key < startWeek || key > weekKey(today)) continue
      let done = 0
      for (const id of WEEKLY_IDS) if (objs.weekly?.[`${id}|${key}`]?.v === 'yes') done++
      weeklyTask.push({ key, pct: Math.round((done / WEEKLY_IDS.length) * 100) })
    }
  }

  // ---- Monthly task % (per month, start..now) ----
  const monthlyTask = []
  {
    const base = new Date(today.getFullYear(), today.getMonth(), 1)
    for (let i = nMonths - 1; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
      const key = monthKey(d)
      if (key < startMonth || key > monthKey(today)) continue
      let done = 0
      for (const id of MONTHLY_IDS) if (objs.monthly?.[`${id}|${key}`]?.v === 'yes') done++
      monthlyTask.push({ key, pct: Math.round((done / MONTHLY_IDS.length) * 100) })
    }
  }

  // ---- Weekly project reports completed vs required ----
  // Pre-index reports by projectNo -> list of completion dates (status complete only).
  const reportDates = {}
  for (const r of reports) {
    if (!r || !r.projectNo || !r.date) continue
    if ((r.status || 'draft') !== 'complete') continue
    ;(reportDates[String(r.projectNo)] = reportDates[String(r.projectNo)] || []).push(r.date)
  }

  const weeklyReports = []
  {
    const t0 = thursdayOf(today)
    for (let i = nWeeks - 1; i >= 0; i--) {
      const d = new Date(t0); d.setDate(t0.getDate() - i * 7)
      const key = iso(d)
      if (key < startWeek || key > weekKey(today)) continue
      const { start, end } = weekRange(key)
      // WORKED ON = ALLOCATED ON A DAY THAT HAS PASSED.
      //
      // This required an explicitly 'actual' cell. Three problems with that:
      //
      //   - an allocation stored in the older format is a plain ARRAY of names, which
      //     reads as 'confirmed' and could never be actual
      //   - a cell with no status at all defaults to 'confirmed'
      //   - 'actual' is a retrospective tick somebody has to remember to apply, and where
      //     it is not applied the week silently required nothing
      //
      // So a week that had plainly been worked asked for no reports. For a week in the
      // PAST, labour allocated to a project is the honest record of having worked on it -
      // provisional or confirmed, it is what happened. One day or five, one report.
      const required = new Set()
      for (const [pk, days] of Object.entries(alloc)) {
        if (!pk.startsWith('L:')) continue
        const projectNo = pk.slice(2)
        for (const [dk, cell] of Object.entries(days || {})) {
          if (dk < start || dk > end) continue
          if (!cell) continue
          // An empty array is an allocation with nobody on it - not worked.
          if (Array.isArray(cell) && !cell.length) continue
          required.add(projectNo); break
        }
      }
      // Completed against the required list, for the percentage.
      let completed = 0
      for (const projectNo of required) {
        const dates = reportDates[projectNo] || []
        if (dates.some(dt => dt >= start && dt <= end)) completed++
      }
      // Every report written in the week, whether or not that project shows on the Gantt.
      let completedAll = 0
      for (const dates of Object.values(reportDates)) {
        if (dates.some(dt => dt >= start && dt <= end)) completedAll++
      }
      const req = required.size
      weeklyReports.push({ key, required: req, completed, completedAll, pct: req === 0 ? null : Math.round((completed / req) * 100) })
    }
  }

  // BY MONTH, which is what the scorecard card shows.
  //
  // Required for a month = the sum of each WEEK's required count. A project worked in
  // three weeks of a four-week month needs three reports, not one - so the weeks are
  // added, not de-duplicated.
  //
  // A week is assigned to the month containing its THURSDAY, the same key the weeks are
  // built on. A week split across a month end belongs to one month or the other, and the
  // Thursday is the established convention for deciding which.
  const monthlyReports = {}
  for (const w of weeklyReports) {
    const mk = String(w.key).slice(0, 7)
    if (!monthlyReports[mk]) monthlyReports[mk] = { key: mk, required: 0, completed: 0, weeks: 0 }
    monthlyReports[mk].required += w.required
    monthlyReports[mk].completed += w.completed
    monthlyReports[mk].weeks += 1
  }
  const monthlyReportsArr = Object.values(monthlyReports)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(m => ({ ...m, pct: m.required === 0 ? null : Math.round((m.completed / m.required) * 100) }))

  return res.json({ weeklyTask, monthlyTask, weeklyReports, monthlyReports: monthlyReportsArr })
}
