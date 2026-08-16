import { sendDailyActivityEmails, sendNoActivityEmail } from '../../../lib/crmDailyActivityEmail'
import { STAGE_LABELS } from '../../../lib/crmFieldSchema'

// Daily CRM activity email.
//
// SEND_HOUR is UK local. The cron fires at minute 0 of UTC hours 6 and 7 - one of which is
// 07:00 in London whatever the season (06:00 UTC during BST, 07:00 UTC during GMT) - and
// this gate picks the right one. So it goes at the top of the hour rather than anywhere
// within it, and does not drift when the clocks change.
//
// Vercel does not promise to-the-minute execution, so expect 01:00 give or take a few
// minutes. Use ?force=1 to send right now instead of waiting.
const SEND_HOUR = 7;
//
// ?force=1   send now, whatever the time (testing)
// ?dryRun=1  report who WOULD get one, and how many activities each, without sending

export default async function handler(req, res) {
  try {
    const force = req.query.force === '1'
    const dryRun = req.query.dryRun === '1'

    const ukHour = (() => {
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).formatToParts(new Date())
      const h = parseInt(p.find((x) => x.type === 'hour')?.value || '0', 10)
      return h === 24 ? 0 : h
    })()

    if (!force && !dryRun && ukHour !== SEND_HOUR) {
      return res.status(200).json({ skipped: `Sends at ${String(SEND_HOUR).padStart(2, '0')}:00 UK (now ${ukHour}:00)` })
    }

    // Two separate emails, both on the same schedule:
    //   personal   - your own activities due today or overdue
    //   team       - open projects with no activity set at all
    const personal = await sendDailyActivityEmails({ dryRun })
    let noActivity = {}
    try { noActivity = await sendNoActivityEmail({ dryRun, stageLabels: STAGE_LABELS }) }
    catch (e) { noActivity = { ok: false, error: e.message } }

    return res.status(200).json({ personal, noActivity })
  } catch (e) {
    console.error('crm-daily-activities cron error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
