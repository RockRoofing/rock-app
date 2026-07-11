import { get, set } from '../../lib/db'

// Operatives roster (H&S) — the source of installer names for the Planning Gantt.
// Separate from Site App login users.
// Operative: { id, firstName, lastName, email, phone, company, trades[], createdAt }
//
// GET    /api/operatives            -> { operatives }
// POST   /api/operatives { operative } -> create/update
// DELETE /api/operatives { id }     -> remove

const KEY = 'ops:operatives-roster'
async function getRoster() { return (await get(KEY)) || [] }
async function saveRoster(v) { await set(KEY, v) }

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const roster = await getRoster()
    roster.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))
    return res.json({ operatives: roster })
  }

  if (req.method === 'POST') {
    try {
      const { operative } = req.body || {}
      if (!operative) return res.status(400).json({ error: 'Missing operative' })
      let roster = await getRoster()
      if (!operative.id) {
        operative.id = `op_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
        operative.createdAt = Date.now()
        roster.push(operative)
      } else {
        const idx = roster.findIndex(o => o.id === operative.id)
        if (idx >= 0) roster[idx] = { ...roster[idx], ...operative }
        else roster.push(operative)
      }
      await saveRoster(roster)
      return res.json({ ok: true, operative })
    } catch (e) {
      console.error('operatives POST failed:', e)
      return res.status(500).json({ error: `Save failed: ${e.message || 'server error'}` })
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let roster = await getRoster()
    roster = roster.filter(o => o.id !== id)
    await saveRoster(roster)
    return res.json({ ok: true })
  }

  res.status(405).end()
}
