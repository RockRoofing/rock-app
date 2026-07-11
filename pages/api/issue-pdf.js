import { get, getOpsProject } from '../../lib/db'
import { buildIssuePDF } from '../../lib/issuePdf'

// GET /api/issue-pdf?id=iss_... -> downloads the branded issue PDF
export default async function handler(req, res) {
  const id = req.query.id
  if (!id) return res.status(400).json({ error: 'Missing issue id' })
  try {
    const issues = (await get('ops:issues')) || []
    const issue = issues.find(i => i.id === id)
    if (!issue) return res.status(404).json({ error: 'Issue not found' })
    const project = await getOpsProject(issue.projectNo)
    const origin = `https://${req.headers.host}`
    const bytes = await buildIssuePDF({ issue, project: project?.data || {}, logoUrl: `${origin}/rock-logo.jpg` })
    const fname = `Issue ${issue.issueId || ''} - ${(issue.issueName || 'issue')}.pdf`.replace(/[^a-zA-Z0-9 .-]/g, '')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`)
    return res.send(Buffer.from(bytes))
  } catch (e) {
    console.error('issue-pdf error:', e)
    return res.status(500).json({ error: e.message || 'PDF generation failed' })
  }
}
