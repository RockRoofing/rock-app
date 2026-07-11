import { buildWeeklyLabourPDF } from '../../lib/weeklyLabourPdf'
import { assembleWeek } from './planning-week'

const DAY = 86400000
const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// GET /api/planning-week-pdf?monday=YYYY-MM-DD&weeks=N -> N consecutive weeks, one page each
export default async function handler(req, res) {
  try {
    const mondayStr = req.query.monday || ''
    const n = Math.min(8, Math.max(1, Number(req.query.weeks) || 1))
    const base = mondayStr ? parseISO(mondayStr) : new Date()
    const mondays = Array.from({ length: n }, (_, i) => iso(new Date(base.getTime() + i * 7 * DAY)))
    const weeks = await Promise.all(mondays.map(m => assembleWeek(m)))
    const origin = `https://${req.headers.host}`
    const bytes = await buildWeeklyLabourPDF({ weeks, logoUrl: `${origin}/rock-logo.jpg` })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="Weekly Labour ${weeks[0].weekStart}${n > 1 ? ` +${n - 1}wk` : ''}.pdf"`)
    return res.send(Buffer.from(bytes))
  } catch (e) {
    console.error('planning-week-pdf error:', e)
    return res.status(500).json({ error: e.message || 'PDF failed' })
  }
}
