import { getTeamMembers, saveTeamMembers } from '../../lib/db'

// Internal team members, by role. Feeds IHM attendee dropdowns and Project
// Financials. Roles align with the IHM meeting attendee fields.
//
// GET    /api/team                -> { members }
// POST   /api/team { member }     -> add/update, returns { members }
// DELETE /api/team { id }         -> remove
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.json({ members: await getTeamMembers() })
  }
  if (req.method === 'POST') {
    const { member } = req.body || {}
    // Accept either the new first/last name shape or a partial update (id only).
    const hasName = member && (member.firstName || member.lastName || member.name)
    if (!member || (!member.id && !hasName)) {
      return res.status(400).json({ error: 'Name is required' })
    }
    let members = await getTeamMembers()
    if (!member.id) {
      member.id = `tm_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
      member.active = member.active !== false
      members.push(member)
    } else {
      const idx = members.findIndex(m => m.id === member.id)
      if (idx >= 0) members[idx] = { ...members[idx], ...member }
      else members.push(member)
    }
    await saveTeamMembers(members)
    return res.json({ members })
  }
  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let members = await getTeamMembers()
    members = members.filter(m => m.id !== id)
    await saveTeamMembers(members)
    return res.json({ members })
  }
  res.status(405).end()
}
