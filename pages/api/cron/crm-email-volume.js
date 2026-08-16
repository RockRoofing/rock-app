import { refreshEmailVolume } from '../../../lib/crmEmailVolume'

// Recounts outbound external email per mailbox per month.
//
// Nightly, and only the last two months - a completed month does not change, so there is
// no point rescanning a year of Sent Items every night.
//
//   ?months=13   widen the window, for a one-off backfill
//   ?mailbox=x   one mailbox only
//   ?max=5000    cap messages scanned per mailbox
export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  try {
    const months = Math.min(24, parseInt(req.query.months || '2', 10) || 2)
    const mailbox = String(req.query.mailbox || '').trim()
    const max = parseInt(req.query.max || '2000', 10) || 2000
    const out = await refreshEmailVolume({ months, mailbox, max })
    return res.status(200).json(out)
  } catch (e) {
    console.error('crm-email-volume error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
