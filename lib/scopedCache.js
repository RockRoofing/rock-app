import { currentTenantId } from './tenantContext'

// A CACHE THAT CANNOT BE SHARED BETWEEN CUSTOMERS.
//
// THE PROBLEM
// -----------
// A serverless function stays warm and serves many requests. Anything cached at
// module scope therefore outlives the request that put it there.
//
// For an access token that is the worst possible thing to cache globally. Four
// files did it:
//
//   lib/msGraph.js    let cachedToken = null    Microsoft Graph token
//   lib/crm8x8.js     let cachedToken = null    8x8 token
//   lib/pipedrive.js  let _pipelineId = null    Pipedrive pipeline id
//   lib/db.js         let store = {}            in-memory data fallback
//
// Once each customer has their own Microsoft app, one company's Graph token
// cached at module scope would be handed to the next request that came in - and
// used to read another company's mailboxes. Nothing about that fails or errors.
// It just quietly works, on the wrong data.
//
// No wrapper fixes this. withTenant scopes the REQUEST; these live outside it.
//
// THE FIX
// -------
// The cache is a map keyed by whichever customer is in scope. Same code, one
// slot each, no possibility of one reading another's.
//
// While the app is single-tenant, currentTenantId() is null and everything uses
// one slot called 'single'. So behaviour today is exactly what it was.
//
// WHAT THIS DOES NOT FIX
// ----------------------
// The CREDENTIALS are still global - MS_CLIENT_SECRET and the rest come from
// environment variables, one set for the whole deployment. Keying the cache
// stops one customer being handed another's cached token. It does not yet give
// each customer their own credentials. That is the separate job of moving 13
// environment variables into per-customer settings, and it has to happen before
// a second customer connects anything.

export function createScopedCache() {
  const byTenant = new Map()
  const slot = () => currentTenantId() || 'single'
  return {
    get() { return byTenant.get(slot()) },
    set(value) { byTenant.set(slot(), value); return value },
    clear() { byTenant.delete(slot()) },
    clearAll() { byTenant.clear() },
    // For diagnostics only. Never log the values - they are tokens.
    size() { return byTenant.size },
  }
}

// Same idea for a key/value store rather than a single value.
export function createScopedStore() {
  const byTenant = new Map()
  const slot = () => currentTenantId() || 'single'
  const own = () => {
    const k = slot()
    let m = byTenant.get(k)
    if (!m) { m = {}; byTenant.set(k, m) }
    return m
  }
  return {
    get(key) { const v = own()[key]; return v === undefined ? null : v },
    set(key, value) { own()[key] = value },
    del(key) { delete own()[key] },
    keys(prefix) { return Object.keys(own()).filter(k => k.startsWith(String(prefix || '').replace('*', ''))) },
  }
}
