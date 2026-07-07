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
