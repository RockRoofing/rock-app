import { get, set } from './db'

// ── Notification builder + scheduler core ───────────────────────────────────
// A notification is a configurable email rule. Stored in Redis under NOTIF_KEY.
//
// notification = {
//   id, name, enabled,
//   func: 'commercial' | 'bookkeeping',
//   cadence: 'weekly' | 'monthly',
//   trigger: 'reminder' | 'incomplete',   // reminder = always on due day;
//                                          // incomplete = only if tasks not all Yes
//   dueDay:    (weekly)  0-6 day of week the tasks are due (default Thu=4 commercial, Fri=5 bookkeeping)
//   dueDom:    (monthly) day-of-month the tasks are due (e.g. 15)
//   offsetDays: 0 = on the due day; 1 = day after; 2 = two days after, etc.
//               (used for the "not marked complete" follow-ups)
//   recipientUserIds: [portal user ids],
//   recipientEmails:  [free-typed emails],
//   subject, body     // email content (plain text; newlines -> <br>)
// }
//
// The cron runs daily; each notification fires only on the day that matches its
// cadence/dueDay/dueDom + offset, and (for 'incomplete') only if that period's tasks
// are not all marked Yes.

const NOTIF_KEY = 'notifications:rules'
const LOG_KEY = 'notifications:sent'   // de-dupe: which notif+period already sent

// Task-set definitions so the checker knows what "complete" means per function.
export const TASK_SETS = {
  commercial: {
    store: 'commercial:objectives',
    weekAnchor: 4,   // Thursday
    weekly: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
    monthly: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'],
    label: 'Commercial',
    weeklyPage: '/weekly-tasks', monthlyPage: '/monthly-tasks',
  },
  bookkeeping: {
    store: 'bookkeeping:tasks',
    weekAnchor: 4,   // Thursday
    weekly: ['bw1', 'bw2', 'bw3', 'bw4', 'bw5', 'bw6'],
    monthly: ['bm1', 'bm2', 'bm3', 'bm4', 'bm5', 'bm6', 'bm7', 'bm8', 'bm9', 'bm10', 'bm11', 'bm12'],
    label: 'Bookkeeping',
    weeklyPage: '/bookkeeping-weekly-tasks', monthlyPage: '/bookkeeping-monthly-tasks',
  },
}

// ── date helpers ──
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
function anchorOf(d, anchor) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + ((anchor - x.getDay() + 7) % 7)); return x }
const weekKey = (d, anchor) => iso(anchorOf(d, anchor))

// ── store ──
export async function getNotifications() { return (await get(NOTIF_KEY)) || [] }
export async function saveNotifications(list) { await set(NOTIF_KEY, Array.isArray(list) ? list : []); return list }

// Is the given cadence's task grid COMPLETE (all tasks Yes) for the period covering `date`?
export async function isPeriodComplete(func, cadence, date) {
  const setDef = TASK_SETS[func]; if (!setDef) return false
  const store = (await get(setDef.store)) || { weekly: {}, monthly: {} }
  const bucket = store[cadence] || {}
  const ids = setDef[cadence] || []
  const periodKey = cadence === 'weekly' ? weekKey(date, setDef.weekAnchor) : monthKey(date)
  return ids.every(id => bucket[`${id}|${periodKey}`]?.v === 'yes')
}

// The period key a notification is about, given "today".
export function periodKeyFor(func, cadence, today) {
  const setDef = TASK_SETS[func]
  return cadence === 'weekly' ? weekKey(today, setDef.weekAnchor) : monthKey(today)
}

// Does this notification fire today? Returns { fire, periodKey } .
// Weekly: the DUE day is the task-set's anchor day; offsetDays shifts the fire date after it.
// Monthly: the DUE day is dueDom; offsetDays shifts the fire date after it.
export function firesToday(n, today) {
  const setDef = TASK_SETS[n.func]; if (!setDef) return { fire: false }
  const offset = Math.max(0, parseInt(n.offsetDays, 10) || 0)

  if (n.cadence === 'weekly') {
    const dueDay = (n.dueDay != null ? n.dueDay : setDef.weekAnchor)
    // Find the most recent occurrence of dueDay on-or-before today; the notification
    // fires when today == that due date + offset. This handles day-after follow-ups
    // cleanly regardless of the task-grid's own anchor day.
    const lastDue = new Date(today); lastDue.setDate(today.getDate() - ((today.getDay() - dueDay + 7) % 7))
    const fireDate = new Date(lastDue); fireDate.setDate(lastDue.getDate() + offset)
    const fire = iso(fireDate) === iso(today)
    // The period this is about is the task-grid week containing the DUE date.
    return { fire, periodKey: weekKey(lastDue, setDef.weekAnchor), dueISO: iso(lastDue) }
  }

  // monthly
  const dom = Math.min(28, Math.max(1, parseInt(n.dueDom, 10) || 15))
  const due = new Date(today.getFullYear(), today.getMonth(), dom)
  const fireDate = new Date(due); fireDate.setDate(due.getDate() + offset)
  const fire = iso(fireDate) === iso(today)
  return { fire, periodKey: monthKey(due), dueISO: iso(due) }
}

// Resolve recipients (portal user ids + free emails) to a de-duped email list.
export async function resolveRecipients(n) {
  const portal = (await get('portal:users')) || []
  const byId = new Map(portal.map(u => [u.id, u]))
  const emails = new Set()
  for (const id of (n.recipientUserIds || [])) { const u = byId.get(id); if (u?.email) emails.add(u.email.trim().toLowerCase()) }
  for (const e of (n.recipientEmails || [])) { if (e && /\S+@\S+/.test(e)) emails.add(String(e).trim().toLowerCase()) }
  return [...emails]
}

function renderHtml(body) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;color:#1a1a2e;line-height:1.6">${esc(body).replace(/\n/g, '<br>')}</div>`
}

async function sendEmail(to, subject, body) {
  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.NOTIFY_FROM_EMAIL || process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  if (!RESEND_KEY) return { ok: false, reason: 'email not configured' }
  if (!to.length) return { ok: false, reason: 'no recipients' }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject: subject || 'Rock Roofing notification', html: renderHtml(body || '') }),
  })
  if (!r.ok) return { ok: false, reason: `resend ${r.status}` }
  return { ok: true }
}

// Send one notification now (used by the "Send test" button and the cron).
export async function sendNotification(n, { test = false } = {}) {
  const to = test && n._testTo ? [n._testTo] : await resolveRecipients(n)
  return sendEmail(to, n.subject, n.body)
}

// The daily cron pass. force=1 ignores the day check (fires every enabled rule once,
// still respecting the incomplete condition) for testing.
export async function runNotifications({ force = false, today = new Date() } = {}) {
  const list = await getNotifications()
  const log = (await get(LOG_KEY)) || {}
  const results = []
  for (const n of list) {
    if (!n.enabled) continue
    const { fire, periodKey } = firesToday(n, today)
    if (!force && !fire) continue

    // 'incomplete' rules only send if the period's tasks are NOT all Yes.
    if (n.trigger === 'incomplete') {
      const complete = await isPeriodComplete(n.func, n.cadence, today)
      if (complete) { results.push({ id: n.id, skipped: 'tasks complete' }); continue }
    }

    // De-dupe: don't send the same notification for the same period twice.
    const logKey = `${n.id}|${periodKey}|${n.offsetDays || 0}`
    if (!force && log[logKey]) { results.push({ id: n.id, skipped: 'already sent' }); continue }

    const to = await resolveRecipients(n)
    const res = await sendEmail(to, n.subject, n.body)
    if (res.ok && !force) { log[logKey] = Date.now() }
    results.push({ id: n.id, name: n.name, to: to.length, ...res })
  }
  await set(LOG_KEY, log)
  return { ok: true, count: results.length, results }
}
