import { requireRole } from '../../lib/portalAuth'
import { getProject, saveProject, get } from '../../lib/db'
import { computeApplicationSummary, buildContractWorksFromRates } from '../../lib/applications'

// Applications live inside the project settings under `applications: [ ... ]`.
// Each application:
//   { id, seq, monthLabel, status ('draft'|'submitted'),
//     appDate, valDate, paymentDate, finalDate,
//     mcdPct, retentionPct,
//     contractWorks: [ { id, code, description, qty, unit, rate, total, pctComplete } ],
//     variations: [...], materials: [...],   (Phase 3)
//     createdAt, submittedAt, createdBy }

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return

  if (req.method === 'GET') {
    const { projectId } = req.query
    if (!projectId) return res.status(400).json({ error: 'projectId required' })
    const project = (await getProject(projectId)) || {}

    // Resolve this project's jobNo (from the dashboard cache) to match deliveries.
    let jobNo = ''
    try {
      const cache = await get('dashboard:cache')
      const row = Array.isArray(cache) ? cache.find(p => String(p.xeroId) === String(projectId)) : null
      jobNo = row?.jobNo || ''
    } catch {}
    const matchKey = (s) => String(s || '').trim().replace(/^[#jJ]/, '').toLowerCase()
    let undeliveredPOs = []
    try {
      const deliveries = (await get('ops:deliveries')) || []
      undeliveredPOs = deliveries
        .filter(d => !d.actualDeliveryDate)   // not yet delivered
        .filter(d => jobNo ? (matchKey(d.projectNo) === matchKey(jobNo) || matchKey(d.project) === matchKey(jobNo)) : true)
        .map(d => ({
          poNumber: d.poNumber || '', supplier: d.supplier || '',
          project: d.project || d.projectNo || '',
          lineItems: (d.lineItems || []).map(li => ({ description: li.description || li.item || '', quantity: li.quantity ?? null, unit: li.unit || '', rate: li.unitAmount ?? li.rate ?? null })),
        }))
    } catch {}

    return res.json({
      applications: project.applications || [],
      contractedRates: project.contractedRates || null,
      variations: project.variations || [],
      undeliveredPOs,
      jobNo,
      settings: {
        applicationDay: project.applicationDay || null,
        valuationDay: project.valuationDay || null,
        paymentDay: project.paymentDay || null,
        dateOverrides: project.dateOverrides || {},
        retentionPct: project.retentionPct != null ? project.retentionPct : null,
        mcdPct: project.mcdPct != null ? project.mcdPct : null,
        finalPaymentDays: project.finalPaymentDays != null ? project.finalPaymentDays : null,
      },
    })
  }

  if (req.method === 'POST') {
    const { action, projectId } = req.body || {}
    if (!projectId) return res.status(400).json({ error: 'projectId required' })
    const project = (await getProject(projectId)) || {}
    const apps = Array.isArray(project.applications) ? project.applications : []

    if (action === 'create') {
      const cr = project.contractedRates
      if (!cr || !Array.isArray(cr.items) || !cr.items.length) {
        return res.status(400).json({ error: 'No contracted rates for this project. Upload and lock them first.' })
      }
      if (!cr.locked) {
        return res.status(400).json({ error: 'Lock the contracted rates before creating an application.' })
      }
      const { monthKey, monthLabel, appDate, valDate, paymentDate, finalDate, mcdPct, retentionPct } = req.body
      const seq = (apps.reduce((m, a) => Math.max(m, a.seq || 0), 0)) + 1
      const contractWorks = buildContractWorksFromRates(cr.items)
      const app = {
        id: `app_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        seq,
        monthKey: monthKey || '',
        monthLabel: monthLabel || '',
        status: 'draft',
        appDate: appDate || '', valDate: valDate || '', paymentDate: paymentDate || '', finalDate: finalDate || '',
        mcdPct: mcdPct != null ? mcdPct : 0,
        retentionPct: retentionPct != null ? retentionPct : (project.retentionPct != null ? project.retentionPct * 100 : 5),
        contractWorks,
        variations: [],
        materials: [],
        createdAt: Date.now(),
        createdBy: req.body.author || '',
      }
      project.applications = [...apps, app]
      await saveProject(projectId, project)
      return res.json({ ok: true, application: app, applications: project.applications })
    }

    if (action === 'save') {
      const { application } = req.body
      if (!application || !application.id) return res.status(400).json({ error: 'application required' })
      const idx = apps.findIndex(a => a.id === application.id)
      if (idx === -1) return res.status(404).json({ error: 'Application not found' })
      if (apps[idx].status && apps[idx].status !== 'draft' && !req.body.allowSubmittedEdit) {
        return res.status(400).json({ error: 'This application has been sent and is locked.' })
      }
      apps[idx] = { ...apps[idx], ...application, savedAt: Date.now() }
      project.applications = apps
      await saveProject(projectId, project)
      return res.json({ ok: true, application: apps[idx] })
    }

    if (action === 'submit') {
      const { id } = req.body
      const idx = apps.findIndex(a => a.id === id)
      if (idx === -1) return res.status(404).json({ error: 'Application not found' })
      apps[idx] = { ...apps[idx], status: 'sent', sentAt: Date.now(), sentBy: req.body.author || '' }
      project.applications = apps
      await saveProject(projectId, project)
      return res.json({ ok: true, application: apps[idx] })
    }

    if (action === 'delete') {
      const { id } = req.body
      const target = apps.find(a => a.id === id)
      if (target && target.status && target.status !== 'draft') {
        return res.status(400).json({ error: 'Only draft applications can be deleted.' })
      }
      project.applications = apps.filter(a => a.id !== id)
      await saveProject(projectId, project)
      return res.json({ ok: true, applications: project.applications })
    }

    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(405).end()
}
