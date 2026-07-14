import { get, getOpsProjects, getSubmissionIndex } from '../../lib/db'

// Forms "Missing" dashboard data.
// For a given week range, works out the REQUIRED tracked forms per project/week and whether each has
// been completed, plus the responsible person (CM for Pre-Start; effective Supervisor for the rest).
//
// GET /api/forms-missing?from=YYYY-MM-DD&to=YYYY-MM-DD
//   from/to are any dates; snapped to Mondays. Defaults: this week .. this week.
//
// Returns { weeks:[iso Mondays], rows:[ { week, projectNo, projectName, formType, responsible, role, done } ],
//           summary:{ required, completed, pct }, byForm:{ [formType]:{required,completed} } }

const DAY = 86400000
const parseISO = (s) => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; return new Date(x.getTime() - wd * DAY) }
function addWorkingDays(d, n) { let c = new Date(d), added = 0; while (added < n) { c = new Date(c.getTime() + DAY); const wd = c.getDay(); if (wd !== 0 && wd !== 6) added++ } return c }
function cellCount(cell) { if (!cell) return 0; if (Array.isArray(cell)) return cell.length; return (cell.entries ? cell.entries.length : 0) + (cell.unnamed || 0) }
function cellEntries(cell) { if (!cell) return []; return Array.isArray(cell) ? cell : (cell.entries || []) }

export default async function handler(req, res) {
  try {
    const [alloc, ops, subs, roster, hsCols, hsData, waterIngress] = await Promise.all([
      get('ops:planning-allocations').then(v => v || {}),
      getOpsProjects(),
      getSubmissionIndex(),
      get('ops:operatives-roster').then(v => v || []),
      get('ops:hs-matrix-columns').then(v => v || []),
      get('ops:hs-matrix-data').then(v => v || {}),
      get('ops:water-ingress').then(v => v || {}),
    ])

    const fromMon = mondayOf(req.query.from ? parseISO(req.query.from) : new Date())
    const toMon = mondayOf(req.query.to ? parseISO(req.query.to) : new Date())
    const nWeeks = Math.min(52, Math.max(1, Math.round((toMon - fromMon) / (7 * DAY)) + 1))
    const weeks = Array.from({ length: nWeeks }, (_, i) => iso(new Date(fromMon.getTime() + i * 7 * DAY)))

    // supervisor competency
    const nowMid = new Date(); nowMid.setHours(0, 0, 0, 0)
    const validCell = (cell) => cell && (cell.noExpiry || (cell.date && parseISO(cell.date) >= nowMid))
    const supColIds = (hsCols || []).filter(c => ['internal supervisor', 'sssts', 'smsts', 'iosh managing safely'].some(m => (c.label || '').toLowerCase().includes(m))).map(c => c.id)
    const isSupervisorOpId = (opId) => { const cols = hsData[`op:${opId}`] || {}; return supColIds.some(id => validCell(cols[id])) }
    const rosterNameById = {}
    for (const o of roster) { const nm = `${o.firstName || ''} ${o.lastName || ''}`.trim(); if (nm) rosterNameById[o.id] = nm }

    const doneFor = (projectNo, projectName, titleMatch, weekMon) => {
      // A submission counts if it matches the form + project and was submitted within that week (or earlier for that project — we treat per-week presence).
      const wStart = parseISO(weekMon); const wEnd = new Date(wStart.getTime() + 7 * DAY)
      return (subs || []).some(s => {
        if (!(s.formTitle || '').toLowerCase().includes(titleMatch)) return false
        const matchesProject = (s.projectName || '').includes(projectNo) || (s.projectId || '') === projectNo || (projectName && (s.projectName || '').includes(projectName))
        if (!matchesProject) return false
        const t = s.submittedAt ? new Date(s.submittedAt) : null
        return t && t >= wStart && t < wEnd
      })
    }

    const rows = []
    const byForm = {
      'Pre-Start': { required: 0, completed: 0 },
      'Start on Site Checklist': { required: 0, completed: 0 },
      'Daily Site Diary': { required: 0, completed: 0 },
      'Works Area Handover': { required: 0, completed: 0 },
      'Water Ingress Report': { required: 0, completed: 0 },
    }

    for (const p of (ops || [])) {
      if ((p.status || 'active') !== 'active') continue
      const projectNo = p.projectNo
      const projectName = p.data?.projectName || p.projectNo
      const cm = p.data?.contractsManager || ''
      const key = `L:${projectNo}`
      const dayCells = Object.entries(alloc[key] || {}).filter(([, c]) => cellCount(c) > 0)
      if (!dayCells.length) continue
      const days = dayCells.map(([dk]) => dk).sort()
      const dayObjs = days.map(parseISO)
      const firstDay = dayObjs[0], lastDay = dayObjs[dayObjs.length - 1]

      // effective supervisor
      const allocOpIds = new Set()
      for (const [, c] of dayCells) for (const e of cellEntries(c)) if (e.opId) allocOpIds.add(e.opId)
      const detailsSup = p.data?.siteSupervisor || ''
      const detailsSupOnGantt = detailsSup && [...allocOpIds].some(id => rosterNameById[id] && rosterNameById[id].toLowerCase() === detailsSup.toLowerCase())
      const ganttSupNames = [...allocOpIds].filter(id => isSupervisorOpId(id)).map(id => rosterNameById[id]).filter(Boolean)
      const supervisor = detailsSupOnGantt ? detailsSup : (ganttSupNames[0] || detailsSup)

      for (const weekMon of weeks) {
        const wStart = parseISO(weekMon); const wEnd = new Date(wStart.getTime() + 6 * DAY)
        const weekDayISOs = Array.from({ length: 7 }, (_, i) => iso(new Date(wStart.getTime() + i * DAY)))
        const inWeek = (d) => d >= wStart && d <= wEnd

        const add = (formType, responsible, role, done) => {
          rows.push({ week: weekMon, projectNo, projectName, formType, responsible: responsible || '—', role, done: !!done })
          byForm[formType].required++
          if (done) byForm[formType].completed++
        }

        // PRE-START (CM): project starts OR returns to site within 14 calendar days of the week start.
        const twoWeeks = new Date(wStart.getTime() + 14 * DAY)
        const triggers = [firstDay]
        for (let i = 1; i < dayObjs.length; i++) if ((dayObjs[i] - dayObjs[i - 1]) > 7 * DAY) triggers.push(dayObjs[i])
        if (triggers.some(t => t >= wStart && t <= twoWeeks)) {
          add('Pre-Start', cm, 'CM', doneFor(projectNo, projectName, 'pre-start', weekMon))
        }

        // START ON SITE CHECKLIST (Supervisor): week containing first allocated day
        if (inWeek(firstDay)) add('Start on Site Checklist', supervisor, 'Supervisor', doneFor(projectNo, projectName, 'start on site', weekMon))

        // DAILY SITE DIARY (Supervisor): one required per allocated day in the week
        const diaryDays = days.filter(dk => weekDayISOs.includes(dk))
        for (const dk of diaryDays) {
          const done = (subs || []).some(s => (s.formTitle || '').toLowerCase().includes('daily site diary') &&
            ((s.projectName || '').includes(projectNo) || (projectName && (s.projectName || '').includes(projectName))) &&
            s.submittedAt && iso(new Date(s.submittedAt)) === dk)
          rows.push({ week: weekMon, projectNo, projectName, formType: 'Daily Site Diary', responsible: supervisor || '—', role: 'Supervisor', done, day: dk })
          byForm['Daily Site Diary'].required++
          if (done) byForm['Daily Site Diary'].completed++
        }

        // WORKS AREA HANDOVER (Supervisor): a finish day in this week followed by a 5+ calendar-day gap
        // before the next visit (or no next visit = project end).
        let wahNeeded = false
        for (let i = 0; i < dayObjs.length; i++) {
          const d = dayObjs[i]; if (!inWeek(d)) continue
          const next = dayObjs[i + 1] || null
          const gap = next ? Math.round((next - d) / DAY) : Infinity
          if (gap >= 5) { wahNeeded = true; break }
        }
        if (wahNeeded) add('Works Area Handover', supervisor, 'Supervisor', doneFor(projectNo, projectName, 'works area handover', weekMon))
      }
    }

    // WATER INGRESS REPORT — WIRF rules:
    //  • 1 WIRF per water-ingress VISIT EVENT for a job.
    //  • Consecutive days on the same job = ONE event (only the first day needs a WIRF).
    //  • A gap of ≥1 day starts a NEW event (needs its own WIRF).
    //  • 2 separate visits on the SAME day both need a WIRF.
    //  • Only SOLIDIFIES as "required" once the visit is marked ACTUAL on the Gantt.
    //  • Visits within the next 2 weeks (not yet actual) show as UPCOMING (not counted
    //    as required until actual).
    const nowD = new Date(); nowD.setHours(0, 0, 0, 0)
    const twoWeeks = new Date(nowD.getTime() + 14 * DAY)

    // Group visit-days by job (projectNo, falling back to jobName).
    const wiByJob = {}   // jobKey -> { name, projectNo, days: { [dk]: visits[] } }
    for (const [dk, visits] of Object.entries(waterIngress || {})) {
      if (!parseISO(dk)) continue
      for (const v of (visits || [])) {
        const jobKey = v.projectNo || v.jobName || 'wi'
        if (!wiByJob[jobKey]) wiByJob[jobKey] = { name: v.jobName || 'Water ingress', projectNo: v.projectNo || '—', days: {} }
        if (!wiByJob[jobKey].days[dk]) wiByJob[jobKey].days[dk] = []
        wiByJob[jobKey].days[dk].push(v)
      }
    }

    for (const job of Object.values(wiByJob)) {
      const sortedDays = Object.keys(job.days).sort()
      const daySet = new Set(sortedDays)
      for (const dk of sortedDays) {
        const dObj = parseISO(dk)
        const prevDayISO = iso(new Date(dObj.getTime() - DAY))
        const isRunStart = !daySet.has(prevDayISO)   // no visit the day before -> new event
        if (!isRunStart) continue                    // consecutive day -> same visit, no extra WIRF

        const visitWeekMon = iso(mondayOf(dObj))
        if (!weeks.includes(visitWeekMon)) continue
        const wStart = parseISO(visitWeekMon); const wEnd = new Date(wStart.getTime() + 7 * DAY)

        const dayVisits = job.days[dk]
        // Each separate visit on a run-start day needs its own WIRF.
        for (let vi = 0; vi < dayVisits.length; vi++) {
          const v = dayVisits[vi]
          const isActual = (v.status || '') === 'actual'
          const isPast = dObj < nowD                    // the visit day has passed
          const isUpcoming = !isActual && !isPast && dObj <= twoWeeks   // future, within 2 weeks
          // A WIRF is REQUIRED once the visit has happened (it's actual OR the day has
          // passed). Future visits within 2 weeks show as "Upcoming" (visibility only).
          // Future visits beyond 2 weeks are ignored for now.
          const isRequired = isActual || isPast
          if (!isRequired && !isUpcoming) continue

          const done = (subs || []).some(s => (s.formTitle || '').toLowerCase().includes('water ingress') &&
            ((job.projectNo && job.projectNo !== '—' && ((s.projectName || '').includes(job.projectNo) || (s.projectId || '') === job.projectNo)) || (s.projectName || '').includes(job.name)) &&
            s.submittedAt && new Date(s.submittedAt) >= wStart && new Date(s.submittedAt) < wEnd)

          rows.push({ week: visitWeekMon, projectNo: job.projectNo, projectName: `💧 ${job.name}`, formType: 'Water Ingress Report', responsible: '—', role: 'Attending operative', done, day: dk, upcoming: isUpcoming })
          if (isRequired) {   // happened (actual or past) -> counts in the required tally
            byForm['Water Ingress Report'].required++
            if (done) byForm['Water Ingress Report'].completed++
          }
        }
      }
    }

    // Upcoming (not-yet-actual) water-ingress visits are shown for visibility but
    // don't count as required/missing until they're marked actual.
    const countableRows = rows.filter(r => !r.upcoming)
    const required = countableRows.length
    const completed = countableRows.filter(r => r.done).length
    const pct = required ? Math.round((completed / required) * 100) : 100

    return res.json({ weeks, rows, summary: { required, completed, pct }, byForm })
  } catch (e) {
    console.error('forms-missing error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
