import { get, set } from './db'
import { listSyncMailboxes, fetchMessages, graphConfigured } from './msGraph'

// Matches email from the pre-contract mailboxes to CRM projects.
//
// STORAGE
//   crm:emails:<dealId>     emails filed against that project
//   crm:emails:unallocated  couldn't be matched - reviewed and allocated by hand
//   crm:emails:sync-state   { [mailbox]: lastRunISO } so each run only asks for new mail
//
// PRIVACY
//   PRIVATE_MAILBOXES match on the PROJECT TITLE IN THE SUBJECT ONLY. No matching on who
//   the email is with. Anything else from those mailboxes is discarded, not queued - it is
//   never stored and never appears in the review list.

const DEALS_KEY = 'crm:deals'
const EMAILS_KEY = (dealId) => `crm:emails:${dealId}`
const UNALLOCATED_KEY = 'crm:emails:unallocated'
const STATE_KEY = 'crm:emails:sync-state'

export const SYNC_GROUP = process.env.MS_SYNC_GROUP || 'crm-sync@rockroofing.co.uk'

// Mailboxes that only ever match on an exact project title in the subject.
export const PRIVATE_MAILBOXES = (process.env.MS_PRIVATE_MAILBOXES || 'james@rockroofing.co.uk')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

// Titles shorter than this are ignored for subject matching - a project called "Tesco"
// would otherwise claim every email with Tesco in the subject.
const MIN_TITLE_LEN = 8

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

// Free email domains must never match a project by domain alone - half the country shares
// them.
const GENERIC_DOMAINS = new Set(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'live.com', 'aol.com'])

function buildIndex(deals) {
  const byTitle = []
  const byEmail = new Map()
  const byDomain = new Map()

  for (const d of deals) {
    if (d.status !== 'open') continue          // only live projects claim email
    const title = norm(d.title)
    if (title.length >= MIN_TITLE_LEN) byTitle.push({ title, id: d.id })

    for (const key of ['contact_email', 'org_email']) {
      const e = norm(d.fields?.[key])
      if (!e || !e.includes('@')) continue
      if (!byEmail.has(e)) byEmail.set(e, d.id)
      const dom = e.split('@')[1]
      if (dom && !GENERIC_DOMAINS.has(dom)) {
        if (!byDomain.has(dom)) byDomain.set(dom, new Set())
        byDomain.get(dom).add(d.id)
      }
    }
  }
  // Longest titles first, so "Bensham Lane Phase 2" wins over "Bensham Lane".
  byTitle.sort((a, b) => b.title.length - a.title.length)
  return { byTitle, byEmail, byDomain }
}

// Returns { dealId, reason } or null.
export function matchEmail(msg, index, { subjectOnly }) {
  const subject = norm(msg.subject)

  for (const t of index.byTitle) {
    if (subject.includes(t.title)) return { dealId: t.id, reason: 'project name in subject' }
  }
  if (subjectOnly) return null                 // private mailbox - nothing else counts

  const people = [msg.from, ...(msg.to || []), ...(msg.cc || [])].filter(Boolean)
  for (const p of people) {
    if (index.byEmail.has(p)) return { dealId: index.byEmail.get(p), reason: 'known contact' }
  }
  // Company domain, but only when it points at exactly one project - otherwise it is a
  // guess, and a wrong project is worse than no project.
  for (const p of people) {
    const dom = p.split('@')[1]
    if (!dom || GENERIC_DOMAINS.has(dom)) continue
    const ids = index.byDomain.get(dom)
    if (ids && ids.size === 1) return { dealId: [...ids][0], reason: 'company domain' }
  }
  return null
}

export async function runEmailSync({ backfillMonths = 0, dryRun = false, max = 2000 } = {}) {
  if (!graphConfigured()) return { ok: false, error: 'Microsoft Graph is not configured' }

  const [deals, state] = await Promise.all([
    get(DEALS_KEY).then((v) => (Array.isArray(v) ? v : [])),
    get(STATE_KEY).then((v) => v || {}),
  ])
  const index = buildIndex(deals)
  const mailboxes = await listSyncMailboxes(SYNC_GROUP)

  const result = { ok: true, mailboxes: [], matched: 0, unallocated: 0, discarded: 0, dryRun }
  const toFile = new Map()      // dealId -> [emails]
  const toQueue = []

  for (const mb of mailboxes) {
    const subjectOnly = PRIVATE_MAILBOXES.includes(mb.email)
    // First run for this mailbox uses the backfill window; after that, only what is new.
    let since = state[mb.email]
    if (!since && backfillMonths > 0) {
      const d = new Date(); d.setMonth(d.getMonth() - backfillMonths)
      since = d.toISOString()
    }
    const isBackfill = !state[mb.email]

    let msgs = []
    try { msgs = await fetchMessages({ mailbox: mb.email, since, max }) }
    catch (e) { result.mailboxes.push({ mailbox: mb.email, error: e.message }); continue }

    let m = 0, q = 0, disc = 0
    for (const msg of msgs) {
      const hit = matchEmail(msg, index, { subjectOnly })
      if (hit) {
        if (!toFile.has(hit.dealId)) toFile.set(hit.dealId, [])
        toFile.get(hit.dealId).push({ ...msg, matchedBy: hit.reason })
        m++
      } else if (subjectOnly) {
        disc++                                  // private mailbox - never queued
      } else if (isBackfill) {
        disc++                                  // historical and unmatched - see notes
      } else {
        toQueue.push(msg); q++
      }
    }
    result.mailboxes.push({ mailbox: mb.email, fetched: msgs.length, matched: m, queued: q, discarded: disc, subjectOnly, backfill: isBackfill })
    result.matched += m; result.unallocated += q; result.discarded += disc
    state[mb.email] = new Date().toISOString()
  }

  if (dryRun) return result

  // Write per project, de-duplicated on the Graph message id so re-running is harmless.
  for (const [dealId, list] of toFile) {
    const existing = (await get(EMAILS_KEY(dealId))) || []
    const seen = new Set(existing.map((e) => e.id))
    const merged = [...existing, ...list.filter((e) => !seen.has(e.id))]
    merged.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    await set(EMAILS_KEY(dealId), merged)
  }

  if (toQueue.length) {
    const existing = (await get(UNALLOCATED_KEY)) || []
    const seen = new Set(existing.map((e) => e.id))
    const merged = [...toQueue.filter((e) => !seen.has(e.id)), ...existing].slice(0, 500)
    await set(UNALLOCATED_KEY, merged)
  }

  await set(STATE_KEY, state)
  return result
}

// Allocate one queued email to a project by hand.
export async function allocateEmail(messageId, dealId) {
  const queue = (await get(UNALLOCATED_KEY)) || []
  const msg = queue.find((e) => e.id === messageId)
  if (!msg) return { ok: false, error: 'That email is no longer in the queue' }

  const existing = (await get(EMAILS_KEY(dealId))) || []
  if (!existing.some((e) => e.id === msg.id)) {
    existing.push({ ...msg, matchedBy: 'allocated by hand' })
    existing.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    await set(EMAILS_KEY(dealId), existing)
  }
  await set(UNALLOCATED_KEY, queue.filter((e) => e.id !== messageId))
  return { ok: true }
}

export async function dismissEmail(messageId) {
  const queue = (await get(UNALLOCATED_KEY)) || []
  await set(UNALLOCATED_KEY, queue.filter((e) => e.id !== messageId))
  return { ok: true }
}

export async function getDealEmails(dealId) {
  return (await get(EMAILS_KEY(dealId))) || []
}

export async function getUnallocated() {
  return (await get(UNALLOCATED_KEY)) || []
}
