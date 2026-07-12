import { get, getOpsProject, getPortalUsers } from '../../lib/db'

// POST /api/issue-notify { id } -> emails the project's Contracts Manager,
// Operations Manager and Quantity Surveyor that an issue has been raised, with
// a link to action the "send to customer" decision (portal on desktop,
// Site App on mobile).
export default async function handler(req, res) {
  const { id } = req.body || {}
  if (!id) return res.status(400).json({ error: 'Missing id' })

  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  if (!RESEND_KEY) return res.status(200).json({ sent: 0, error: 'Email not configured' })

  try {
    const issues = (await get('ops:issues')) || []
    const issue = issues.find(i => i.id === id)
    if (!issue) return res.status(404).json({ error: 'Issue not found' })

    const project = await getOpsProject(issue.projectNo)
    const pdata = project?.data || {}
    const users = await getPortalUsers()
    const emailForName = (name) => {
      if (!name) return null
      const u = users.find(u => {
        const full = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || ''
        return full && full.toLowerCase() === String(name).toLowerCase()
      })
      return u?.email || null
    }

    // Recipients tagged by role. Only the CM gets the "review & action" button;
    // the Operations Manager and QS get an information-only copy (with attachments).
    const recipients = []
    const seen = new Set()
    const addRecip = (roleName, kind) => {
      const em = emailForName(roleName)
      if (em && !seen.has(em)) { seen.add(em); recipients.push({ email: em, kind }) }
    }
    addRecip(pdata.contractsManager, 'cm')
    addRecip(pdata.operationsManager, 'info')
    addRecip(pdata.quantitySurveyor, 'info')
    if (!recipients.length) return res.status(200).json({ sent: 0, error: 'No CM/Ops/QS emails found on the IHM' })

    const origin = `https://${req.headers.host}`
    const smartLink = `${origin}/go/issue?id=${encodeURIComponent(issue.id)}`

    const types = [...(issue.issueTypes || [])]; if (issue.issueOther) types.push(`Other: ${issue.issueOther}`)
    const photos = Array.isArray(issue.photos) ? issue.photos : []
    const photosBlock = photos.length ? `
        <div style="margin:18px 0 4px">
          <p style="margin:0 0 8px;color:#888;font-size:13px">Attachments</p>
          ${photos.map((p, i) => `<a href="${typeof p === 'string' ? p : p.url}" style="color:#2a78d6;font-size:13px;display:block;margin-bottom:4px">Photo ${i + 1}</a>`).join('')}
        </div>` : ''

    const infoTable = `
        <table style="font-size:14px;color:#333;border-collapse:collapse">
          <tr><td style="padding:4px 12px 4px 0;color:#888">Issue ID</td><td>${issue.issueId || ''}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#888">Issue</td><td><strong>${issue.issueName || ''}</strong></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#888">Type</td><td>${types.join(', ')}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#888;vertical-align:top">Description</td><td>${(issue.description || '').replace(/</g, '&lt;')}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#888">Raised by</td><td>${issue.createdBy || ''}</td></tr>
        </table>`

    const header = `
        <h2 style="color:#1a1a19;margin:0 0 4px">New Site Issue Raised</h2>
        <p style="color:#666;margin:0 0 16px">${pdata.projectName || issue.projectName || ''}${issue.projectNo ? ` — ${issue.projectNo}` : ''}</p>`

    const cmHtml = `
      <div style="font-family:system-ui,Arial,sans-serif;max-width:600px">
        ${header}${infoTable}${photosBlock}
        <div style="margin:22px 0 8px;padding:16px;background:#faf9f7;border-radius:10px">
          <p style="margin:0 0 12px;color:#1a1a19;font-weight:600">Does this issue need to be sent to the customer?</p>
          <a href="${smartLink}" style="display:inline-block;background:#ca8a04;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Review &amp; action this issue</a>
          <p style="margin:12px 0 0;font-size:12px;color:#888">This opens the portal on a computer, or the Site App on a phone.</p>
        </div>
      </div>`

    const infoHtml = `
      <div style="font-family:system-ui,Arial,sans-serif;max-width:600px">
        ${header}${infoTable}${photosBlock}
        <p style="margin:20px 0 0;font-size:13px;color:#888">For your information — the Contracts Manager will review and action this issue.</p>
      </div>`

    let sent = 0
    for (const r of recipients) {
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: r.email, subject: `New Site Issue — ${issue.issueName || issue.issueId} (${issue.projectNo || ''})`, html: r.kind === 'cm' ? cmHtml : infoHtml }),
        })
        if (resp.ok) sent++
      } catch {}
    }
    return res.status(200).json({ sent, recipients: recipients.map(r => r.email) })
  } catch (e) {
    console.error('issue-notify error:', e)
    return res.status(500).json({ error: e.message || 'Notify failed' })
  }
}
