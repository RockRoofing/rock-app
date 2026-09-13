import { currentTenant } from './tenantContext'

// PER-CUSTOMER SETTINGS.
//
// Thirteen environment variables decided who an email came from, what it replied
// to, and what address the links in it pointed at. An environment variable has
// ONE value for the whole deployment, so every customer would have sent mail as
// Rock Roofing, with links into Rock's portal.
//
// Worse than embarrassing: a variation instruction or RAMS approval link is a
// token in a URL. Send another company's customer a link on Rock's domain and
// the token resolves against Rock's tenant.
//
// THE RULE, and it is the important part
// --------------------------------------
// When a customer IS in scope, their own setting is used. If they have not got
// one, this THROWS. It does not fall back to Rock's value.
//
// That is deliberate and it is the opposite of how the code read before. A
// missing setting used to quietly become 'notifications@rockroofing.co.uk'.
// A failed notification is a support call. A notification sent from the wrong
// company is a breach, and nobody finds out from a log.
//
// When NO customer is in scope - which is every request today - it reads the
// environment variable exactly as before, including the historical default. So
// nothing changes until tenancy is switched on.

function fromTenant(key) {
  const t = currentTenant()
  if (!t) return undefined          // single-tenant: fall through to env
  const v = t[key]
  if (v === undefined || v === null || v === '') {
    throw new Error(
      `Customer "${t.id}" has no ${key} configured. Refusing to fall back to another customer's value.`
    )
  }
  return v
}

// One place that knows the shape of a from-address, so a customer's own sender
// name reaches every email rather than only the ones somebody remembered.
function composeFrom(name, address) {
  if (!name) return address
  return `${name} <${address}>`
}

// --- Senders ---------------------------------------------------------------
// kind: 'notify' | 'forms' | 'accounts' | 'commercial'
//
// THESE CHAINS MIRROR THE ORIGINAL FILES EXACTLY, env var for env var and
// default for default. They are not tidied, shortened or made consistent.
//
// My first version shortened them - 'notify' became NOTIFY || NOTIFY instead of
// NOTIFY || FORMS, and 'commercial' lost ACCOUNTS and FORMS entirely. With
// NOTIFY_FROM_EMAIL unset and FORMS_FROM_EMAIL set, variation emails would have
// started arriving from onboarding@resend.dev: delivered, read, wrong sender,
// and nothing on any screen to say so.
//
// Consolidating a rule is only safe if the consolidated version is the SAME
// rule. Four near-identical chains are not one chain.
const ENV_CHAIN = {
  // pages/api/variation-send.js, pages/api/wip-lock.js
  notify: ['NOTIFY_FROM_EMAIL', 'FORMS_FROM_EMAIL'],
  // pages/api/pre-start-send.js, lib/outstandingInvoicesReport.js
  forms: ['FORMS_FROM_EMAIL'],
  // pages/api/chase-email-send.js
  accounts: ['ACCOUNTS_FROM_EMAIL'],
  // pages/api/application-send.js
  commercial: ['COMMERCIAL_FROM_EMAIL', 'ACCOUNTS_FROM_EMAIL', 'FORMS_FROM_EMAIL'],
}
const LEGACY_FROM = {
  notify: 'Rock Roofing <onboarding@resend.dev>',
  forms: 'Rock Roofing <onboarding@resend.dev>',
  accounts: 'Rock Roofing <onboarding@resend.dev>',
  commercial: 'Rock Roofing Commercial <onboarding@resend.dev>',
}

export function fromEmail(kind = 'notify') {
  const t = currentTenant()
  if (t) {
    // One verified sending domain, per-customer sender NAME. A subdomain per
    // customer means a DNS job each time and spreads sending reputation across
    // many new domains, which is worse for deliverability than one domain with
    // a long clean history.
    const address = fromTenant('sendingAddress')
    const name = fromTenant('senderName')
    return composeFrom(name, address)
  }
  for (const name of (ENV_CHAIN[kind] || ENV_CHAIN.notify)) {
    if (process.env[name]) return process.env[name]
  }
  return LEGACY_FROM[kind] || LEGACY_FROM.notify
}

// Where a reply goes. The customer's own address, so a subcontractor hitting
// reply writes to them and not to us.
export function replyTo() {
  const t = currentTenant()
  if (t) return fromTenant('replyTo')
  return process.env.FORMS_REPLY_TO || 'notifications@rockroofing.co.uk'
}

export function alertEmail() {
  const t = currentTenant()
  if (t) return fromTenant('replyTo')
  return process.env.ALERT_EMAIL || process.env.FORMS_REPLY_TO || 'notifications@rockroofing.co.uk'
}

// --- Addresses -------------------------------------------------------------
// Every link in an outgoing email is built from the CUSTOMER'S OWN address,
// resolved at send time. Never from an environment variable, because that has
// one value for everybody.
export function baseUrl() {
  const t = currentTenant()
  if (t) {
    const hosts = t.hosts || []
    if (!hosts.length) throw new Error(`Customer "${t.id}" has no hosts configured.`)
    return `https://${hosts[0]}`
  }
  return process.env.PORTAL_BASE_URL || process.env.APP_URL || process.env.PORTAL_URL || 'https://app.rockroofing.co.uk'
}

export function ramsApproveOrigin() {
  const t = currentTenant()
  if (t) return baseUrl()
  return process.env.RAMS_APPROVE_ORIGIN || baseUrl()
}

// The Site App. A second-level subdomain is not covered by a wildcard
// certificate, so new customers reach it as a path on their own address rather
// than needing a certificate each.
export function siteAppUrl() {
  const t = currentTenant()
  if (t) return t.siteAppUrl || `${baseUrl()}/forms`
  return process.env.FORMS_URL || 'https://siteapp.rockroofing.co.uk'
}

// The customer's logo, for documents and emails.
export function logoUrl() {
  const t = currentTenant()
  if (t) return t.logoUrl || ''
  return process.env.LOGO_URL || ''
}

// The customer's display name, for email bodies and document headers.
export function companyName() {
  const t = currentTenant()
  if (t) return fromTenant('name')
  return 'Rock Roofing Ltd'
}
