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

export function createSessionToken(user, days = 7) {
  const payload = { id: user.id, email: user.email, role: user.role, name: user.name, exp: Date.now() + days * 86400000 }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

export function verifySessionToken(token) {
  if (!token || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  if (sign(body) !== sig) return null
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    if (!payload.exp || payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

export const SESSION_COOKIE = 'rr_portal_session'
