import { getPreStart, savePreStart } from '../../lib/db'

// GET  /api/pre-start?no=J247   -> { data }
// POST /api/pre-start { projectNo, data } -> { ok }
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } }

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const no = req.query.no
    if (!no) return res.status(400).json({ error: 'Missing project number' })
    const data = await getPreStart(no)
    return res.json({ data })
  }
  if (req.method === 'POST') {
    const { projectNo, data } = req.body || {}
    if (!projectNo) return res.status(400).json({ error: 'Missing project number' })
    try {
      const record = { ...data, projectNo, updatedAt: Date.now() }
      await savePreStart(projectNo, record)
      return res.json({ ok: true, data: record })
    } catch (e) {
      console.error('pre-start save failed:', e)
      return res.status(500).json({ error: e.message || 'Save failed' })
    }
  }
  res.status(405).end()
}
