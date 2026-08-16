import { refreshCallVolume, fetchRawSample } from '../../../lib/crm8x8'

// Outbound call volume from 8x8 Work, per person per month.
//
//   ?sample=1     return ONE raw 8x8 record and its field names. Writes nothing.
//                 Use this first - the field names in lib/crm8x8.js are best guesses
//                 and almost certainly need correcting against the real response.
//   ?months=13    widen the window for a one-off backfill (default 2)
//   ?max=50000    cap records scanned
export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  try {
    if (req.query.sample === '1') return res.status(200).json(await fetchRawSample())
    const months = Math.min(24, parseInt(req.query.months || '2', 10) || 2)
    const max = parseInt(req.query.max || '50000', 10) || 50000
    return res.status(200).json(await refreshCallVolume({ months, max }))
  } catch (e) {
    console.error('crm-call-volume error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
