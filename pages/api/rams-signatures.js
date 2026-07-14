import { getRamsSignatures } from '../../lib/db'

// Per-document RAMS signatures for one project.
//
// GET /api/rams-signatures?no=<projectNo>
//   -> { signatures: { [fileId]: { [opId]: { name, date, signedAt, statement } } } }
//
// Phase 1 is read-only (used to label RAMS "Signed / Not signed" and drive the
// home badge). Signing (POST) is added in Phase 2.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { no } = req.query
    if (!no) return res.status(400).json({ error: 'Project number required' })
    const signatures = await getRamsSignatures(no)
    return res.json({ signatures })
  } catch (e) {
    console.error('rams-signatures error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
