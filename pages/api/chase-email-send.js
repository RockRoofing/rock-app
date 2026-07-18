import { requireRole } from '../../lib/portalAuth'

// Sends a single chase email (already-rendered subject + body) via Resend.
// FROM  = ACCOUNTS_FROM_EMAIL (e.g. "Rock Roofing Accounts <accountsreceivable@rockroofing.co.uk>")
//         falls back to FORMS_FROM_EMAIL, then Resend's test address.
// REPLY-TO = the project QS's email (passed in), so replies reach the QS.
//
// Body: { to:[..], cc:[..], replyTo, subject, html|text }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return

  const { to, cc, replyTo, subject, text } = req.body || {}
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (!recipients.length) return res.status(400).json({ error: 'At least one recipient (to) is required' })
  if (!subject) return res.status(400).json({ error: 'Subject is required' })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Email is not configured (RESEND_API_KEY missing).' })

  const FROM = process.env.ACCOUNTS_FROM_EMAIL
    || process.env.FORMS_FROM_EMAIL
    || 'Rock Roofing Accounts <onboarding@resend.dev>'

  // Preserve the plain-text template layout as HTML (newlines -> <br>).
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;white-space:normal;line-height:1.5">${esc(text).replace(/\n/g, '<br>')}</div>`

  const payload = {
    from: FROM,
    to: recipients,
    subject,
    html,
    text: String(text || ''),
  }
  const ccList = (Array.isArray(cc) ? cc : [cc]).filter(Boolean)
  if (ccList.length) payload.cc = ccList
  if (replyTo) payload.reply_to = replyTo

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return res.status(502).json({ error: data?.message || 'Resend rejected the email', detail: data })
    return res.json({ ok: true, id: data?.id || null })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
