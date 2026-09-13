// WRAP EVERY API ROUTE IN THIS.
//
//     import withTenant from '../../lib/withTenant'
//     export default withTenant(async function handler(req, res) { ... })
//
// It works out which customer the request is for from the web address it came
// to, and puts that customer in request-scoped storage for the duration of the
// handler. getClient() reads it back from there, so nothing inside the handler
// changes and no helper needs a new argument.
//
// WHY A WRAPPER RATHER THAN PASSING THE REQUEST DOWN
// --------------------------------------------------
// getClient() is called from roughly 200 places, many inside helpers that never
// see the request - mergeCosts, readRegistry, loadRates. Passing it down means
// changing those signatures and everything that calls them. One line at the top
// of each route does not spread.
//
// It is also the safer failure. A route that was never wrapped resolves no
// customer, and once the global database credentials are removed it will find no
// credentials and error on first use. A missed route becomes a broken page
// rather than a page quietly serving the wrong company's data.
//
// WHILE THE REGISTRY IS NOT CONFIGURED this does nothing at all - it calls the
// handler straight through. So routes can be wrapped in batches, deployed, and
// verified while the app is still single-tenant and behaving exactly as it did.

import { runWithTenant } from './tenantContext'
import { tenantForHost, registryConfigured } from './tenants'

export default function withTenant(handler) {
  return async function wrapped(req, res) {
    // Dormant until a control database exists. Current behaviour, unchanged.
    if (!registryConfigured()) return handler(req, res)

    const host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || ''
    let tenant = null
    try {
      tenant = await tenantForHost(host)
    } catch (e) {
      // The registry could not be read AND nothing was cached. Fail the request
      // rather than guess. Guessing is how one customer sees another's data.
      console.error('Tenant resolution failed for host', host, e && e.message)
      return res.status(503).json({ error: 'Service temporarily unavailable' })
    }

    if (!tenant) {
      // An address nobody owns. Say so plainly. Do NOT fall back to a default
      // customer - a default is exactly the silent wrong-data failure this whole
      // design exists to prevent.
      console.error('No tenant for host', host)
      return res.status(404).json({ error: 'Unknown address' })
    }

    return runWithTenant(tenant, () => handler(req, res))
  }
}
