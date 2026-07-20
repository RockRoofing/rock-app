import { getProject, get } from '../../lib/db'
import { computeApplicationSummary, resolveAppDates, backfillAppNumbers } from '../../lib/applications'

// Read-only Applications view for the Site App (Contracts Manager area).
// GET only, no writes. The Site App gates project access on its own side
// (useMyProjects / canAccessProject); this endpoint never mutates anything.
//
//   ?projectId=..                 -> { applications: [ {list rows} ] }
//   ?projectId=..&appId=..        -> { application: { full summary + sections } }
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const { projectId, appId } = req.query
  if (!projectId) return res.status(400).json({ error: 'projectId required' })
  try {
    const project = (await getProject(projectId)) || {}
    const apps = Array.isArray(project.applications) ? project.applications : []
    backfillAppNumbers(apps)
    const sorted = apps.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0))
    const prevGrossFor = (app) => {
      let prev = null
      for (const a of sorted) { if ((a.seq || 0) < (app.seq || 0)) prev = a }
      if (!prev) return 0
      return app.prevCertGross != null ? app.prevCertGross : computeApplicationSummary(prev, 0).grossCurrent
    }

    // Single application — full summary with all sections.
    if (appId) {
      const app = apps.find(a => a.id === appId)
      if (!app) return res.status(404).json({ error: 'Application not found' })
      const summary = computeApplicationSummary(app, prevGrossFor(app))
      const dates = resolveAppDates(app.monthKey, project)
      return res.json({
        application: {
          id: app.id,
          appNumber: app.appNumber || app.seq || '',
          status: app.status || 'draft',
          monthKey: app.monthKey || '',
          requiredDate: dates.appDate || '',
          valuationDate: dates.valDate || '',
          paymentDate: dates.paymentDate || '',
          mcdPct: app.mcdPct || 0,
          retentionPct: app.retentionPct || 0,
          summary,
          // Raw section rows so the detail view can show all columns/sections.
          contractWorks: Array.isArray(app.contractWorks) ? app.contractWorks : [],
          variations: Array.isArray(app.variations) ? app.variations : [],
          materials: Array.isArray(app.materials) ? app.materials : [],
        },
      })
    }

    // List — one row per application, newest first.
    const list = sorted.map(app => {
      const summary = computeApplicationSummary(app, prevGrossFor(app))
      const dates = resolveAppDates(app.monthKey, project)
      return {
        id: app.id,
        appNumber: app.appNumber || app.seq || '',
        status: app.status || 'draft',
        monthKey: app.monthKey || '',
        requiredDate: dates.appDate || '',
        thisCertValue: summary?.thisCert?.total || 0,
      }
    }).sort((a, b) => (b.appNumber || 0) - (a.appNumber || 0))

    return res.json({ applications: list })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
