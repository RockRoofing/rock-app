import { get, set, keys } from '../../lib/db'

// Procurement Savings — per-project schedule of tendered vs buying rates.
//   Tendered Total = Qty x Tendered Rate
//   Buying Total   = Qty x Buying Rate
//   Total Savings  = Tendered Total - Buying Total
// Stored per project under key ops:procurement-savings:{projectNo}
//
// GET  /api/procurement-savings?projectNo=XXX  -> { rows }
// GET  /api/procurement-savings?summary=true   -> { started: {projectNo: {incomplete, total}} }
//        (used with the caller's project list to build the "needs finalising" list)
// POST /api/procurement-savings { projectNo, rows }  -> replace whole set

const PREFIX = 'ops:procurement-savings:'
const keyFor = (p) => `${PREFIX}${p}`
const hasVal = (v) => v !== '' && v != null

// A row is "incomplete" if it has a tendered figure (rate or total) but no buying rate.
function rowIncomplete(r) {
  const tendered = hasVal(r.tenderedRate) || hasVal(r.tenderedTotal)
  const bought = hasVal(r.buyingRate)
  return tendered && !bought
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (req.query.summary === 'true') {
      // Scan all stored savings docs; report per-project completeness.
      let allKeys = []
      try { allKeys = await keys(`${PREFIX}*`) } catch {}
      const started = {}
      for (const k of allKeys) {
        const projectNo = k.slice(PREFIX.length)
        const rows = (await get(k)) || []
        const meaningful = rows.filter(r => Object.values(r).some(hasVal))
        if (!meaningful.length) continue
        const incomplete = meaningful.filter(rowIncomplete).length
        started[projectNo] = { total: meaningful.length, incomplete }
      }
      return res.json({ started })
    }
    const projectNo = req.query.projectNo
    if (!projectNo) return res.status(400).json({ error: 'projectNo required' })
    const rows = (await get(keyFor(projectNo))) || []
    return res.json({ rows })
  }

  if (req.method === 'POST') {
    const { projectNo, rows } = req.body || {}
    if (!projectNo) return res.status(400).json({ error: 'projectNo required' })
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows must be an array' })
    await set(keyFor(projectNo), rows)
    return res.json({ ok: true, count: rows.length })
  }

  res.status(405).end()
}
