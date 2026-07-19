import { requireRole } from '../../lib/portalAuth'
import { getProject, saveProject, get, getAllProjectSettings } from '../../lib/db'
import { computeApplicationSummary, buildContractWorksFromRates, buildAppVariations, resolveAppDates } from '../../lib/applications'

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
    // Cross-project "upcoming applications" summary for the landing table.
    if (req.query.upcoming) {
      const all = await getAllProjectSettings()
      let cache = null
      try { cache = await get('dashboard:cache') } catch {}
      const nameOf = (xeroId) => {
        const row = Array.isArray(cache) ? cache.find(p => String(p.xeroId) === String(xeroId)) : null
        return { jobNo: row?.jobNo || '', name: row?.name || '' }
      }
      const rows = []
      for (const [xeroId, proj] of Object.entries(all || {})) {
        const p = proj || {}
        const apps = Array.isArray(p.applications) ? p.applications : []
        if (!apps.length) continue
        const sorted = apps.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0))
        // "Next" = the latest DRAFT if any; else the next month after the last sent.
        const draft = [...sorted].reverse().find(a => !a.status || a.status === 'draft')
        const last = sorted[sorted.length - 1]
        let nextSeq, nextDate, nextMonthLabel, status
        if (draft) {
          nextSeq = draft.seq; nextDate = draft.appDate || ''; nextMonthLabel = draft.monthLabel || ''; status = 'draft'
        } else {
          // project up to date; next would follow the last sent app
          nextSeq = (last.seq || 0) + 1
          const [y, m] = String(last.monthKey || '').split('-').map(Number)
          if (y && m) {
            const nd = new Date(y, m, 1)
            const settings = { applicationDay: p.applicationDay, valuationDay: p.valuationDay, paymentDay: p.paymentDay, dateOverrides: p.dateOverrides || {}, finalPaymentDays: p.finalPaymentDays }
            const key = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`
            nextDate = resolveAppDates(key, settings).appDate || ''
            nextMonthLabel = nd.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
          }
          status = 'upcoming'
        }
        const info = nameOf(xeroId)
        rows.push({ xeroId, jobNo: info.jobNo, name: info.name, nextSeq, nextDate, nextMonthLabel, status })
      }
      // Order by the next application date (soonest first; undated last).
      rows.sort((a, b) => {
        if (!a.nextDate) return 1
        if (!b.nextDate) return -1
        return a.nextDate.localeCompare(b.nextDate)
      })
      return res.json({ upcoming: rows })
    }

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
    let projectPOs = []
    try {
      const deliveries = (await get('ops:deliveries')) || []
      projectPOs = deliveries
        .filter(d => jobNo ? (matchKey(d.projectNo) === matchKey(jobNo) || matchKey(d.project) === matchKey(jobNo)) : false)
        .map(d => ({
          poNumber: d.poNumber || '', supplier: d.supplier || '',
          project: d.project || d.projectNo || '',
          delivered: !!d.actualDeliveryDate,
          deliveryDate: d.actualDeliveryDate || '',
          orderDate: d.orderDate || '',
          createdAt: d.createdAt || 0,
          lineItems: (d.lineItems || []).map(li => ({ description: li.description || li.item || '', quantity: li.quantity ?? null, unit: li.unit || '', rate: li.unitAmount ?? li.rate ?? null })),
        }))
        // Latest POs first (by order date, then by when we first saw it).
        .sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || '') || (b.createdAt || 0) - (a.createdAt || 0))
    } catch {}

    return res.json({
      applications: project.applications || [],
      contractedRates: project.contractedRates || null,
      variations: project.variations || [],
      projectPOs,
      hiddenPOs: project.hiddenPOs || [],
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

      // Base the new application on the PREVIOUS one (highest seq) so it starts
      // exactly where the last left off — % complete, materials (incl. their
      // attachments) and per-variation data (incl. attachments) all carry over.
      // Only the identity fields (seq, month, dates) change.
      const prev = apps.slice().sort((a, b) => (b.seq || 0) - (a.seq || 0))[0] || null

      let contractWorks = buildContractWorksFromRates(cr.items)
      if (prev && Array.isArray(prev.contractWorks)) {
        // carry % complete across by matching row id (falls back to code)
        const byId = new Map(prev.contractWorks.filter(r => r.kind === 'item').map(r => [r.id, r]))
        const byCode = new Map(prev.contractWorks.filter(r => r.kind === 'item').map(r => [String(r.code), r]))
        contractWorks = contractWorks.map(r => {
          if (r.kind !== 'item') return r
          const p = byId.get(r.id) || byCode.get(String(r.code))
          return p ? { ...r, pctComplete: p.pctComplete || 0 } : r
        })
      }
      // Deep-copy previous per-variation data and materials (including attachments).
      const variationData = prev && prev.variationData ? JSON.parse(JSON.stringify(prev.variationData)) : {}
      const materials = prev && Array.isArray(prev.materials)
        ? JSON.parse(JSON.stringify(prev.materials)).map(m => ({ ...m, id: `${m.kind === 'group' ? 'grp' : 'mat'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, _oldId: m.id }))
        : []
      // Re-link item groupId to the newly-generated group ids.
      if (materials.length) {
        const idMap = new Map(materials.filter(m => m._oldId).map(m => [m._oldId, m.id]))
        materials.forEach(m => { if (m.groupId && idMap.get(m.groupId)) m.groupId = idMap.get(m.groupId); delete m._oldId })
      }

      const app = {
        id: `app_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        seq,
        monthKey: monthKey || '',
        monthLabel: monthLabel || '',
        status: 'draft',
        appDate: appDate || '', valDate: valDate || '', paymentDate: paymentDate || '', finalDate: finalDate || '',
        mcdPct: mcdPct != null ? mcdPct : (prev ? prev.mcdPct : 0),
        retentionPct: retentionPct != null ? retentionPct : (prev ? prev.retentionPct : (project.retentionPct != null ? project.retentionPct * 100 : 5)),
        contractWorks,
        variations: [],
        variationData,
        materials,
        clonedFromSeq: prev ? prev.seq : null,
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
      // Freeze the live variation list (from the tracker + per-app data) into the app.
      const frozen = buildAppVariations(apps[idx], project.variations || [])
      apps[idx] = { ...apps[idx], variations: frozen, status: 'sent', sentAt: Date.now(), sentBy: req.body.author || '' }
      project.applications = apps
      await saveProject(projectId, project)
      return res.json({ ok: true, application: apps[idx] })
    }

    // Mark a variation instructed/not-instructed from the application. Writes
    // through to the project's variation tracker (settings.variations) so Project
    // Details, budgets and WIP all update.
    if (action === 'set-variation-instructed') {
      const { varNumber, description, instructed } = req.body
      const vars = Array.isArray(project.variations) ? [...project.variations] : []
      const norm = (s) => String(s || '').trim()
      let matchIdx = vars.findIndex(v => norm(v.varNumber) === norm(varNumber) && norm(v.description) === norm(description))
      if (matchIdx < 0) matchIdx = vars.findIndex(v => norm(v.varNumber) === norm(varNumber))
      if (matchIdx < 0 && description) matchIdx = vars.findIndex(v => norm(v.descriptionFull) === norm(description) || norm(v.description) === norm(description))
      if (matchIdx < 0) return res.status(404).json({ error: 'Variation not found in tracker.' })
      vars[matchIdx] = { ...vars[matchIdx], instructed: !!instructed }
      project.variations = vars
      await saveProject(projectId, project)
      return res.json({ ok: true, variations: vars })
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

    // Persist the project's hidden-PO list (PO numbers hidden from the materials picker).
    if (action === 'set-hidden-pos') {
      project.hiddenPOs = Array.isArray(req.body.hiddenPOs) ? req.body.hiddenPOs : []
      await saveProject(projectId, project)
      return res.json({ ok: true, hiddenPOs: project.hiddenPOs })
    }

    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(405).end()
}
