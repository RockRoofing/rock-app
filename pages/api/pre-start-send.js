import { getPreStart, savePreStart, getOpsProject } from '../../lib/db'
import { buildPreStartPDF } from '../../lib/preStartPdf'

// POST /api/pre-start-send { projectNo }
// Generates the PDF, emails it as an attachment to all attendees via Resend,
// records send-proof, and locks the record (stage = 'sent').
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { projectNo } = req.body || {}
  if (!projectNo) return res.status(400).json({ error: 'Missing project number' })

  try {
    const data = await getPreStart(projectNo)
    if (!data) return res.status(404).json({ error: 'No Pre-Start Minutes to send' })
    if (data.stage === 'sent') return res.status(400).json({ error: 'Already sent and locked' })

    const project = await getOpsProject(projectNo)

    // Collect recipients (name + email) from both attendee groups.
    const recips = []
    for (const a of [...(data.attendeesRock || []), ...(data.attendeesCustomer || [])]) {
      if (a.email && !recips.some(r => r.email.toLowerCase() === a.email.toLowerCase())) {
        recips.push({ name: a.name || '', email: a.email })
      }
    }
    if (!recips.length) return res.status(400).json({ error: 'No attendees with email addresses' })

    const RESEND_KEY = process.env.RESEND_API_KEY
    if (!RESEND_KEY) return res.status(500).json({ error: 'Email not configured (RESEND_API_KEY missing)' })
    const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
    const REPLY_TO = process.env.FORMS_REPLY_TO || 'notifications@rockroofing.co.uk'

    const sentAt = Date.now()
    const origin = `https://${req.headers.host}`

    // Build PDF (without proof page first; proof is added to the stored/download copy after).
    const bytes = await buildPreStartPDF({ project: project?.data || {}, data, logoUrl: `${origin}/rock-logo.jpg`, proof: null })
    const base64 = Buffer.from(bytes).toString('base64')
    const projName = project?.data?.projectName || projectNo
    const filename = `Pre-Start Minutes - ${projName}.pdf`.replace(/[^a-zA-Z0-9 .-]/g, '')

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a19">
        <h2 style="color:#1a1a19">Pre-Start Meeting Minutes</h2>
        <p>Please find attached the Pre-Start Meeting Minutes for <strong>${projName}</strong>.</p>
        <p>These minutes summarise what was discussed and agreed at the pre-start meeting. If anything looks incorrect, please reply to this email.</p>
        <p style="font-size:13px;color:#666">Sent by Rock Roofing.</p>
      </div>`

    // Send to each recipient; capture per-recipient status.
    const statuses = {}
    for (const r of recips) {
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM, to: r.email, reply_to: REPLY_TO,
            subject: `Pre-Start Meeting Minutes — ${projName}`,
            html,
            attachments: [{ filename, content: base64 }],
          }),
        })
        statuses[r.email] = resp.ok ? 'sent' : 'failed'
      } catch { statuses[r.email] = 'failed' }
    }

    const anySent = Object.values(statuses).some(s => s === 'sent')
    if (!anySent) return res.status(502).json({ error: 'Could not send to any attendee — check email configuration.' })

    // Lock and record proof.
    const record = {
      ...data,
      stage: 'sent',
      sentAt,
      recipients: recips.map(r => r.email),
      recipientsDetailed: recips,
      statuses,
      updatedAt: sentAt,
    }
    await savePreStart(projectNo, record)
    return res.json({ ok: true, data: record })
  } catch (e) {
    console.error('pre-start-send error:', e)
    return res.status(500).json({ error: e.message || 'Send failed' })
  }
}
