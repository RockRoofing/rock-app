import { getPortalUsers } from './db'
import { normRole } from './roles'

// EMAIL FOR @MENTIONS IN CRM NOTES.
//
// The CRM has always written a history line reading "Notified: Roman (email would send in
// live version)". Nothing ever sent. This sends it.
//
// Two things were wrong beyond the missing send:
//   1. Mentions matched a hard-coded list of five FIRST names in crmFieldSchema, so
//      "@Edita" worked and "@Edita Durikova" did not, and anyone joining since was
//      unmentionable. Resolution is now against real portal users.
//   2. There was no way to reach the mentioned person anyway - no email address on the
//      list at all.

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Who can be mentioned: the same people who can own a CRM activity.
export async function getMentionableUsers() {
  const portal = await getPortalUsers()
  return (Array.isArray(portal) ? portal : [])
    .filter((u) => u.active !== false && u.email)
    .filter((u) => ['pre-contract', 'admin'].includes(normRole(u.role)))
    .map((u) => ({
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || u.username || '',
      first: u.firstName || (u.name || '').split(' ')[0] || '',
      username: u.username || '',
      email: u.email,
    }))
    .filter((u) => u.name)
}

// Match @Name in the text against real users. Full name first, so "@Edita Durikova"
// resolves to Edita rather than stopping at the first name and leaving "Durikova"
// dangling. Falls back to first name and username, because that is what people type.
export function resolveMentions(text, users) {
  const body = String(text || '')
  const hit = new Map()
  const ordered = [...(users || [])].sort((a, b) => (b.name || '').length - (a.name || '').length)
  for (const u of ordered) {
    for (const handle of [u.name, u.first, u.username].filter(Boolean)) {
      // \B before @ so an email address in the body cannot trigger a mention.
      const re = new RegExp(`(^|[^\\w@])@${handle.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i')
      if (re.test(body)) { hit.set(u.email, u); break }
    }
  }
  return [...hit.values()]
}

export async function sendMentionEmails({ dealId, dealTitle, body, author, kind = 'note' }) {
  const users = await getMentionableUsers()
  const targets = resolveMentions(body, users)
    // Nobody needs an email telling them what they just typed.
    .filter((u) => !author || u.name.toLowerCase() !== String(author).toLowerCase())
  if (!targets.length) return { ok: true, sent: 0, note: 'No mentions to notify.' }

  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'Email not configured (RESEND_API_KEY)', names: targets.map((t) => t.name) }
  const from = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  const baseUrl = process.env.PORTAL_BASE_URL || 'https://app.rockroofing.co.uk'
  const link = `${baseUrl}/crm?deal=${encodeURIComponent(dealId)}`
  const what = kind === 'comment' ? 'a comment' : 'a note'

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;color:#1a1a19">
      <p style="font-size:15px">${esc(author || 'Someone')} mentioned you in ${what} on
        <strong>${esc(dealTitle || `project ${dealId}`)}</strong>.</p>
      <div style="border-left:3px solid #2a7de1;background:#f7f9fc;padding:12px 14px;margin:16px 0;
                  font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(body)}</div>
      <p style="margin-top:22px"><a href="${link}"
        style="background:#2a7de1;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;
               font-size:13px;font-weight:600">Open the project</a></p>
      <p style="color:#888;font-size:12px;margin-top:18px">${esc(link)}</p>
    </div>`

  let sent = 0
  const failed = []
  for (const t of targets) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: [t.email],
          subject: `${author || 'Someone'} mentioned you - ${dealTitle || `project ${dealId}`}`,
          html,
        }),
      })
      if (res.ok) sent++; else failed.push(t.email)
    } catch { failed.push(t.email) }
  }
  return { ok: true, sent, failed, names: targets.map((t) => t.name) }
}
