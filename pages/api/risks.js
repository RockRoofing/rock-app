import { getOpsProjects, get, set } from '../../lib/db'

// Risk Log — combines two sources:
//   1. Risks auto-populated from each project's Internal Handover Minutes
//      (project.data.risks = [{ risk, mitigation }]).
//   2. Manually-added risks (stored under ops:risks:manual).
// Editable fields (assignee, closeOutDate, closed) for BOTH sources are stored
// as an overlay under ops:risks:overlay, keyed by risk id, so we can enrich
// IHM-derived risks without mutating the handover.
//
// GET    /api/risks                     -> { risks: [...] }
// POST   /api/risks { risk }            -> add/update a manual risk
// POST   /api/risks { action:'meta', id, patch } -> set assignee/closeOutDate/closed on any risk
// DELETE /api/risks { id }              -> delete a manual risk (IHM risks can't be deleted here)

async function getManual() { return (await get('ops:risks:manual')) || [] }
async function saveManual(r) { await set('ops:risks:manual', r) }
async function getOverlay() { return (await get('ops:risks:overlay')) || {} }
async function saveOverlay(o) { await set('ops:risks:overlay', o) }

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const [projects, manual, overlay] = await Promise.all([getOpsProjects(), getManual(), getOverlay()])

    const risks = []

    // 1. IHM-derived risks
    for (const p of projects) {
      const projName = p.data?.projectName || ''
      const projNo = p.projectNo
      const arr = Array.isArray(p.data?.risks) ? p.data.risks : []
      arr.forEach((r, i) => {
        if (!r || (!r.risk && !r.mitigation)) return
        const id = `ihm:${projNo}:${i}`
        const ov = overlay[id] || {}
        risks.push({
          id,
          source: 'ihm',
          projectNo: projNo,
          projectName: projName,
          description: r.risk || '',
          mitigation: r.mitigation || '',
          assignee: ov.assignee || '',
          closeOutDate: ov.closeOutDate || '',
          closed: !!ov.closed,
        })
      })
    }

    // 2. Manual risks
    for (const r of manual) {
      const ov = overlay[r.id] || {}
      risks.push({
        id: r.id,
        source: 'manual',
        projectNo: r.projectNo || '',
        projectName: r.projectName || '',
        description: r.description || '',
        mitigation: r.mitigation || '',
        assignee: (ov.assignee !== undefined ? ov.assignee : r.assignee) || '',
        closeOutDate: (ov.closeOutDate !== undefined ? ov.closeOutDate : r.closeOutDate) || '',
        closed: ov.closed !== undefined ? !!ov.closed : !!r.closed,
      })
    }

    return res.json({ risks })
  }

  if (req.method === 'POST') {
    const body = req.body || {}

    // Update editable meta on any risk (IHM or manual)
    if (body.action === 'meta') {
      const { id, patch } = body
      if (!id) return res.status(400).json({ error: 'Missing id' })
      const overlay = await getOverlay()
      overlay[id] = { ...(overlay[id] || {}), ...patch }
      await saveOverlay(overlay)
      return res.json({ ok: true })
    }

    // Add / update a manual risk
    const { risk } = body
    if (!risk) return res.status(400).json({ error: 'Missing risk' })
    let manual = await getManual()
    if (!risk.id) {
      risk.id = `man_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
      manual.push(risk)
    } else {
      const idx = manual.findIndex(r => r.id === risk.id)
      if (idx >= 0) manual[idx] = { ...manual[idx], ...risk }
      else manual.push(risk)
    }
    await saveManual(manual)
    return res.json({ ok: true, id: risk.id })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let manual = await getManual()
    manual = manual.filter(r => r.id !== id)
    await saveManual(manual)
    // also clear any overlay for it
    const overlay = await getOverlay()
    if (overlay[id]) { delete overlay[id]; await saveOverlay(overlay) }
    return res.json({ ok: true })
  }

  res.status(405).end()
}
