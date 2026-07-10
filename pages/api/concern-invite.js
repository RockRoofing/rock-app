import { get, set, getPortalUsers, getLiveTasks } from '../../lib/db'

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

  // Resolve attendee emails directly from portal users (no internal HTTP fetch —
  // that would be blocked by the login middleware and return nothing).
  let portalUsers = []
  try { portalUsers = await getPortalUsers() } catch {}
  const users = portalUsers.map(u => ({
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || '',
    email: u.email || '',
  }))
  const attendeeEmails = (m.attendees || [])
    .map(id => users.find(u => u.id === id))
    .filter(Boolean)
    .map(u => ({ id: u.id, email: u.email, name: u.name }))
    .filter(a => a.email)

  if (method === 'REQUEST' && (!m.nextMeetingDate || !attendeeEmails.length)) {
    return res.status(200).json({ sent: false, error: !attendeeEmails.length ? 'No attendee emails' : 'No date' })
  }

  // Decide recipients:
  //  - date/time changed (dateChanged=true) OR cancel -> send to ALL current attendees
  //  - otherwise (just added attendees to an existing invite) -> only NEW attendees
  const alreadyInvited = m.invitedAttendees || []
  const dateChanged = m.inviteSentDate && (m.inviteSentDate !== m.nextMeetingDate || (m.inviteSentTime || '09:00') !== (m.nextMeetingTime || '09:00'))
  let recipients = attendeeEmails
  if (method === 'REQUEST' && m.inviteUid && !dateChanged) {
    recipients = attendeeEmails.filter(a => !alreadyInvited.includes(a.id))
  }
  if (method === 'REQUEST' && !recipients.length) {
    return res.status(200).json({ sent: 0, error: 'No new attendees to invite' })
  }

  // Stable UID + sequence for update/cancel semantics
  const uid = m.inviteUid || `concern-${projectNo}-${meetingId}@rockroofing.co.uk`
  const sequence = (m.inviteSequence || 0) + 1

  // Build a full description covering all meeting information.
  let tasks = [], risks = []
  try {
    const allTasks = await getLiveTasks()
    const allRisks = (await get('ops:risks')) || []
    tasks = allTasks.filter(t => (m.actionTaskIds || []).includes(t.id))
    risks = allRisks.filter(r => r.projectNo === projectNo)
  } catch {}

  const attendeeNames = attendeeEmails.map(a => a.name || a.email)
  const issues = [...(m.issues || []), ...(m.issueOther ? [m.issueOther] : [])]

  const lines = []
  lines.push('PROJECT CONCERN — FOLLOW-UP MEETING')
  lines.push('')
  lines.push(`Project: ${m.projectName || ''} (${projectNo})`)
  if (m.date) lines.push(`Original meeting date: ${m.date}`)
  if (attendeeNames.length) lines.push(`Attendees: ${attendeeNames.join(', ')}`)
  if (m.recordingLink) lines.push(`Recording: ${m.recordingLink}`)
  lines.push('')
  if (issues.length) { lines.push('Issues faced:'); issues.forEach(i => lines.push(`  • ${i}`)); lines.push('') }
  if (m.description) { lines.push('Current / potential issue(s):'); lines.push(m.description); lines.push('') }
  if (m.mitigation) { lines.push('How we plan to mitigate / remove the risk:'); lines.push(m.mitigation); lines.push('') }
  if (risks.length) { lines.push('Risk log:'); risks.forEach(r => lines.push(`  • ${r.description || ''}${r.mitigation ? ` — mitigation: ${r.mitigation}` : ''}${r.closed ? ' (resolved)' : ''}`)); lines.push('') }
  if (tasks.length) { lines.push('Meeting actions:'); tasks.forEach(t => lines.push(`  • ${t.description || ''}${t.assignee ? ` — ${t.assignee}` : ''}${t.closed ? ' (done)' : ''}`)); lines.push('') }
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
  for (const a of recipients) {
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

  // Persist invite metadata WITHOUT touching any other meeting fields (attendees etc.).
  // Track everyone who now holds an invite so future "add attendee" updates only email the new ones.
  const invitedAttendees = method === 'CANCEL' ? [] : Array.from(new Set([...(m.invitedAttendees || []), ...attendeeEmails.map(a => a.id)]))
  const fresh = (await get(keyFor(projectNo))) || meetings
  const i2 = fresh.findIndex(x => x.id === meetingId)
  if (i2 >= 0) {
    fresh[i2] = { ...fresh[i2], inviteUid: uid, inviteSequence: sequence, inviteSentDate: m.nextMeetingDate, inviteSentTime: m.nextMeetingTime || '09:00', invitedAttendees }
    await set(keyFor(projectNo), fresh)
  }

  return res.json({ ok: true, sent: sentCount, method })
}
