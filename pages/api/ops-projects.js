import { getOpsProjects, saveOpsProjects } from '../../lib/db'

// Operations projects. Created via the Internal Handover Minutes (IHM), or added
// manually as a temporary record for pre-existing projects. Keyed by RR Project
// Number (projectNo).
//
// status values: 'draft' (IHM not finalised), 'active' (Live), 'complete'
//
// GET    /api/ops-projects                 -> { projects: [summaries] }
// GET    /api/ops-projects?no=J247         -> { project }
// POST   { project, status }               -> create/update from IHM
// POST   { action:'manual-add', project }  -> quick-add an old project (manual)
// POST   { action:'set-status', projectNo, status } -> Live <-> Complete
// DELETE { projectNo }                     -> remove
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const projects = await getOpsProjects()
    const { no } = req.query
    if (no) {
      const project = projects.find(p => p.projectNo === no)
      if (!project) return res.status(404).json({ error: 'Not found' })
      return res.json({ project })
    }
    const summaries = projects.map(p => ({
      projectNo: p.projectNo,
      projectName: p.data?.projectName || '',
      contractsManager: p.data?.contractsManager || '',
      estimator: p.data?.estimator || '',
      quantitySurveyor: p.data?.quantitySurveyor || '',
      designManager: p.data?.designManager || '',
      operationsManager: p.data?.operationsManager || '',
      location: p.data?.projectAddress || p.data?.siteLocation || '',
      customer: p.data?.customerCompany || '',
      status: p.status || 'active',
      manual: !!p.manual,
      updatedAt: p.updatedAt || p.createdAt || 0,
    }))
    summaries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    return res.json({ projects: summaries })
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    let projects = await getOpsProjects()
    const now = Date.now()

    // Change Live <-> Complete
    if (body.action === 'set-status') {
      const idx = projects.findIndex(p => p.projectNo === body.projectNo)
      if (idx < 0) return res.status(404).json({ error: 'Not found' })
      // Named rather than taken on trust. A typo here would set a status no consumer
      // recognises, and the project would quietly vanish from every list with nothing
      // to explain it.
      const ALLOWED = ['draft', 'active', 'complete', 'archived']
      if (!ALLOWED.includes(body.status)) return res.status(400).json({ error: `Unknown status. One of: ${ALLOWED.join(', ')}` })
      projects[idx].status = body.status
      if (body.status === 'archived') { projects[idx].archivedAt = now; projects[idx].archivedBy = body.by || '' }
      else if (projects[idx].archivedAt) { projects[idx].archivedAt = 0; projects[idx].archivedBy = '' }
      projects[idx].updatedAt = now
      await saveOpsProjects(projects)
      return res.json({ ok: true })
    }

    // Edit project detail fields in place (works for IHM or manual projects).
    // For IHM projects these fields may be overwritten if the IHM is re-completed.
    if (body.action === 'set-details') {
      const p = body.project || {}
      const idx = projects.findIndex(x => x.projectNo === body.projectNo)
      if (idx < 0) return res.status(404).json({ error: 'Not found' })
      // Project Details = the single source of truth. Merge these fields into the
      // shared project.data (the SAME object the IHM reads/writes), so Project
      // Details and the IHM stay in lockstep automatically. Only defined fields
      // are written, so we never wipe other IHM data.
      const d0 = projects[idx].data || {}
      const setIf = (obj, key, val) => { if (val !== undefined) obj[key] = val }
      const merged = { ...d0 }
      setIf(merged, 'projectName', p.projectName)
      setIf(merged, 'contractsManager', p.contractsManager)
      setIf(merged, 'estimator', p.estimator)
      setIf(merged, 'quantitySurveyor', p.quantitySurveyor)
      setIf(merged, 'designManager', p.designManager)
      setIf(merged, 'operationsManager', p.operationsManager)
      setIf(merged, 'siteSupervisor', p.siteSupervisor)
      setIf(merged, 'customerCompany', p.customerCompany)
      // address: accept either projectAddress or location
      if (p.projectAddress !== undefined) merged.projectAddress = p.projectAddress
      else if (p.location !== undefined) merged.projectAddress = p.location
      if (p.siteContacts !== undefined) merged.siteContacts = p.siteContacts
      projects[idx].data = merged
      if (p.status) projects[idx].status = p.status
      projects[idx].updatedAt = now
      await saveOpsProjects(projects)
      return res.json({ ok: true, project: projects[idx] })
    }

    // Quick-add an old project manually (temporary record)
    if (body.action === 'manual-add') {
      const p = body.project || {}
      const projectNo = String(p.projectNo || '').trim()
      if (!projectNo || !p.projectName) return res.status(400).json({ error: 'Project number and name are required.' })
      if (projects.some(x => x.projectNo === projectNo)) return res.status(409).json({ error: 'That project number already exists.' })
      projects.push({
        projectNo,
        manual: true,
        status: p.status || 'active',
        data: {
          projectName: p.projectName,
          contractsManager: p.contractsManager || '',
          estimator: p.estimator || '',
          quantitySurveyor: p.quantitySurveyor || '',
          designManager: p.designManager || '',
          projectAddress: p.location || '',
        },
        createdAt: now,
        updatedAt: now,
      })
      await saveOpsProjects(projects)
      if ((p.status || 'active') === 'active') {
        try { const { notifyNewProject } = await import('../../lib/ramsNotify'); notifyNewProject({ projectNo }) } catch {}
      }
      return res.json({ ok: true, projectNo })
    }

    // Create / update from IHM
    const { project, status } = body
    if (!project || !project.projectNo) {
      return res.status(400).json({ error: 'RR Project Number is required.' })
    }
    const projectNo = String(project.projectNo).trim()
    const idx = projects.findIndex(p => p.projectNo === projectNo)
    if (idx >= 0) {
      projects[idx] = {
        ...projects[idx],
        projectNo,
        data: project,
        status: status || projects[idx].status || 'active',
        updatedAt: now,
      }
    } else {
      projects.push({ projectNo, data: project, status: status || 'active', createdAt: now, updatedAt: now })
    }
    await saveOpsProjects(projects)
    // A newly-created project (active OR draft) → notify "all projects" Site App users.
    // Creating the pre-contract (handover) minutes IS the creation of the project, so
    // drafts count. notifyNewProject dedupes so re-saves/IHM edits won't re-send.
    if (((status || 'active') === 'active' || (status || 'active') === 'draft') && idx < 0) {
      try { const { notifyNewProject } = await import('../../lib/ramsNotify'); notifyNewProject({ projectNo }) } catch {}
    }
    return res.json({ ok: true, projectNo, status: status || 'active' })
  }

  // PROJECTS ARE NOT DELETED. THEY ARE ARCHIVED.
  //
  // This used to remove the record outright, with no guard at all - the only thing
  // stopping it was the Delete button being hidden in the UI, and that button was
  // shown on exactly the wrong set: manually-added projects, which KEEP manual: true
  // even after an Internal Handover is completed against them. So the rule was a
  // hidden button rather than an enforced one, and it was hidden in the wrong places.
  //
  // Deleting an ops project never made sense anyway. The handover, the RAMS, the
  // drawings, the submissions and the planner allocations all key off the project
  // number and none of them were being removed with it - and saving that project's
  // handover again would simply recreate the record.
  //
  // Archiving is set-status with 'archived'. Every consumer of this list allowlists
  // 'active' and 'draft', so an archived project drops out of the Planner, the Site
  // App, RAMS, badges and the process board without any of them needing to know the
  // status exists.
  if (req.method === 'DELETE') {
    return res.status(405).json({
      error: 'Projects are not deleted. Set the status to Archived instead - it comes out of every live list and can be restored at any time.',
    })
  }

  res.status(405).end()
}
