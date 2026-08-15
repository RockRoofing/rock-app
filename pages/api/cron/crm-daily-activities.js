import { sendDailyActivityEmails } from '../../../lib/crmDailyActivityEmail'

// Daily CRM activity email. Runs HOURLY and sends in the 07:00 UK hour, so it does not
// drift by an hour when the clocks change - a cron fixed to a UTC hour would.
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

    if (!force && !dryRun && ukHour !== 7) {
      return res.status(200).json({ skipped: `Sends in the 07:00 UK hour (now ${ukHour}:00)` })
    }

    const result = await sendDailyActivityEmails({ dryRun })
    return res.status(200).json(result)
  } catch (e) {
    console.error('crm-daily-activities cron error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
