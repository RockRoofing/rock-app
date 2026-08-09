import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { _sendDesignEmail } from '../../lib/designEmail'

// Admin-only: send a test email and return the raw result, so we can see exactly why
// design emails are or aren't sending. GET/POST ?to=you@example.com
function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}

export default async function handler(req, res) {
  const me = verifySessionToken(readCookie(req, SESSION_COOKIE))
  if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  const to = String((req.query.to || req.body?.to || me.email || '')).trim()

  const diag = {
    hasResendKey: !!process.env.RESEND_API_KEY,
    FORMS_FROM_EMAIL: process.env.FORMS_FROM_EMAIL || null,
    NOTIFY_FROM_EMAIL: process.env.NOTIFY_FROM_EMAIL || null,
    FORMS_REPLY_TO: process.env.FORMS_REPLY_TO || null,
    fromUsed: process.env.FORMS_FROM_EMAIL || process.env.NOTIFY_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>',
    recipient: to,
  }
  if (!to) return res.json({ ...diag, sent: false, error: 'No recipient - pass ?to=you@example.com' })

  const result = await _sendDesignEmail({
    to,
    subject: 'Rock Roofing Design portal - test email',
    html: '<div style="font-family:system-ui,Arial,sans-serif"><h2>Test email</h2><p>If you can read this, design emails are sending correctly.</p></div>',
  })
  return res.json({ ...diag, ...result })
}
