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
      if (!u.name || !email) return res.status(400).json({ error: 'Name and email are required.' })
      if (users.some(x => x.email === email)) return res.status(409).json({ error: 'That email already has an account.' })
      const tempPw = u.password && u.password.length >= 8 ? u.password : Math.random().toString(36).slice(2, 10) + 'A1!'
      const newUser = {
        id: `pu_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        name: u.name, email,
        role: ['standard', 'management', 'admin'].includes(u.role) ? u.role : 'standard',
        active: u.active !== false,
        passwordHash: hashPassword(tempPw),
        mustResetPassword: true,
        createdAt: Date.now(),
      }
      users.push(newUser)
      await savePortalUsers(users)
      return res.json({ ok: true, users: users.map(strip), tempPassword: tempPw })
    }

    if (action === 'update') {
      const u = body.user || {}
      const idx = users.findIndex(x => x.id === u.id)
      if (idx < 0) return res.status(404).json({ error: 'User not found' })
      const { password, passwordHash, ...editable } = u
      if (editable.role && !['standard', 'management', 'admin'].includes(editable.role)) delete editable.role
      if (editable.email) editable.email = String(editable.email).toLowerCase().trim()
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
