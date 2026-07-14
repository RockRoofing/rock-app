let store = {}

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
  return store[key] || null
}

export async function set(key, value) {
  const redis = await getRedis()
  if (redis) await redis.set(key, value)
  else store[key] = value
}

export async function keys(pattern) {
  const redis = await getRedis()
  if (redis) return await redis.keys(pattern)
  return Object.keys(store).filter(k => {
    const p = pattern.replace('*', '')
    return k.startsWith(p)
  })
}

// ─── Sales / Pipedrive ─────────────────────────────────────────────────────

export async function getCachedDeals() {
  return await get('pipedrive:deals')
}

export async function saveCachedDeals(deals) {
  await set('pipedrive:deals', deals)
}

export async function getLastSync() {
  return await get('pipedrive:last_sync')
}

export async function saveLastSync(ts) {
  await set('pipedrive:last_sync', ts)
}

export async function getFieldMap() {
  return await get('pipedrive:field_map')
}

export async function saveFieldMap(map) {
  await set('pipedrive:field_map', map)
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
  return store[`project:${id}`] || null
}

export async function saveProject(id, data) {
  const redis = await getRedis()
  if (redis) await redis.set(`project:${id}`, data)
  else store[`project:${id}`] = data
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
  Object.keys(store).forEach(k => {
    if (k.startsWith('project:')) result[k.replace('project:', '')] = store[k]
  })
  return result
}

export async function getTokens() {
  const redis = await getRedis()
  if (redis) return await redis.get('xero:tokens')
  return store['xero:tokens'] || null
}

export async function saveTokens(tokens) {
  const redis = await getRedis()
  if (redis) await redis.set('xero:tokens', tokens)
  else store['xero:tokens'] = tokens
}

export async function getCachedProjects() {
  const redis = await getRedis()
  if (redis) return await redis.get('dashboard:cache')
  return store['dashboard:cache'] || null
}

export async function getComment(projectId) {
  const redis = await getRedis()
  if (redis) return await redis.get(`comment:${projectId}`)
  return store[`comment:${projectId}`] || null
}

export async function saveComment(projectId, comment) {
  const redis = await getRedis()
  if (redis) await redis.set(`comment:${projectId}`, comment)
  else store[`comment:${projectId}`] = comment
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
  Object.keys(store).forEach(k => {
    if (k.startsWith('comment:')) result[k.replace('comment:', '')] = store[k]
  })
  return result
}

export async function getStaff() {
  const redis = await getRedis()
  const data = redis ? await redis.get('staff:lists') : store['staff:lists']
  return data || { members: [] }
}

export async function saveStaff(data) {
  const redis = await getRedis()
  if (redis) await redis.set('staff:lists', data)
  else store['staff:lists'] = data
}

export async function getCachedInvoice(invoiceId) {
  const redis = await getRedis()
  if (redis) return await redis.get(`invoice:${invoiceId}`)
  return store[`invoice:${invoiceId}`] || null
}

export async function saveCachedInvoice(invoiceId, data) {
  const redis = await getRedis()
  if (redis) await redis.set(`invoice:${invoiceId}`, data)
  else store[`invoice:${invoiceId}`] = data
}

export async function getAllCachedInvoiceIds() {
  const redis = await getRedis()
  if (redis) {
    const ks = await redis.keys('invoice:*')
    return ks.map(k => k.replace('invoice:', ''))
  }
  return Object.keys(store).filter(k => k.startsWith('invoice:')).map(k => k.replace('invoice:', ''))
}

export function getEffectiveValuationDate(settings) {
  if (settings.valuationDateOverride) return new Date(settings.valuationDateOverride)
  if (settings.valuationDay) {
    const day = parseInt(settings.valuationDay)
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() - 1, day)
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
