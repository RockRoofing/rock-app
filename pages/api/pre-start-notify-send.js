import { getSubmission, getOpsProject } from '../../lib/db'
import { buildIssuePDF } from '../../lib/issuePdf'

// POST /api/pre-start-notify-send { submissionId, emails:[] }
// Emails the Pre-Start Notification (as a PDF built from the submission answers)
// to the given customer email addresses.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { submissionId, emails } = req.body || {}
  if (!submissionId) return res.status(400).json({ error: 'Missing submissionId' })
  if (!Array.isArray(emails) || !emails.length) return res.status(400).json({ error: 'No recipient emails' })

  const RESEND_KEY = process.env.RESEND_API_KEY
  if (!RESEND_KEY) return res.status(500).json({ error: 'Email not configured' })
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  const REPLY_TO = process.env.FORMS_REPLY_TO || 'notifications@rockroofing.co.uk'

  try {
    const sub = await getSubmission(submissionId)
    if (!sub) return res.status(404).json({ error: 'Submission not found' })

    // Resolve project for header + logo.
    let project = null
    const pno = sub.projectNo || sub.projectName
    try { project = await getOpsProject(pno) } catch {}
    const origin = `https://${req.headers.host}`

    // Reuse the generic branded PDF builder, shaping the submission into its
    // "issue"-style input (title + labelled fields).
    const answerLines = Object.entries(sub.answers || {})
      .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : (typeof v === 'object' ? (v.name || JSON.stringify(v)) : v)}`)
      .join('\n')
    const pseudoIssue = {
      issueId: sub.id,
      issueName: sub.formTitle || 'Pre-Start Notification',
      issueTypes: [],
      description: answerLines,
      createdBy: sub.operative || '',
      photos: [],
    }
    const bytes = await buildIssuePDF({ issue: pseudoIssue, project: project?.data || {}, logoUrl: `${origin}/rock-logo.jpg` })
    const base64 = Buffer.from(bytes).toString('base64')
    const projName = project?.data?.projectName || sub.projectName || pno || ''
    const filename = `Pre-Start Notification - ${projName}.pdf`.replace(/[^a-zA-Z0-9 .-]/g, '')

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a19">
        <h2 style="color:#1a1a19">Pre-Start Notification</h2>
        <p>Please find attached our Pre-Start Notification for <strong>${projName}</strong>, advising of the works to be carried out, materials being delivered, and what needs to be ready prior to our arrival on site.</p>
        <p style="font-size:13px;color:#666">Sent by Rock Roofing.</p>
      </div>`

    const statuses = {}
    for (const to of emails) {
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to, reply_to: REPLY_TO, subject: `Pre-Start Notification — ${projName}`, html, attachments: [{ filename, content: base64 }] }),
        })
        statuses[to] = resp.ok ? 'sent' : 'failed'
      } catch { statuses[to] = 'failed' }
    }
    const anySent = Object.values(statuses).some(s => s === 'sent')
    if (!anySent) return res.status(502).json({ error: 'Could not send to any recipient' })
    return res.json({ ok: true, statuses })
  } catch (e) {
    console.error('pre-start-notify-send error:', e)
    return res.status(500).json({ error: e.message || 'Send failed' })
  }
}
