import { get, set, getPortalUsers } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { canAccessArea, normRole } from '../../lib/roles'
import { SEED_DEALS } from '../../lib/crmSeedDeals'
import { DEFAULT_FIELD_SCHEMA } from '../../lib/crmFieldSchema'
import { sendMentionEmails, getMentionableUsers, diagnoseMentions, sendTestMention } from '../../lib/crmMentions'
import { getDealEmails, getUnallocated, allocateEmail, dismissEmail, unfileEmail, allowEmailAgain, moveEmail, dismissEmails, allocateEmails } from '../../lib/crmEmailSync'

// Persistence for the CRM. Shared across all pre-contract staff.
//   GET                    -> { deals, schema }
//   POST { action:'save', deals, schema }  -> persists both
//   POST { action:'save-schema', schema }  -> persists just the schema
// Keys: crm:deals, crm:field-schema. On first ever load (nothing saved yet) we seed from
// the built-in sample data so the page isn't empty.
const DEALS_KEY = 'crm:deals'
const SCHEMA_KEY = 'crm:field-schema'
const LOST_REASONS_KEY = 'crm:lost-reasons'
const ORGS_KEY = 'crm:orgs'
const CONTACTS_KEY = 'crm:contacts'
// Activities and notes are stored PER DEAL - crm:activities:<dealId> - so opening a deal
// reads only its own, rather than pulling 39k rows to show five. An index key remembers
// which deals have records, so a wipe-and-replace import can clear the old ones without
// scanning every key in the database.
const SUB_KEY = (kind, dealId) => `crm:${kind}:${dealId}`
const SUB_INDEX = (kind) => `crm:${kind}:index`
// A tiny per-deal SUMMARY so the kanban can show the activity dot without loading 36k
// activity records. Merging the full lists onto crm:deals was measured at 31MB in a single
// key - far too big to read on every page load - so the board gets counts only and the
// full lists load when a deal is actually opened.
const SUB_SUMMARY = (kind) => `crm:${kind}:summary`
// A flat list of the OUTSTANDING activities across every deal, so the Activities tab can
// show a single to-do table without reading 5,000+ per-deal keys. Only open ones, so it
// stays small (about 1,000 rows) rather than the 32k of completed history.
const OPEN_ACTIVITIES = 'crm:activities:open'
// Names deliberately removed. Needed because the Companies / Contacts pages also list
// anyone found on a deal - without this, deleting a company that appears on any project
// would simply reappear on the next load.
const DELETED_KEY = (kind) => `crm:${kind}:deleted`

// Write many keys with a capped number in flight. Sequential awaits were the bottleneck
// (one network round trip each); unbounded Promise.all risks rate-limiting on a few
// thousand keys, so this sits between the two.
async function writeMany(pairs, concurrency = 25) {
  const list = pairs || []
  let i = 0
  async function worker() {
    while (i < list.length) {
      const n = i++
      const [k, v] = list[n]
      try { await set(k, v) } catch { /* one bad key must not fail the whole chunk */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker))
}

// What the board needs per deal: how many activities are still open, and the earliest
// due date among them. Notes only need a count.
function summarise(kind, items) {
  const list = Array.isArray(items) ? items : []
  if (kind === 'notes') return { total: list.length }
  const open = list.filter(a => !a.done)
  const dues = open.map(a => a.dueDate).filter(Boolean).sort()
  return { total: list.length, open: open.length, next: dues[0] || '' }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}
function requireAccess(req) {
  const u = verifySessionToken(readCookie(req, SESSION_COOKIE))
  if (!u) return { ok: false, code: 401 }
  // CRM lives in Pre-Contract; management/admin also have access.
  if (!canAccessArea(u.role, 'pre-contract')) return { ok: false, code: 403 }
  return { ok: true, user: u }
}

// True when the deals shown are the built-in preview sample rather than your imported
// data. Surfaced to the page so a mismatch is obvious instead of looking like a bug.
let LAST_DEALS_WERE_SEED = false

async function loadDeals() {
  const saved = await get(DEALS_KEY)
  LAST_DEALS_WERE_SEED = !Array.isArray(saved)
  if (Array.isArray(saved)) return saved
  // First run: seed from the sample deals (deep-ish copy).
  return (SEED_DEALS || []).map(d => ({ ...d, fields: { ...d.fields }, history: [...(d.history || [])], activities: [...(d.activities || [])], notes: [...(d.notes || [])] }))
}
async function loadSchema() {
  const saved = await get(SCHEMA_KEY)
  if (!Array.isArray(saved) || !saved.length) return DEFAULT_FIELD_SCHEMA

  // MERGE THE CODE'S OPTIONS INTO THE SAVED SCHEMA.
  //
  // The saved schema is a snapshot taken the first time the CRM loaded, and it wins
  // outright. So a new option added in code - "Actively Chased" on Lead Source - appeared
  // in Add Project, which reads DEFAULT_FIELD_SCHEMA directly, and NOT in the deal view,
  // which reads this. Two dropdowns for the same field offering different choices.
  //
  // Options the code knows about are added; options only in the saved copy are KEPT,
  // because those were added deliberately through Manage Fields and are not ours to
  // remove. Order follows the code, with anything extra appended.
  const byKey = new Map(DEFAULT_FIELD_SCHEMA.map((f) => [f.key, f]))
  return saved.map((f) => {
    const def = byKey.get(f.key)
    if (!def || !Array.isArray(def.options)) return f
    const savedOpts = Array.isArray(f.options) ? f.options : []
    const merged = [...def.options, ...savedOpts.filter((o) => !def.options.includes(o))]
    if (merged.length === savedOpts.length && merged.every((o, i) => o === savedOpts[i])) return f
    return { ...f, options: merged }
  })
}

// Import chunks carry a lot of JSON. Next.js caps request bodies at 1MB BY DEFAULT, which
// is what returned "server 413" - a single activities chunk reached 1.18MB. Every other
// bulk-import endpoint in this app sets this explicitly; the CRM one never did.
// maxDuration: chunks write thousands of keys, and the default timeout is short enough
// that one slow chunk would kill the import mid-way. (Vercel Pro.)
export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
  maxDuration: 60,
}

export default async function handler(req, res) {
  const acc = requireAccess(req)
  if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })

  if (req.method === 'GET') {
    const [deals, schema, orgs, contacts, actSum, noteSum, openActs, delOrgs, delContacts, portal] = await Promise.all([
      loadDeals(), loadSchema(), get(ORGS_KEY), get(CONTACTS_KEY),
      get(SUB_SUMMARY('activities')), get(SUB_SUMMARY('notes')), get(OPEN_ACTIVITIES),
      get(DELETED_KEY('orgs')), get(DELETED_KEY('contacts')), getPortalUsers(),
    ])
    return res.json({
      deals, schema,
      orgs: Array.isArray(orgs) ? orgs : [],
      contacts: Array.isArray(contacts) ? contacts : [],
      // Counts only - the full activity/note lists load per deal when one is opened.
      activitySummary: actSum || {},
      noteSummary: noteSum || {},
      openActivities: Array.isArray(openActs) ? openActs : [],
      dealsAreSeed: LAST_DEALS_WERE_SEED,
      // Who is logged in. The page never knew, which is why "Assign to (current user)"
      // saved an activity with nobody on it.
      // The real portal users - the single source of truth for who can own an activity.
      // The CRM previously used a hard-coded list of five FIRST names, which is why
      // "James" and "James McVeigh" both existed as separate people.
      users: (portal || [])
        .filter(u => u.active !== false)
        // Only people who actually work in this area can own a CRM activity: pre-contract
        // (estimators and sales) plus admin. A post-contract or management user has no
        // business appearing in the assignee list.
        .filter(u => ['pre-contract', 'admin'].includes(normRole(u.role)))
        .map(u => ({
          name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || u.username || '',
          first: u.firstName || (u.name || '').split(' ')[0] || '',
          username: u.username || '',
          // Needed by the email review queue, which tags every message with the mailbox
          // it came from. Without the address there is no way to tie a portal user to
          // their mail.
          email: (u.email || '').toLowerCase(),
        }))
        .filter(u => u.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
      me: {
        name: [acc.user.firstName, acc.user.lastName].filter(Boolean).join(' ') || acc.user.name || acc.user.username || '',
        username: acc.user.username || '',
        // Needed so the CRM can gate admin-only actions - managing the lost-reason list.
        // Normalised, so a legacy role value cannot accidentally read as admin.
        role: normRole(acc.user.role),
      },
      deletedOrgs: Array.isArray(delOrgs) ? delOrgs : [],
      deletedContacts: Array.isArray(delContacts) ? delContacts : [],
    })
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    // Fetch several deals' activities/notes at once. Used to build the Activities tab
    // from data imported BEFORE the flat open-list existed, without a re-import.
    // Add or update a single company / contact, matched on name (case-insensitive).
    // Used when a project is created or edited with a company or person the CRM has not
    // seen before, so they reach the Companies and Contacts pages instead of existing
    // only as text on the deal.
    if (body.action === 'delete-org' || body.action === 'delete-contact') {
      const isOrg = body.action === 'delete-org'
      const key = isOrg ? ORGS_KEY : CONTACTS_KEY
      const dkey = DELETED_KEY(isOrg ? 'orgs' : 'contacts')
      const name = String(body.name || '').trim()
      if (!name) return res.status(400).json({ error: 'Name required' })
      const lower = name.toLowerCase()

      const list = (Array.isArray(await get(key)) ? await get(key) : []).filter(x => String(x?.name || '').trim().toLowerCase() !== lower)
      await set(key, list)

      const gone = Array.isArray(await get(dkey)) ? await get(dkey) : []
      if (!gone.some(n => String(n).trim().toLowerCase() === lower)) gone.push(name)
      await set(dkey, gone)
      return res.json({ ok: true, list, deleted: gone })
    }

    if (body.action === 'upsert-org' || body.action === 'upsert-contact') {
      const isOrg = body.action === 'upsert-org'
      const key = isOrg ? ORGS_KEY : CONTACTS_KEY
      const rec = body.record || {}
      const name = String(rec.name || '').trim()
      if (!name) return res.status(400).json({ error: 'Name required' })

      const list = Array.isArray(await get(key)) ? await get(key) : []
      const i = list.findIndex(x => String(x?.name || '').trim().toLowerCase() === name.toLowerCase())
      if (i < 0) {
        list.push({ ...rec, name, addedInCrm: true })
      } else {
        // Merge, but never let a blank overwrite something already recorded - a project
        // form left half-filled must not wipe details that came from the import.
        const merged = { ...list[i] }
        for (const [k, v] of Object.entries(rec)) {
          if (v === null || v === undefined || String(v).trim() === '') continue
          merged[k] = v
        }
        list[i] = merged
      }
      await set(key, list)
      // Adding it back by name lifts a previous deletion, so the two cannot disagree.
      const dkey = DELETED_KEY(isOrg ? 'orgs' : 'contacts')
      const gone = Array.isArray(await get(dkey)) ? await get(dkey) : []
      const lower = name.toLowerCase()
      if (gone.some(n => String(n).trim().toLowerCase() === lower)) {
        await set(dkey, gone.filter(n => String(n).trim().toLowerCase() !== lower))
      }
      return res.json({ ok: true, list })
    }

    // Store the rebuilt outstanding-activity list so the Activities tab does not have to
    // reconstruct it from hundreds of per-deal keys on every single page load.
    // ONE STORE FOR ACTIVITIES.
    //
    // Everything lives in crm:activities:<dealId> - imported and CRM-created alike. The
    // client sends the activities it created for a deal; anything imported that is already
    // stored is preserved. The flat outstanding list is rebuilt for that deal at the same
    // time, so the Activities tab and the deal can never disagree.
    if (body.action === 'save-deal-activities') {
      const dealId = String(body.dealId || '')
      if (!dealId) return res.status(400).json({ error: 'dealId required' })
      // Write BOTH names. The deal sends `due`; imported records use `dueDate`; different
      // readers reach for different ones. Storing both means no reader can miss it and no
      // future reader can pick up a stale one.
      const supplied = (Array.isArray(body.activities) ? body.activities : []).map(a => {
        const d = a.dueDate || a.due || ''
        return { ...a, due: d, dueDate: d, crm: true }
      })

      const stored = (await get(SUB_KEY('activities', dealId))) || []
      const keptImported = stored.filter(a => !a.crm)
      const merged = [...keptImported, ...supplied]
      await set(SUB_KEY('activities', dealId), merged)

      // keep the index current so a rebuild can still find this deal
      const index = (await get(SUB_INDEX('activities'))) || []
      if (!index.includes(dealId)) { index.push(dealId); await set(SUB_INDEX('activities'), index) }

      // per-deal summary for the kanban dot
      const summary = (await get(SUB_SUMMARY('activities'))) || {}
      summary[dealId] = summarise('activities', merged)
      await set(SUB_SUMMARY('activities'), summary)

      // and this deal's slice of the flat outstanding list
      const open = (await get(OPEN_ACTIVITIES)) || []
      const others = open.filter(a => String(a.dealId) !== dealId)
      const mine = merged.filter(a => !a.done).map(a => ({
        id: a.id, dealId, text: a.subject || a.text || 'Activity',
        due: a.dueDate || a.due || '', assignee: a.assignee || '',
      }))
      await set(OPEN_ACTIVITIES, [...others, ...mine])

      return res.json({ ok: true, total: merged.length, open: mine.length })
    }

    // ONE STORE FOR NOTES, same as activities.
    //
    // A note written in the CRM lives on the deal as a history entry of type 'note';
    // imported ones live in crm:notes:<dealId>. Same two-stores problem activities had, so
    // the same answer: everything goes to the per-deal store, imported ones preserved.
    if (body.action === 'save-deal-notes') {
      const dealId = String(body.dealId || '')
      if (!dealId) return res.status(400).json({ error: 'dealId required' })
      const supplied = (Array.isArray(body.notes) ? body.notes : []).map(n => ({ ...n, crm: true }))

      const stored = (await get(SUB_KEY('notes', dealId))) || []
      const keptImported = stored.filter(n => !n.crm)
      const merged = [...keptImported, ...supplied]
      await set(SUB_KEY('notes', dealId), merged)

      const index = (await get(SUB_INDEX('notes'))) || []
      if (!index.includes(dealId)) { index.push(dealId); await set(SUB_INDEX('notes'), index) }

      const summary = (await get(SUB_SUMMARY('notes'))) || {}
      summary[dealId] = summarise('notes', merged)
      await set(SUB_SUMMARY('notes'), summary)

      return res.json({ ok: true, total: merged.length })
    }

    if (body.action === 'save-open-activities') {
      await set(OPEN_ACTIVITIES, Array.isArray(body.openList) ? body.openList : [])
      return res.json({ ok: true })
    }

    // Just the activity state - the outstanding list and the per-deal counts. A few
    // hundred KB, against 6.4MB for the full load, so it is cheap enough to re-fetch
    // regularly and keep people in step without reloading the page.
    // Rebuild the outstanding list and the per-deal counts from the per-deal stores, which
    // are the source of truth. Use if the tab ever looks short - it cannot lose anything,
    // it only recounts what is already stored.
    if (body.action === 'rebuild-activity-state') {
      const index = (await get(SUB_INDEX('activities'))) || []
      const open = []
      const summary = {}
      for (let i = 0; i < index.length; i += 50) {
        const slice = index.slice(i, i + 50)
        const lists = await Promise.all(slice.map(id => get(SUB_KEY('activities', id)).catch(() => [])))
        slice.forEach((id, j) => {
          const items = lists[j] || []
          summary[id] = summarise('activities', items)
          for (const a of items) {
            if (a.done) continue
            open.push({
              id: a.id, dealId: String(id), text: a.subject || a.text || 'Activity',
              due: a.dueDate || a.due || '', assignee: a.assignee || '',
            })
          }
        })
      }
      await set(OPEN_ACTIVITIES, open)
      await set(SUB_SUMMARY('activities'), summary)
      return res.json({ ok: true, deals: index.length, open: open.length })
    }

    if (body.action === 'activity-state') {
      const [openActs, actSum] = await Promise.all([get(OPEN_ACTIVITIES), get(SUB_SUMMARY('activities'))])
      return res.json({
        ok: true,
        openActivities: Array.isArray(openActs) ? openActs : [],
        activitySummary: actSum || {},
      })
    }

    if (body.action === 'get-sub-many') {
      const kind = body.kind
      if (kind !== 'activities' && kind !== 'notes') return res.status(400).json({ error: 'Unknown kind' })
      const ids = (Array.isArray(body.dealIds) ? body.dealIds : []).slice(0, 400).map(String)
      const out = {}
      await Promise.all(ids.map(async (id) => {
        try { out[id] = (await get(SUB_KEY(kind, id))) || [] } catch { out[id] = [] }
      }))
      return res.json({ ok: true, items: out })
    }

    if (body.action === 'get-sub') {
      const kind = body.kind
      if (kind !== 'activities' && kind !== 'notes') return res.status(400).json({ error: 'Unknown kind' })
      const items = (await get(SUB_KEY(kind, String(body.dealId || '')))) || []
      return res.json({ ok: true, items })
    }

    // ---- Email (Outlook sync) ------------------------------------------------
    // Mail is filed per project in crm:emails:<dealId> by the hourly sync. Anything it
    // could not place with confidence sits in crm:emails:unallocated to be filed by hand -
    // deliberately NOT auto-guessed, because the wrong project is worse than no project.
    // @mention notification. Fired by the CRM after a note or comment is saved, so the
    // note is stored whether or not the email goes out - a failing mail service must not
    // cost somebody their note.
    if (body.action === 'notify-mentions') {
      const out = await sendMentionEmails({
        dealId: body.dealId,
        dealTitle: body.dealTitle || '',
        body: String(body.body || ''),
        author: body.author || '',
        kind: body.kind === 'comment' ? 'comment' : 'note',
      })
      return res.json(out)
    }

    // Diagnostic for @mention email. Sends nothing; says who it resolves to and how the
    // mail service is configured.
    // Sends one real email down the identical path a mention uses.
    if (body.action === 'mention-test-send') {
      const users = await getMentionableUsers()
      const me = (acc.user.email || '').toLowerCase()
      const to = String(body.to || me || '').trim()
      if (!to) return res.status(400).json({ error: 'No address - your portal account has no email on it.' })
      const out = await sendTestMention(to)
      return res.json({ ...out, mentionable: users.map((u) => u.email) })
    }

    if (body.action === 'mention-diagnose') {
      const out = await diagnoseMentions(String(body.body || '@'))
      return res.json(out)
    }

    // LOST REASONS - a managed list rather than a hard-coded one.
    //
    // Reading is open to anyone: everyone marking a deal lost needs the list. WRITING is
    // admin only, because a list everybody can edit stops being a list - you end up with
    // "Price", "price" and "Too expensive" as three separate reasons and the Lost Reasons
    // analysis becomes meaningless.
    if (body.action === 'lost-reasons') {
      const stored = await get(LOST_REASONS_KEY)
      const list = Array.isArray(stored) && stored.length
        ? stored
        : (DEFAULT_FIELD_SCHEMA.find(f => f.key === 'lost_reason')?.options || [])
      return res.json({ ok: true, reasons: list })
    }

    if (body.action === 'save-lost-reasons') {
      if (normRole(acc.user.role) !== 'admin') {
        return res.status(403).json({ error: 'Only an admin can change the lost-reason list.' })
      }
      const reasons = Array.isArray(body.reasons) ? body.reasons : []
      // Trimmed, blanks dropped, duplicates removed case-insensitively - the whole point
      // of a managed list is that the same reason cannot exist twice.
      const seen = new Set()
      const clean = []
      for (const r of reasons) {
        const t = String(r || '').trim()
        if (!t) continue
        const k = t.toLowerCase()
        if (seen.has(k)) continue
        seen.add(k); clean.push(t)
      }
      await set(LOST_REASONS_KEY, clean)
      return res.json({ ok: true, reasons: clean })
    }

    // Add one reason without needing the whole list - used by the Mark lost modal when
    // somebody types a reason that is not on it yet.
    if (body.action === 'add-lost-reason') {
      if (normRole(acc.user.role) !== 'admin') {
        return res.status(403).json({ error: 'Only an admin can add to the lost-reason list.' })
      }
      const reason = String(body.reason || '').trim()
      if (!reason) return res.status(400).json({ error: 'reason required' })
      const stored = await get(LOST_REASONS_KEY)
      const list = Array.isArray(stored) && stored.length
        ? stored
        : (DEFAULT_FIELD_SCHEMA.find(f => f.key === 'lost_reason')?.options || [])
      if (!list.some(r => String(r).toLowerCase() === reason.toLowerCase())) list.push(reason)
      await set(LOST_REASONS_KEY, list)
      return res.json({ ok: true, reasons: list })
    }

    if (body.action === 'emails') {
      const dealId = String(body.dealId || '')
      if (!dealId) return res.status(400).json({ error: 'dealId required' })
      const items = await getDealEmails(dealId)
      return res.json({ ok: true, items: Array.isArray(items) ? items : [] })
    }

    // Count only, for the nav badge. The queue itself can be a few hundred rows, and the
    // badge is polled - no point shifting the whole list to show a number.
    if (body.action === 'emails-queue-count') {
      const items = await getUnallocated()
      return res.json({ ok: true, count: Array.isArray(items) ? items.length : 0 })
    }

    if (body.action === 'emails-unallocated') {
      const items = await getUnallocated()
      return res.json({ ok: true, items: Array.isArray(items) ? items : [] })
    }

    if (body.action === 'allocate-email') {
      const messageId = String(body.messageId || '')
      const dealId = String(body.dealId || '')
      if (!messageId || !dealId) return res.status(400).json({ error: 'messageId and dealId required' })
      const out = await allocateEmail(messageId, dealId)
      return res.json(out)
    }

    if (body.action === 'dismiss-email') {
      const messageId = String(body.messageId || '')
      if (!messageId) return res.status(400).json({ error: 'messageId required' })
      const out = await dismissEmail(messageId)
      return res.json(out)
    }

    // Take an email back off a project. Also marks it do-not-assign, otherwise the next
    // sync would simply file it again and it would look like the removal never happened.
    // BULK. One request, one write - not a loop of singles from the browser.
    if (body.action === 'dismiss-emails') {
      const ids = Array.isArray(body.messageIds) ? body.messageIds : []
      if (!ids.length) return res.status(400).json({ error: 'messageIds required' })
      const out = await dismissEmails(ids)
      return res.json(out)
    }

    if (body.action === 'allocate-emails') {
      const ids = Array.isArray(body.messageIds) ? body.messageIds : []
      const dealId = String(body.dealId || '')
      if (!ids.length || !dealId) return res.status(400).json({ error: 'messageIds and dealId required' })
      const out = await allocateEmails(ids, dealId)
      return res.json(out)
    }

    if (body.action === 'unfile-email') {
      const messageId = String(body.messageId || '')
      const dealId = String(body.dealId || '')
      if (!messageId || !dealId) return res.status(400).json({ error: 'messageId and dealId required' })
      const out = await unfileEmail(dealId, messageId)
      return res.json(out)
    }

    // The way back from a mis-click on Do not assign.
    if (body.action === 'allow-email-again') {
      const messageId = String(body.messageId || '')
      if (!messageId) return res.status(400).json({ error: 'messageId required' })
      const out = await allowEmailAgain(messageId)
      return res.json(out)
    }

    // Move an email from one project to another. Filed against the wrong job is far more
    // common than filed wrongly altogether, and un-filing then hunting for it in the
    // queue is not a route back - the queue is not where it went.
    if (body.action === 'move-email') {
      const messageId = String(body.messageId || '')
      const fromDealId = String(body.fromDealId || '')
      const toDealId = String(body.toDealId || '')
      if (!messageId || !fromDealId || !toDealId) return res.status(400).json({ error: 'messageId, fromDealId and toDealId required' })
      if (fromDealId === toDealId) return res.status(400).json({ error: 'That is the project it is already on' })
      const out = await moveEmail(fromDealId, toDealId, messageId)
      return res.json(out)
    }

    if (body.action === 'save-sub') {
      const kind = body.kind
      if (kind !== 'activities' && kind !== 'notes') return res.status(400).json({ error: 'Unknown kind' })
      const dealId = String(body.dealId || '')
      if (!dealId) return res.status(400).json({ error: 'dealId required' })
      const items = Array.isArray(body.items) ? body.items : []
      await set(SUB_KEY(kind, dealId), items)
      const index = (await get(SUB_INDEX(kind))) || []
      if (!index.includes(dealId)) { index.push(dealId); await set(SUB_INDEX(kind), index) }

      // Keep the summary and the flat outstanding list in step. Without this, completing
      // an activity from the Activities table looked right until the next reload, when it
      // came back - the stored record said done but the aggregate still listed it.
      if (kind === 'activities') {
        const summary = (await get(SUB_SUMMARY('activities'))) || {}
        summary[dealId] = summarise('activities', items)
        await set(SUB_SUMMARY('activities'), summary)

        const open = (await get(OPEN_ACTIVITIES)) || []
        const others = open.filter(a => String(a.dealId) !== dealId)
        const mine = items.filter(a => !a.done).map(a => ({
          id: a.id, dealId, text: a.subject || a.text || 'Activity',
          due: a.dueDate || a.due || '', assignee: a.assignee || '',
        }))
        await set(OPEN_ACTIVITIES, [...others, ...mine])
      }
      return res.json({ ok: true })
    }

    // Save only the deals that actually changed.
    //
    // The whole deals list is ~6.4MB for 6,860 projects, and Vercel rejects any request
    // body over 4.5MB before the code even runs - which is the "server 413". Sending the
    // full list on every keystroke could never work at this size; it only survived while
    // the CRM held a few hundred sample deals.
    // Delete a project and everything filed against it. Its activities and notes live in
    // their own keys, so removing only the deal would leave those behind for good.
    if (body.action === 'delete-deal') {
      const dealId = String(body.dealId || '')
      if (!dealId) return res.status(400).json({ error: 'dealId required' })

      const list = Array.isArray(await get(DEALS_KEY)) ? await get(DEALS_KEY) : []

      // REMOVE ONE, NOT ALL WITH THAT ID.
      //
      // This filtered on id, so if two projects ever shared one, deleting either wiped
      // BOTH - silently, and with no way back. Ids cannot collide any more, but a delete
      // that can destroy a project you did not ask about is not something to leave to
      // the assumption that nothing upstream is broken.
      let dropped = 0
      const keptDeals = list.filter(d => {
        if (String(d.id) !== dealId || dropped) return true
        dropped = 1
        return false
      })
      if (!dropped) return res.json({ ok: true, note: 'That project was already gone.' })
      const stillThere = keptDeals.some(d => String(d.id) === dealId)
      await set(DEALS_KEY, keptDeals)

      // If a duplicate of this id is still present, its activities, notes and email are
      // the SAME records. Leave them alone or deleting one project guts the other.
      for (const kind of stillThere ? [] : ['activities', 'notes']) {
        await set(SUB_KEY(kind, dealId), [])
        const idx = (await get(SUB_INDEX(kind))) || []
        await set(SUB_INDEX(kind), idx.filter(id => String(id) !== dealId))
        const sum = (await get(SUB_SUMMARY(kind))) || {}
        delete sum[dealId]
        await set(SUB_SUMMARY(kind), sum)
      }

      if (!stillThere) {
        const open = (await get(OPEN_ACTIVITIES)) || []
        await set(OPEN_ACTIVITIES, open.filter(a => String(a.dealId) !== dealId))
      }

      // EVERYTHING ELSE THAT KNOWS ABOUT THIS PROJECT.
      //
      // Deleting used to clear the deal, its activities and its notes. Everything added
      // since - filed email, conversation links, milestones, value changes - was left
      // behind, pointing at a project that no longer exists. The consequences were not
      // obvious: orphaned milestones still counted towards Deals Researched, orphaned
      // value changes still counted towards work priced, and any reply on a filed thread
      // would re-file itself against the deleted id.
      const removed = {}
      if (stillThere) return res.json({ ok: true, removed, note: 'Another project still uses that id, so its records were left alone.' })

      // Filed email, and the conversation links that would re-file replies against it.
      await set(`crm:emails:${dealId}`, [])
      const threads = (await get('crm:emails:threads')) || []
      const keptThreads = threads.filter(t => !(t && String(t.d) === dealId))
      removed.threadLinks = threads.length - keptThreads.length
      await set('crm:emails:threads', keptThreads)

      // Suggestions in the review queue pointing at it - the row stays, the suggestion
      // goes, otherwise you would be offered a project that is not there.
      const queue = (await get('crm:emails:unallocated')) || []
      let suggestionsCleared = 0
      const cleanQueue = queue.map(e => {
        if (e && String(e.suggestDealId) === dealId) {
          suggestionsCleared++
          const { suggestDealId, suggestTitle, suggestScore, suggestRunnerUp, ...rest } = e
          return rest
        }
        return e
      })
      if (suggestionsCleared) await set('crm:emails:unallocated', cleanQueue)
      removed.emailSuggestions = suggestionsCleared

      // Milestones - received date, Project In date, score. These drive Deals Researched
      // and the Glenigan cards, so leaving them would keep counting a deleted project.
      const milestones = (await get('crm:deal-milestones')) || {}
      if (milestones[dealId]) { delete milestones[dealId]; await set('crm:deal-milestones', milestones); removed.milestones = 1 }

      // Hand-made and seeded value changes. Derived ones vanish with the deal itself.
      const vc = (await get('crm:value-changes')) || []
      const keptVc = vc.filter(v => String(v.dealId) !== dealId)
      removed.valueChanges = vc.length - keptVc.length
      if (removed.valueChanges) await set('crm:value-changes', keptVc)

      return res.json({ ok: true, removed })
    }

    // PROJECT SCORES ONLY. Writes fields.project_score onto deals that already exist and
    // touches nothing else - not the title, not the stage, not history, not activities.
    //
    // Deliberately NOT a re-import. A full import is wipe-and-replace, and the CRM now
    // holds things the Pipedrive export never had: filed email, thread links, activities
    // and notes created here, corrections made by hand. Re-importing to recover a single
    // column would take all of that with it.
    // REPAIR. Deals marked won or lost in the CRM before this was fixed carry no
    // won_time / lost_time, so they had no close date and fell out of every
    // date-filtered view. The history knows when it happened - it wrote a 'won' or
    // 'lost' entry at the time - so the date is recoverable from that.
    //
    // Only fills a blank. Never touches a date that is already there.
    // DUPLICATE DEAL IDS.
    //
    // New ids came from a counter that started at 900000 every session, so projects
    // created on different days could share an id. deals.find() returns the first match,
    // which is why clicking one project opened another.
    //
    // Reports them, and renumbers the duplicates on request. The FIRST occurrence keeps
    // its id - it is the one already referenced by activities, notes, filed email and
    // planning allocations. Later ones are moved above the highest id in use, and their
    // sub-records move with them.
    if (body.action === 'find-duplicate-ids') {
      const list = Array.isArray(await get(DEALS_KEY)) ? await get(DEALS_KEY) : []
      const seen = new Map()
      const dupes = []
      for (const d of list) {
        const k = String(d.id)
        if (seen.has(k)) dupes.push({ id: k, keeps: seen.get(k), duplicate: d.title || '(untitled)' })
        else seen.set(k, d.title || '(untitled)')
      }
      return res.json({ ok: true, total: list.length, duplicates: dupes })
    }

    if (body.action === 'fix-duplicate-ids') {
      const list = Array.isArray(await get(DEALS_KEY)) ? await get(DEALS_KEY) : []
      let highest = list.reduce((mx, d) => { const n = Number(d.id); return Number.isFinite(n) && n > mx ? n : mx }, 899999)
      const seen = new Set()
      const moved = []
      for (const d of list) {
        const k = String(d.id)
        if (!seen.has(k)) { seen.add(k); continue }
        const from = k
        const to = String(++highest)
        d.id = highest
        seen.add(to)
        // Carry its own records across with it.
        for (const kind of ['activities', 'notes']) {
          const sub = (await get(SUB_KEY(kind, from))) || []
          if (sub.length) {
            await set(SUB_KEY(kind, to), sub)
            const idx = (await get(SUB_INDEX(kind))) || []
            if (!idx.includes(to)) await set(SUB_INDEX(kind), [...idx, to])
          }
        }
        moved.push({ from, to, title: d.title || '(untitled)' })
      }
      if (moved.length) await set(DEALS_KEY, list)
      return res.json({
        ok: true, moved,
        note: moved.length
          ? 'The FIRST project with each id kept it. Later ones were renumbered. Their activities and notes were copied across; filed email and planning allocations still point at the original id and may need checking.'
          : 'No duplicates found.',
      })
    }

    // ONE-OFF: make every activity carry both date names.
    //
    // CRM-created activities were stored with `due` only, and the deal view reads
    // `dueDate` - so their dates showed on the Activities list and vanished on the deal.
    // Fixed going forward; this brings the existing ones into line.
    if (body.action === 'repair-activity-dates') {
      const index = (await get(SUB_INDEX('activities'))) || []
      let dealsTouched = 0, recordsFixed = 0
      for (const dealId of index) {
        const items = (await get(SUB_KEY('activities', dealId))) || []
        let changed = false
        const next = items.map(a => {
          const d = a.dueDate || a.due || ''
          if (a.dueDate === d && a.due === d) return a
          changed = true; recordsFixed++
          return { ...a, due: d, dueDate: d }
        })
        if (changed) { await set(SUB_KEY('activities', dealId), next); dealsTouched++ }
      }
      return res.json({ ok: true, dealsTouched, recordsFixed, note: 'Every activity now carries the same date under both field names.' })
    }

    if (body.action === 'repair-close-dates') {
      const list = Array.isArray(await get(DEALS_KEY)) ? await get(DEALS_KEY) : []
      let fixed = 0, alreadyOk = 0, noHistory = 0
      for (const d of list) {
        if (!d || (d.status !== 'won' && d.status !== 'lost')) continue
        const f = d.fields || {}
        if (f.won_time || f.lost_time) { alreadyOk++; continue }
        const hist = Array.isArray(d.history) ? d.history : []
        // Latest matching entry: a deal reopened and re-decided should carry the date of
        // the decision that stands, not the one that was undone.
        const entry = [...hist].reverse().find((h) => h && h.type === d.status)
        if (!entry || !entry.ts) { noHistory++; continue }
        d.fields = { ...f, [d.status === 'won' ? 'won_time' : 'lost_time']: entry.ts }
        fixed++
      }
      if (fixed) await set(DEALS_KEY, list)
      return res.json({ ok: true, fixed, alreadyOk, noHistory })
    }

    if (body.action === 'patch-project-scores') {
      const pairs = Array.isArray(body.scores) ? body.scores : []
      if (!pairs.length) return res.status(400).json({ error: 'scores required' })

      const list = Array.isArray(await get(DEALS_KEY)) ? await get(DEALS_KEY) : []
      const byId = new Map(list.map((d) => [String(d.id), d]))

      let updated = 0, unchanged = 0, notFound = 0
      for (const p of pairs) {
        if (!p || p.id == null) continue
        const d = byId.get(String(p.id))
        if (!d) { notFound++; continue }
        const score = String(p.score == null ? '' : p.score).trim()
        if (!score) continue
        const current = String(d.fields?.project_score ?? '').trim()
        if (current === score) { unchanged++; continue }
        // Never blank a score somebody has typed in here. The export is older than the
        // CRM, so what is in the CRM is the newer fact.
        if (current) { unchanged++; continue }
        d.fields = { ...(d.fields || {}), project_score: score }
        updated++
      }

      if (updated) await set(DEALS_KEY, list)
      return res.json({ ok: true, updated, unchanged, notFound, seen: pairs.length })
    }

    if (body.action === 'save-deals-partial') {
      const changed = Array.isArray(body.deals) ? body.deals : []
      const removed = new Set((Array.isArray(body.removedIds) ? body.removedIds : []).map(String))

      const list = Array.isArray(await get(DEALS_KEY)) ? await get(DEALS_KEY) : []
      const byId = new Map(list.map(d => [String(d.id), d]))

      // Activities and notes travel WITH the deal, in this one request, and the server
      // files them. Doing it as a separate call was the mistake: the deal could be stored
      // without them if that second call failed, and the cross-project list could drift
      // out of step with what was actually saved.
      for (const d of changed) {
        if (!d || d.id == null) continue
        const dealId = String(d.id)
        const acts = Array.isArray(d.__activities) ? d.__activities : null
        const nts = Array.isArray(d.__notes) ? d.__notes : null
        delete d.__activities; delete d.__notes

        if (acts) {
          const stored = (await get(SUB_KEY('activities', dealId))) || []
          const merged = [...stored.filter(a => !a.crm), ...acts.map(a => ({ ...a, crm: true }))]
          await set(SUB_KEY('activities', dealId), merged)
          const idx = (await get(SUB_INDEX('activities'))) || []
          if (!idx.includes(dealId)) { idx.push(dealId); await set(SUB_INDEX('activities'), idx) }
          const sum = (await get(SUB_SUMMARY('activities'))) || {}
          sum[dealId] = summarise('activities', merged)
          await set(SUB_SUMMARY('activities'), sum)
          const open = (await get(OPEN_ACTIVITIES)) || []
          await set(OPEN_ACTIVITIES, [
            ...open.filter(a => String(a.dealId) !== dealId),
            ...merged.filter(a => !a.done).map(a => ({
              id: a.id, dealId, text: a.subject || a.text || 'Activity',
              due: a.dueDate || a.due || '', assignee: a.assignee || '',
            })),
          ])
        }

        if (nts) {
          const stored = (await get(SUB_KEY('notes', dealId))) || []
          const merged = [...stored.filter(n => !n.crm), ...nts.map(n => ({ ...n, crm: true }))]
          await set(SUB_KEY('notes', dealId), merged)
          const idx = (await get(SUB_INDEX('notes'))) || []
          if (!idx.includes(dealId)) { idx.push(dealId); await set(SUB_INDEX('notes'), idx) }
        }

        byId.set(dealId, d)
      }
      for (const id of removed) byId.delete(id)

      await set(DEALS_KEY, Array.from(byId.values()))
      if (Array.isArray(body.schema) && body.schema.length) await set(SCHEMA_KEY, body.schema)
      return res.json({ ok: true, saved: changed.length, removed: removed.size })
    }

    if (body.action === 'save') {
      if (Array.isArray(body.deals)) await set(DEALS_KEY, body.deals)
      if (Array.isArray(body.schema) && body.schema.length) await set(SCHEMA_KEY, body.schema)
      return res.json({ ok: true })
    }
    if (body.action === 'save-schema') {
      if (Array.isArray(body.schema) && body.schema.length) await set(SCHEMA_KEY, body.schema)
      return res.json({ ok: true })
    }
    // Full import from a Pipedrive export (browser parses the file and sends mapped rows).
    // Wipe & replace for each entity type.
    if (body.action === 'import') {
      if (!Array.isArray(body.deals)) return res.status(400).json({ error: 'No deals to import' })
      await set(DEALS_KEY, body.deals)
      return res.json({ ok: true, count: body.deals.length })
    }
    if (body.action === 'import-orgs') {
      if (!Array.isArray(body.orgs)) return res.status(400).json({ error: 'No companies to import' })
      await set(ORGS_KEY, body.orgs)
      return res.json({ ok: true, count: body.orgs.length })
    }
    if (body.action === 'import-contacts') {
      if (!Array.isArray(body.contacts)) return res.status(400).json({ error: 'No contacts to import' })
      await set(CONTACTS_KEY, body.contacts)
      return res.json({ ok: true, count: body.contacts.length })
    }
    // Chunked import - avoids the ~4.5MB serverless body limit on large sets.
    //   { action:'import-chunk', kind:'deals'|'orgs'|'contacts', rows:[...], first:bool, last:bool }
    // first=true starts a fresh set (wipe); subsequent chunks append; last=true finalises.
    // Per-deal import for activities / notes.
    //   { action:'import-sub', kind:'activities'|'notes',
    //     groups:[{ dealId, items:[...] }], first, last }
    // Grouping happens client-side, so each deal arrives in exactly one chunk and each
    // key can be written outright - no read-modify-write, and re-running a chunk is safe.
    if (body.action === 'import-sub') {
      const kind = body.kind
      if (kind !== 'activities' && kind !== 'notes') return res.status(400).json({ error: 'Unknown import kind' })
      const groups = Array.isArray(body.groups) ? body.groups : []

      // First chunk: clear only the keys that will NOT be rewritten by this import.
      // Previously this blanked EVERY key from the last import one at a time - on a
      // re-import of the same data that was 5,000+ pointless sequential writes in a
      // single request, which is most of why the import crawled.
      if (body.first) {
        const oldIds = (await get(SUB_INDEX(kind))) || []
        const incoming = new Set((body.allDealIds || []).map(String))
        const stale = oldIds.filter(id => !incoming.has(String(id)))
        await writeMany(stale.map(id => [SUB_KEY(kind, id), []]))
      }

      // Per-deal writes run in parallel batches rather than one after another.
      const jobs = []
      let written = 0
      for (const g of groups) {
        if (!g || !g.dealId || !Array.isArray(g.items)) continue
        jobs.push([SUB_KEY(kind, g.dealId), g.items])
        written += g.items.length
      }
      await writeMany(jobs)

      // The index and summary are computed CLIENT-side and sent once with the final
      // chunk. Reading and rewriting them on every chunk meant shifting a 234KB summary
      // back and forth ~45 times per import for no benefit.
      if (body.last) {
        if (Array.isArray(body.index)) await set(SUB_INDEX(kind), body.index.map(String))
        if (body.summary && typeof body.summary === 'object') await set(SUB_SUMMARY(kind), body.summary)
        if (kind === 'activities' && Array.isArray(body.openList)) await set(OPEN_ACTIVITIES, body.openList)
      }
      return res.json({ ok: true, written })
    }

    if (body.action === 'import-chunk') {
      const kind = body.kind
      const key = kind === 'deals' ? DEALS_KEY : kind === 'orgs' ? ORGS_KEY : kind === 'contacts' ? CONTACTS_KEY : null
      if (!key) return res.status(400).json({ error: 'Unknown import kind' })
      if (!Array.isArray(body.rows)) return res.status(400).json({ error: 'No rows in chunk' })
      const existing = body.first ? [] : (Array.isArray(await get(key)) ? await get(key) : [])
      const merged = existing.concat(body.rows)
      await set(key, merged)
      return res.json({ ok: true, count: merged.length })
    }
    return res.status(400).json({ error: 'Unknown action' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
