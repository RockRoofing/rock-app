import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { getExternalUsers, saveExternalUsers, stripExternal, normProjects, hashPassword } from '../../lib/designUsers'
import { sendCustomerWelcome } from '../../lib/designEmail'

// Admin management of EXTERNAL customer/design-team users.
//   GET  ?action=list                         -> { users }
//   POST { action:'create', user }            -> add (returns temp password)
//   POST { action:'update', user }            -> edit (name/email/company/projects/active)
//   POST { action:'set-password', id, password }
//   POST { action:'delete', id }
// External users are project-scoped and can NEVER be assigned all projects.

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}
function currentUser(req) { return verifySessionToken(readCookie(req, SESSION_COOKIE)) }

export default async function handler(req, res) {
  const me = currentUser(req)
  if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Admins only' })

  if (req.method === 'GET') {
    const users = await getExternalUsers()
    return res.json({ users: users.map(stripExternal) })
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    const action = body.action
    let users = await getExternalUsers()

    if (action === 'create') {
      const u = body.user || {}
      const email = String(u.email || '').toLowerCase().trim()
      const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ')
      if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' })
      if (users.some(x => (x.email || '').toLowerCase() === email)) return res.status(409).json({ error: 'That email already has a customer account.' })
      const projects = normProjects(u.projects)
      if (!projects.length) return res.status(400).json({ error: 'Assign at least one project. External users must be scoped to specific projects.' })
      const tempPw = u.password && u.password.length >= 8 ? u.password : Math.random().toString(36).slice(2, 10) + 'A1!'
      const newUser = {
        id: `ext_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        name, email,
        firstName: u.firstName || '',
        lastName: u.lastName || '',
        company: u.company || '',
        phone: u.phone || '',
        projects,
        active: u.active !== false,
        passwordHash: hashPassword(tempPw),
        mustResetPassword: true,
        createdAt: Date.now(),
      }
      users.push(newUser)
      await saveExternalUsers(users)
      // Email the customer their login details.
      const mail = await sendCustomerWelcome({ to: email, name, tempPassword: tempPw })
      return res.json({ ok: true, users: users.map(stripExternal), tempPassword: tempPw, emailSent: mail.sent, emailError: mail.error || null })
    }

    // Re-send login details: generates a NEW temporary password (the old one can't be
    // recovered because it's hashed) and emails it to the customer.
    if (action === 'resend-invite') {
      const idx = users.findIndex(x => x.id === body.id)
      if (idx < 0) return res.status(404).json({ error: 'Customer not found' })
      const tempPw = Math.random().toString(36).slice(2, 10) + 'A1!'
      users[idx].passwordHash = hashPassword(tempPw)
      users[idx].mustResetPassword = true
      await saveExternalUsers(users)
      const mail = await sendCustomerWelcome({ to: users[idx].email, name: users[idx].name, tempPassword: tempPw, isReset: true })
      return res.json({ ok: true, users: users.map(stripExternal), tempPassword: tempPw, emailSent: mail.sent, emailError: mail.error || null })
    }

    if (action === 'update') {
      const u = body.user || {}
      const idx = users.findIndex(x => x.id === u.id)
      if (idx < 0) return res.status(404).json({ error: 'Customer not found' })
      const { password, passwordHash, ...editable } = u
      if (editable.email) {
        editable.email = String(editable.email).toLowerCase().trim()
        if (users.some((x, i) => i !== idx && (x.email || '').toLowerCase() === editable.email)) return res.status(409).json({ error: 'That email is already in use.' })
      }
      if ('projects' in editable) {
        editable.projects = normProjects(editable.projects)
        if (!editable.projects.length) return res.status(400).json({ error: 'Assign at least one project.' })
      }
      if (editable.firstName != null || editable.lastName != null) {
        editable.name = [editable.firstName ?? users[idx].firstName, editable.lastName ?? users[idx].lastName].filter(Boolean).join(' ') || users[idx].name
      }
      users[idx] = { ...users[idx], ...editable }
      await saveExternalUsers(users)
      return res.json({ ok: true, users: users.map(stripExternal) })
    }

    if (action === 'set-password') {
      const idx = users.findIndex(x => x.id === body.id)
      if (idx < 0) return res.status(404).json({ error: 'Customer not found' })
      if (!body.password || body.password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })
      users[idx].passwordHash = hashPassword(body.password)
      users[idx].mustResetPassword = true
      await saveExternalUsers(users)
      return res.json({ ok: true })
    }

    if (action === 'delete') {
      users = users.filter(x => x.id !== body.id)
      await saveExternalUsers(users)
      return res.json({ ok: true, users: users.map(stripExternal) })
    }

    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(405).end()
}
