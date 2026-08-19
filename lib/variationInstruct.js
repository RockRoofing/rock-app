import crypto from 'crypto'

// A signed link the customer can click to instruct a variation.
//
// Same HMAC approach as the portal session token, and the same secret. It is not a login:
// it authenticates ONE ACTION on ONE VARIATION, which is the whole point - the customer
// has no portal account and should not need one to say "yes, do the work".
//
// What makes it evidence rather than a button:
//   - it is signed, so it cannot be forged or edited to point at a different variation
//   - it names the recipient it was issued to, so the instruction records WHO clicked
//   - it expires, so a link forwarded on months later does not still instruct work
const SECRET = process.env.PORTAL_SECRET || process.env.SESSION_SECRET || 'rock-portal-dev-secret'

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sign = (data) => b64url(crypto.createHmac('sha256', SECRET).update(data).digest())

export function createInstructToken({ projectId, varNumber, email, days = 120 }) {
  const payload = {
    p: String(projectId),
    v: String(varNumber),
    e: String(email || ''),
    exp: Date.now() + days * 86400000,
  }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

export function verifyInstructToken(token) {
  if (!token || !String(token).includes('.')) return null
  const [body, sig] = String(token).split('.')
  if (sign(body) !== sig) return null
  try {
    const p = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    if (!p.exp || p.exp < Date.now()) return null
    return { projectId: p.p, varNumber: p.v, email: p.e }
  } catch { return null }
}

// Three WORKING days. A variation sent on Thursday is chased the following Tuesday, not
// on Sunday - a reminder landing at the weekend is one that gets buried by Monday.
export function addWorkingDays(from, days) {
  const d = new Date(from)
  let left = days
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) left--
  }
  return d
}
