import { getSubmission } from '../../lib/db'
import { buildSubmissionsPDF } from '../../lib/submissionsPdf'

// POST /api/submissions-pdf  { ids: [...], labels: {...} }
// Returns a real application/pdf file of the selected form submissions.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { ids, labels } = req.body || {}
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' })

    const subs = (await Promise.all(ids.map(id => getSubmission(id).catch(() => null)))).filter(Boolean)
    if (!subs.length) return res.status(404).json({ error: 'No submissions found' })

    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]
    const host = req.headers.host
    const logoUrl = host ? `${proto}://${host}/rock-logo.jpg` : null

    const bytes = await buildSubmissionsPDF({ subs, labels: labels || {}, logoUrl })

    const fname = subs.length === 1
      ? `${(subs[0].formTitle || 'submission').replace(/[^a-z0-9]+/gi, '-')}.pdf`
      : `form-submissions-${subs.length}.pdf`

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
    res.send(Buffer.from(bytes))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
