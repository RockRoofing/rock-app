import { get, set } from '../../lib/db'

// Risk Log. Risks are stored (not read live) so they can carry editable fields
// including comments. Two sources:
//   - IHM: synced in on "Meeting Complete" (keyed by projectNo, re-sync replaces)
//   - manual: added directly
//
// GET    /api/risks                 -> { risks }
// POST   /api/risks { risk }        -> add/update a manual risk
// POST   /api/risks { action:'sync-ihm', projectNo, projectName, risks:[...] }
// DELETE /api/risks { id }          -> remove

async function getRisks() { return (await get('ops:risks')) || [] }
async function saveRisks(r) { await set('ops:risks', r) }

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const risks = await getRisks()
    return res.json({ risks })
  }

  if (req.method === 'POST') {
    const body = req.body || {}

    if (body.action === 'sync-ihm') {
      const { projectNo, projectName, risks: incoming } = body
      let risks = await getRisks()
      // COPY ONCE: only add IHM rows not already copied. Existing rows (whether
      // edited on the live page or not) are never overwritten — the live page
      // is master once an item has been copied across.
      const existingIds = new Set(risks.map(r => r.id))
      ;(incoming || []).forEach((r, i) => {
        if (!r || (!r.risk && !r.description)) return
        const id = `ihmrisk_${projectNo}_${i}`
        if (existingIds.has(id)) return   // already copied — leave the live version alone
        risks.push({
          id,
          sourceIhm: projectNo,
          projectNo,
          projectName: projectName || '',
          description: r.description || r.risk || '',
          mitigation: r.mitigation || '',
          assignee: r.assignee || '',
          closeOutDate: r.closeOutDate || '',
          closed: !!r.closed,
          comments: r.comments || '',
          attachments: [],
          createdAt: Date.now(),
        })
      })
      await saveRisks(risks)
      return res.json({ ok: true })
    }

    const { risk } = body
    if (!risk) return res.status(400).json({ error: 'Missing risk' })
    let risks = await getRisks()
    if (!risk.id) {
      risk.id = `man_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
      risk.source = 'manual'
      risk.createdAt = Date.now()
      risks.push(risk)
    } else {
      const idx = risks.findIndex(r => r.id === risk.id)
      if (idx >= 0) risks[idx] = { ...risks[idx], ...risk }
      else { risk.source = risk.source || 'manual'; risk.createdAt = Date.now(); risks.push(risk) }
    }
    await saveRisks(risks)
    return res.json({ ok: true, id: risk.id })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let risks = await getRisks()
    risks = risks.filter(r => r.id !== id)
    await saveRisks(risks)
    return res.json({ ok: true })
  }

  res.status(405).end()
}
