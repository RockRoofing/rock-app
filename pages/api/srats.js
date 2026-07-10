import { get, set } from '../../lib/db'

// SRATs — Situation, Roadblocks, Actions, Timeline. Stored as one list.
// Each SRAT: { id, projectNo, projectName, situation, roadblocks, actionsText,
//   actionTaskIds:[], timeline, createdAt }
// Actions push ONE-WAY into Live Project Tasks (we keep the created task IDs so
// we can display their current state, but there's no live two-way sync).
//
// GET    /api/srats                 -> { srats }
// POST   /api/srats { srat }        -> add/update one
// DELETE /api/srats { id }          -> remove

async function getSrats() { return (await get('ops:srats')) || [] }
async function saveSrats(v) { await set('ops:srats', v) }

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const srats = await getSrats()
    srats.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return res.json({ srats })
  }

  if (req.method === 'POST') {
    const { srat } = req.body || {}
    if (!srat) return res.status(400).json({ error: 'srat required' })
    let srats = await getSrats()
    if (!srat.id) {
      srat.id = `srat_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
      srat.createdAt = Date.now()
      srats.push(srat)
    } else {
      const idx = srats.findIndex(s => s.id === srat.id)
      if (idx >= 0) srats[idx] = { ...srats[idx], ...srat }
      else srats.push(srat)
    }
    await saveSrats(srats)
    return res.json({ ok: true, id: srat.id })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let srats = await getSrats()
    srats = srats.filter(s => s.id !== id)
    await saveSrats(srats)
    return res.json({ ok: true })
  }

  res.status(405).end()
}
