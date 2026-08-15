import { get, set } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { canAccessArea } from '../../lib/roles'
import { SEED_DEALS } from '../../lib/crmSeedDeals'
import { DEFAULT_FIELD_SCHEMA } from '../../lib/crmFieldSchema'

// Persistence for the CRM. Shared across all pre-contract staff.
//   GET                    -> { deals, schema }
//   POST { action:'save', deals, schema }  -> persists both
//   POST { action:'save-schema', schema }  -> persists just the schema
// Keys: crm:deals, crm:field-schema. On first ever load (nothing saved yet) we seed from
// the built-in sample data so the page isn't empty.
const DEALS_KEY = 'crm:deals'
const SCHEMA_KEY = 'crm:field-schema'
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
  if (Array.isArray(saved) && saved.length) return saved
  return DEFAULT_FIELD_SCHEMA
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
    const [deals, schema, orgs, contacts, actSum, noteSum, openActs, delOrgs, delContacts] = await Promise.all([
      loadDeals(), loadSchema(), get(ORGS_KEY), get(CONTACTS_KEY),
      get(SUB_SUMMARY('activities')), get(SUB_SUMMARY('notes')), get(OPEN_ACTIVITIES),
      get(DELETED_KEY('orgs')), get(DELETED_KEY('contacts')),
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
      const supplied = (Array.isArray(body.activities) ? body.activities : []).map(a => ({ ...a, crm: true }))

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
