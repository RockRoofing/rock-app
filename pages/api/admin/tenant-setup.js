import { requireRole } from '../../../lib/portalAuth'
import { getClient } from '../../../lib/db'
import { saveTenant, tenantForHost, allTenants, registryConfigured, tenancyEnabled } from '../../../lib/tenants'

// TENANT SETUP - admin only, and deliberately manual for now.
//
// Three things it does:
//
//   GET                 report what is configured, so you can see the state
//                       before changing anything
//   POST identity       write the tenant:identity record into the CURRENT
//                       database - the label the self-check compares against
//   POST register       write a customer's record into the control database
//
// The identity label and the registry entry are the two halves of the self-check.
// Both have to say the same thing or getClient() refuses to serve that database.
// Write the identity FIRST, then the registry entry - in that order nothing is
// ever pointed at a database that cannot prove who it is.
//
// Not wired to any page. Called by hand, once per customer, until provisioning
// replaces it.
export default async function handler(req, res) {
  if (!requireRole(req, res, ['admin'])) return

  if (req.method === 'GET') {
    const redis = await getClient()
    let identity = null
    try { identity = await redis.get('tenant:identity') } catch {}
    let registered = []
    if (registryConfigured()) {
      try { registered = (await allTenants()).map(t => ({ id: t.id, name: t.name, hosts: t.hosts, modules: t.modules })) } catch (e) {
        return res.status(500).json({ error: 'Control database unreachable: ' + e.message })
      }
    }
    return res.json({
      controlDatabaseConfigured: registryConfigured(),
      tenancyEnabled: tenancyEnabled(),
      identityOfCurrentDatabase: identity,
      registeredTenants: registered,
      resolvedForThisHost: registryConfigured()
        ? ((await tenantForHost(req.headers.host).catch(() => null)) || null)
        : null,
    })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' })

  const { action, id, name } = req.body || {}

  // Stamp the database this request is already talking to.
  if (action === 'identity') {
    if (!id) return res.status(400).json({ error: 'id required' })
    const redis = await getClient()
    const existing = await redis.get('tenant:identity').catch(() => null)
    if (existing && existing.id && String(existing.id) !== String(id)) {
      // Changing an identity re-points a database at a different customer. That
      // is never a thing to do by accident.
      return res.status(409).json({
        error: `This database already identifies as "${existing.id}". Refusing to change it to "${id}".`,
      })
    }
    const rec = { id: String(id), name: name || String(id), setAt: new Date().toISOString() }
    await redis.set('tenant:identity', rec)
    return res.json({ ok: true, identity: rec })
  }

  // Write a customer into the control database.
  if (action === 'register') {
    if (!registryConfigured()) return res.status(400).json({ error: 'Control database not configured' })
    const rec = req.body.tenant
    if (!rec || !rec.id) return res.status(400).json({ error: 'tenant record with an id required' })
    if (!Array.isArray(rec.hosts) || !rec.hosts.length) return res.status(400).json({ error: 'tenant.hosts required' })
    if (!rec.redis || !rec.redis.url || !rec.redis.token) return res.status(400).json({ error: 'tenant.redis.url and .token required' })
    const saved = await saveTenant({
      timezone: 'Europe/London',
      currency: 'GBP',
      locale: 'UK',
      active: true,
      ...rec,
    })
    // Never echo credentials back.
    const { redis: _omit, ...safe } = saved
    return res.json({ ok: true, tenant: safe })
  }

  return res.status(400).json({ error: "action must be 'identity' or 'register'" })
}
