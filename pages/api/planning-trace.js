import { get, set, getOpsProjects } from '../../lib/db'
import { requireRole } from '../../lib/portalAuth'

// TEMP DIAGNOSTIC + CLEANUP:
//   GET  /api/planning-trace?q=J203                  -> show allocations referencing J203
//   POST /api/planning-trace { deleteKey:'L:J203' }  -> remove that orphaned allocation key
// Delete this file after use.
export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return

  if (req.method === 'POST') {
    const key = (req.body || {}).deleteKey
    if (!key) return res.status(400).json({ error: 'Missing deleteKey' })
    const alloc = (await get('ops:planning-allocations')) || {}
    if (!(key in alloc)) return res.json({ ok: true, removed: false, note: 'Key not found (already clean).' })
    delete alloc[key]
    await set('ops:planning-allocations', alloc)
    return res.json({ ok: true, removed: true, key })
  }

  const q = String(req.query.q || 'J203').toUpperCase()
  const alloc = (await get('ops:planning-allocations')) || {}
  const ops = (await getOpsProjects()) || []

  const matchingKeys = Object.keys(alloc).filter(k => k.toUpperCase().includes(q))
  const detail = matchingKeys.map(k => {
    const daysMap = alloc[k] || {}
    const dates = Object.keys(daysMap).sort().map(dk => {
      const cell = daysMap[dk]
      const entries = Array.isArray(cell) ? cell : (cell.entries || [])
      return { date: dk, opIds: entries.map(e => e.opId), unnamed: (cell && cell.unnamed) || 0, status: (cell && cell.status) || 'confirmed' }
    })
    return { key: k, dateCount: dates.length, dates }
  })

  const projNo = q.replace(/^L:/, '')
  const proj = ops.find(p => String(p.projectNo).toUpperCase() === projNo)

  return res.json({
    query: q,
    allocationKeysFound: matchingKeys,
    projectExists: !!proj,
    projectStatus: proj ? (proj.status || 'active') : null,
    projectName: proj ? (proj.data?.projectName || null) : null,
    detail,
  })
}
