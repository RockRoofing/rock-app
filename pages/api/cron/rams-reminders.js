import { runRamsReminders } from '../../../lib/ramsNotify'

// RAMS "still to sign" reminders — every 2 days per operative/RAMS until signed.
// No dedicated cron slot (Hobby limit = 2). This is invoked DAILY from
// /api/cron/hs-expiry-email; runRamsReminders self-throttles to once per 2 days
// per recipient+document. Can also be hit directly with ?force=1 for testing.
export default async function handler(req, res) {
  try {
    const force = req.query.force === '1'
    const result = await runRamsReminders({ force })
    return res.status(200).json(result)
  } catch (e) {
    console.error('rams-reminders cron error:', e)
    return res.status(500).json({ ok: false, error: e.message || 'Failed' })
  }
}
