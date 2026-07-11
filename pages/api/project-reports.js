import { get, set } from '../../lib/db'

// Project (Site) Reports — completed on desktop, listed under Project Management.
// Each report: { id, reportId, projectNo, projectName, projectAddress, customerName,
//   completedBy, date (completion), status: 'draft'|'complete',
//   variationsSnapshot[], issuesSnapshot[], siteComms, worksCompleted,
//   photos[] (auto-collected), lastReportDate,
//   approvalName, approvalDate,
//   revision, revisions:[{ rev, at, by }], createdAt, updatedAt }
//
// GET    /api/project-reports              -> { reports } (index, no heavy fields)
// GET    /api/project-reports?id=...       -> { report } (full)
// POST   /api/project-reports { report }   -> create/update (revisions tracked)
// DELETE /api/project-reports { id }       -> remove

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } }

const KEY = 'ops:project-reports'
async function getReports() { return (await get(KEY)) || [] }
async function saveReports(v) { await set(KEY, v) }

function nextReportId(reports) {
  let max = 0
  for (const r of reports) { const m = /PR-(\d+)/.exec(r.reportId || ''); if (m) max = Math.max(max, parseInt(m[1], 10)) }
  return `PR-${String(max + 1).padStart(4, '0')}`
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { id } = req.query
    const reports = await getReports()
    if (id) {
      const report = reports.find(r => r.id === id)
      if (!report) return res.status(404).json({ error: 'Not found' })
      return res.json({ report })
    }
    // Light index (drop heavy fields)
    const index = reports.map(r => ({
      id: r.id, reportId: r.reportId, projectNo: r.projectNo, projectName: r.projectName,
      customerName: r.customerName, completedBy: r.completedBy, date: r.date,
      status: r.status || 'draft', revision: r.revision || 0, updatedAt: r.updatedAt || r.createdAt || 0,
    }))
    index.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    return res.json({ reports: index })
  }

  if (req.method === 'POST') {
    try {
      const { report } = req.body || {}
      if (!report) return res.status(400).json({ error: 'Missing report' })
      let reports = await getReports()

      if (!report.id) {
        report.id = `pr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
        report.reportId = nextReportId(reports)
        report.createdAt = Date.now()
        report.revision = report.status === 'complete' ? 1 : 0
        report.revisions = report.status === 'complete'
          ? [{ rev: 1, at: Date.now(), by: report.approvalName || report.completedBy || '' }] : []
        report.updatedAt = Date.now()
        reports.push(report)
        await saveReports(reports)
        return res.json({ ok: true, report })
      }

      const idx = reports.findIndex(r => r.id === report.id)
      const prev = idx >= 0 ? reports[idx] : {}
      // Bump revision when a report is (re)saved as complete
      let revision = prev.revision || 0
      let revisions = prev.revisions || []
      const becomingOrStayingComplete = report.status === 'complete'
      if (becomingOrStayingComplete) {
        revision = (prev.revision || 0) + 1
        revisions = [...revisions, { rev: revision, at: Date.now(), by: report.approvalName || report.completedBy || '' }]
      }
      const merged = { ...prev, ...report, revision, revisions, updatedAt: Date.now() }
      if (idx >= 0) reports[idx] = merged; else reports.push(merged)
      await saveReports(reports)
      return res.json({ ok: true, report: merged })
    } catch (e) {
      console.error('project-reports POST failed:', e)
      return res.status(500).json({ error: `Save failed: ${e.message || 'server error'}` })
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let reports = await getReports()
    reports = reports.filter(r => r.id !== id)
    await saveReports(reports)
    return res.json({ ok: true })
  }

  res.status(405).end()
}
