import { get, set } from './db'
import { graphConfigured, getGraphToken, listSyncMailboxes } from './msGraph'
import { SYNC_GROUP } from './crmEmailSync'

// OUTBOUND EMAIL VOLUME, per mailbox per month.
//
// Counts messages SENT to at least one recipient outside rockroofing.co.uk. Internal
// chatter is not the activity being measured - the point is contact with customers and
// main contractors.
//
// Deliberately separate from the CRM email sync. That one files mail against projects and
// only keeps what it can match; this one counts everything outbound, matched or not. A
// call to a customer about a job that never became a project is still work done.
//
// Stored as a plain per-month tally rather than the messages themselves:
//   crm:email-volume  ->  { "edita@rockroofing.co.uk": { "2026-08": 143, ... }, ... }
// Counting is not the same as keeping. Nobody needs 40,000 subject lines retained to know
// that 143 emails went out in August.

const KEY = 'crm:email-volume'
const GRAPH = 'https://graph.microsoft.com/v1.0'
const INTERNAL_DOMAIN = (process.env.MS_INTERNAL_DOMAIN || 'rockroofing.co.uk').toLowerCase()

const monthOf = (iso) => String(iso || '').slice(0, 7)

export async function getEmailVolume() {
  const v = await get(KEY)
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}
}

// One month of Sent Items for one mailbox. Returns the count of messages that went to at
// least one external address.
async function countSentExternal({ mailbox, from, to, max = 20000 }) {
  const token = await getGraphToken()
  const select = 'id,sentDateTime,toRecipients,ccRecipients,bccRecipients'
  // SentItems specifically. The whole-mailbox endpoint would include everything received,
  // and "emails sent" must mean sent.
  let url = `${GRAPH}/users/${encodeURIComponent(mailbox)}/mailFolders/SentItems/messages`
    + `?$select=${select}&$top=50&$orderby=sentDateTime desc`
    + `&$filter=${encodeURIComponent(`sentDateTime ge ${from} and sentDateTime lt ${to}`)}`

  const byMonth = {}
  let seen = 0
  let truncated = false
  while (url) {
    if (seen >= max) { truncated = true; break }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' } })
    if (!res.ok) throw new Error(`Graph ${res.status} for ${mailbox}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json()
    for (const m of (data.value || [])) {
      seen++
      const addrs = [
        ...(m.toRecipients || []), ...(m.ccRecipients || []), ...(m.bccRecipients || []),
      ].map((r) => String(r?.emailAddress?.address || '').toLowerCase()).filter(Boolean)
      // At least one recipient outside the business. An email to a customer that also
      // copies a colleague still counts once.
      const external = addrs.some((a) => !a.endsWith(`@${INTERNAL_DOMAIN}`))
      if (!external) continue
      const k = monthOf(m.sentDateTime)
      if (k) byMonth[k] = (byMonth[k] || 0) + 1
    }
    url = data['@odata.nextLink'] || null
  }
  return { byMonth, seen, truncated }
}

// Recount a window and overwrite those months. Overwrite rather than add, so re-running
// cannot double-count - the commonest way a tally like this goes wrong.
// max defaults high on purpose. It was 2,000, and Edita's mailbox alone passes that in
// eight months - so a 13-month backfill stopped at January and wrote ZEROS for the five
// months it never reached, while reporting success. A partial scan that looks complete is
// worse than one that fails.
export async function refreshEmailVolume({ months = 2, mailbox = '', max = 20000 } = {}) {
  if (!graphConfigured()) return { ok: false, error: 'Microsoft Graph is not configured' }

  const now = new Date()
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
  const fromD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1))
  const from = fromD.toISOString()

  let boxes = await listSyncMailboxes(SYNC_GROUP)
  if (mailbox) boxes = boxes.filter((b) => b.email === String(mailbox).toLowerCase())

  const store = await getEmailVolume()
  const result = { ok: true, from, to, mailboxes: [] }

  for (const b of boxes) {
    try {
      const { byMonth, seen, truncated } = await countSentExternal({ mailbox: b.email, from, to, max })
      const existing = store[b.email] || {}
      // Only the months we just recounted are replaced. Anything older stays.
      for (const k of Object.keys(byMonth)) existing[k] = byMonth[k]
      // Only fill zeros when the scan actually COVERED the window. If it stopped at the
      // cap, the months it never reached are unknown, not empty - writing zeros there is
      // how five months of Edita's work came to read as nothing.
      if (!truncated) {
        const cursor = new Date(fromD)
        while (cursor < new Date(to)) {
          const k = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`
          if (existing[k] == null) existing[k] = 0
          cursor.setUTCMonth(cursor.getUTCMonth() + 1)
        }
      }
      store[b.email] = existing
      const row = { mailbox: b.email, scanned: seen, byMonth }
      if (truncated) {
        row.truncated = true
        row.warning = `Stopped at the ${max} message cap - only back to ${Object.keys(byMonth).sort()[0] || 'nothing'}. Re-run with a higher ?max= to reach further.`
        result.truncated = true
      }
      result.mailboxes.push(row)
    } catch (e) {
      result.mailboxes.push({ mailbox: b.email, error: e.message })
    }
  }

  await set(KEY, store)
  return result
}
