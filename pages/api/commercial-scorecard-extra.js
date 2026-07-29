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
      // Required projects: those with an 'actual' planning day in this week.
      const required = new Set()
      for (const [pk, days] of Object.entries(alloc)) {
        if (!pk.startsWith('L:')) continue
        const projectNo = pk.slice(2)
        for (const [dk, cell] of Object.entries(days || {})) {
          if (dk >= start && dk <= end && cellStatus(cell) === 'actual') { required.add(projectNo); break }
        }
      }
      // Completed: of those required, how many have >=1 report dated in the week.
      let completed = 0
      for (const projectNo of required) {
        const dates = reportDates[projectNo] || []
        if (dates.some(dt => dt >= start && dt <= end)) completed++
      }
      const req = required.size
      weeklyReports.push({ key, required: req, completed, pct: req === 0 ? null : Math.round((completed / req) * 100) })
    }
  }

  return res.json({ weeklyTask, monthlyTask, weeklyReports })
}
