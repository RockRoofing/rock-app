import { get, set, getPortalUsers } from '../../lib/db'
import { requireRole } from '../../lib/portalAuth'

// Designated RAMS Director — chosen from Portal Users whose jobRole is 'Director'.
// The Director approves/signs RAMS in the Site App; we match them there by email.
//
// GET  /api/rams-director            -> { director: {name,email}|null, candidates:[{name,email}] }
// POST { email }  (admin)            -> set the designated Director (by email)
// POST { email:'' } (admin)          -> clear
const KEY = 'ops:rams-director'

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // Lightweight: Site App just needs the designated Director's email.
      if (req.query.who === '1') {
        const director = (await get(KEY)) || null
        return res.json({ director })
      }
      const [director, users] = await Promise.all([
        get(KEY).then(v => v || null),
        getPortalUsers(),
      ])
      const candidates = (users || [])
        .filter(u => (u.jobRole || '') === 'Director' && u.active !== false && u.email)
        .map(u => ({ name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim(), email: u.email }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      return res.json({ director, candidates })
    }

    if (req.method === 'POST') {
      const session = requireRole(req, res, ['admin'])
      if (!session) return
      const email = (req.body?.email || '').trim().toLowerCase()
      if (!email) { await set(KEY, null); return res.json({ ok: true, director: null }) }

      const users = await getPortalUsers()
      const u = (users || []).find(x => (x.email || '').toLowerCase() === email && (x.jobRole || '') === 'Director')
      if (!u) return res.status(400).json({ error: 'That user is not a Portal User with the Director job role.' })
      const director = { name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim(), email: u.email }
      await set(KEY, director)
      return res.json({ ok: true, director })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('rams-director error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
