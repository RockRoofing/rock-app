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
      // Preserve edits made to existing IHM risks for this project (assignee,
      // closeOutDate, closed, comments) by matching on index-stable id.
      const prevById = {}
      for (const r of risks) if (r.sourceIhm === projectNo) prevById[r.id] = r
      risks = risks.filter(r => r.sourceIhm !== projectNo)
      ;(incoming || []).forEach((r, i) => {
        if (!r || (!r.risk && !r.description)) return
        const id = `ihmrisk_${projectNo}_${i}`
        const prev = prevById[id] || {}
        risks.push({
          id,
          sourceIhm: projectNo,
          projectNo,
          projectName: projectName || '',
          description: r.description || r.risk || '',
          mitigation: r.mitigation || '',
          assignee: r.assignee !== undefined ? r.assignee : (prev.assignee || ''),
          closeOutDate: r.closeOutDate !== undefined ? r.closeOutDate : (prev.closeOutDate || ''),
          closed: r.closed !== undefined ? !!r.closed : !!prev.closed,
          comments: r.comments !== undefined ? r.comments : (prev.comments || ''),
          createdAt: prev.createdAt || Date.now(),
        })
      })
      await saveRisks(risks)
      return res.json({ ok: true })
    }

    const { risk } = body
    if (!risk) return res.status(400).json({ error: 'Missing risk' })
    let risks = await getRisks()
    if (!risk.id) {
      if (!risk.description) return res.status(400).json({ error: 'Description required' })
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
