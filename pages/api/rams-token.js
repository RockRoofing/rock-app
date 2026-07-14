import { getRamsToken, getRamsApprovals, getProjectFiles, getOpsProject } from '../../lib/db'

// Public (no-login) lookup for the tokenised Site-Manager approval page.
// GET /api/rams-token?token=... -> { ok, projectName, fileName, fileUrl, status, smName }
//   status: 'ready' | 'done' | 'not-ready' | 'invalid'
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { token } = req.query
    if (!token) return res.status(400).json({ error: 'Missing token' })
    const ref = await getRamsToken(token)
    if (!ref) return res.json({ ok: false, status: 'invalid' })

    const approvals = await getRamsApprovals(ref.projectNo)
    const rec = approvals[ref.fileId]
    if (!rec) return res.json({ ok: false, status: 'invalid' })

    let projectName = ref.projectNo
    try { const p = await getOpsProject(ref.projectNo); if (p?.data?.projectName) projectName = `${ref.projectNo} — ${p.data.projectName}` } catch {}

    let fileName = 'RAMS document', fileUrl = ''
    try {
      const files = await getProjectFiles(ref.projectNo)
      const f = (files || []).find(x => x.id === ref.fileId)
      if (f) { fileName = f.name || fileName; fileUrl = f.url || '' }
    } catch {}

    let status = 'not-ready'
    if (rec.stage === 'site-manager') status = 'ready'
    else if (rec.siteManager || rec.stage === 'operatives' || rec.stage === 'complete') status = 'done'

    return res.json({ ok: true, status, projectName, fileName, fileUrl, smName: rec.siteManagerName || '' })
  } catch (e) {
    console.error('rams-token error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
