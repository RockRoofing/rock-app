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
  return getMentionableUsersForRoles(['pre-contract', 'admin'])
}

// The same resolution for any other surface, with its own set of roles. Cost comments
// on a project need the commercial side, not the sales side, and duplicating this
// function to change one array is how the rest of this codebase went wrong.
export async function getMentionableUsersForRoles(roles) {
  const allow = (roles || []).map(normRole)
  const portal = await getPortalUsers()
  return (Array.isArray(portal) ? portal : [])
    .filter((u) => u.active !== false && u.email)
    .filter((u) => !allow.length || allow.includes(normRole(u.role)))
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
  // A first name only counts when exactly one person has it - see the client-side twin
  // of this in pages/crm.js. Two Jameses and "@James" is a guess.
  const firstCounts = {}
  for (const u of (users || [])) { const f = (u.first || '').toLowerCase(); if (f) firstCounts[f] = (firstCounts[f] || 0) + 1 }
  for (const u of ordered) {
    const unique = firstCounts[(u.first || '').toLowerCase()] === 1
    for (const handle of [u.name, u.username, unique ? u.first : null].filter(Boolean)) {
      // \B before @ so an email address in the body cannot trigger a mention.
      const re = new RegExp(`(^|[^\\w@])@${handle.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i')
      if (re.test(body)) { hit.set(u.email, u); break }
    }
  }
  return [...hit.values()]
}

export async function sendMentionEmails({ dealId, dealTitle, body, author, kind = 'note' }) {
  const baseUrl = process.env.PORTAL_BASE_URL || 'https://app.rockroofing.co.uk'
  return notifyMentions({
    body, author,
    users: await getMentionableUsers(),
    // The CRM has never emailed you your own note. Unchanged here on purpose.
    notifyAuthor: false,
    what: kind === 'comment' ? 'a comment' : 'a note',
    context: dealTitle || `project ${dealId}`,
    link: `${baseUrl}/crm?deal=${encodeURIComponent(dealId)}`,
    cta: 'Open the project',
  })
}

// THE ONLY PLACE A MENTION EMAIL IS SENT.
//
// Everything above and every other surface goes through here, so the sending address,
// the failure reporting and the "do not email the author their own words" rule exist
// once. `users` is the mentionable set for whichever surface is calling.
export async function notifyMentions({ body, author, users, what = 'a comment', context = '', link = '', cta = 'Open it', notifyAuthor = true }) {
  // WHY NOTHING WAS SENT HAS TO COME BACK, NOT JUST THAT NOTHING WAS SENT.
  //
  // This returned a bare { sent: 0 } for three completely different outcomes - the
  // name did not match anyone, the only person tagged was the author, or there are no
  // mentionable users at all - so every one of them surfaced as silence. "I tagged
  // someone and they got nothing" was unanswerable without reading the code.
  const matched = resolveMentions(body, users)
  const isSelf = (u) => author && u.name.toLowerCase() === String(author).toLowerCase()
  // IF YOU WERE TAGGED, YOU GET THE EMAIL - INCLUDING WHEN YOU TAGGED YOURSELF.
  //
  // The CRM's rule was that nobody needs an email telling them what they just typed,
  // and it still passes notifyAuthor: false to keep that. Everywhere else a tag is a
  // tag: tagging yourself is a deliberate act, usually to put something in your own
  // inbox to come back to, and silently dropping it is surprising.
  const self = notifyAuthor ? [] : matched.filter(isSelf)
  const targets = notifyAuthor ? matched : matched.filter((u) => !isSelf(u))

  const diag = {
    mentionable: (users || []).length,
    matchedNames: matched.map((u) => u.name),
    skippedSelf: self.map((u) => u.name),
    resendConfigured: !!process.env.RESEND_API_KEY,
  }

  if (!targets.length) {
    const reason = self.length
      ? `Only you were tagged - you are not emailed your own comment.`
      : (diag.mentionable === 0
          ? 'Nobody is taggable here. Portal users need an email address and the right role.'
          : 'No name in the comment matched anyone. Type @ and pick from the list.')
    return { ok: true, sent: 0, names: [], reason, ...diag }
  }

  const key = process.env.RESEND_API_KEY
  if (!key) {
    return { ok: false, sent: 0, error: 'Email is not configured on the server (RESEND_API_KEY is not set).',
             names: targets.map((t) => t.name), ...diag }
  }
  const from = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;color:#1a1a19">
      <p style="font-size:15px">${esc(author || 'Someone')} mentioned you in ${what} on
        <strong>${esc(context)}</strong>.</p>
      <div style="border-left:3px solid #2a7de1;background:#f7f9fc;padding:12px 14px;margin:16px 0;
                  font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(body)}</div>
      <p style="margin-top:22px"><a href="${link}"
        style="background:#2a7de1;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;
               font-size:13px;font-weight:600">${esc(cta)}</a></p>
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
          subject: `${author || 'Someone'} mentioned you - ${context}`,
          html,
        }),
      })
      if (res.ok) { sent++; continue }
      // Keep what Resend actually said. Throwing this away is why a failing send looked
      // like nothing happening at all - the commonest cause is an unverified sending
      // domain, and Resend says so plainly in the body.
      let detail = ''
      try { detail = (await res.text()).slice(0, 300) } catch { /* ignore */ }
      failed.push({ email: t.email, status: res.status, detail })
    } catch (e) {
      failed.push({ email: t.email, status: 0, detail: e.message || 'network error' })
    }
  }
  return { ok: true, sent, failed, from, names: targets.map((t) => t.name), ...diag }
}


// Diagnostic. Reports what WOULD happen for a given body, without sending anything -
// who it resolves to, whether email is configured, and which address it would send from.
export async function diagnoseMentions(body) {
  const users = await getMentionableUsers()
  const targets = resolveMentions(body || '', users)
  return {
    ok: true,
    mentionableUsers: users.map((u) => ({ name: u.name, email: u.email })),
    usersWithoutEmail: 'filtered out before this point - see getMentionableUsers',
    resolved: targets.map((t) => ({ name: t.name, email: t.email })),
    resendConfigured: !!process.env.RESEND_API_KEY,
    from: process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>',
    baseUrl: process.env.PORTAL_BASE_URL || 'https://app.rockroofing.co.uk',
  }
}
