import {
  getOpsProjects, getProjectFiles, getRamsSignatures, get,
} from '../../lib/db'

// Site App home-screen notification badges for one operative.
//
// GET /api/site-badges?opId=<id>&projectAccess=all
// GET /api/site-badges?opId=<id>&projectAccess=J13,J247
//
// Returns:
//   {
//     rams:      <number of RAMS documents this operative has NOT signed>,
//     ramsByProject: { [projectNo]: <count> },
//     deliveries: <number of scheduled-but-not-delivered deliveries>,
//     deliveriesByProject: { [projectNo]: <count> }
//   }
//
// "Assigned" = the operative's projectAccess ('all' or a list of project numbers).
// A RAMS doc is "unsigned" when there is no signature entry for this opId under
// that file's id in ops:rams-signatures:<projectNo>. Because project-files mints
// a new file id on every upload, a re-uploaded (new-version) RAMS is unsigned
// again automatically.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { opId } = req.query
    const rawAccess = req.query.projectAccess || ''
    const access =
      rawAccess === 'all' ? 'all'
      : rawAccess ? String(rawAccess).split(',').map(s => s.trim()).filter(Boolean)
      : []

    const projects = (await getOpsProjects()).filter(p => (p.status || 'active') === 'active')
    const allowed = (no) =>
      access === 'all' || (Array.isArray(access) && access.map(String).includes(String(no)))
    const myProjects = projects.filter(p => allowed(p.projectNo))

    // ── RAMS: unsigned documents across my projects ──
    let rams = 0
    const ramsByProject = {}
    await Promise.all(myProjects.map(async (p) => {
      const files = await getProjectFiles(p.projectNo)
      const ramsFiles = (files || []).filter(f => f.category === 'rams')
      if (!ramsFiles.length) return
      const sigs = await getRamsSignatures(p.projectNo)
      let n = 0
      for (const f of ramsFiles) {
        const signedBy = sigs[f.id] || {}
        if (opId && signedBy[opId]) continue   // this operative already signed this version
        n++
      }
      if (n > 0) { ramsByProject[p.projectNo] = n; rams += n }
    }))

    // ── Deliveries: scheduled (not delivered) on my projects ──
    const deliveries = (await get('ops:deliveries')) || []
    const deliveriesByProject = {}
    let deliveriesCount = 0
    for (const d of deliveries) {
      if (d.actualDeliveryDate) continue           // already delivered
      const no = d.projectNo || ''
      if (!allowed(no)) continue                   // not one of my projects
      deliveriesByProject[no] = (deliveriesByProject[no] || 0) + 1
      deliveriesCount++
    }

    return res.json({
      rams,
      ramsByProject,
      deliveries: deliveriesCount,
      deliveriesByProject,
    })
  } catch (e) {
    console.error('site-badges error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
