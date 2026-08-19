import { requireRole } from '../../lib/portalAuth'
import { buildWipPDF } from '../../lib/wipPdf'

// GET /api/wip-pdf?month=2026-08  -> the month's WIP as a PDF
//
// ACCOUNTS CAN DOWNLOAD IT. They can see the WIP in Bookkeeping and the whole point of the
// button is that they can take it away - refusing the download while showing the figures
// on screen would be a distinction with no purpose.
export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin', 'accounts'])) return
  const month = String(req.query.month || '')
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month required, as YYYY-MM' })

  try {
    // Built from the same endpoint the page reads, so the PDF and the screen cannot
    // disagree. Cookies forwarded because that endpoint checks the session too.
    const proto = req.headers['x-forwarded-proto'] || 'https'
    const base = `${proto}://${req.headers.host}`
    const d = await fetch(`${base}/api/wip?month=${month}`, { headers: { cookie: req.headers.cookie || '' } }).then(r => r.json())

    const monthLabel = new Date(`${month}-01T00:00:00Z`)
      .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

    const bytes = await buildWipPDF({
      month, monthLabel,
      projects: d.projects || [],
      totalWip: d.totalWip, totalWipProfit: d.totalWipProfit,
      lock: d.lock || null,
      logoUrl: process.env.LOGO_URL || '',
    })

    const fname = `WIP ${monthLabel}.pdf`.replace(/[^a-zA-Z0-9 .-]/g, '')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
    res.send(Buffer.from(bytes))
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Could not build the PDF' })
  }
}
