import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { canAccessArea } from '../../lib/roles'
import { getApprovalAudit } from '../../lib/approvalAudit'

// Read the append-only approval audit log for a project. Internal (design) users only.
// GET ?no=<projectNo>  ->  { entries: [...] }
function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}

export default async function handler(req, res) {
  const u = verifySessionToken(readCookie(req, SESSION_COOKIE))
  if (!u) return res.status(401).json({ error: 'Not logged in' })
  if (u.role === 'external' || !canAccessArea(u.role, 'design')) return res.status(403).json({ error: 'No access' })
  const no = String(req.query.no || '').trim()
  if (!no) return res.status(400).json({ error: 'Missing project' })
  const entries = await getApprovalAudit(no)
  return res.json({ entries })
}
