import { get, set } from '../../lib/db'

// POST /api/report-problem { userName, platform, page, description }
//   Stores the report under ops:problem-reports and emails it to the office.
// GET  /api/report-problem  -> { reports } (admin view; newest first)
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const reports = (await get('ops:problem-reports')) || []
    return res.json({ reports: [...reports].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) })
  }
  if (req.method === 'PATCH') {
    const { id, status } = req.body || {}
    if (!id) return res.status(400).json({ error: 'Missing id' })
    const reports = (await get('ops:problem-reports')) || []
    const idx = reports.findIndex(r => r.id === id)
    if (idx === -1) return res.status(404).json({ error: 'Not found' })
    reports[idx] = { ...reports[idx], status: status || 'open' }
    await set('ops:problem-reports', reports)
    return res.json({ ok: true })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { userName, platform, page, description } = req.body || {}
    if (!description || !description.trim()) return res.status(400).json({ error: 'Please describe the problem.' })

    const report = {
      id: `prob_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userName: (userName || 'Unknown').trim(),
      platform: platform || 'Portal',
      page: (page || '').trim(),
      description: description.trim(),
      createdAt: Date.now(),
      status: 'open',
    }
    const reports = (await get('ops:problem-reports')) || []
    reports.push(report)
    await set('ops:problem-reports', reports)

    // Best-effort email to the office (never blocks saving).
    const RESEND_KEY = process.env.RESEND_API_KEY
    if (RESEND_KEY) {
      const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
      const TO = process.env.ALERT_EMAIL || process.env.FORMS_REPLY_TO || 'notifications@rockroofing.co.uk'
      const html = `
        <div style="font-family:system-ui,Arial,sans-serif;max-width:560px">
          <h2 style="color:#1a1a19;margin:0 0 4px">App Problem Reported</h2>
          <table style="font-size:14px;color:#333;border-collapse:collapse;margin-top:8px">
            <tr><td style="padding:4px 12px 4px 0;color:#888">Reported by</td><td>${report.userName}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#888">Where</td><td>${report.platform}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#888">Page</td><td>${(report.page || '—').replace(/</g, '&lt;')}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#888;vertical-align:top">Problem</td><td>${report.description.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</td></tr>
          </table>
        </div>`
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: TO, subject: `App problem — ${report.platform} — ${report.userName}`, html }),
        })
      } catch {}
    }

    return res.json({ ok: true, id: report.id })
  } catch (e) {
    console.error('report-problem error:', e)
    return res.status(500).json({ error: e.message || 'Could not submit report' })
  }
}
