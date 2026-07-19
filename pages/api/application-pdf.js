import { requireRole } from '../../lib/portalAuth'
import { getProject, get } from '../../lib/db'
import { buildApplicationPDF } from '../../lib/applicationPdf'

// GET /api/application-pdf?projectId=..&appId=..  -> customer-copy Application PDF
export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return
  const { projectId, appId } = req.query
  if (!projectId || !appId) return res.status(400).json({ error: 'projectId and appId are required' })
  try {
    const project = (await getProject(projectId)) || {}
    const apps = Array.isArray(project.applications) ? project.applications : []
    const app = apps.find(a => a.id === appId)
    if (!app) return res.status(404).json({ error: 'Application not found' })

    // Previous cumulative gross for carry-forward (the app just before this seq).
    const sorted = apps.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0))
    let prev = null
    for (const a of sorted) { if ((a.seq || 0) < (app.seq || 0)) prev = a }
    const { computeApplicationSummary } = await import('../../lib/applications')
    const prevGross = prev ? computeApplicationSummary(prev, 0).grossCurrent : 0

    // Project meta (jobNo / name) from the dashboard cache.
    let jobNo = '', name = ''
    try {
      const cache = await get('dashboard:cache')
      const row = Array.isArray(cache) ? cache.find(p => String(p.xeroId) === String(projectId)) : null
      jobNo = row?.jobNo || ''; name = row?.name || ''
    } catch {}

    const origin = `https://${req.headers.host}`
    const appNumber = app.appNumber || (apps.reduce((m, a) => (a.appNumber ? Math.max(m, a.appNumber) : m), 0) + 1)
    const bytes = await buildApplicationPDF({
      appNumber,
      app, prevGross,
      trackerVariations: project.variations || [],
      project: { jobNo, name, customerName: project.customerName || '' },
      logoUrl: `${origin}/rock-logo.jpg`,
    })
    const fname = `Application ${app.seq || ''} - ${(jobNo || name || 'application')}.pdf`.replace(/[^a-zA-Z0-9 .-]/g, '')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${fname}"`)
    return res.send(Buffer.from(bytes))
  } catch (e) {
    console.error('application-pdf error:', e)
    return res.status(500).json({ error: e.message || 'PDF generation failed' })
  }
}
