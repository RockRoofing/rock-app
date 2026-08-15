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

async function loadDeals() {
  const saved = await get(DEALS_KEY)
  if (Array.isArray(saved)) return saved
  // First run: seed from the sample deals (deep-ish copy).
  return (SEED_DEALS || []).map(d => ({ ...d, fields: { ...d.fields }, history: [...(d.history || [])], activities: [...(d.activities || [])], notes: [...(d.notes || [])] }))
}
async function loadSchema() {
  const saved = await get(SCHEMA_KEY)
  if (Array.isArray(saved) && saved.length) return saved
  return DEFAULT_FIELD_SCHEMA
}

// Import chunks write thousands of keys. The default function timeout is short enough
// that one slow chunk kills the whole import mid-way, so give it room. (Vercel Pro.)
export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  const acc = requireAccess(req)
  if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })

  if (req.method === 'GET') {
    const [deals, schema, orgs, contacts, actSum, noteSum] = await Promise.all([
      loadDeals(), loadSchema(), get(ORGS_KEY), get(CONTACTS_KEY),
      get(SUB_SUMMARY('activities')), get(SUB_SUMMARY('notes')),
    ])
    return res.json({
      deals, schema,
      orgs: Array.isArray(orgs) ? orgs : [],
      contacts: Array.isArray(contacts) ? contacts : [],
      // Counts only - the full activity/note lists load per deal when one is opened.
      activitySummary: actSum || {},
      noteSummary: noteSum || {},
    })
  }

  if (req.method === 'POST') {
    const body = req.body || {}
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
      await set(SUB_KEY(kind, dealId), Array.isArray(body.items) ? body.items : [])
      const index = (await get(SUB_INDEX(kind))) || []
      if (!index.includes(dealId)) { index.push(dealId); await set(SUB_INDEX(kind), index) }
      return res.json({ ok: true })
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
