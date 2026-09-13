import bcrypt from 'bcryptjs'
import crypto from 'crypto'

// ── Portal authentication helpers ──
// Passwords are hashed with bcrypt. Sessions are stateless signed tokens
// (HMAC-SHA256) so middleware can verify them at the edge without a DB call.

const SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret-change-me'

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10)
}
export function verifyPassword(pw, hash) {
  try { return bcrypt.compareSync(pw, hash || '') } catch { return false }
}

// Token = base64url(payload).signature   payload = { id, email, role, exp }
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function sign(data) {
  return b64url(crypto.createHmac('sha256', SECRET).update(data).digest())
}

// A SESSION BELONGS TO ONE CUSTOMER.
//
// It did not used to. The payload was { id, email, role, name, exp } signed with
// one global secret, which meant a cookie issued by one customer's site verified
// perfectly on another's:
//
//   1. sign in at app.rockroofing.co.uk, get a cookie
//   2. send that cookie to wilson.constructionliberation.com
//   3. the signature verifies - same secret
//   4. requireRole reads role: 'admin' - passes
//   5. getClient() resolves Wilson from the host and opens WILSON'S database
//   6. Wilson's financials render, to an authenticated Rock session
//
// No forgery, no stolen password. Just a different hostname. Every other
// guardrail behaved correctly the whole way through - the tenant resolved right,
// the self-check passed, the database was the correct one. Data access was
// tenant-scoped; AUTHENTICATION never was.
//
// So the customer goes in the payload, as `t`, and is checked on the way back.
export function createSessionToken(user, tenantId, days = 7) {
  const payload = {
    id: user.id, email: user.email, role: user.role, name: user.name,
    t: tenantId || null,
    exp: Date.now() + days * 86400000,
  }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

// expectedTenantId: pass it and the session must belong to that customer.
// Omit it and only the signature and expiry are checked - which is all
// middleware can do at the edge, since it cannot reach the registry.
export function verifySessionToken(token, expectedTenantId) {
  if (!token || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  if (sign(body) !== sig) return null
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    if (!payload.exp || payload.exp < Date.now()) return null
    if (expectedTenantId !== undefined && expectedTenantId !== null) {
      // A token with NO customer is one issued before this existed. Rejected
      // rather than assumed to be the current one - assuming is how the hole
      // would stay open for the seven days it takes them all to expire.
      if (!payload.t || String(payload.t) !== String(expectedTenantId)) return null
    }
    return payload
  } catch { return null }
}

export const SESSION_COOKIE = 'rr_portal_session'

// ── Password reset tokens ───────────────────────────────────────────────────
// Purpose-bound, short-lived, and tied to the user's CURRENT password hash so a
// link stops working the moment the password is changed (self-invalidating,
// single-use in practice). No DB storage needed.
export function createResetToken(user, ttlMs = 3600000) {
  const hashFrag = (user.passwordHash || '').slice(0, 16)
  const payload = { id: user.id, email: user.email, purpose: 'pwreset', hf: hashFrag, exp: Date.now() + ttlMs }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}
export function verifyResetToken(token, user) {
  if (!token || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  if (sign(body) !== sig) return null
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    if (payload.purpose !== 'pwreset') return null
    if (!payload.exp || payload.exp < Date.now()) return null
    if (user) {
      if (payload.id !== user.id) return null
      if (payload.hf !== (user.passwordHash || '').slice(0, 16)) return null   // password already changed
    }
    return payload
  } catch { return null }
}

// ── Server-side API guards ─────────────────────────────────────────────────
// Read + verify the session from an API request's cookies.
export function getSessionFromReq(req) {
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token) return null
  return verifySessionToken(token)
}

// Guard an API route. Returns the session if allowed; otherwise writes a 401/403
// response and returns null (caller should `return` immediately if null).
// Usage:
//   const session = requireRole(req, res, ['management','admin'])
//   if (!session) return
export function requireRole(req, res, allowedRoles) {
  const session = getSessionFromReq(req)
  if (!session) { res.status(401).json({ error: 'Not signed in' }); return null }
  const norm = (r) => (r === 'standard' ? 'post-contract' : r)
  const role = norm(session.role)
  const allowed = (allowedRoles || []).map(norm)
  if (allowed.length && !allowed.includes(role)) {
    res.status(403).json({ error: 'You do not have access to this.' }); return null
  }
  return session
}
