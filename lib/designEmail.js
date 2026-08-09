// Email helpers for the Design portal (customer logins + RFI notifications).
// Uses the same Resend setup as the rest of the app.

const RESEND_URL = 'https://api.resend.com/emails'
const FROM = process.env.NOTIFY_FROM_EMAIL || process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
const REPLY_TO = process.env.FORMS_REPLY_TO || 'notifications@rockroofing.co.uk'
export const APP_URL = process.env.PORTAL_URL || 'https://app.rockroofing.co.uk'
const LOGIN_URL = `${APP_URL}/login`

async function send({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY
  if (!key) return { sent: false, error: 'Email not configured' }
  if (!to || (Array.isArray(to) && !to.length)) return { sent: false, error: 'No recipient' }
  try {
    const r = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], reply_to: REPLY_TO, subject, html }),
    })
    const data = await r.json().catch(() => ({}))
    return { sent: r.ok, error: r.ok ? null : (data?.message || `Send failed (${r.status})`) }
  } catch (e) { return { sent: false, error: e.message || 'Send failed' } }
}

const shell = (inner) => `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a19">${inner}<p style="font-size:12px;color:#999;margin-top:24px">Rock Roofing Ltd</p></div>`
const btn = (href, label) => `<p style="text-align:center;margin:24px 0"><a href="${href}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:600;display:inline-block">${label}</a></p>`
const esc = (s) => String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Login details for a newly-created (or re-invited) design customer.
export async function sendCustomerWelcome({ to, name, tempPassword, isReset }) {
  const subject = isReset ? 'Your new Rock Roofing Design portal password' : 'Your Rock Roofing Design portal login';
  const html = shell(`
    <h2>Hi ${esc(name) || 'there'},</h2>
    <p>${isReset ? 'Your Design portal password has been reset.' : "You've been given access to the Rock Roofing Design portal, where you can view your project's RFIs, drawings and documents, and add comments."}</p>
    <p style="font-size:15px;margin-bottom:4px">Log in with your email:</p>
    <div style="background:#faf9f7;border:1px solid #eee;border-radius:10px;padding:12px 16px;margin:6px 0"><strong>Email:</strong> ${esc(to)}<br/><strong>Temporary password:</strong> <span style="font-family:monospace;font-size:16px">${esc(tempPassword)}</span></div>
    <p>You'll be asked to choose your own password the first time you log in.</p>
    ${btn(LOGIN_URL, 'Log in to the Design portal')}
    <p style="font-size:13px;color:#666">Link: <a href="${LOGIN_URL}">${LOGIN_URL}</a></p>
  `)
  return send({ to, subject, html })
}

// Notify someone about a new comment on an RFI.
export async function sendRfiCommentNotice({ to, recipientName, projectNo, projectName, rfiNumber, authorName, commentHtml, rfiLink, mentioned }) {
  const subject = `${mentioned ? 'You were mentioned' : 'New comment'} on ${rfiNumber} - ${projectName || projectNo}`
  const html = shell(`
    <h2>Hi ${esc(recipientName) || 'there'},</h2>
    <p><strong>${esc(authorName)}</strong> ${mentioned ? 'mentioned you in a comment on' : 'commented on'} <strong>${esc(rfiNumber)}</strong> for project <strong>${esc(projectName || projectNo)}</strong>.</p>
    <div style="background:#faf9f7;border-left:3px solid #7c3aed;border-radius:6px;padding:10px 14px;margin:12px 0">${commentHtml || ''}</div>
    ${btn(rfiLink, 'View the RFI')}
    <p style="font-size:13px;color:#666">Link: <a href="${rfiLink}">${rfiLink}</a></p>
  `)
  return send({ to, subject, html })
}

// Notify the responsible customer that a new RFI has been issued to them.
export async function sendRfiIssuedNotice({ to, recipientName, projectNo, projectName, rfiNumber, description, requiredDate, rfiLink }) {
  const subject = `New RFI ${rfiNumber} - ${projectName || projectNo}`
  const html = shell(`
    <h2>Hi ${esc(recipientName) || 'there'},</h2>
    <p>A new Request for Information, <strong>${esc(rfiNumber)}</strong>, has been raised for project <strong>${esc(projectName || projectNo)}</strong> and needs your response.</p>
    ${description ? `<div style="background:#faf9f7;border-left:3px solid #7c3aed;border-radius:6px;padding:10px 14px;margin:12px 0">${esc(description)}</div>` : ''}
    ${requiredDate ? `<p><strong>Response required by:</strong> ${esc(requiredDate)}</p>` : ''}
    ${btn(rfiLink, 'View & respond to the RFI')}
    <p style="font-size:13px;color:#666">Link: <a href="${rfiLink}">${rfiLink}</a></p>
  `)
  return send({ to, subject, html })
}

export { send as _sendDesignEmail }
