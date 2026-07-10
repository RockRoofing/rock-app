import { get, set } from '../../lib/db'

// Procurement Savings — per-project schedule of tendered vs buying rates and
// the resulting savings. Mirrors the "Procurement Savings" sheet:
//   Tendered Total = Qty x Tendered Rate
//   Buying Total   = Qty x Buying Rate
//   Total Savings  = Tendered Total - Buying Total
// Stored per project under key ops:procurement-savings:{projectNo}
//
// GET    /api/procurement-savings?projectNo=XXX  -> { rows }
// POST   /api/procurement-savings { projectNo, rows }  -> replace whole set
// (whole-set save keeps the spreadsheet-style grid simple and atomic)

const keyFor = (p) => `ops:procurement-savings:${p}`

export default async function handler(req, res) {
  if (req.method === 'GET') {
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
