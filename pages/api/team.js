import { getPortalUsers } from '../../lib/db'

// Team members now come from Portal Users (the single people list).
// This endpoint maps portal users into the legacy member shape so all existing
// consumers (IHM, Pre-Start, projects, Site App member picker) keep working
// unchanged. Management of people happens in Admin → Portal Users.
//
// GET /api/team -> { members: [{ id, firstName, lastName, name, email, phone, role, active }] }
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const users = await getPortalUsers()
    const members = users.map(u => ({
      id: u.id,
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || '',
      email: u.email || '',
      phone: u.phone || '',
      role: u.jobRole || '',        // descriptive job role for dropdowns
      active: u.active !== false,
    }))
    return res.json({ members })
  }
  // Writes are no longer accepted here — people are managed in Admin → Portal Users.
  if (req.method === 'POST' || req.method === 'DELETE') {
    return res.status(410).json({ error: 'Team members are now managed under Admin → Portal Users.' })
  }
  res.status(405).end()
}
