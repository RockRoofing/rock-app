// THE CUSTOMER REGISTRY.
//
// A small control database holding nothing but the list of customers: which web
// address is whose, where their data lives, what they have bought. No customer
// DATA is ever in here - only routing and settings. Each customer's projects,
// applications, financials and people live in their own separate database, and
// that separation is the isolation wall. This file is the index to it.
//
// SHAPE OF A RECORD, stored at tenant:<id> in the control database:
//
//   {
//     id: 'rock',
//     name: 'Rock Roofing Ltd',
//     hosts: ['app.rockroofing.co.uk', 'siteapp.rockroofing.co.uk'],
//     redis: { url: '...', token: '...' },
//     timezone: 'Europe/London',
//     currency: 'GBP',
//     locale: 'UK',
//     modules: ['operations','commercial','pre-contract','bookkeeping', ...],
//     senderName: 'Rock Roofing',
//     replyTo: 'notifications@rockroofing.co.uk',
//     logoUrl: '...',
//     active: true,
//   }
//
// The host list is also mirrored at tenant-host:<host> -> <id> so a lookup is one
// read rather than a scan of every customer.

import { Redis } from '@upstash/redis'

// The ONE place outside lib/db.js allowed to build a Redis client, and it only
// ever reaches the control database - never a customer's data. Kept separate on
// purpose: getClient() must not be able to reach the registry's credentials, and
// this must not be able to reach a customer's.
function controlClient() {
  const url = process.env.CONTROL_REDIS_URL
  const token = process.env.CONTROL_REDIS_TOKEN
  if (!url || !token) return null
  try { return new Redis({ url, token }) } catch { return null }
}

// Is the registry configured at all? While this is false the app runs exactly as
// it did before - single tenant, global credentials. That is what makes this
// package deployable with nothing visible changing.
export function registryConfigured() {
  return !!(process.env.CONTROL_REDIS_URL && process.env.CONTROL_REDIS_TOKEN)
}

// ---------------------------------------------------------------------------
// Cache
//
// The registry is tiny and barely changes, so it is held in memory for a short
// while. This is safe to keep at module scope - unlike a cache of customer DATA,
// which is not - because it is the same list for everyone. It is the index, not
// the contents.
//
// TWO RULES THAT MATTER MORE THAN THEY LOOK:
//
//   1. A FAILURE IS NEVER CACHED. "I could not reach the registry" and "that
//      customer does not exist" are different answers. Caching the first turns a
//      two-second blip into a poisoned instance that keeps refusing for the full
//      cache period. This is the bug that actually bites people in this design.
//
//   2. STALE IS SERVED ON ERROR. If the control database cannot be reached, the
//      last known copy keeps being used rather than failing. An outage then means
//      "you cannot add a customer or change a module for a few minutes", which
//      nobody using the app notices, instead of everybody being locked out.
// ---------------------------------------------------------------------------
const TTL_MS = 60 * 1000
let cache = { at: 0, byHost: null, byId: null }

async function loadAll() {
  const c = controlClient()
  if (!c) return null
  const ids = []
  let cursor = 0
  do {
    const [next, batch] = await c.scan(cursor, { match: 'tenant:*', count: 200 })
    cursor = Number(next) || 0
    for (const k of batch || []) ids.push(k)
  } while (cursor !== 0)

  const byId = {}, byHost = {}
  for (const key of ids) {
    const rec = await c.get(key)
    if (!rec || !rec.id) continue
    if (rec.active === false) continue
    byId[rec.id] = rec
    for (const h of rec.hosts || []) byHost[String(h).toLowerCase()] = rec
  }
  return { byId, byHost }
}

async function registry() {
  const fresh = Date.now() - cache.at < TTL_MS
  if (fresh && cache.byId) return cache

  let loaded = null
  try {
    loaded = await loadAll()
  } catch (e) {
    // Rule 2. Keep serving what we had.
    if (cache.byId) return cache
    throw e
  }
  if (!loaded) {
    if (cache.byId) return cache
    // Rule 1. Nothing loaded and nothing cached: do NOT write an empty cache,
    // or every later request inside the TTL gets the same empty answer.
    return { at: 0, byId: {}, byHost: {} }
  }
  cache = { at: Date.now(), ...loaded }
  return cache
}

// Strip port and any leading www.
function normHost(host) {
  return String(host || '').toLowerCase().split(':')[0].replace(/^www\./, '')
}

export async function tenantForHost(host) {
  const h = normHost(host)
  if (!h) return null
  const reg = await registry()
  return reg.byHost[h] || null
}

export async function tenantById(id) {
  if (!id) return null
  const reg = await registry()
  return reg.byId[id] || null
}

export async function allTenants() {
  const reg = await registry()
  return Object.values(reg.byId)
}

// For the platform admin and for provisioning. Writes the record and its host
// index together so the two cannot drift apart.
export async function saveTenant(rec) {
  const c = controlClient()
  if (!c) throw new Error('Control database not configured')
  if (!rec || !rec.id) throw new Error('Tenant record needs an id')
  const existing = await c.get(`tenant:${rec.id}`).catch(() => null)
  // Remove host pointers this record no longer claims.
  for (const h of (existing && existing.hosts) || []) {
    if (!(rec.hosts || []).map(x => normHost(x)).includes(normHost(h))) {
      await c.del(`tenant-host:${normHost(h)}`)
    }
  }
  await c.set(`tenant:${rec.id}`, rec)
  for (const h of rec.hosts || []) await c.set(`tenant-host:${normHost(h)}`, rec.id)
  cache = { at: 0, byHost: null, byId: null }   // force a reload
  return rec
}

// Drop the cache. Used after provisioning so a new customer works immediately
// rather than after the TTL.
export function invalidateRegistry() {
  cache = { at: 0, byHost: null, byId: null }
}
