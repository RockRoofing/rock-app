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
    const [deals, schema] = await Promise.all([loadDeals(), loadSchema()])
    return res.json({ deals, schema })
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
    // Full import from a Pipedrive export (browser parses the file and sends mapped deals).
    // Wipe & replace: the uploaded file becomes the entire deal set.
    if (body.action === 'import') {
      if (!Array.isArray(body.deals)) return res.status(400).json({ error: 'No deals to import' })
      await set(DEALS_KEY, body.deals)
      return res.json({ ok: true, count: body.deals.length })
    }
    return res.status(400).json({ error: 'Unknown action' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
