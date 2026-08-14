import { buildAccountsLabourPDF } from '../../lib/weeklyLabourPdf'
import { assembleWeek } from './planning-week'
import { requireRole } from '../../lib/portalAuth'

const DAY = 86400000
const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// POST /api/planning-accounts-pdf
// body: { monday:'YYYY-MM-DD', weeks:N, includeOpIds:[...], overnight:{ [opId]:[dateISO,...] } }
// Returns a PDF: only the selected installers, with O/A marked where overnight applies.
export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin', 'accounts'])) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  try {
    const body = req.body || {}
    const mondayStr = body.monday || ''
    const n = Math.min(26, Math.max(1, Number(body.weeks) || 1))
    const includeOpIds = Array.isArray(body.includeOpIds) ? new Set(body.includeOpIds) : null
    const overnight = body.overnight || {}   // { opId: [dateISO,...] }

    const base = mondayStr ? parseISO(mondayStr) : new Date()
    const mondays = Array.from({ length: n }, (_, i) => iso(new Date(base.getTime() + i * 7 * DAY)))
    const weeks = await Promise.all(mondays.map(m => assembleWeek(m)))

    // Filter rows to the selected installers, and attach each row's overnight days.
    for (const wk of weeks) {
      wk.rows = (wk.rows || [])
        .filter(r => !r.unnamed && (!includeOpIds || includeOpIds.has(r.opId)))
        .map(r => {
          const days = Array.isArray(overnight[r.opId]) ? overnight[r.opId] : []
          const on = {}
          for (const dk of days) on[dk] = true
          return { ...r, overnight: on }
        })
    }

    const origin = `https://${req.headers.host}`
    const bytes = await buildAccountsLabourPDF({ weeks, logoUrl: `${origin}/rock-logo.jpg` })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="Accounts Weekly Labour ${weeks[0].weekStart}${n > 1 ? ` +${n - 1}wk` : ''}.pdf"`)
    return res.send(Buffer.from(bytes))
  } catch (e) {
    console.error('planning-accounts-pdf error:', e)
    return res.status(500).json({ error: e.message || 'PDF failed' })
  }
}
