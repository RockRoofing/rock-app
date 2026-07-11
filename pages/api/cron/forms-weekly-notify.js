import { get, getTeamMembers, getOpsProjects, getSubmissionIndex } from '../../../lib/db'

// Monday 07:00 forms digest.
//  - Contracts Manager: Pre-Start needed when a start-on-site or a revisit (return after >1 week off
//    site) falls within 3 working days of the coming week.
//  - Site Supervisor:
//      * Start on Site Checklist — in the week containing the project's first-ever allocated day.
//      * Daily Site Diary — count of allocated days for their projects this week.
//      * Works Area Handover — projects whose last allocated day falls in this week (finishing).
//
// Runs via the daily cron wrapper; only acts on Mondays unless ?force=1.

const DAY = 86400000
const parseISO = (s) => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; return new Date(x.getTime() - wd * DAY) }
const fmt = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
// add N working days (Mon-Fri) to a date
function addWorkingDays(d, n) { let c = new Date(d), added = 0; while (added < n) { c = new Date(c.getTime() + DAY); const wd = c.getDay(); if (wd !== 0 && wd !== 6) added++ } return c }

function cellCount(cell) {
  if (!cell) return 0
  if (Array.isArray(cell)) return cell.length
  return (cell.entries ? cell.entries.length : 0) + (cell.unnamed || 0)
}

export async function runFormsWeeklyNotify({ force = false } = {}) {
  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  if (!RESEND_KEY) return { ok: false, reason: 'email not configured' }

  const [alloc, ops, team, subs] = await Promise.all([
    get('ops:planning-allocations').then(v => v || {}),
    getOpsProjects(),
    getTeamMembers(),
    getSubmissionIndex(),
  ])

  const weekMon = mondayOf(new Date())
  const weekDays = Array.from({ length: 7 }, (_, i) => iso(new Date(weekMon.getTime() + i * DAY)))
  const weekStart = weekMon, weekEnd = new Date(weekMon.getTime() + 6 * DAY)
  const inThisWeek = (d) => d >= weekStart && d <= weekEnd

  // team email lookup by name
  const emailByName = {}
  for (const m of (team || [])) {
    const nm = m.name || [m.firstName, m.lastName].filter(Boolean).join(' ')
    if (nm) emailByName[nm.toLowerCase()] = m.email || ''
  }
  // roster emails + names + supervisor competency (in-date supervisor ticket from the H&S matrix)
  const roster = (await get('ops:operatives-roster')) || []
  const supEmailByName = {}
  const rosterNameById = {}
  for (const o of roster) { const nm = `${o.firstName || ''} ${o.lastName || ''}`.trim(); if (nm) { supEmailByName[nm.toLowerCase()] = o.email || ''; rosterNameById[o.id] = nm } }

  // Which roster opIds are qualified supervisors (in-date supervisor ticket)?
  const [hsCols, hsData] = await Promise.all([
    get('ops:hs-matrix-columns').then(v => v || []),
    get('ops:hs-matrix-data').then(v => v || {}),
  ])
  const nowMid = new Date(); nowMid.setHours(0, 0, 0, 0)
  const validCell = (cell) => cell && (cell.noExpiry || (cell.date && parseISO(cell.date) >= nowMid))
  const supColIds = (hsCols || []).filter(c => ['internal supervisor', 'sssts', 'smsts', 'iosh managing safely'].some(m => (c.label || '').toLowerCase().includes(m))).map(c => c.id)
  const isSupervisorOpId = (opId) => { const cols = hsData[`op:${opId}`] || {}; return supColIds.some(id => validCell(cols[id])) }

  // per-project sorted allocated day list (only days with labour) + allocated named people
  const projMeta = {}
  for (const p of (ops || [])) {
    if ((p.status || 'active') !== 'active') continue
    const key = `L:${p.projectNo}`
    const dayCells = Object.entries(alloc[key] || {}).filter(([, c]) => cellCount(c) > 0)
    const days = dayCells.map(([dk]) => dk).sort()
    // named opIds allocated to this project (across all days)
    const allocOpIds = new Set()
    for (const [, c] of dayCells) {
      const entries = Array.isArray(c) ? c : (c.entries || [])
      for (const e of entries) if (e.opId) allocOpIds.add(e.opId)
    }
    const detailsSup = p.data?.siteSupervisor || ''
    // is the Details supervisor actually on the Gantt for this project?
    const detailsSupOnGantt = detailsSup && [...allocOpIds].some(id => rosterNameById[id] && rosterNameById[id].toLowerCase() === detailsSup.toLowerCase())
    // Gantt-allocated qualified supervisors (names)
    const ganttSupNames = [...allocOpIds].filter(id => isSupervisorOpId(id)).map(id => rosterNameById[id]).filter(Boolean)
    // Effective supervisor for notifications: Details sup if on the Gantt, else the first Gantt-allocated supervisor, else Details sup.
    const effectiveSupervisor = detailsSupOnGantt ? detailsSup : (ganttSupNames[0] || detailsSup)
    projMeta[p.projectNo] = {
      projectNo: p.projectNo,
      name: p.data?.projectName || p.projectNo,
      cm: p.data?.contractsManager || '',
      supervisor: effectiveSupervisor,
      days,
    }
  }

  // has a given form been submitted for a project already? (match by title contains + projectName/No)
  const doneFor = (projectNoOrName, titleMatch) => (subs || []).some(s =>
    (s.formTitle || '').toLowerCase().includes(titleMatch) &&
    ((s.projectName || '').includes(projectNoOrName) || (s.projectId || '') === projectNoOrName))

  // Build obligations keyed by recipient
  const cmTasks = {}   // cmName -> { preStart:[{name, when}] }
  const supTasks = {}  // supName -> { startOnSite:[], siteDiaryProjects:[], wah:[] }
  const pushCM = (nm, item) => { (cmTasks[nm] = cmTasks[nm] || { preStart: [] }).preStart.push(item) }
  const ensureSup = (nm) => (supTasks[nm] = supTasks[nm] || { startOnSite: [], siteDiaryProjects: [], wah: [] })

  const twoWeeks = new Date(weekMon.getTime() + 14 * DAY)  // start/return within 14 calendar days

  for (const pm of Object.values(projMeta)) {
    if (!pm.days.length) continue
    const dayObjs = pm.days.map(parseISO)
    const firstDay = dayObjs[0]
    const lastDay = dayObjs[dayObjs.length - 1]

    // PRE-START (CM): project starts OR returns to site within 14 calendar days of this Monday.
    if (pm.cm) {
      const triggers = [firstDay]
      // returns: any allocated day following a gap of > 7 days from the previous allocated day
      for (let i = 1; i < dayObjs.length; i++) if ((dayObjs[i] - dayObjs[i - 1]) > 7 * DAY) triggers.push(dayObjs[i])
      for (const t of triggers) {
        if (t >= weekMon && t <= twoWeeks && !doneFor(pm.projectNo, 'pre-start')) {
          pushCM(pm.cm, { name: `${pm.projectNo} — ${pm.name}`, when: fmt(t) })
        }
      }
    }

    // SUPERVISOR tasks
    if (pm.supervisor) {
      const s = ensureSup(pm.supervisor)
      // Start on Site Checklist — week containing the first-ever allocated day
      if (inThisWeek(firstDay) && !doneFor(pm.projectNo, 'start on site')) s.startOnSite.push(`${pm.projectNo} — ${pm.name}`)
      // Daily Site Diary — list the project if it has any allocated day this week
      const diaryDays = pm.days.filter(dk => weekDays.includes(dk)).length
      if (diaryDays > 0) s.siteDiaryProjects.push(`${pm.projectNo} — ${pm.name}`)
      // Works Area Handover — a finish day this week followed by a 5+ calendar-day gap before the next
      // visit (or no next visit = project end). Checked per allocated day that falls in this week.
      for (let i = 0; i < dayObjs.length; i++) {
        const d = dayObjs[i]
        if (!inThisWeek(d)) continue
        const next = dayObjs[i + 1] || null
        const gapDays = next ? Math.round((next - d) / DAY) : Infinity
        if (gapDays >= 5 && !doneFor(pm.projectNo, 'works area handover')) { s.wah.push(`${pm.projectNo} — ${pm.name}`); break }
      }
    }
  }

  // Compose + send
  const wcLabel = weekMon.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
  const sent = []; const skipped = []

  async function sendMail(to, subject, html) {
    if (!to) { skipped.push('(no email)'); return }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    })
    if (r.ok) sent.push(to); else skipped.push(to)
  }

  const listHtml = (items) => `<ul style="margin:4px 0 12px;padding-left:18px">${items.map(i => `<li style="margin:2px 0">${i}</li>`).join('')}</ul>`

  // CM emails
  for (const [nm, t] of Object.entries(cmTasks)) {
    if (!t.preStart.length) continue
    const email = emailByName[nm.toLowerCase()]
    const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:620px">
      <h2 style="color:#1a1a19;margin:0 0 4px">Up and coming projects that require a Pre-Start Notification</h2>
      <p style="color:#666;margin:0 0 10px">Hi ${nm.split(' ')[0]}, these projects start or return to site within the next 2 weeks and need a Pre-Start.</p>
      <h3 style="font-size:15px;color:#1a1a19;margin:14px 0 2px">Pre-Start Meetings (${t.preStart.length})</h3>
      ${listHtml(t.preStart.map(p => `${p.name} — starts ${p.when}`))}
      <p style="color:#999;font-size:12px;margin-top:16px">Complete in the portal: Projects → select project → Pre-Start.</p>
    </div>`
    await sendMail(email, `Rock Roofing — Up and coming Pre-Start Notifications (w/c ${weekMon.toLocaleDateString('en-GB')})`, html)
  }

  // Supervisor emails
  for (const [nm, t] of Object.entries(supTasks)) {
    if (!t.startOnSite.length && !t.siteDiaryProjects.length && !t.wah.length) continue
    const email = supEmailByName[nm.toLowerCase()] || emailByName[nm.toLowerCase()]
    let body = ''
    if (t.startOnSite.length) body += `<h3 style="font-size:15px;color:#1a1a19;margin:14px 0 2px">Start on Site Checklist (${t.startOnSite.length})</h3>${listHtml(t.startOnSite)}`
    if (t.siteDiaryProjects.length) body += `<h3 style="font-size:15px;color:#1a1a19;margin:14px 0 2px">Daily Site Diaries (${t.siteDiaryProjects.length})</h3><p style="margin:2px 0 8px;color:#666">A daily site diary is required for each of these projects this week:</p>${listHtml(t.siteDiaryProjects)}`
    if (t.wah.length) body += `<h3 style="font-size:15px;color:#1a1a19;margin:14px 0 2px">Works Area Handovers (${t.wah.length})</h3>${listHtml(t.wah)}`
    const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:620px">
      <h2 style="color:#1a1a19;margin:0 0 4px">Forms to complete — week commencing ${wcLabel}</h2>
      <p style="color:#666;margin:0 0 10px">Hi ${nm.split(' ')[0]}, here's what's due this week.</p>
      ${body}
      <p style="color:#999;font-size:12px;margin-top:16px">Complete these on the Site App.</p>
    </div>`
    await sendMail(email, `Rock Roofing — Forms due this week (w/c ${weekMon.toLocaleDateString('en-GB')})`, html)
  }

  return { ok: true, sent: sent.length, skipped, cms: Object.keys(cmTasks).length, supervisors: Object.keys(supTasks).length }
}

export default async function handler(req, res) {
  try {
    const force = req.query.force === '1'
    if (!force && new Date().getDay() !== 1) return res.status(200).json({ ok: true, skipped: 'not Monday' })
    const result = await runFormsWeeklyNotify({ force })
    return res.status(200).json(result)
  } catch (e) {
    console.error('forms-weekly-notify error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
