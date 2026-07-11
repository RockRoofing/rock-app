import { get } from '../../lib/db'
import { buildProjectReportPDF } from '../../lib/projectReportPdf'

// GET /api/project-report-pdf?id=pr_... -> branded, date-stamped report PDF
export default async function handler(req, res) {
  const id = req.query.id
  if (!id) return res.status(400).json({ error: 'Missing report id' })
  try {
    const reports = (await get('ops:project-reports')) || []
    const report = reports.find(r => r.id === id)
    if (!report) return res.status(404).json({ error: 'Report not found' })
    const origin = `https://${req.headers.host}`
    // Pull the full open-issue records referenced in this report, to append their forms.
    // Only append issues that were sent to the customer (or marked sent); never "do not send".
    let openIssues = []
    try {
      const allIssues = (await get('ops:issues')) || []
      const ids = (report.issuesSnapshot || []).map(s => s.id).filter(Boolean)
      openIssues = ids.map(id => allIssues.find(i => i.id === id)).filter(Boolean)
        .filter(i => i.sendToCustomer !== 'nosend' && (i.sentToCustomer === true || i.sentManually === true))
    } catch {}
    const bytes = await buildProjectReportPDF({ report, logoUrl: `${origin}/rock-logo.jpg`, openIssues })
    const fname = `Project Report ${report.reportId || ''} - ${(report.projectName || report.projectNo || 'report')}.pdf`.replace(/[^a-zA-Z0-9 .-]/g, '')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`)
    return res.send(Buffer.from(bytes))
  } catch (e) {
    console.error('project-report-pdf error:', e)
    return res.status(500).json({ error: e.message || 'PDF generation failed' })
  }
}
