import { runEmailSync } from '../../../lib/crmEmailSync'

// Pulls new mail from the pre-contract mailboxes and files it against projects.
// Runs hourly - little and often, so the unallocated queue stays small and current.
//
//   ?dryRun=1            report what WOULD be matched, write nothing
//   ?backfillMonths=24   first run only: how far back to go (matched-only, see notes)
//   ?max=500             cap messages per mailbox, useful when testing

export default async function handler(req, res) {
  try {
    const dryRun = req.query.dryRun === '1'
    const backfillMonths = parseInt(req.query.backfillMonths || '0', 10) || 0
    const max = parseInt(req.query.max || '2000', 10) || 2000
    const result = await runEmailSync({ dryRun, backfillMonths, max })
    return res.status(200).json(result)
  } catch (e) {
    console.error('crm-email-sync error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
