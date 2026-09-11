import { get, getOpsProjects, getOpsUsers } from '../../lib/db'
import { requireRole } from '../../lib/portalAuth'
import { crmDealsToFlat } from '../../lib/crmDashboardAdapter'

// TIMESHEET CSV OUT OF THE PLANNER
//
// GET /api/planning-timesheet-csv?from=2026-07-22&to=2026-08-21[&opIds=a,b]
//
// One row per person, per day, per rate - the shape of the Timesheets workbook:
//
//   Employee Name, Date, Job No, Job Description, Hours, Rate Description
//
// Five stores feed it, the same five the Planner writes:
//
//   ops:planning-allocations   project work        -> Standard / Weekend
//   ops:water-ingress          call-out visits     -> Standard / Weekend
//   ops:overheads              Holidays, Sick...   -> Holiday / Paid leave / Standard
//   ops:overnight-allowance    nights away         -> Overnight Allowance
//   ops:operatives-roster      names               (Site App users take precedence)
//
// WHAT IS DERIVED RATHER THAN RECORDED, because it matters when the figures are
// checked against a payroll run:
//
//   HOURS. The Planner records a full day or a half day, not a clock. A full day is
//   8 hours and a half day 4, set by DAY_HOURS below. Anyone who actually worked
//   9.5 hours will still read 8 here - the Planner has nowhere to put the 1.5.
//
//   WEEKEND. Taken from the date falling on a Saturday or Sunday, which is how the
//   workbook separates it. A weekday worked at a weekend rate cannot be told apart.
//
// Everything else - who, when, which job, its number, holidays, nights away - is
// recorded and comes out exactly as stored.

const DAY_HOURS = 8
const OVERNIGHT_UNITS = 1      // the workbook books an overnight as 1, not as hours

// The Planner's overhead categories against the workbook's Job Description and Rate
// Description. Rate Description drives pay, so it is deliberately explicit rather
// than derived from the category name.
const OVERHEAD_MAP = {
  'Holidays': { desc: 'Holiday', rate: 'Holiday' },
  'Sick': { desc: 'Sick', rate: 'Holiday' },
  'Paid Leave': { desc: 'Paid leave', rate: 'Standard/ Paid leave' },
  'Unpaid Leave': { desc: 'Unpaid leave', rate: 'Unpaid' },
  'Internal Time': { desc: 'Office Day', rate: 'Standard' },
  'Ops Support': { desc: 'Ops support', rate: 'Standard' },
}
const INTERNAL_JOB_NO = 'Internal time'

const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const isWeekend = (dk) => { const d = parseISO(dk).getDay(); return d === 0 || d === 6 }

// Excel opens a CSV happily but mangles anything with a comma, a quote or a newline
// unless it is quoted. A job description with a comma in it is normal.
const cell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin', 'accounts'])) return
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'GET only' }) }

  const from = String(req.query.from || '').trim()
  const to = String(req.query.to || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'from and to are required, as YYYY-MM-DD' })
  }
  if (from > to) return res.status(400).json({ error: 'from is after to' })
  const onlyOps = String(req.query.opIds || '').split(',').map(s => s.trim()).filter(Boolean)
  const opFilter = onlyOps.length ? new Set(onlyOps) : null

  try {
    const [alloc, roster, waterIngress, overheads, overnight, opsUsers, opsProjects, crmRaw] = await Promise.all([
      get('ops:planning-allocations').then(v => v || {}),
      get('ops:operatives-roster').then(v => v || []),
      get('ops:water-ingress').then(v => v || {}),
      get('ops:overheads').then(v => v || {}),
      get('ops:overnight-allowance').then(v => v || {}),
      getOpsUsers().then(v => v || []).catch(() => []),
      getOpsProjects().then(v => v || []).catch(() => []),
      get('crm:deals').then(v => v || []).catch(() => []),
    ])

    // Project key -> { no, name }. The workbook wants the JOB NUMBER as well as the
    // name, which is why this is not assembleWeek's map - that one carries the name
    // and the address only.
    const projects = {}
    for (const p of opsProjects) projects[`L:${p.projectNo}`] = { no: p.projectNo, name: p.data?.projectName || p.projectNo }
    try {
      for (const d of crmDealsToFlat(crmRaw)) {
        if (d.stageName === 'Negotiating') projects[`N:${d.id}`] = { no: 'Negotiated', name: (d.title || `Deal ${d.id}`) }
      }
    } catch { /* a CRM hiccup must not lose the live projects */ }

    // Names: Site App users first, then the legacy roster - the same order of
    // precedence assembleWeek uses, so a person is not called one thing on the
    // weekly PDF and another on the timesheet.
    const nameById = {}
    for (const o of roster) {
      const nm = `${o.firstName || ''} ${o.lastName || ''}`.trim() || o.name || ''
      if (nm) nameById[o.id] = nm
    }
    for (const u of opsUsers) {
      const nm = `${u.firstName || (u.name || '').split(' ')[0] || ''} ${u.lastName || (u.name || '').split(' ').slice(1).join(' ') || ''}`.trim() || u.name || ''
      if (nm) nameById[u.id] = nm
    }
    const nameOf = (opId) => nameById[opId] || opId

    const inRange = (dk) => dk >= from && dk <= to
    const rows = []
    const push = (opId, date, jobNo, jobDesc, hours, rate) => {
      if (opFilter && !opFilter.has(opId)) return
      rows.push({ name: nameOf(opId), date, jobNo, jobDesc, hours, rate })
    }
    const hoursFor = (half) => (half && half !== 'full') ? DAY_HOURS / 2 : DAY_HOURS

    // 1. Project allocations.
    for (const [pk, daysMap] of Object.entries(alloc)) {
      const p = projects[pk]
      // An allocation whose project has been deleted is skipped rather than exported
      // under a raw key - the same rule assembleWeek applies.
      if (!p) continue
      for (const [dk, cellVal] of Object.entries(daysMap || {})) {
        if (!inRange(dk)) continue
        const entries = Array.isArray(cellVal) ? cellVal : (cellVal && cellVal.entries) || []
        for (const e of entries) {
          if (!e || !e.opId) continue
          push(e.opId, dk, p.no, p.name, hoursFor(e.half), isWeekend(dk) ? 'Weekend' : 'Standard')
        }
      }
    }

    // 2. Water ingress call-outs. Real worked time against a named job.
    for (const [dk, visits] of Object.entries(waterIngress)) {
      if (!inRange(dk)) continue
      for (const v of (visits || [])) {
        for (const e of (v.entries || [])) {
          if (!e || !e.opId) continue
          push(e.opId, dk, v.projectNo || 'Water ingress', v.jobName || 'Water ingress',
            hoursFor(e.half), isWeekend(dk) ? 'Weekend' : 'Standard')
        }
      }
    }

    // 3. Overheads - holidays, sick, office days.
    for (const [dk, list] of Object.entries(overheads)) {
      if (!inRange(dk)) continue
      for (const e of (list || [])) {
        if (!e || !e.opId) continue
        const m = OVERHEAD_MAP[e.category] || { desc: e.category || 'Internal time', rate: 'Standard' }
        push(e.opId, dk, INTERNAL_JOB_NO, m.desc, DAY_HOURS, m.rate)
      }
    }

    // 4. Overnight allowances. Booked against the job the person was on that day, so
    // the allowance lands on the right project rather than on "Internal time".
    const jobThatDay = {}
    for (const r of rows) {
      if (r.jobNo === INTERNAL_JOB_NO) continue
      jobThatDay[`${r.name}|${r.date}`] = { no: r.jobNo, desc: r.jobDesc }
    }
    // A night away is often the night BEFORE the job - travelling up on the Sunday,
    // or staying over at the end of a holiday to start on site the next morning. On
    // those days the person has no project allocation, so the allowance would land on
    // "Internal time" and the cost would not reach the job.
    //
    // So: the job that day, else the job the next working day, else the day before.
    // This is a GUESS where there is no allocation - the Planner does not record which
    // job an overnight belongs to. It matches how the workbook has been filled in by
    // hand, and anything it cannot place is left on Internal time to be spotted.
    const nextDay = (dk, step) => { const d = parseISO(dk); d.setDate(d.getDate() + step); return iso(d) }
    const jobNear = (nm, dk) => {
      const here = jobThatDay[`${nm}|${dk}`]
      if (here) return here
      for (let i = 1; i <= 3; i++) { const j = jobThatDay[`${nm}|${nextDay(dk, i)}`]; if (j) return j }
      return jobThatDay[`${nm}|${nextDay(dk, -1)}`] || null
    }
    for (const [dk, ids] of Object.entries(overnight)) {
      if (!inRange(dk)) continue
      for (const opId of (ids || [])) {
        const j = jobNear(nameOf(opId), dk)
        push(opId, dk, j ? j.no : INTERNAL_JOB_NO, j ? j.desc : 'Overnight allowance', OVERNIGHT_UNITS, 'Overnight Allowance')
      }
    }

    // Name, then date, then the job - the order the workbook reads in.
    rows.sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date)
      || String(a.jobNo).localeCompare(String(b.jobNo)) || a.rate.localeCompare(b.rate))

    const header = ['Employee Name', 'Date', 'Job No', 'Job Description', 'Hours', 'Rate Description']
    const lines = [header.join(',')]
    for (const r of rows) {
      // DD/MM/YYYY. An ISO date in a CSV gets read as text by Excel in a UK locale,
      // and the workbook this replaces uses UK dates throughout.
      const [y, m, d] = r.date.split('-')
      lines.push([r.name, `${d}/${m}/${y}`, r.jobNo, r.jobDesc, r.hours, r.rate].map(cell).join(','))
    }

    // BOM, so Excel reads it as UTF-8 and does not mangle an accented name.
    const csv = '\uFEFF' + lines.join('\r\n') + '\r\n'
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="Timesheets ${from} to ${to}.csv"`)
    return res.status(200).send(csv)
  } catch (e) {
    console.error('planning-timesheet-csv error:', e)
    return res.status(500).json({ error: e.message || 'Export failed' })
  }
}
