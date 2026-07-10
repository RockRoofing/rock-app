import { getPortalUsers, savePortalUsers } from '../../lib/db'
import { hashPassword, verifyPassword, createSessionToken, verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'

// Portal authentication + user management.
//   POST { action:'login', email, password }      -> sets session cookie
//   POST { action:'logout' }                       -> clears cookie
//   GET  ?action=me                                -> current user (from cookie)
//   GET  ?action=list      (admin)                 -> all portal users
//   POST { action:'create', user } (admin)         -> add user
//   POST { action:'update', user } (admin)         -> edit user / role / active
//   POST { action:'set-password', id, password } (admin or self)
//   POST { action:'delete', id } (admin)
//
// First-admin bootstrap: if no users exist, a seed admin is created on first
// access so the very first login is possible.

const FIRST_ADMIN_EMAIL = 'james@rockroofing.co.uk'   // seed admin
const FIRST_ADMIN_TEMP_PW = 'RockAdmin2026!'           // change on first login

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}
function currentUser(req) {
  return verifySessionToken(readCookie(req, SESSION_COOKIE))
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${7 * 86400}`)
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`)
}
const strip = (u) => { const { passwordHash, ...rest } = u; return rest }

// Emails a new portal user their temporary password + login link.
async function sendPortalInvite({ to, name, tempPassword, origin }) {
  const RESEND_KEY = process.env.RESEND_API_KEY
  if (!RESEND_KEY) return { sent: false, error: 'Email not configured' }
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  const REPLY_TO = process.env.FORMS_REPLY_TO || 'notifications@rockroofing.co.uk'
  const loginUrl = `${origin || 'https://app.rockroofing.co.uk'}/login`
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a19">
      <h2 style="color:#1a1a19">Hi ${name ? name.split(' ')[0] : 'there'},</h2>
      <p>An account has been created for you on the Rock Roofing Portal.</p>
      <p style="font-size:15px">Sign in with your email and this temporary password:</p>
      <div style="font-size:22px;font-weight:700;letter-spacing:2px;background:#faf9f7;border:1px solid #eee;border-radius:12px;padding:16px;text-align:center;margin:12px 0">${tempPassword}</div>
      <p>You'll be asked to set your own password the first time you log in.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${loginUrl}" style="background:#ca8a04;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;display:inline-block">Sign in to the Portal</a>
      </p>
      <p style="font-size:13px;color:#666">Link: <a href="${loginUrl}">${loginUrl}</a></p>
      <p style="font-size:12px;color:#999">For security, please change your password on first login and don't share it.</p>
    </div>`
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, reply_to: REPLY_TO, subject: 'Your Rock Roofing Portal login', html }),
    })
    const data = await r.json()
    return { sent: r.ok, error: r.ok ? null : (data?.message || 'Send failed') }
  } catch (e) { return { sent: false, error: e.message } }
}

async function ensureSeed() {
  let users = await getPortalUsers()
  if (users.length === 0) {
    users = [{
      id: `pu_${Date.now()}`,
      name: 'James McVeigh',
      email: FIRST_ADMIN_EMAIL.toLowerCase(),
      role: 'admin',
      active: true,
      passwordHash: hashPassword(FIRST_ADMIN_TEMP_PW),
      mustResetPassword: true,
      createdAt: Date.now(),
    }]
    await savePortalUsers(users)
  }
  return users
}

export default async function handler(req, res) {
  await ensureSeed()

  if (req.method === 'GET') {
    const action = req.query.action
    if (action === 'me') {
      const u = currentUser(req)
      return res.json({ user: u || null })
    }
    if (action === 'list') {
      const me = currentUser(req)
      if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
      const users = await getPortalUsers()
      return res.json({ users: users.map(strip) })
    }
    return res.status(400).json({ error: 'Unknown action' })
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    const action = body.action

    if (action === 'login') {
      const email = String(body.email || '').toLowerCase().trim()
      const users = await getPortalUsers()
      const user = users.find(u => u.email === email && u.active !== false)
      if (!user || !verifyPassword(body.password, user.passwordHash)) {
        return res.status(401).json({ ok: false, error: 'Incorrect email or password.' })
      }
      const token = createSessionToken(user)
      setSessionCookie(res, token)
      return res.json({ ok: true, user: strip(user), mustResetPassword: !!user.mustResetPassword })
    }

    if (action === 'logout') {
      clearSessionCookie(res)
      return res.json({ ok: true })
    }

    if (action === 'set-password') {
      const me = currentUser(req)
      if (!me) return res.status(401).json({ error: 'Not logged in' })
      // Admins can set anyone's; users can set their own.
      const targetId = body.id || me.id
      if (targetId !== me.id && me.role !== 'admin') return res.status(403).json({ error: 'Not allowed' })
      if (!body.password || body.password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })
      const users = await getPortalUsers()
      const idx = users.findIndex(u => u.id === targetId)
      if (idx < 0) return res.status(404).json({ error: 'User not found' })
      users[idx].passwordHash = hashPassword(body.password)
      users[idx].mustResetPassword = false
      await savePortalUsers(users)
      // Refresh own session if changing own password
      if (targetId === me.id) setSessionCookie(res, createSessionToken(users[idx]))
      return res.json({ ok: true })
    }

    // Remaining actions are admin-only
    const me = currentUser(req)
    if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
    let users = await getPortalUsers()

    if (action === 'create') {
      const u = body.user || {}
      const email = String(u.email || '').toLowerCase().trim()
      if (!u.name && (u.firstName || u.lastName)) u.name = [u.firstName, u.lastName].filter(Boolean).join(' ')
      if (!u.name || !email) return res.status(400).json({ error: 'Name and email are required.' })
      if (users.some(x => x.email === email)) return res.status(409).json({ error: 'That email already has an account.' })
      const tempPw = u.password && u.password.length >= 8 ? u.password : Math.random().toString(36).slice(2, 10) + 'A1!'
      const newUser = {
        id: `pu_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        name: u.name, email,
        firstName: u.firstName || '',
        lastName: u.lastName || '',
        phone: u.phone || '',
        jobRole: u.jobRole || '',   // descriptive role (Estimator, CM, QS…) — separate from access role
        role: ['standard', 'management', 'admin'].includes(u.role) ? u.role : 'standard',
        active: u.active !== false,
        passwordHash: hashPassword(tempPw),
        mustResetPassword: true,
        createdAt: Date.now(),
      }
      users.push(newUser)
      await savePortalUsers(users)
      const origin = `https://${req.headers.host}`
      const invite = await sendPortalInvite({ to: email, name: newUser.name, tempPassword: tempPw, origin })
      return res.json({ ok: true, users: users.map(strip), tempPassword: tempPw, emailSent: invite.sent, emailError: invite.error })
    }

    if (action === 'update') {
      const u = body.user || {}
      const idx = users.findIndex(x => x.id === u.id)
      if (idx < 0) return res.status(404).json({ error: 'User not found' })
      const { password, passwordHash, ...editable } = u
      if (editable.role && !['standard', 'management', 'admin'].includes(editable.role)) delete editable.role
      if (editable.email) editable.email = String(editable.email).toLowerCase().trim()
      // Keep display name in sync when first/last provided
      if (editable.firstName || editable.lastName) {
        editable.name = [editable.firstName ?? users[idx].firstName, editable.lastName ?? users[idx].lastName].filter(Boolean).join(' ') || users[idx].name
      }
      users[idx] = { ...users[idx], ...editable }
      await savePortalUsers(users)
      return res.json({ ok: true, users: users.map(strip) })
    }

    if (action === 'delete') {
      if (body.id === me.id) return res.status(400).json({ error: 'You cannot delete your own account.' })
      users = users.filter(x => x.id !== body.id)
      await savePortalUsers(users)
      return res.json({ ok: true, users: users.map(strip) })
    }

    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(405).end()
}
