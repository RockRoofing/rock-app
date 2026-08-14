import { get } from '../../lib/db'

// Rock Drawings, read straight from the Design Portal so there is ONE source of truth.
// Nothing is copied or synced - this reads design:rock-drawings:<projectNo> live, which
// means a drawing approved or marked Construction Issue in the Design Portal shows the
// new status here immediately.
//
// Read-only by design. Drawings are uploaded and revised in the Design Portal only.
//
// GET /api/project-drawings?no=J247            -> every CURRENT drawing + counts   (Ops)
// GET /api/project-drawings?no=J247&ci=1       -> Construction Issue only          (Site App)

const RKEY = (no) => `design:rock-drawings:${no}`

// One entry per drawing FAMILY - the newest revision. Superseded revisions are history
// and must never reach site. If a family somehow has no current revision (all marked
// superseded), promote the newest so the drawing does not silently vanish.
function currentRevisions(list) {
  const byFam = {}
  const order = []
  for (const d of (Array.isArray(list) ? list : [])) {
    const fam = d.familyId || d.id
    if (!byFam[fam]) { byFam[fam] = { current: null, newest: null }; order.push(fam) }
    if (!byFam[fam].newest) byFam[fam].newest = d
    if (!d.superseded && !byFam[fam].current) byFam[fam].current = d
  }
  return order.map(f => byFam[f].current || byFam[f].newest).filter(Boolean)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const no = String(req.query.no || '').trim()
  if (!no) return res.status(400).json({ error: 'Project number required' })

  const raw = (await get(RKEY(no))) || []
  const current = currentRevisions(raw)

  const mapped = current.map(d => ({
    id: d.id,
    // The stamped copy carries the APPROVED / CONSTRUCTION ISSUE stamp on page 1. Fall
    // back to the original when there isn't one (non-PDF, or status set before stamping).
    url: d.stampedUrl || d.url,
    originalUrl: d.url,
    stamped: !!d.stampedUrl,
    name: d.name || d.title || 'Drawing',
    title: d.title || d.name || 'Drawing',
    contentType: d.contentType || '',
    size: d.size || 0,
    thumbUrl: d.thumbUrl || '',
    revision: d.revision || '',
    approved: d.status === 'approved',
    constructionIssue: !!d.constructionIssue,
    approvedAt: d.approvedAt || 0,
    approvedBy: d.approvedBy || '',
    constructionIssueAt: d.constructionIssueAt || 0,
    uploadedAt: d.uploadedAt || 0,
    uploadedBy: d.uploadedBy || '',
  }))

  mapped.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0))

  const counts = {
    total: mapped.length,
    approved: mapped.filter(d => d.approved).length,
    notApproved: mapped.filter(d => !d.approved).length,
    constructionIssue: mapped.filter(d => d.constructionIssue).length,
    notConstructionIssue: mapped.filter(d => !d.constructionIssue).length,
  }

  // Site App: operatives must only ever see drawings released for construction.
  const ciOnly = req.query.ci === '1' || req.query.constructionIssue === '1'
  const drawings = ciOnly ? mapped.filter(d => d.constructionIssue) : mapped

  return res.json({ drawings, files: drawings, counts })
}
