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

export default async function handler(req, res) {
  const acc = requireAccess(req)
  if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })

  if (req.method === 'GET') {
    const [deals, schema, orgs, contacts] = await Promise.all([
      loadDeals(), loadSchema(), get(ORGS_KEY), get(CONTACTS_KEY),
    ])
    return res.json({ deals, schema, orgs: Array.isArray(orgs) ? orgs : [], contacts: Array.isArray(contacts) ? contacts : [] })
  }

  if (req.method === 'POST') {
    const body = req.body || {}
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
