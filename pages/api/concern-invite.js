import { get, set } from '../../lib/db'

// Sends (or updates/cancels) a calendar invite for a Project Concern meeting's
// "next meeting". Uses a stable UID + incrementing SEQUENCE stored on the meeting
// so a later date change is treated by Outlook as an UPDATE (moves the event),
// and turning the meeting off sends a CANCEL. Attendees can then edit in their
// own calendar — the portal doesn't manage it after sending.
//
// POST /api/concern-invite { projectNo, meetingId, method:'REQUEST'|'CANCEL' }

const keyFor = (p) => `ops:concerns:${p}`
const pad = (n) => String(n).padStart(2, '0')

// Build an ICS datetime (local floating time is simplest & avoids TZ headaches):
function icsDateTime(dateStr, timeStr) {
  const [y, m, d] = (dateStr || '').split('-').map(Number)
  const [hh, mm] = (timeStr || '09:00').split(':').map(Number)
  return `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`
}
function addMinutes(dateStr, timeStr, mins) {
  const [y, m, d] = (dateStr || '').split('-').map(Number)
  const [hh, mm] = (timeStr || '09:00').split(':').map(Number)
  const dt = new Date(y, m - 1, d, hh, mm)
  dt.setMinutes(dt.getMinutes() + mins)
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`
}
const esc = (s) => (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { projectNo, meetingId, method = 'REQUEST' } = req.body || {}
  if (!projectNo || !meetingId) return res.status(400).json({ error: 'projectNo and meetingId required' })

  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  const ORGANISER = (FROM.match(/<(.+)>/) || [])[1] || 'notifications@rockroofing.co.uk'
  if (!RESEND_KEY) return res.status(200).json({ sent: false, error: 'Email not configured' })

  const meetings = (await get(keyFor(projectNo))) || []
  const idx = meetings.findIndex(m => m.id === meetingId)
  if (idx < 0) return res.status(404).json({ error: 'meeting not found' })
  const m = meetings[idx]

  // Resolve attendee emails from portal users
  let users = []
  try {
    const base = `http://${req.headers.host}`
    users = (await fetch(`${base}/api/team`).then(r => r.json())).members || []
  } catch {}
  const attendeeEmails = (m.attendees || [])
    .map(id => users.find(u => u.id === id))
    .filter(Boolean)
    .map(u => ({ email: u.email, name: u.name }))
    .filter(a => a.email)

  if (method === 'REQUEST' && (!m.nextMeetingDate || !attendeeEmails.length)) {
    return res.status(200).json({ sent: false, error: !attendeeEmails.length ? 'No attendee emails' : 'No date' })
  }

  // Stable UID + sequence for update/cancel semantics
  const uid = m.inviteUid || `concern-${projectNo}-${meetingId}@rockroofing.co.uk`
  const sequence = (m.inviteSequence || 0) + 1

  // Build description: risks, mitigations, meeting actions
  let tasks = [], risks = []
  try {
    const base = `http://${req.headers.host}`
    const [tk, rk] = await Promise.all([
      fetch(`${base}/api/tasks`).then(r => r.json()).catch(() => ({})),
      fetch(`${base}/api/risks`).then(r => r.json()).catch(() => ({})),
    ])
    tasks = (tk.tasks || []).filter(t => (m.actionTaskIds || []).includes(t.id))
    risks = (rk.risks || []).filter(r => r.projectNo === projectNo)
  } catch {}

  const lines = []
  lines.push(`Project Concern follow-up meeting`)
  lines.push(`Project: ${m.projectName || ''} (${projectNo})`)
  lines.push('')
  if (m.description) { lines.push('Current / potential issues:'); lines.push(m.description); lines.push('') }
  if (m.mitigation) { lines.push('Mitigation plan:'); lines.push(m.mitigation); lines.push('') }
  if (risks.length) { lines.push('Risks:'); risks.forEach(r => lines.push(`- ${r.description || ''}${r.mitigation ? ` (mitigation: ${r.mitigation})` : ''}`)); lines.push('') }
  if (tasks.length) { lines.push('Meeting actions:'); tasks.forEach(t => lines.push(`- ${t.description || ''}${t.assignee ? ` [${t.assignee}]` : ''}`)); lines.push('') }
  const description = lines.join('\n')

  const dtStart = icsDateTime(m.nextMeetingDate, m.nextMeetingTime)
  const dtEnd = addMinutes(m.nextMeetingDate, m.nextMeetingTime, 30)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rock Roofing//Portal//EN',
    `METHOD:${method}`, 'BEGIN:VEVENT',
    `UID:${uid}`, `SEQUENCE:${sequence}`, `DTSTAMP:${stamp}`,
    `DTSTART:${dtStart}`, `DTEND:${dtEnd}`,
    `SUMMARY:${esc(`Project Concern — ${m.projectName || projectNo}`)}`,
    `DESCRIPTION:${esc(description)}`,
    `ORGANIZER;CN=Rock Roofing:mailto:${ORGANISER}`,
    ...attendeeEmails.map(a => `ATTENDEE;CN=${esc(a.name || a.email)};RSVP=TRUE:mailto:${a.email}`),
    method === 'CANCEL' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')

  const base64 = Buffer.from(ics, 'utf-8').toString('base64')
  const subjectPrefix = method === 'CANCEL' ? 'Cancelled: ' : (m.inviteUid ? 'Updated: ' : '')
  const subject = `${subjectPrefix}Project Concern meeting — ${m.projectName || projectNo}`

  let sentCount = 0
  for (const a of attendeeEmails) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: a.email,
          subject,
          html: `<p>${method === 'CANCEL' ? 'The following Project Concern meeting has been cancelled.' : 'You are invited to a Project Concern meeting.'}</p><pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${description.replace(/</g, '&lt;')}</pre>`,
          attachments: [{ filename: 'invite.ics', content: base64, content_type: `text/calendar; method=${method}` }],
        }),
      })
      if (resp.ok) sentCount++
    } catch {}
  }

  // Persist UID + sequence so future changes update the same event
  meetings[idx] = { ...m, inviteUid: uid, inviteSequence: sequence, inviteSentDate: m.nextMeetingDate, inviteSentTime: m.nextMeetingTime || '09:00' }
  await set(keyFor(projectNo), meetings)

  return res.json({ ok: true, sent: sentCount, method })
}
