import { runEmailSync } from '../../../lib/crmEmailSync'

// Pulls new mail from the pre-contract mailboxes and files it against projects.
// Runs every 15 minutes - little and often, so the unallocated queue stays small.
//
//   ?dryRun=1              report what WOULD happen, write nothing
//   ?detail=1              list every subject line with its outcome and score
//   ?max=500               cap messages per mailbox
//   ?mailbox=x@y.co.uk     one mailbox only - the practical way to backfill in chunks
//
// BACKFILL
//   ?since=2024-08-01      look at a window you choose, whatever the sync state says.
//                          Nothing is discarded on a `since` run - unmatched mail goes to
//                          the review queue - and the incremental watermark is NOT moved,
//                          so ordinary syncing carries on untouched and the run can be
//                          repeated safely (writes de-duplicate on message id).
//
//   ?backfillMonths=24     legacy: only applies to a mailbox that has never synced.

// A backfill pulls thousands of messages through Graph, which throttles. The default
// timeout would kill it part-way, leaving a run that looks finished but is not.
export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  try {
    const dryRun = req.query.dryRun === '1'
    const detail = req.query.detail === '1'
    const backfillMonths = parseInt(req.query.backfillMonths || '0', 10) || 0
    const max = parseInt(req.query.max || '2000', 10) || 2000
    const mailbox = String(req.query.mailbox || '').trim()

    // Accept a plain date as well as a full timestamp - Graph needs the latter.
    let since = String(req.query.since || '').trim()
    if (since) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(since)) since = `${since}T00:00:00Z`
      if (isNaN(new Date(since))) return res.status(400).json({ error: `Could not read since=${req.query.since}. Use YYYY-MM-DD.` })
      since = new Date(since).toISOString()
    }

    const result = await runEmailSync({ dryRun, backfillMonths, max, detail, since, mailbox })
    return res.status(200).json(result)
  } catch (e) {
    console.error('crm-email-sync error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
