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
    const accessLevel = req.query.accessLevel || ''
    const userEmail = (req.query.email || '').trim().toLowerCase()
    const userName = (req.query.name || '').trim().toLowerCase()
    const rawAccess = req.query.projectAccess || ''
    const access =
      rawAccess === 'all' ? 'all'
      : rawAccess ? String(rawAccess).split(',').map(s => s.trim()).filter(Boolean)
      : []

    const projects = (await getOpsProjects()).filter(p => (p.status || 'active') === 'active')
    const allowed = (no) =>
      access === 'all' || (Array.isArray(access) && access.map(String).includes(String(no)))
    const myProjects = projects.filter(p => allowed(p.projectNo))

    // Designated Director (match by email or name).
    const director = (await get('ops:rams-director')) || null
    const isDirector = !!director && (
      (!!userEmail && userEmail === (director.email || '').toLowerCase()) ||
      (!!userName && userName === (director.name || '').toLowerCase())
    )
    const isCMlevel = accessLevel === 'contracts-manager'
    const nameMatchesCM = (p) => {
      const cm = (p.data?.contractsManager || '').trim().toLowerCase()
      if (!cm || !userName) return false
      if (cm === userName) return true
      const a = userName.split(/\s+/), b = cm.split(/\s+/)
      return a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1]
    }

    // ── RAMS: documents where THIS user has an action to take ──
    //   • CM (for their project)  → RAMS at 'cm' stage
    //   • Director                → RAMS at 'director' stage
    //   • Operative               → RAMS at 'operatives' stage they haven't signed
    let rams = 0
    const ramsByProject = {}
    await Promise.all(myProjects.map(async (p) => {
      const files = await getProjectFiles(p.projectNo)
      const ramsFiles = (files || []).filter(f => f.category === 'rams')
      if (!ramsFiles.length) return
      const [sigs, appr] = await Promise.all([getRamsSignatures(p.projectNo), getRamsApprovals(p.projectNo)])
      const cmForThis = isCMlevel && nameMatchesCM(p)
      let n = 0
      for (const f of ramsFiles) {
        const stage = (appr[f.id] && appr[f.id].stage) || 'cm'
        if (stage === 'cm' && cmForThis) { n++; continue }              // CM's turn
        if (stage === 'director' && isDirector) { n++; continue }        // Director's turn
        if (stage === 'operatives' || stage === 'complete') {            // operatives can sign
          const signedBy = sigs[f.id] || {}
          if (opId && signedBy[opId]) continue
          n++
        }
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
