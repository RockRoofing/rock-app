import {
  getOpsProjects, getProjectFiles, getRamsSignatures, getRamsApprovals, get,
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

    // ── RAMS: documents READY for this operative to sign, and unsigned ──
    // "Ready" = the approval chain has reached the operatives stage. RAMS still
    // going through CM/Director/Site-Manager approval don't count (they can't
    // sign yet). CM/Director are recognised by matching the designated director /
    // project CM, but for the operative badge we simply gate on stage + signed.
    let rams = 0
    const ramsByProject = {}
    await Promise.all(myProjects.map(async (p) => {
      const files = await getProjectFiles(p.projectNo)
      const ramsFiles = (files || []).filter(f => f.category === 'rams')
      if (!ramsFiles.length) return
      const [sigs, appr] = await Promise.all([getRamsSignatures(p.projectNo), getRamsApprovals(p.projectNo)])
      let n = 0
      for (const f of ramsFiles) {
        const stage = (appr[f.id] && appr[f.id].stage) || 'cm'
        if (stage !== 'operatives' && stage !== 'complete') continue   // not signable yet
        const signedBy = sigs[f.id] || {}
        if (opId && signedBy[opId]) continue   // already signed this version
        n++
      }
      if (n > 0) { ramsByProject[p.projectNo] = n; rams += n }
    }))

    // ── Deliveries: overdue or due-today (not delivered) on my projects ──
    // "Due" = required/scheduled delivery date is today or earlier.
    const deliveries = (await get('ops:deliveries')) || []
    const deliveriesByProject = {}
    let deliveriesCount = 0
    const today = new Date(); today.setHours(0, 0, 0, 0)
    for (const d of deliveries) {
      if (d.actualDeliveryDate) continue           // already delivered
      const no = d.projectNo || ''
      if (!allowed(no)) continue                   // not one of my projects
      if (!d.requiredDeliveryDate) continue        // no scheduled date -> not "due" yet
      const req = new Date(d.requiredDeliveryDate); req.setHours(0, 0, 0, 0)
      if (req > today) continue                     // scheduled in the future -> not counted
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
