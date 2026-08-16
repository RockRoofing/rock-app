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
// Messages somebody has said outright do not belong on a project. The sync skips these
// before it even tries to match, so a dismissal STAYS dismissed - otherwise clearing the
// sync state or re-running a backfill would drag the same personal email back into the
// queue and it would have to be dismissed again, for ever.
const NEVER_KEY = 'crm:emails:never'
// Capped so this key cannot grow without limit. Graph message ids are long; 2,000 is
// roughly 300KB, and dismissals should be rare.
const NEVER_MAX = 2000

export const SYNC_GROUP = process.env.MS_SYNC_GROUP || 'crm-sync@rockroofing.co.uk'

// Mailboxes that only ever match on an exact project title in the subject.
export const PRIVATE_MAILBOXES = (process.env.MS_PRIVATE_MAILBOXES || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

// The BCC drop-box. Everything that arrives here was sent deliberately, so nothing from it
// is ever discarded - if it cannot be matched it goes to the review queue to be filed by
// hand, rather than being thrown away for want of a reference.
export const BCC_MAILBOX = (process.env.MS_BCC_MAILBOX || 'crm@rockroofing.co.uk').toLowerCase()

// Titles shorter than this are ignored for subject matching - a project called "Tesco"
// would otherwise claim every email with Tesco in the subject.
const MIN_TITLE_LEN = 8

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

// Free email domains must never match a project by domain alone - half the country shares
// them.
const GENERIC_DOMAINS = new Set(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'live.com', 'aol.com'])

// ---------------------------------------------------------------------------
// Close matching
// ---------------------------------------------------------------------------
// An exact title in the subject is unambiguous and files itself. Most real subject lines
// are not exact - "RE: Bensham Lane - drawings for phase 2" contains every word of
// "Bensham Lane Phase 2" but not as one unbroken run, so the exact rule misses it. This
// scores word overlap instead.
//
// Words are weighted by how RARE they are across your project titles. "bensham" appears
// on one project and counts for a lot; "lane", "house", "roofing" appear on hundreds and
// count for very little. So a subject matching only common words scores low even when it
// matches several of them, which is the behaviour you want.

// Email and prose noise only. Everything else is left to the weighting - a hand-written
// list of construction words would be guesswork and would go stale.
const STOPWORDS = new Set(['re', 'fw', 'fwd', 'the', 'and', 'for', 'of', 'to', 'at', 'in', 'on', 'a', 'your', 'our', 'my', 'we', 'is', 'this', 'that', 'with', 'from'])

function tokens(s) {
  return norm(s).split(/[^a-z0-9]+/).filter((t) => t && !STOPWORDS.has(t) && (t.length > 1 || /\d/.test(t)))
}

// Score above which a close match files itself, and how far clear of the runner-up it has
// to be. Both tunable from Vercel without a deploy.
const MATCH_THRESHOLD = Math.min(1, Math.max(0.4, parseFloat(process.env.MS_MATCH_THRESHOLD || '0.70') || 0.70))
// The guard that matters. "Bensham Lane" scores the same against "Bensham Lane Phase 1"
// and "Bensham Lane Phase 2"; without this it would file into whichever sorted first.
const MATCH_MARGIN = Math.max(0, parseFloat(process.env.MS_MATCH_MARGIN || '0.12') || 0.12)
// Below this a suggestion is not worth showing at all - it would be noise on the row.
const SUGGEST_FLOOR = 0.45

// Best and second-best scoring projects for a subject line.
// Returns { dealId, title, score, runnerUp, runnerUpScore } or null.
export function closeMatch(subject, index) {
  const subjTokens = new Set(tokens(subject))
  if (!subjTokens.size) return null

  let best = null, second = null
  for (const t of index.byTitle) {
    let hit = 0, total = 0
    for (const tok of t.tokens) {
      const w = index.weight.get(tok) || 1
      total += w
      if (subjTokens.has(tok)) hit += w
    }
    if (!total) continue
    const score = hit / total
    if (!best || score > best.score) { second = best; best = { dealId: t.id, title: t.raw, score } }
    else if (!second || score > second.score) second = { dealId: t.id, title: t.raw, score }
  }
  if (!best || best.score < SUGGEST_FLOOR) return null
  return {
    dealId: best.dealId, title: best.title, score: best.score,
    runnerUp: second ? second.title : '', runnerUpScore: second ? second.score : 0,
  }
}

// Confident enough to file without asking: over the threshold AND clearly ahead of
// whatever came second.
export function isConfident(cm) {
  if (!cm) return false
  return cm.score >= MATCH_THRESHOLD && (cm.score - (cm.runnerUpScore || 0)) >= MATCH_MARGIN
}

function buildIndex(deals) {
  const byTitle = []
  const byEmail = new Map()
  const byDomain = new Map()
  const docFreq = new Map()   // token -> how many project titles contain it

  for (const d of deals) {
    if (d.status !== 'open') continue          // only live projects claim email
    const title = norm(d.title)
    if (title.length >= MIN_TITLE_LEN) {
      const toks = tokens(d.title)
      byTitle.push({ title, raw: d.title || '', tokens: toks, id: d.id })
      for (const t of new Set(toks)) docFreq.set(t, (docFreq.get(t) || 0) + 1)
    }

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
  // Rarity weighting. A word on one project is worth several times one that appears on a
  // hundred, so "bensham" carries a match and "lane" barely moves it.
  const weight = new Map()
  for (const [tok, df] of docFreq) weight.set(tok, 1 / (1 + Math.log(df)))

  // Longest titles first, so "Bensham Lane Phase 2" wins over "Bensham Lane".
  byTitle.sort((a, b) => b.title.length - a.title.length)
  const ids = new Set(deals.filter((d) => d.status === 'open').map((d) => Number(d.id)))
  return { byTitle, byEmail, byDomain, ids, weight }
}

// A deliberate reference in the subject, e.g. [CRM-972]. Beats every other rule because
// somebody has stated outright which project this belongs to.
const REF_RE = /\[\s*crm\s*[-:# ]\s*(\d+)\s*\]|#crm(\d+)\b/i
export function subjectRef(subject) {
  const m = REF_RE.exec(String(subject || ''))
  if (!m) return null
  const id = m[1] || m[2]
  return id ? Number(id) : null
}

// Returns { dealId, reason } when it is confident enough to file on its own, or
// { suggest: {...} } when it has a good idea but not a certainty, or null.
export function matchEmail(msg, index, { subjectOnly }) {
  const subject = norm(msg.subject)

  const ref = subjectRef(msg.subject)
  if (ref && index.ids.has(ref)) return { dealId: ref, reason: 'reference in subject' }

  for (const t of index.byTitle) {
    if (subject.includes(t.title)) return { dealId: t.id, reason: 'project name in subject' }
  }

  // Not an exact title. Score the words instead. Files itself only when it is over the
  // threshold AND clearly ahead of the runner-up - "Bensham Lane" scores the same against
  // Phase 1 and Phase 2, and guessing between them is exactly the harm to avoid.
  const cm = closeMatch(msg.subject, index)
  if (cm && isConfident(cm)) {
    return { dealId: cm.dealId, reason: `close match ${Math.round(cm.score * 100)}%` }
  }

  if (subjectOnly) return cm ? { suggest: cm } : null   // private mailbox - nothing else counts

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
  // Nothing filed it, but a near miss is still worth putting in front of you.
  return cm ? { suggest: cm } : null
}

// Attach a suggestion to a queued message so the review screen can offer one-click accept.
function withSuggestion(msg, cm) {
  if (!cm) return msg
  return {
    ...msg,
    suggestDealId: cm.dealId,
    suggestTitle: cm.title,
    suggestScore: Math.round(cm.score * 100),
    suggestRunnerUp: cm.runnerUp || '',
  }
}

export async function runEmailSync({ backfillMonths = 0, dryRun = false, max = 2000, detail = false } = {}) {
  if (!graphConfigured()) return { ok: false, error: 'Microsoft Graph is not configured' }

  const [deals, state, neverList] = await Promise.all([
    get(DEALS_KEY).then((v) => (Array.isArray(v) ? v : [])),
    get(STATE_KEY).then((v) => v || {}),
    get(NEVER_KEY).then((v) => (Array.isArray(v) ? v : [])),
  ])
  const never = new Set(neverList)
  const index = buildIndex(deals)
  const mailboxes = await listSyncMailboxes(SYNC_GROUP)

  const result = { ok: true, mailboxes: [], matched: 0, unallocated: 0, discarded: 0, skipped: 0, dryRun, threshold: MATCH_THRESHOLD, margin: MATCH_MARGIN }
  const toFile = new Map()      // dealId -> [emails]
  const toQueue = []
  const detailRows = []

  for (const mb of mailboxes) {
    const subjectOnly = PRIVATE_MAILBOXES.includes(mb.email)
    const isBcc = mb.email === BCC_MAILBOX
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

    let m = 0, q = 0, disc = 0, skip = 0
    for (const msg of msgs) {
      // Told outright this one does not belong on a project. Nothing else applies - not
      // even a reference in the subject, because a person overrules a rule.
      if (never.has(msg.id)) { skip++; continue }
      const hit = matchEmail(msg, index, { subjectOnly })
      const suggest = hit && hit.suggest ? hit.suggest : null
      const filed = hit && hit.dealId ? hit : null

      if (detail) {
        detailRows.push({
          mailbox: mb.email,
          date: msg.date,
          subject: msg.subject,
          outcome: filed ? 'FILED' : suggest ? 'SUGGESTED' : 'NO MATCH',
          project: filed ? (index.byTitle.find((t) => t.id === filed.dealId) || {}).raw || String(filed.dealId) : (suggest ? suggest.title : ''),
          why: filed ? filed.reason : '',
          score: suggest ? Math.round(suggest.score * 100) : (filed && /close match/.test(filed.reason) ? parseInt(filed.reason.replace(/\D/g, ''), 10) : null),
          runnerUp: suggest ? suggest.runnerUp : '',
          runnerUpScore: suggest ? Math.round((suggest.runnerUpScore || 0) * 100) : null,
        })
      }

      if (filed) {
        if (!toFile.has(filed.dealId)) toFile.set(filed.dealId, [])
        toFile.get(filed.dealId).push({ ...msg, matchedBy: filed.reason })
        m++
      } else if (isBcc) {
        toQueue.push(withSuggestion(msg, suggest)); q++   // deliberate BCC - always reviewable
      } else if (subjectOnly) {
        disc++                                  // private mailbox - never queued
      } else if (isBackfill) {
        disc++                                  // historical and unmatched - see notes
      } else {
        toQueue.push(withSuggestion(msg, suggest)); q++
      }
    }
    result.mailboxes.push({ mailbox: mb.email, fetched: msgs.length, matched: m, queued: q, discarded: disc, skipped: skip, subjectOnly, isBcc, backfill: isBackfill })
    result.matched += m; result.unallocated += q; result.discarded += disc; result.skipped += skip
    state[mb.email] = new Date().toISOString()
  }

  if (detail) result.detail = detailRows
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

// Remember that a message must never be filed against a project. Kept newest-first and
// capped, so the key stays a sensible size.
async function rememberNever(messageId) {
  const list = (await get(NEVER_KEY)) || []
  if (list.includes(messageId)) return
  await set(NEVER_KEY, [messageId, ...list].slice(0, NEVER_MAX))
}

// "Do not assign to a project." Takes it off the review queue AND records it, so a later
// sync, backfill or re-run leaves it alone rather than queueing it all over again.
export async function dismissEmail(messageId) {
  const queue = (await get(UNALLOCATED_KEY)) || []
  await set(UNALLOCATED_KEY, queue.filter((e) => e.id !== messageId))
  await rememberNever(messageId)
  return { ok: true }
}

// Take an email back OFF a project. Same standing instruction as a dismissal - it will
// not be re-filed on the next sync, which it would be otherwise.
export async function unfileEmail(dealId, messageId) {
  const existing = (await get(EMAILS_KEY(dealId))) || []
  await set(EMAILS_KEY(dealId), existing.filter((e) => e.id !== messageId))
  await rememberNever(messageId)
  return { ok: true }
}

// Lift a "do not assign" so the message can be filed again on the next sync. The way back
// from a mis-click, which otherwise would have been permanent.
export async function allowEmailAgain(messageId) {
  const list = (await get(NEVER_KEY)) || []
  await set(NEVER_KEY, list.filter((id) => id !== messageId))
  return { ok: true }
}

export async function getDealEmails(dealId) {
  return (await get(EMAILS_KEY(dealId))) || []
}

export async function getUnallocated() {
  return (await get(UNALLOCATED_KEY)) || []
}
