import { currentTenant, currentTenantId } from './tenantContext'

// THE IN-MEMORY FALLBACK, ONE PER CUSTOMER.
//
// Used only when no Redis credentials are configured, so in practice never in
// production - but it was a single object at module scope, shared by every
// request a warm function handled. Under multi-tenancy that is one customer's
// data served to another, from the one place in the app that is supposed to be
// the isolation boundary.
//
// While single-tenant, currentTenantId() is null and everything uses one slot
// called 'single'. Identical behaviour to before.
const _stores = new Map()
function currentStore() {
  const k = currentTenantId() || 'single'
  let m = _stores.get(k)
  if (!m) { m = {}; _stores.set(k, m) }
  return m
}

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    // Support all env var naming conventions from both apps
    const url = process.env.kv_KV_REST_API_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.kv_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch {
    return null
  }
}

// ─── Generic helpers ───────────────────────────────────────────────────────

export async function get(key) {
  const redis = await getRedis()
  if (redis) return await redis.get(key)
  return currentStore()[key] || null
}

export async function set(key, value) {
  const redis = await getRedis()
  if (redis) await redis.set(key, value)
  else currentStore()[key] = value
}

export async function keys(pattern) {
  const redis = await getRedis()
  if (redis) return await redis.keys(pattern)
  return Object.keys(currentStore()).filter(k => {
    const p = pattern.replace('*', '')
    return k.startsWith(p)
  })
}

export async function del(key) {
  const redis = await getRedis()
  if (redis) return await redis.del(key)
  delete currentStore()[key]
  return 1
}

export async function scan(cursor, opts) {
  const redis = await getRedis()
  if (redis) return await redis.scan(cursor, opts)
  const match = (opts && opts.match) || '*'
  const p = match.replace('*', '')
  return [0, Object.keys(currentStore()).filter(k => k.startsWith(p))]
}

// --- Shared data client -----------------------------------------------------
// THE ONLY WAY ANY FILE MAY TALK TO REDIS.
//
// Do not write `new Redis(...)` or `Redis.fromEnv()` anywhere else in this app.
// Every other file must do:
//
//     import { getClient } from '../../lib/db'
//     const redis = await getClient()
//     const v = await redis.get('some:key')
//
// It deliberately has the same shape as an Upstash client (get/set/del/keys/
// scan), so call sites read identically to the direct connections it replaces
// and key names never change.
//
// This is the single place a tenant will later be resolved: when the app goes
// multi-tenant, getClient() picks that customer's database and every file
// follows automatically. A file that opens its own connection would not, and
// would serve one customer's data to another.
// --- Tenant resolution ------------------------------------------------------
// Self-check results, keyed by tenant id. Safe at module scope because it holds
// a boolean per customer, never any customer's data.
const verified = {}
const VERIFY_TTL_MS = 5 * 60 * 1000

// THE SELF-CHECK.
//
// The registry says "Wilson is at database X". Before serving anything, database
// X has to agree it is Wilson. A record at tenant:identity inside each customer's
// own database carries its id.
//
// This does not grant access, it refuses it. It catches a wrong mapping in the
// registry, which is the one failure that would otherwise be completely silent:
// everything works, nothing errors, and one company sees another's projects.
//
// What it CANNOT catch is both sides being wrong the same way - a database cloned
// from another customer with the label edited. Which is why test customers are
// created empty and never cloned.
async function assertIdentity(redis, tenant) {
  const now = Date.now()
  if (verified[tenant.id] && verified[tenant.id] > now) return
  let identity = null
  try {
    identity = await redis.get('tenant:identity')
  } catch (e) {
    throw new Error(`Could not verify identity of database for tenant ${tenant.id}: ${e.message}`)
  }
  if (!identity || !identity.id) {
    throw new Error(`Database for tenant ${tenant.id} carries no identity record - refusing to serve it`)
  }
  if (String(identity.id) !== String(tenant.id)) {
    throw new Error(`Tenant mismatch: registry says ${tenant.id}, database says ${identity.id} - refusing to serve it`)
  }
  verified[tenant.id] = now + VERIFY_TTL_MS
}

async function tenantRedis(tenant) {
  const { Redis } = await import('@upstash/redis')
  return new Redis({ url: tenant.redis.url, token: tenant.redis.token })
}

export async function getClient() {
  // When a tenant is in scope, that customer's own database is the one to use.
  const tenant = currentTenant()
  if (tenant && tenant.redis && tenant.redis.url && tenant.redis.token) {
    const redis = await tenantRedis(tenant)
    await assertIdentity(redis, tenant)
    return {
      get: (k) => redis.get(k),
      set: (k, v) => redis.set(k, v),
      del: (k) => redis.del(k),
      keys: (p) => redis.keys(p),
      scan: (cursor, opts) => redis.scan(cursor, opts),
    }
  }

  // No tenant in scope: single-tenant behaviour, exactly as before. This is the
  // path everything takes until the control database exists and the routes are
  // wrapped. It is also the path that disappears when the global credentials are
  // removed, at which point an unwrapped route fails loudly instead of quietly
  // reading whatever was configured globally.
  const redis = await getRedis()
  if (redis) {
    return {
      get: (k) => redis.get(k),
      set: (k, v) => redis.set(k, v),
      del: (k) => redis.del(k),
      keys: (p) => redis.keys(p),
      scan: (cursor, opts) => redis.scan(cursor, opts),
    }
  }
  // No credentials configured: fall back to the in-process store, same as the
  // generic helpers above, so local/preview runs do not crash.
  return {
    get: async (k) => (currentStore()[k] === undefined ? null : currentStore()[k]),
    set: async (k, v) => { currentStore()[k] = v },
    del: async (k) => { delete currentStore()[k]; return 1 },
    keys: async (p) => Object.keys(currentStore()).filter(k => k.startsWith(String(p).replace('*', ''))),
    scan: async (cursor, opts) => {
      const match = (opts && opts.match) || '*'
      const pre = match.replace('*', '')
      return [0, Object.keys(currentStore()).filter(k => k.startsWith(pre))]
    },
  }
}

export async function getValueChanges() {
  return await get('value_changes:all') || []
}

export async function saveValueChanges(changes) {
  await set('value_changes:all', changes)
}

export async function getScorecardEntries() {
  return await get('scorecard:entries') || []
}

export async function saveScorecardEntries(entries) {
  await set('scorecard:entries', entries)
}

export async function getTargets() {
  return await get('scorecard:targets')
}

export async function saveTargets(targets) {
  await set('scorecard:targets', targets)
}

// ─── Financials / Xero ────────────────────────────────────────────────────

export async function getProject(id) {
  const redis = await getRedis()
  if (redis) return await redis.get(`project:${id}`)
  return currentStore()[`project:${id}`] || null
}

export async function saveProject(id, data) {
  const redis = await getRedis()
  if (redis) await redis.set(`project:${id}`, data)
  else currentStore()[`project:${id}`] = data
}

export async function getAllProjectSettings() {
  const redis = await getRedis()
  if (redis) {
    const ks = await redis.keys('project:*')
    if (!ks.length) return {}
    const values = await Promise.all(ks.map(k => redis.get(k)))
    const result = {}
    ks.forEach((k, i) => { result[k.replace('project:', '')] = values[i] })
    return result
  }
  const result = {}
  Object.keys(currentStore()).forEach(k => {
    if (k.startsWith('project:')) result[k.replace('project:', '')] = currentStore()[k]
  })
  return result
}

export async function getTokens() {
  const redis = await getRedis()
  if (redis) return await redis.get('xero:tokens')
  return currentStore()['xero:tokens'] || null
}

export async function saveTokens(tokens) {
  const redis = await getRedis()
  if (redis) await redis.set('xero:tokens', tokens)
  else currentStore()['xero:tokens'] = tokens
}

export async function getCachedProjects() {
  const redis = await getRedis()
  if (redis) return await redis.get('dashboard:cache')
  return currentStore()['dashboard:cache'] || null
}

export async function getComment(projectId) {
  const redis = await getRedis()
  if (redis) return await redis.get(`comment:${projectId}`)
  return currentStore()[`comment:${projectId}`] || null
}

export async function saveComment(projectId, comment) {
  const redis = await getRedis()
  if (redis) await redis.set(`comment:${projectId}`, comment)
  else currentStore()[`comment:${projectId}`] = comment
}

export async function getAllComments() {
  const redis = await getRedis()
  if (redis) {
    const ks = await redis.keys('comment:*')
    if (!ks.length) return {}
    const values = await Promise.all(ks.map(k => redis.get(k)))
    const result = {}
    ks.forEach((k, i) => { result[k.replace('comment:', '')] = values[i] })
    return result
  }
  const result = {}
  Object.keys(currentStore()).forEach(k => {
    if (k.startsWith('comment:')) result[k.replace('comment:', '')] = currentStore()[k]
  })
  return result
}

export async function getStaff() {
  const redis = await getRedis()
  const data = redis ? await redis.get('staff:lists') : currentStore()['staff:lists']
  return data || { members: [] }
}

export async function saveStaff(data) {
  const redis = await getRedis()
  if (redis) await redis.set('staff:lists', data)
  else currentStore()['staff:lists'] = data
}

export async function getCachedInvoice(invoiceId) {
  const redis = await getRedis()
  if (redis) return await redis.get(`invoice:${invoiceId}`)
  return currentStore()[`invoice:${invoiceId}`] || null
}

export async function saveCachedInvoice(invoiceId, data) {
  const redis = await getRedis()
  if (redis) await redis.set(`invoice:${invoiceId}`, data)
  else currentStore()[`invoice:${invoiceId}`] = data
}

export async function getAllCachedInvoiceIds() {
  const redis = await getRedis()
  if (redis) {
    const ks = await redis.keys('invoice:*')
    return ks.map(k => k.replace('invoice:', ''))
  }
  return Object.keys(currentStore()).filter(k => k.startsWith('invoice:')).map(k => k.replace('invoice:', ''))
}

export function getEffectiveValuationDate(settings) {
  if (settings.valuationDateOverride) return new Date(settings.valuationDateOverride)
  if (settings.valuationDay) {
    const day = parseInt(settings.valuationDay)
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() - 1, day)
  }
  // Projects with manually-entered per-month valuation dates (no fixed day): use the
  // most recent PAST override date, so the effective date matches the dates actually
  // entered in the table rather than defaulting to end-of-month / null.
  if (settings.dateOverrides && typeof settings.dateOverrides === 'object') {
    const now = new Date()
    const dates = Object.values(settings.dateOverrides)
      .map(ov => ov && ov.valuationDate)
      .filter(Boolean)
      .map(s => new Date(s + 'T00:00:00Z'))
      .filter(d => !isNaN(d) && d <= now)
      .sort((a, b) => b - a)
    if (dates.length) return dates[0]
  }
  if (settings.valuationDate) return new Date(settings.valuationDate)
  return null
}

export function getWipEndDate() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 0)
}

// ─── Operations: Forms, Users, Submissions, Docs ───────────────────────────
// All keyed under ops:* so they're isolated from the main portal data.

// Form definitions (JSON-driven forms). Stored as an array under ops:forms.
export async function getForms() {
  return (await get('ops:forms')) || []
}
export async function saveForms(forms) {
  await set('ops:forms', forms)
}

// Operative users for the forms.rockroofing.co.uk app.
export async function getOpsUsers() {
  return (await get('ops:users')) || []
}
export async function saveOpsUsers(users) {
  await set('ops:users', users)
}

// Form submissions. One key per submission (ops:submission:<id>) for scale,
// plus an index list (ops:submissions:index) of lightweight metadata.
export async function getSubmissionIndex() {
  return (await get('ops:submissions:index')) || []
}
export async function saveSubmissionIndex(idx) {
  await set('ops:submissions:index', idx)
}
export async function getSubmission(id) {
  return await get(`ops:submission:${id}`)
}
export async function saveSubmission(id, data) {
  await set(`ops:submission:${id}`, data)
}
export async function deleteSubmission(id) {
  const redis = await getRedis()
  if (redis) { try { await redis.del(`ops:submission:${id}`) } catch {} }
  const idx = (await get('ops:submissions:index')) || []
  await set('ops:submissions:index', idx.filter(s => s.id !== id))
}

// Company documents / operative guidance / project documents.
// Grouped: category -> array of { id, title, url, projectId? }
export async function getOpsDocs() {
  return (await get('ops:docs')) || { company: [], guidance: [], project: [] }
}
export async function saveOpsDocs(docs) {
  await set('ops:docs', docs)
}

// ─── Operations: Projects (created via Internal Handover Minutes) ───────────
// Keyed by RR Project Number (e.g. "J247"). Each record holds the full handover
// data plus status (draft | active) and timestamps. Financials still come from
// Xero separately; this is the operational master record.

// ─── Operations: Projects (created via Internal Handover Minutes) ───────────
// Keyed by RR Project Number (e.g. "J247"). Financials still come from Xero;
// this is the operational master record.
export async function getOpsProjects() {
  return (await get('ops:projects')) || []
}
export async function saveOpsProjects(projects) {
  await set('ops:projects', projects)
}
export async function getOpsProject(projectNo) {
  const all = await getOpsProjects()
  return all.find(p => p.projectNo === projectNo) || null
}

// ─── Editable form templates (IHM, Pre-Start) ──────────────────────────────
// Admins edit these in the Admin area. If none saved, code defaults are used.
// Stored as { sections:[...] }. Applies to NEW forms only.
export async function getTemplate(key) {
  return (await get(`template:${key}`)) || null
}
export async function saveTemplate(key, template) {
  await set(`template:${key}`, template)
}

// ─── Portal Users (office staff logins for the portal) ─────────────────────
// Roles: 'standard' | 'management' | 'admin'. Passwords are bcrypt-hashed.
export async function getPortalUsers() {
  return (await get('portal:users')) || []
}
export async function savePortalUsers(users) {
  await set('portal:users', users)
}

// ─── Operations: Pre-Start Meeting Minutes (per project) ───────────────────
// Keyed by RR Project Number. Holds the completed Pre-Start form data.
export async function getPreStart(projectNo) {
  return (await get(`ops:prestart:${projectNo}`)) || null
}
export async function savePreStart(projectNo, data) {
  await set(`ops:prestart:${projectNo}`, data)
}

// ─── Operations: Team Members ──────────────────────────────────────────────
// Managed list of internal staff by role. Feeds IHM attendee dropdowns and the
// Project Financials page.
export async function getTeamMembers() {
  return (await get('ops:team')) || []
}
export async function saveTeamMembers(members) {
  await set('ops:team', members)
}

// ─── Operations: Manufacturer contacts address book ────────────────────────
export async function getManufacturerContacts() {
  return (await get('ops:manufacturers')) || []
}
export async function saveManufacturerContacts(list) {
  await set('ops:manufacturers', list)
}

// ─── Operations: Live Project Tasks ────────────────────────────────────────
export async function getLiveTasks() {
  return (await get('ops:tasks')) || []
}
export async function saveLiveTasks(tasks) {
  await set('ops:tasks', tasks)
}
// Project files (drawings, RAMS, handover docs). Keyed per project.
// Each entry: { id, category, name, url, contentType, size, uploadedAt }
export async function getProjectFiles(projectNo) {
  return (await get(`ops:files:${projectNo}`)) || []
}
export async function saveProjectFiles(projectNo, files) {
  await set(`ops:files:${projectNo}`, files)
}

// RAMS per-document signatures. Keyed per project, then by the RAMS file id
// (project-files generates a fresh id on every upload, so a re-upload is a new
// document with no signatures — signatures reset automatically on new version).
//   ops:rams-signatures:<projectNo> = {
//     [fileId]: { [opId]: { name, date, signedAt, statement } }
//   }
export async function getRamsSignatures(projectNo) {
  return (await get(`ops:rams-signatures:${projectNo}`)) || {}
}
export async function saveRamsSignatures(projectNo, sigs) {
  await set(`ops:rams-signatures:${projectNo}`, sigs)
}

// RAMS approval chain (per RAMS document / fileId).
//   ops:rams-approvals:<projectNo> = {
//     [fileId]: {
//       stage: 'cm'|'director'|'site-manager'|'operatives'|'complete',
//       cm:          { name, date, signedAt, signatureImg } | null,
//       director:    { name, date, signedAt, signatureImg } | null,
//       siteManager: { name, date, signedAt } | null,
//       siteManagerEmail: string,   // recipient chosen by the CM
//       token: string,              // unguessable token for the SM approval page
//       startedAt, updatedAt
//     }
//   }
export async function getRamsApprovals(projectNo) {
  return (await get(`ops:rams-approvals:${projectNo}`)) || {}
}
export async function saveRamsApprovals(projectNo, data) {
  await set(`ops:rams-approvals:${projectNo}`, data)
}

// Token → { projectNo, fileId } lookup for the tokenised Site-Manager page.
export async function getRamsToken(token) {
  return (await get(`ops:rams-token:${token}`)) || null
}
export async function saveRamsToken(token, ref) {
  await set(`ops:rams-token:${token}`, ref)
}
