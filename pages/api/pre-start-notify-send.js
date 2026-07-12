import { getSubmission, getOpsProject, getForms } from '../../lib/db'
import { SEED_FORMS } from '../../lib/formDefs'
import { buildPsnPDF } from '../../lib/preStartNotifyPdf'

// POST /api/pre-start-notify-send { submissionId, emails:[] }
// Emails the Pre-Start Notification (a branded PDF built from the submission,
// using the real question labels) to the given customer email addresses.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
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

    // Load the form definition so the PDF shows real question labels.
    let forms = []
    try { forms = await getForms() } catch {}
    if (!forms || !forms.length) forms = SEED_FORMS
    const form = forms.find(f => f.id === sub.formId) || null

    // Resolve the project for the header.
    let project = null
    const label = sub.projectName || ''
    const noMatch = label.match(/([A-Za-z]?\d{2,})/)
    const pno = noMatch ? noMatch[1] : (sub.projectId || label)
    try { project = await getOpsProject(pno) } catch {}
    const origin = `https://${req.headers.host}`

    const bytes = await buildPsnPDF({ submission: sub, form, project: project?.data || {}, logoUrl: `${origin}/rock-logo.jpg` })
    const base64 = Buffer.from(bytes).toString('base64')
    const projName = project?.data?.projectName || sub.projectName || pno || ''
    const filename = `Pre-Start Notification - ${projName}.pdf`.replace(/[^a-zA-Z0-9 .-]/g, '')

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a19">
        <h2 style="color:#1a1a19">Pre-Start Notification</h2>
        <p>Please find attached our Pre-Start Notification for <strong>${projName}</strong>, advising of the works to be carried out, materials being delivered, and what needs to be ready prior to our arrival on site.</p>
        <p>If anything looks incorrect, please reply to this email.</p>
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
    return res.status(200).json({ ok: true, statuses })
  } catch (e) {
    console.error('pre-start-notify-send error:', e)
    return res.status(500).json({ error: e.message || 'Send failed' })
  }
}
