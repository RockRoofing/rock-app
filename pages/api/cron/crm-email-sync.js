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
//   ?until=2024-11-01      and bound the far end, so a long backfill runs a quarter at a
//                          time without re-fetching everything before it each go.
//   ?queue=0               file the matches, COUNT the rest rather than queueing them.
//                          Use this for any real backfill - two years of unmatched
//                          newsletters is not a review job anybody will ever do, and the
//                          queue caps at 1,000 anyway.
//
//                          On a `since` run nothing is discarded silently: the counts are
//                          reported, and ?detail=1 lists every subject either way.
//                          The incremental watermark is NOT moved, so ordinary syncing
//                          carries on and the run can be repeated safely.
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
    const queue = req.query.queue !== '0'

    // Accept a plain date as well as a full timestamp - Graph needs the latter.
    const readDate = (v, name) => {
      let d = String(v || '').trim()
      if (!d) return ''
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) d = `${d}T00:00:00Z`
      if (isNaN(new Date(d))) throw new Error(`Could not read ${name}=${v}. Use YYYY-MM-DD.`)
      return new Date(d).toISOString()
    }
    let since, until
    try {
      since = readDate(req.query.since, 'since')
      until = readDate(req.query.until, 'until')
    } catch (e) { return res.status(400).json({ error: e.message }) }
    if (since && until && since >= until) {
      return res.status(400).json({ error: 'since must be earlier than until' })
    }

    const result = await runEmailSync({ dryRun, backfillMonths, max, detail, since, until, mailbox, queue })
    return res.status(200).json(result)
  } catch (e) {
    console.error('crm-email-sync error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
