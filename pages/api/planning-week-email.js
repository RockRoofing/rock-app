import { buildOperativeWeekPDF } from '../../lib/weeklyLabourPdf'

// POST /api/planning-week-email { monday } -> emails each operative allocated that week THEIR own week.
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } }

const DOWFULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const fmtDM = (s) => parseISO(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  if (!RESEND_KEY) return res.status(200).json({ sent: 0, error: 'Email not configured' })

  try {
    const { monday } = req.body || {}
    const origin = `https://${req.headers.host}`
    const week = await fetch(`${origin}/api/planning-week?monday=${encodeURIComponent(monday || '')}`).then(r => r.json())

    let sent = 0; const skipped = []
    for (const row of week.rows) {
      if (!row.email) { skipped.push(`${row.name} (no email)`); continue }
      const lines = week.days.map((dk, i) => {
        const cell = row.cells[i]
        const txt = cell ? cell.entries.map(e => e.projectName + (e.half !== 'full' ? ` (${e.half.toUpperCase()})` : '')).join(', ') : '—'
        const weekend = i >= 5
        return `<tr><td style="padding:6px 14px 6px 0;color:${weekend ? '#b91c1c' : '#333'};font-weight:600">${DOWFULL[i]} ${fmtDM(dk)}</td><td style="padding:6px 0;color:${cell ? '#1e3a8a' : '#999'}">${txt}</td></tr>`
      }).join('')
      const html = `
        <div style="font-family:system-ui,Arial,sans-serif;max-width:560px">
          <h2 style="color:#1a1a19;margin:0 0 2px">Your week</h2>
          <p style="color:#666;margin:0 0 16px">Hi ${row.name.split(' ')[0] || ''}, here's where you're working, w/c ${parseISO(week.weekStart).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}.</p>
          <table style="font-size:14px;border-collapse:collapse">${lines}</table>
          <p style="color:#999;font-size:12px;margin-top:18px">A PDF of your week is attached. Please contact the office with any queries.</p>
        </div>`
      let attachment = null
      try {
        const bytes = await buildOperativeWeekPDF({ row, week, logoUrl: `${origin}/rock-logo.jpg` })
        attachment = { filename: `Your week ${week.weekStart}.pdf`, content: Buffer.from(bytes).toString('base64') }
      } catch {}
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: row.email, subject: `Your week — w/c ${fmtDM(week.weekStart)}`, html, attachments: attachment ? [attachment] : [] }),
        })
        if (resp.ok) sent++; else skipped.push(`${row.name} (send failed)`)
      } catch { skipped.push(`${row.name} (send error)`) }
    }
    return res.status(200).json({ sent, skipped, total: week.rows.length })
  } catch (e) {
    console.error('planning-week-email error:', e)
    return res.status(500).json({ error: e.message || 'Email failed' })
  }
}
