import { refreshEmailVolume } from '../../../lib/crmEmailVolume'

// Recounts outbound external email per mailbox per month.
//
// Nightly, and only the last two months - a completed month does not change, so there is
// no point rescanning a year of Sent Items every night.
//
//   ?months=13   widen the window, for a one-off backfill
//   ?mailbox=x   one mailbox only
//   ?max=5000    cap messages scanned per mailbox. Defaults high: too low a cap stops
//                the scan part-way, and the months it never reached would look empty.
export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  try {
    // Capped at 60 rather than 24. Two years was an arbitrary ceiling and it silently
    // clipped a longer request - asking for 37 months quietly gave you 24, which is the
    // sort of thing that gets read as "the data does not go back further".
    const months = Math.min(60, parseInt(req.query.months || '2', 10) || 2)
    const mailbox = String(req.query.mailbox || '').trim()
    const max = parseInt(req.query.max || '20000', 10) || 20000
    const out = await refreshEmailVolume({ months, mailbox, max })
    return res.status(200).json(out)
  } catch (e) {
    console.error('crm-email-volume error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
