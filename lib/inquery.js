import crypto from 'crypto'

// IN QUERY - the state the portal keeps ALONGSIDE Xero.
//
// Xero holds the cost and the fact it is tagged to the In Query tracking option.
// Everything else - who is answering it, whether they have approved it, what they
// said - is ours, and lives under one key.
//
//   bookkeeping:inquery = {
//     [invoiceKey]: {
//       assignee: { name, email, userId },     // portal user OR typed in by hand
//       status:   'query' | 'approved',
//       comments: [ { by, body, at } ],
//       updatedAt, approvedAt, approvedBy,
//     }
//   }
//
// KEYED BY INVOICE, NOT BY LINE. The table groups an invoice's lines into one row and
// a person answers the invoice, not each line of it. Keying by line would ask the
// same question five times and let one invoice be half approved.
//
// Nothing here deletes itself. When the bookkeeper re-tags a cost to a real project
// in Xero it stops arriving as In Query and simply stops appearing - the record stays
// so the Approved view can still show what was said about it.
export const INQUERY_KEY = 'bookkeeping:inquery'

// date|supplier|reference - the same grouping the Costs tab on a project uses. Not
// the Xero invoice id, because the bookkeeping feed does not carry one.
export function invoiceKeyOf(row) {
  if (!row) return ''
  return [row.date || '', row.supplier || row.contact || '', row.reference || row.invoiceNumber || ''].join('|')
}

// The same env vars variationInstruct.js signs with, so there is one secret to set in
// Vercel rather than a second one nobody knows about until links stop verifying.
const SECRET = () => process.env.PORTAL_SECRET || process.env.SESSION_SECRET || 'rock-portal-dev-secret'
const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sign = (body) => crypto.createHmac('sha256', SECRET()).update(body).digest('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// The review link has to work for somebody who has no portal account - a manually
// added name with an email address. So the token IS the authentication: signed, tied
// to one email, and it expires.
// Carries the customer, and is checked against the one resolved from the
// address. Passed in rather than read from request-scoped storage: this file is
// imported by components/InQueryTable.js, so a tenantContext import would drag
// async_hooks into the browser bundle and break the build. Same reason as the variation link: one signing secret across every
// customer means a link from one verifies on another's site.
export function createReviewToken({ email, tenantId = null, days = 60 }) {
  const body = b64url(JSON.stringify({
    e: String(email || '').toLowerCase(),
    t: tenantId || null,
    exp: Date.now() + days * 86400000,
  }))
  return `${body}.${sign(body)}`
}

export function verifyReviewToken(token, expectedTenantId = null) {
  if (!token || !String(token).includes('.')) return null
  const [body, sig] = String(token).split('.')
  if (sign(body) !== sig) return null
  try {
    const p = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    if (!p.exp || p.exp < Date.now()) return null
    if (expectedTenantId && String(p.t || '') !== String(expectedTenantId)) return null
    return { email: p.e, tenant: p.t || null }
  } catch { return null }
}

// A cost is IN QUERY until somebody says otherwise. An invoice nobody has touched
// still needs answering, so the absence of a record means query, not approved.
export function statusOf(state, key) {
  const r = state && state[key]
  return (r && r.status === 'approved') ? 'approved' : 'query'
}
