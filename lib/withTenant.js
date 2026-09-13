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
import { tenantForHost, tenancyEnabled, isPlatformHost, PLATFORM_TENANT } from './tenants'
import { verifySessionToken, SESSION_COOKIE } from './portalAuth'

function readCookie(req, name) {
  const raw = (req.headers && req.headers.cookie) || ''
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

function sessionBelongsTo(req, tenantId) {
  const raw = readCookie(req, SESSION_COOKIE)
  if (!raw) return false
  return !!verifySessionToken(raw, tenantId)
}

export default function withTenant(handler) {
  return async function wrapped(req, res) {
    // Dormant until TENANCY_ENABLED is set to 1. Having the control database
    // credentials is NOT enough - see the note in lib/tenants.js.
    if (!tenancyEnabled()) return handler(req, res)

    const host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || ''

    // The platform address belongs to no customer. It must not 404, and a
    // session issued there must not work anywhere else - which is why it carries
    // a reserved id rather than nothing.
    if (isPlatformHost(host)) {
      if (!sessionBelongsTo(req, PLATFORM_TENANT)) {
        return res.status(401).json({ error: 'Not signed in to the platform' })
      }
      return runWithTenant({ id: PLATFORM_TENANT, name: 'Platform', platform: true }, () => handler(req, res))
    }

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

    // AUTHENTICATION IS TENANT-SCOPED TOO, not just data access.
    //
    // Without this, a valid cookie from one customer's site verifies on
    // another's - same secret, same signature - and everything downstream
    // behaves perfectly while serving the wrong company's data to the wrong
    // company's user. One place, covering every wrapped route.
    //
    // Only enforced where a session is actually present. Routes with no session
    // at all - the signed public links, the login page - are handled by their
    // own checks.
    const raw = readCookie(req, SESSION_COOKIE)
    if (raw && !sessionBelongsTo(req, tenant.id)) {
      return res.status(401).json({ error: 'This sign-in is not valid for this address. Please sign in again.' })
    }

    return runWithTenant(tenant, () => handler(req, res))
  }
}
