import { getOpsDocs, saveOpsDocs } from '../../lib/db'
import withTenant from '../../lib/withTenant'

// GET  /api/ops-docs           -> { docs: { company, guidance, project } }
// POST /api/ops-docs { docs }  -> save full structure
async function handler(req, res) {
  if (req.method === 'GET') {
    return res.json({ docs: await getOpsDocs() })
  }
  if (req.method === 'POST') {
    const { docs } = req.body || {}
    if (!docs) return res.status(400).json({ error: 'Missing docs' })
    await saveOpsDocs(docs)
    return res.json({ docs })
  }
  res.status(405).end()
}

export default withTenant(handler)
