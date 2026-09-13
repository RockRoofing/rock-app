import { runWithTenant } from './tenantContext'
import { allTenants, registryConfigured } from './tenants'
import { getClient } from './db'

// RUN A CRON ONCE PER CUSTOMER.
//
//     import forEachTenant from '../../../lib/forEachTenant'
//     export default forEachTenant('wip-sync', handler)
//
// WHY CRONS CANNOT USE withTenant
// -------------------------------
// withTenant works out the customer from the web address the request came to.
// A cron has no meaningful address - Vercel calls it on the deployment URL.
// Wrapping a cron would therefore bind it to whichever host it happened to be
// called on, which in practice means every cron runs as the first customer,
// forever, and never runs for anyone else. Silently. The sync would simply stop
// for everybody except one company and nothing would say so.
//
// So a cron loops instead.
//
// EACH ITERATION IS ISOLATED
// --------------------------
// One customer's expired Xero token must not stop the job for everyone else.
// Every iteration is caught separately, its result recorded, and the loop
// continues. The response reports per-customer success or failure so a partial
// run is visible rather than looking like a whole one.
//
// THE RESPONSE PROBLEM
// --------------------
// Each handler calls res.json() itself. Called in a loop it would try to send
// the response once per customer, and every call after the first throws
// "headers already sent". So each iteration gets its own CAPTURING response
// that records what the handler tried to send, and one combined response is
// sent at the end.
//
// HEARTBEATS
// ----------
// Every run records cron:last:<name> in that customer's own database: when it
// started, how long it took, whether it worked, and the error if not. Nothing
// reads these yet - the monitoring page comes later - but a job that has never
// recorded anything is the only way to spot one that has silently stopped, and
// the recording has to start before it is useful.

// A response object that captures instead of sending.
function captureRes() {
  const cap = { statusCode: 200, body: undefined, headers: {} }
  const api = {
    status(code) { cap.statusCode = code; return api },
    json(obj) { cap.body = obj; return api },
    send(obj) { cap.body = obj; return api },
    end(obj) { if (obj !== undefined) cap.body = obj; return api },
    setHeader(k, v) { cap.headers[k] = v; return api },
    getHeader(k) { return cap.headers[k] },
    removeHeader(k) { delete cap.headers[k]; return api },
    write() { return true },
    on() { return api }, once() { return api }, emit() { return api },
    removeListener() { return api },
  }
  Object.defineProperty(api, 'statusCode', {
    get: () => cap.statusCode,
    set: (v) => { cap.statusCode = v },
  })
  return { api, cap }
}

async function heartbeat(name, entry) {
  try {
    const redis = await getClient()
    await redis.set(`cron:last:${name}`, entry)
  } catch {
    // A heartbeat that cannot be written must never fail the job it is watching.
  }
}

export default function forEachTenant(name, handler) {
  return async function wrapped(req, res) {
    // Single-tenant, as today. Still records a heartbeat, so the history starts
    // now rather than when multi-tenancy lands.
    if (!registryConfigured()) {
      const started = Date.now()
      const { api, cap } = captureRes()
      let ok = true, error = null
      try {
        await handler(req, api)
        if (cap.statusCode >= 400) { ok = false; error = (cap.body && cap.body.error) || `status ${cap.statusCode}` }
      } catch (e) {
        ok = false; error = (e && e.message) || 'failed'
      }
      await heartbeat(name, {
        startedAt: new Date(started).toISOString(),
        ms: Date.now() - started, ok, error, result: cap.body ?? null,
      })
      if (!ok && error) return res.status(cap.statusCode >= 400 ? cap.statusCode : 500).json({ ok: false, error, result: cap.body ?? null })
      return res.status(cap.statusCode).json(cap.body ?? { ok: true })
    }

    let tenants = []
    try {
      tenants = await allTenants()
    } catch (e) {
      // The registry itself is unreachable. Say so rather than running nothing
      // and reporting success, which is how a stopped sync stays hidden.
      return res.status(503).json({ ok: false, error: 'Registry unreachable: ' + (e && e.message) })
    }

    const results = []
    for (const tenant of tenants) {
      const started = Date.now()
      const { api, cap } = captureRes()
      let ok = true, error = null
      try {
        await runWithTenant(tenant, () => handler(req, api))
        if (cap.statusCode >= 400) { ok = false; error = (cap.body && cap.body.error) || `status ${cap.statusCode}` }
      } catch (e) {
        ok = false; error = (e && e.message) || 'failed'
      }
      const entry = {
        startedAt: new Date(started).toISOString(),
        ms: Date.now() - started, ok, error, result: cap.body ?? null,
      }
      // Written inside the tenant's own scope so it lands in their database.
      try { await runWithTenant(tenant, () => heartbeat(name, entry)) } catch {}
      results.push({ tenant: tenant.id, ok, ms: entry.ms, error, result: cap.body ?? null })
    }

    const failed = results.filter(r => !r.ok)
    return res.status(200).json({
      cron: name,
      tenants: results.length,
      succeeded: results.length - failed.length,
      failed: failed.length,
      // A 200 with failures inside is deliberate: the JOB ran. Returning 500
      // because one customer out of forty failed would make Vercel report the
      // whole cron as broken and hide the other thirty-nine that worked.
      results,
    })
  }
}
