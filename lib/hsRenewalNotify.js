import { get, set, getOpsUsers, getPortalUsers } from './db'

// Automatic renewal notifications for CSCS cards and Working at Height training.
//
// TWO jobs, both driven by the daily/hourly cron:
//
// 1. OPERATIVE REMINDERS. When a tracked ticket is within 6 weeks of expiry, the person
//    is emailed. Repeated weekly until it is 2 weeks overdue, then it stops (the weekly
//    management list still carries it).
//
// 2. WEEKLY MANAGEMENT LIST. Everything expiring within 6 weeks or already overdue, sent
//    to an editable recipient list, on a configurable day/hour (default Friday 17:00 UK).
//    In-date tickets beyond 6 weeks are never listed.
//
// Which tickets count is matched on the COLUMN LABEL, so renaming a column in the matrix
// keeps working as long as it still says CSCS or Working at Height.

const COLS_KEY = 'ops:hs-matrix-columns'
const DATA_KEY = 'ops:hs-matrix-data'
const RECIPIENTS_KEY = 'hs:renewal-recipients'   // [ 'name <email>' or 'email' ]
const SCHEDULE_KEY = 'hs:renewal-schedule'       // { dayOfWeek, hour, lastSentDate }
const SENT_KEY = 'hs:renewal-last-sent'          // { '<pid>|<colId>': 'YYYY-MM-DD' }

const WEEKS6_DAYS = 42
const OVERDUE_STOP_DAYS = 14     // stop chasing the person once 2 weeks overdue

const parseISO = (s) => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const fmtDate = (d) => d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
const esc = (s) => String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Is this column one we chase renewals for?
export function isTrackedTraining(label) {
  const l = String(label || '').toLowerCase()
  if (l.includes('cscs')) return 'CSCS'
  if (l.includes('working at height')) return 'Working at Height'
  return null
}

// ---- recipients (editable from the H&S Matrix page) ----
export async function getRenewalRecipients() {
  const v = await get(RECIPIENTS_KEY)
  return Array.isArray(v) ? v : []
}
export async function setRenewalRecipients(list) {
  const clean = (Array.isArray(list) ? list : [])
    .map(x => String(x || '').trim())
    .filter(Boolean)
    .filter(x => /@/.test(x))
  await set(RECIPIENTS_KEY, clean)
  return clean
}

// ---- schedule ----
export async function getRenewalSchedule() {
  const s = await get(SCHEDULE_KEY)
  return { dayOfWeek: s?.dayOfWeek ?? 5, hour: s?.hour ?? 17, lastSentDate: s?.lastSentDate || '' }
}
export async function setRenewalSchedule({ dayOfWeek, hour }) {
  const cur = await getRenewalSchedule()
  const next = {
    dayOfWeek: Math.max(0, Math.min(6, parseInt(dayOfWeek))),
    hour: Math.max(0, Math.min(23, parseInt(hour))),
    lastSentDate: cur.lastSentDate || '',
  }
  await set(SCHEDULE_KEY, next)
  return next
}

// UK-local day/hour/date. The cron ticks in UTC, so the gate must be evaluated in UK time
// or it drifts by an hour across BST/GMT.
function ukNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const g = (t) => parts.find(p => p.type === t)?.value || ''
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  let hour = parseInt(g('hour'), 10); if (hour === 24) hour = 0
  return { day: wdMap[g('weekday')], hour, dateStr: `${g('year')}-${g('month')}-${g('day')}` }
}

// ---- people ----
async function buildPeople() {
  const [users, portal] = await Promise.all([getOpsUsers(), getPortalUsers()])
  const map = {}
  for (const u of (users || [])) {
    if (u.active === false) continue
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || ''
    if (!name) continue
    map[`op:${u.id}`] = { name, email: u.email || '', company: u.company || '' }
  }
  for (const u of (portal || [])) {
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || ''
    if (!name) continue
    map[`pu:${u.id}`] = { name, email: u.email || '', company: 'Rock Roofing (office)' }
  }
  return map
}

// Every CSCS / Working at Height ticket that is within 6 weeks of expiry or already
// overdue. Anything comfortably in date is excluded entirely.
export async function collectDueTrainings() {
  const [columns, data, people] = await Promise.all([
    get(COLS_KEY).then(v => v || []),
    get(DATA_KEY).then(v => v || {}),
    buildPeople(),
  ])
  const tracked = {}
  for (const c of columns) { const k = isTrackedTraining(c.label); if (k) tracked[c.id] = { kind: k, label: c.label } }

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const rows = []
  for (const [pid, cols] of Object.entries(data || {})) {
    const person = people[pid]
    if (!person) continue
    for (const [colId, cell] of Object.entries(cols || {})) {
      const t = tracked[colId]
      if (!t || !cell || cell.noExpiry || !cell.date) continue
      const d = parseISO(cell.date); if (!d) continue
      const days = Math.round((d - today) / 86400000)
      if (days > WEEKS6_DAYS) continue          // comfortably in date - not our concern
      rows.push({
        pid, colId, personName: person.name, email: person.email, company: person.company,
        kind: t.kind, training: t.label, date: d, dateStr: cell.date, days,
        overdue: days < 0,
      })
    }
  }
  rows.sort((a, b) => a.date - b.date)
  return rows
}

async function sendMail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY
  if (!key) return { sent: false, error: 'Email not configured' }
  const from = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  const replyTo = process.env.FORMS_REPLY_TO || 'notifications@rockroofing.co.uk'
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], reply_to: replyTo, subject, html }),
    })
    return { sent: r.ok }
  } catch (e) { return { sent: false, error: e.message } }
}

// ---- 1. operative reminders (weekly per ticket, until 2 weeks overdue) ----
export async function runOperativeRenewalReminders({ force } = {}) {
  const rows = await collectDueTrainings()
  const sentMap = (await get(SENT_KEY)) || {}
  const { dateStr } = ukNow()
  const today = new Date(); today.setHours(0, 0, 0, 0)

  let sent = 0, skippedNoEmail = 0, throttled = 0, stopped = 0
  for (const r of rows) {
    // Stop chasing the individual once 2 weeks overdue - it stays on the weekly list.
    if (r.days < -OVERDUE_STOP_DAYS) { stopped++; continue }
    if (!r.email) { skippedNoEmail++; continue }

    const key = `${r.pid}|${r.colId}`
    const last = sentMap[key] ? parseISO(sentMap[key]) : null
    if (!force && last) {
      const sinceDays = Math.round((today - last) / 86400000)
      if (sinceDays < 7) { throttled++; continue }
    }

    const what = r.kind === 'CSCS' ? 'CSCS card' : 'Working at Height training'
    const when = r.overdue
      ? `expired on <strong>${fmtDate(r.date)}</strong> (${Math.abs(r.days)} day${Math.abs(r.days) === 1 ? '' : 's'} ago)`
      : `expires on <strong>${fmtDate(r.date)}</strong> (in ${r.days} day${r.days === 1 ? '' : 's'})`

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;color:#1a1a19">
        <h2 style="margin:0 0 10px">Your ${esc(what)} needs renewing</h2>
        <p style="font-size:15px">Hi ${esc((r.personName || '').split(' ')[0] || 'there')},</p>
        <p style="font-size:15px">Your <strong>${esc(r.training)}</strong> ${when}.</p>
        <div style="background:${r.overdue ? '#fef2f2' : '#fff7ed'};border:1px solid ${r.overdue ? '#fecaca' : '#fed7aa'};border-radius:10px;padding:14px;margin:16px 0;font-size:15px">
          Please send your renewed ${esc(what)} to Rock Roofing to keep your training up to
          date and to maintain your ability to work for Rock Roofing.
        </div>
        <p style="font-size:13px;color:#666">Reply to this email with a photo or scan of the renewed card or certificate.</p>
        <p style="font-size:12px;color:#999;margin-top:20px">Rock Roofing Ltd</p>
      </div>`

    const res = await sendMail({
      to: r.email,
      subject: r.overdue ? `OVERDUE: your ${what} has expired` : `Your ${what} expires on ${fmtDate(r.date)}`,
      html,
    })
    if (res.sent) { sent++; sentMap[key] = dateStr }
  }

  // Drop tracking for anything no longer due, so a renewed-then-expiring-again ticket
  // is not wrongly throttled later.
  const live = new Set(rows.map(r => `${r.pid}|${r.colId}`))
  for (const k of Object.keys(sentMap)) if (!live.has(k)) delete sentMap[k]
  await set(SENT_KEY, sentMap)

  return { ok: true, candidates: rows.length, sent, throttled, skippedNoEmail, stopped }
}

// ---- 2. weekly management list ----
export async function sendRenewalSummary() {
  const rows = await collectDueTrainings()
  const to = await getRenewalRecipients()
  if (!to.length) return { ok: false, reason: 'No recipients. Add them on the H&S Training Matrix page.' }

  const overdue = rows.filter(r => r.overdue)
  const soon = rows.filter(r => !r.overdue)

  const table = (list, colour) => `
    <table style="font-size:13px;border-collapse:collapse;width:100%">
      <tr style="color:#888;font-size:11px;text-align:left">
        <th style="padding:4px 12px 4px 0">Person</th><th style="padding:4px 12px 4px 0">Company</th>
        <th style="padding:4px 12px 4px 0">Training</th><th style="padding:4px 0">Expiry</th>
      </tr>
      ${list.map(r => `<tr>
        <td style="padding:5px 12px 5px 0">${esc(r.personName)}</td>
        <td style="padding:5px 12px 5px 0;color:#666">${esc(r.company || '')}</td>
        <td style="padding:5px 12px 5px 0">${esc(r.training)}</td>
        <td style="padding:5px 0;color:${colour};font-weight:600;white-space:nowrap">${fmtDate(r.date)}${r.overdue ? ` (${Math.abs(r.days)}d ago)` : ` (${r.days}d)`}</td>
      </tr>`).join('')}
    </table>`

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:680px;color:#1a1a19">
      <h2 style="margin:0 0 4px">CSCS &amp; Working at Height - renewals due</h2>
      <p style="color:#666;margin:0 0 14px;font-size:13px">Everything overdue or expiring within 6 weeks. In-date tickets are not listed.</p>
      ${!rows.length ? '<p style="color:#16a34a;font-size:15px">Nothing overdue or due within 6 weeks. All up to date.</p>' : ''}
      ${overdue.length ? `<h3 style="margin:18px 0 6px;font-size:15px;color:#b91c1c">Overdue (${overdue.length})</h3>${table(overdue, '#b91c1c')}` : ''}
      ${soon.length ? `<h3 style="margin:18px 0 6px;font-size:15px;color:#9a3412">Due within 6 weeks (${soon.length})</h3>${table(soon, '#9a3412')}` : ''}
      <p style="color:#999;font-size:12px;margin-top:20px">Manage records in the portal: H&amp;S &gt; H&amp;S Training Matrix.</p>
    </div>`

  const res = await sendMail({ to, subject: `CSCS & Working at Height renewals - ${overdue.length} overdue, ${soon.length} due`, html })
  return { ok: !!res.sent, sentTo: to, overdue: overdue.length, soon: soon.length, error: res.error }
}

// Gate the weekly list to its configured day/hour, once per day.
export async function maybeSendRenewalSummary({ force, dryRun } = {}) {
  const sched = await getRenewalSchedule()
  const { day, hour, dateStr } = ukNow()
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const diag = { nowUkDay: DAYS[day], nowUkHour: hour, nowUkDate: dateStr, wantDay: DAYS[sched.dayOfWeek], wantHour: sched.hour, lastSentDate: sched.lastSentDate || '(never)' }

  if (!force) {
    if (day !== sched.dayOfWeek) return { skipped: `Not the scheduled day (${DAYS[day]} vs ${DAYS[sched.dayOfWeek]})`, diag }
    if (hour < sched.hour) return { skipped: `Too early - ${hour}:00 UK, scheduled ${sched.hour}:00`, diag }
    if (sched.lastSentDate === dateStr) return { skipped: `Already sent today (${dateStr})`, diag }
  }
  if (dryRun) return { wouldSend: true, diag }

  const result = await sendRenewalSummary()
  if (result.ok) await set(SCHEDULE_KEY, { ...sched, lastSentDate: dateStr })
  return { ...result, diag }
}
