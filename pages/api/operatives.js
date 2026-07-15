import { getOpsUsers } from '../../lib/db'

// Operatives roster (H&S) — NOW a READ-ONLY projection of Site App Users.
// Adding a Site App User (Admin → Site App Users) automatically populates this
// list; the H&S Operatives page is read-only. Company + Trade are captured on
// the Site App User record.
//
// GET /api/operatives -> { operatives:[{ id, firstName, lastName, email, phone, company, trades[], accessLevel }] }
// POST/DELETE are disabled — manage people under Site App Users.

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const users = await getOpsUsers()
    const operatives = (users || [])
      .filter(u => u.active !== false)
      .map(u => ({
        id: u.id,
        firstName: u.firstName || (u.name || '').split(' ')[0] || '',
        lastName: u.lastName || (u.name || '').split(' ').slice(1).join(' ') || '',
        email: u.email || '',
        phone: u.phone || '',
        company: u.company || '',
        trades: Array.isArray(u.trades) ? u.trades : [],
        accessLevel: u.accessLevel || 'operative',
      }))
    operatives.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))
    return res.json({ operatives })
  }

  // Roster is managed via Site App Users now.
  if (req.method === 'POST' || req.method === 'DELETE') {
    return res.status(405).json({ error: 'Operatives are managed under Site App Users.' })
  }

  res.status(405).end()
}
