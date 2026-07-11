import { buildWeeklyLabourPDF } from '../../lib/weeklyLabourPdf'

// GET /api/planning-week-pdf?monday=YYYY-MM-DD -> the whole week's grid as a PDF
export default async function handler(req, res) {
  try {
    const monday = req.query.monday || ''
    const origin = `https://${req.headers.host}`
    const week = await fetch(`${origin}/api/planning-week?monday=${encodeURIComponent(monday)}`).then(r => r.json())
    const bytes = await buildWeeklyLabourPDF({ week, logoUrl: `${origin}/rock-logo.jpg` })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="Weekly Labour ${week.weekStart}.pdf"`)
    return res.send(Buffer.from(bytes))
  } catch (e) {
    console.error('planning-week-pdf error:', e)
    return res.status(500).json({ error: e.message || 'PDF failed' })
  }
}
