import { maybeSendScheduledReport } from '../../../lib/outstandingInvoicesReport'

// Runs HOURLY. Sends the Outstanding Invoices weekly report only when the
// configured day-of-week + hour (managed in the app) match the current UK time,
// and it hasn't already been sent today. ?force=1 sends immediately (testing).
export default async function handler(req, res) {
  try {
    const force = req.query.force === '1'
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]
    const host = req.headers['x-forwarded-host'] || req.headers.host
    const baseUrl = host ? `${proto}://${host}` : null
    const result = await maybeSendScheduledReport({ baseUrl, force })
    return res.status(200).json({ ok: true, result })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message })
  }
}
