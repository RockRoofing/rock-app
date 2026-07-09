import { getPreStart, getOpsProject } from '../../lib/db'
import { buildPreStartPDF } from '../../lib/preStartPdf'

// GET /api/pre-start-pdf?no=J247 -> downloads the branded PDF
export default async function handler(req, res) {
  const no = req.query.no
  if (!no) return res.status(400).json({ error: 'Missing project number' })
  try {
    const data = await getPreStart(no)
    if (!data) return res.status(404).json({ error: 'No Pre-Start Minutes for this project' })
    const project = await getOpsProject(no)
    const origin = `https://${req.headers.host}`
    const proof = data.stage === 'sent' ? {
      sentAt: data.sentAt, sentBy: data.sentBy,
      recipients: data.recipientsDetailed || (data.recipients || []).map(e => ({ email: e })),
      statuses: data.statuses || {},
    } : null
    const bytes = await buildPreStartPDF({ project: project?.data || {}, data, logoUrl: `${origin}/rock-logo.jpg`, proof })
    const fname = `Pre-Start Minutes - ${(project?.data?.projectName || no)}.pdf`.replace(/[^a-zA-Z0-9 .-]/g, '')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`)
    return res.send(Buffer.from(bytes))
  } catch (e) {
    console.error('pre-start-pdf error:', e)
    return res.status(500).json({ error: e.message || 'PDF generation failed' })
  }
}
