import { getOpsProjects, saveOpsProjects } from '../../lib/db'

// Operations projects, created/edited via the Internal Handover Minutes.
// Keyed by RR Project Number (projectNo).
//
// GET    /api/ops-projects                 -> { projects: [summaries] }
// GET    /api/ops-projects?no=J247         -> { project }
// POST   /api/ops-projects { project, status } -> create/update (status: draft|active)
// DELETE /api/ops-projects { projectNo }   -> remove
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const projects = await getOpsProjects()
    const { no } = req.query
    if (no) {
      const project = projects.find(p => p.projectNo === no)
      if (!project) return res.status(404).json({ error: 'Not found' })
      return res.json({ project })
    }
    // Lightweight summaries for the list
    const summaries = projects.map(p => ({
      projectNo: p.projectNo,
      projectName: p.data?.projectName || '',
      customer: p.data?.customerCompany || '',
      address: p.data?.projectAddress || '',
      status: p.status || 'active',
      contractsManager: p.data?.contractsManager || '',
      operationsManager: p.data?.operationsManager || '',
      updatedAt: p.updatedAt || p.createdAt || 0,
    }))
    summaries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    return res.json({ projects: summaries })
  }

  if (req.method === 'POST') {
    const { project, status } = req.body || {}
    if (!project || !project.projectNo) {
      return res.status(400).json({ error: 'RR Project Number is required.' })
    }
    const projectNo = String(project.projectNo).trim()
    let projects = await getOpsProjects()
    const idx = projects.findIndex(p => p.projectNo === projectNo)
    const now = Date.now()

    if (idx >= 0) {
      // Update existing
      projects[idx] = {
        ...projects[idx],
        projectNo,
        data: project,
        status: status || projects[idx].status || 'active',
        updatedAt: now,
      }
    } else {
      // Create new — guard against duplicate project number
      projects.push({
        projectNo,
        data: project,
        status: status || 'active',
        createdAt: now,
        updatedAt: now,
      })
    }
    await saveOpsProjects(projects)
    return res.json({ ok: true, projectNo, status: status || 'active' })
  }

  if (req.method === 'DELETE') {
    const { projectNo } = req.body || {}
    let projects = await getOpsProjects()
    projects = projects.filter(p => p.projectNo !== projectNo)
    await saveOpsProjects(projects)
    return res.json({ ok: true })
  }

  res.status(405).end()
}
