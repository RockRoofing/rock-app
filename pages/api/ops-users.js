import { getOpsUsers, saveOpsUsers } from '../../lib/db'

// Operative users for forms.rockroofing.co.uk.
// Login is intentionally simple for site use: name + 4-6 digit PIN.
// (This is a lightweight gate to keep the forms app separate from the main
//  portal and attribute submissions — not high-security auth. Can be upgraded
//  to Microsoft/365 SSO later without changing the forms UI.)
//
// GET    /api/ops-users            -> { users } (PINs omitted)
// POST   /api/ops-users { user }   -> upsert, returns { users }
// DELETE /api/ops-users { id }     -> remove
// POST   /api/ops-users { action:'login', pin } -> { ok, user } | { ok:false }
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const users = await getOpsUsers()
    // Never leak PINs to the client list.
    return res.json({ users: users.map(({ pin, ...u }) => u) })
  }

  if (req.method === 'POST') {
    const body = req.body || {}

    // Login verification
    if (body.action === 'login') {
      const users = await getOpsUsers()
      const user = users.find(u => String(u.pin) === String(body.pin) && u.active !== false)
      if (!user) return res.json({ ok: false })
      const { pin, ...safe } = user
      // Provide a computed display name for the Forms App (works whether the
      // record has firstName/lastName or a legacy single name field).
      safe.name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || ''
      return res.json({ ok: true, user: safe })
    }

    // Upsert a user
    const { user } = body
    if (!user || !user.name) return res.status(400).json({ error: 'Missing user' })
    let users = await getOpsUsers()
    if (!user.id) {
      user.id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
      user.active = user.active !== false
    }
    // Guard: PINs must be unique.
    if (user.pin && users.some(u => u.id !== user.id && String(u.pin) === String(user.pin))) {
      return res.status(409).json({ error: 'That PIN is already in use — choose another.' })
    }
    const idx = users.findIndex(u => u.id === user.id)
    if (idx >= 0) users[idx] = { ...users[idx], ...user }
    else users.push(user)
    await saveOpsUsers(users)
    return res.json({ users: users.map(({ pin, ...u }) => u) })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let users = await getOpsUsers()
    users = users.filter(u => u.id !== id)
    await saveOpsUsers(users)
    return res.json({ users: users.map(({ pin, ...u }) => u) })
  }

  res.status(405).end()
}
