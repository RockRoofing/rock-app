import { get, set } from '../../lib/db'

// App Improvement tickets.
// POST  { userName, userEmail, platform, page, description }  -> store + notify office
// GET                                                          -> { reports } newest first
// PATCH { id, status?, comments? }                             -> update; when status becomes
//                                                                 'resolved', email the reporter
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const reports = (await get('ops:problem-reports')) || []
    return res.json({ reports: [...reports].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) })
  }

  if (req.method === 'PATCH') {
    const { id, status, comments } = req.body || {}
    if (!id) return res.status(400).json({ error: 'Missing id' })
    const reports = (await get('ops:problem-reports')) || []
    const idx = reports.findIndex(r => r.id === id)
    if (idx === -1) return res.status(404).json({ error: 'Not found' })

    const prev = reports[idx]
    const wasResolved = (prev.status || 'open') === 'resolved'
    const next = { ...prev }
    if (comments !== undefined) next.comments = comments
    if (status !== undefined) next.status = status || 'open'
    reports[idx] = next
    await set('ops:problem-reports', reports)

    // On transition to resolved, notify the reporter (best-effort).
    let emailed = false
    if (!wasResolved && (next.status === 'resolved') && next.userEmail) {
      emailed = await notifyReporterResolved(next, req)
    }
    return res.json({ ok: true, emailed })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { userName, userEmail, platform, page, description } = req.body || {}
    if (!description || !description.trim()) return res.status(400).json({ error: 'Please describe the improvement.' })

    const report = {
      id: `prob_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userName: (userName || 'Unknown').trim(),
      userEmail: (userEmail || '').trim(),
      platform: platform || 'Portal',
      page: (page || '').trim(),
      description: description.trim(),
      comments: '',
      createdAt: Date.now(),
      status: 'open',
    }
    const reports = (await get('ops:problem-reports')) || []
    reports.push(report)
    await set('ops:problem-reports', reports)

    // Notify the office (best-effort).
    const RESEND_KEY = process.env.RESEND_API_KEY
    if (RESEND_KEY) {
      const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
      const TO = process.env.ALERT_EMAIL || process.env.FORMS_REPLY_TO || 'notifications@rockroofing.co.uk'
      const html = `
        <div style="font-family:system-ui,Arial,sans-serif;max-width:560px">
          <h2 style="color:#1a1a19;margin:0 0 4px">App Improvement suggested</h2>
          <table style="font-size:14px;color:#333;border-collapse:collapse;margin-top:8px">
            <tr><td style="padding:4px 12px 4px 0;color:#888">From</td><td>${esc(report.userName)}${report.userEmail ? ` (${esc(report.userEmail)})` : ''}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#888">Where</td><td>${esc(report.platform)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#888">Page</td><td>${esc(report.page || '—')}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#888;vertical-align:top">Details</td><td>${esc(report.description).replace(/\n/g, '<br>')}</td></tr>
          </table>
        </div>`
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: TO, subject: `App improvement — ${report.platform} — ${report.userName}`, html }),
        })
      } catch {}
    }

    return res.json({ ok: true, id: report.id })
  } catch (e) {
    console.error('report-problem error:', e)
    return res.status(500).json({ error: e.message || 'Could not submit report' })
  }
}

function esc(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

async function notifyReporterResolved(report, req) {
  const RESEND_KEY = process.env.RESEND_API_KEY
  if (!RESEND_KEY || !report.userEmail) return false
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  const REPLY_TO = process.env.FORMS_REPLY_TO || 'notifications@rockroofing.co.uk'
  const commentsBlock = report.comments && report.comments.trim()
    ? `<p style="margin:14px 0 4px;color:#888;font-size:13px">Notes from the team:</p>
       <div style="background:#faf9f7;border:1px solid #eee;border-radius:10px;padding:12px 14px;font-size:14px;color:#1a1a19">${esc(report.comments).replace(/\n/g, '<br>')}</div>`
    : ''
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;color:#1a1a19">
      <h2 style="margin:0 0 6px">Your app improvement has been resolved ✅</h2>
      <p style="font-size:14px;color:#444">Hi ${esc(report.userName?.split(' ')[0] || 'there')}, the suggestion you raised has been marked as resolved.</p>
      <p style="margin:12px 0 4px;color:#888;font-size:13px">Your original message:</p>
      <div style="background:#f7f6f3;border:1px solid #eee;border-radius:10px;padding:12px 14px;font-size:14px">${esc(report.description).replace(/\n/g, '<br>')}</div>
      ${commentsBlock}
      <p style="font-size:12px;color:#999;margin-top:18px">Thanks for helping improve the app.</p>
    </div>`
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: report.userEmail, reply_to: REPLY_TO, subject: 'Your app improvement has been resolved', html }),
    })
    return r.ok
  } catch { return false }
}
