import { get, set, getOpsProject } from '../../lib/db'
import { buildIssuePDF } from '../../lib/issuePdf'

// POST /api/issue-send-customer { id, emails: [] } -> emails the styled issue PDF
// to the given customer emails and marks the issue as sent.
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } }

export default async function handler(req, res) {
  const { id, emails } = req.body || {}
  if (!id) return res.status(400).json({ error: 'Missing id' })
  if (!Array.isArray(emails) || !emails.length) return res.status(400).json({ error: 'No recipient emails' })

  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  if (!RESEND_KEY) return res.status(200).json({ sent: 0, error: 'Email not configured' })

  try {
    const issues = (await get('ops:issues')) || []
    const idx = issues.findIndex(i => i.id === id)
    if (idx < 0) return res.status(404).json({ error: 'Issue not found' })
    const issue = issues[idx]

    const project = await getOpsProject(issue.projectNo)
    const origin = `https://${req.headers.host}`
    const bytes = await buildIssuePDF({ issue, project: project?.data || {}, logoUrl: `${origin}/rock-logo.jpg` })
    const base64 = Buffer.from(bytes).toString('base64')
    const fname = `Issue ${issue.issueId || ''} - ${(issue.issueName || 'issue')}.pdf`.replace(/[^a-zA-Z0-9 .-]/g, '')

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;max-width:600px">
        <p>Dear Customer,</p>
        <p>Please find attached a site issue report for <strong>${project?.data?.projectName || issue.projectName || ''}</strong>${issue.projectNo ? ` (${issue.projectNo})` : ''}.</p>
        <p><strong>${issue.issueName || ''}</strong></p>
        <p>${(issue.description || '').replace(/</g, '&lt;')}</p>
        <p style="color:#666;font-size:13px">Kind regards,<br/>Rock Roofing Ltd</p>
      </div>`

    let sent = 0
    for (const to of emails) {
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM, to,
            subject: `Site Issue Report — ${issue.issueName || issue.issueId} (${issue.projectNo || ''})`,
            html,
            attachments: [{ filename: fname, content: base64 }],
          }),
        })
        if (resp.ok) sent++
      } catch {}
    }

    if (sent > 0) {
      issues[idx] = { ...issue, sentToCustomer: true, sentAt: Date.now(), sentTo: emails }
      await set('ops:issues', issues)
    }
    return res.status(200).json({ sent, issue: issues[idx] })
  } catch (e) {
    console.error('issue-send-customer error:', e)
    return res.status(500).json({ error: e.message || 'Send failed' })
  }
}
