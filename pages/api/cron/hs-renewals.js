import { runOperativeRenewalReminders, maybeSendRenewalSummary } from '../../../lib/hsRenewalNotify'

// CSCS / Working at Height renewal notifications.
//
// Runs HOURLY. Two jobs, each self-gating:
//   - operative reminders: throttled to once a week per person per ticket, and only
//     actually run once a day (in the 08:00 UK hour) so an hourly cron cannot spam.
//   - weekly management list: sent on the configured day/hour (default Friday 17:00 UK),
//     once per day.
//
// ?force=1  runs both now, ignoring every gate (testing)
// ?dryRun=1 reports what the weekly list WOULD do without sending

export default async function handler(req, res) {
  try {
    const force = req.query.force === '1'
    const dryRun = req.query.dryRun === '1'

    // UK hour, so the daily operative run does not drift with BST/GMT.
    const ukHour = (() => {
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).formatToParts(new Date())
      let h = parseInt(p.find(x => x.type === 'hour')?.value || '0', 10)
      return h === 24 ? 0 : h
    })()

    let operatives = { skipped: `Operative reminders run in the 08:00 UK hour (now ${ukHour}:00)` }
    if (force || ukHour === 8) {
      try { operatives = await runOperativeRenewalReminders({ force }) }
      catch (e) { operatives = { ok: false, error: e.message } }
    }

    let summary = {}
    try { summary = await maybeSendRenewalSummary({ force, dryRun }) }
    catch (e) { summary = { ok: false, error: e.message } }

    return res.status(200).json({ ok: true, operatives, summary })
  } catch (e) {
    console.error('hs-renewals cron error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
