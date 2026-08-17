import { refreshGpSnapshots } from '../../../lib/crmGpSnapshots'

// Monthly GP margin snapshot per estimator.
//
// Scheduled for the 22nd so the EOM report for the month just gone has settled. Each run
// also re-does the previous 6 months, to pick up invoices and costs processed late.
//
//   ?only=2026-07   rebuild one month
//   ?months=12      widen the re-snapshot window
export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  try {
    // The project list, stages and estimators come from the same place Project Financials
    // uses, so the snapshot and the live page cannot disagree about who owns what.
    const base = process.env.PORTAL_BASE_URL || `https://${req.headers.host}`
    const r = await fetch(`${base}/api/dashboard`, { headers: { cookie: req.headers.cookie || '' } })
    if (!r.ok) return res.status(500).json({ error: `Could not read /api/dashboard (${r.status})` })
    const { projects } = await r.json()

    const months = Math.min(24, parseInt(req.query.months || '6', 10) || 6)
    const only = String(req.query.only || '').trim()
    return res.status(200).json(await refreshGpSnapshots(projects, { months, only }))
  } catch (e) {
    console.error('gp-snapshot error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
