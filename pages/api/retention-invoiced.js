import { get, set } from '../../lib/db'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const data = await get('commercial:retention_invoiced') || {}
    return res.json({ data })
  }
  if (req.method === 'POST') {
    const { month, value } = req.body // month: 'YYYY-MM', value: true/false
    const existing = await get('commercial:retention_invoiced') || {}
    existing[month] = value
    await set('commercial:retention_invoiced', existing)
    return res.json({ ok: true, data: existing })
  }
  res.status(405).end()
}
