// Resolves the "people" for a project — the internal team (CM, OM, QS, Estimator,
// etc.) and the customer contacts — from the Internal Handover Minutes (IHM),
// with a per-project commercial-portal OVERRIDE layer on top.
//
// Resolution order for each field: commercial override → IHM value → blank.
// Commercial overrides NEVER write back to the IHM. If the IHM is completed after
// a Xero project already exists, these values simply start resolving on the next
// read (nothing is copied), so it "catches up" automatically.
//
// IHM projects live in redis key 'ops:projects' as [{ projectNo, data:{...} }].
// Commercial overrides live per Xero project in its settings under
// settings.peopleOverride = { estimator, contractsManager, operationsManager,
//   quantitySurveyor, customerContacts:[...] }.
// Portal users (name -> email/phone) come from the shared people list so team
// names chosen in the IHM resolve to a contactable email/phone.

// Roles resolved from the Ops project record (IHM / Ops > Projects > Project Details).
// designManager and siteSupervisor were captured in Ops but had no route through to
// the commercial portal, so changing them there had no visible effect.
const ROLE_KEYS = ['estimator', 'contractsManager', 'operationsManager', 'quantitySurveyor', 'designManager', 'siteSupervisor']

function normJob(v) {
  // Match a Xero jobNo to an IHM projectNo tolerantly (trim, strip a leading
  // "J"/"#", collapse case). Both are RR project numbers so usually identical.
  return String(v || '').trim().replace(/^[#jJ]/, '').replace(/\s+/g, '').toLowerCase()
}

// Build a name -> {email, phone} map from portal users.
export function buildUserLookup(users = []) {
  const map = {}
  for (const u of users) {
    const name = ([u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || '').trim()
    if (name) map[name.toLowerCase()] = { name, email: u.email || '', phone: u.phone || '' }
  }
  return map
}

// Find the IHM project record for a given Xero jobNo.
export function findIhmByJob(opsProjects = [], jobNo) {
  const key = normJob(jobNo)
  if (!key) return null
  return opsProjects.find(p => normJob(p.projectNo) === key) || null
}

// Resolve a person (name string) to { name, email, phone } via portal users.
function enrich(name, userLookup) {
  const n = String(name || '').trim()
  if (!n) return { name: '', email: '', phone: '' }
  const hit = userLookup[n.toLowerCase()]
  return { name: n, email: hit?.email || '', phone: hit?.phone || '' }
}

// Main resolver. Returns:
//   { team: { estimator, contractsManager, operationsManager, quantitySurveyor }  (each {name,email,phone})
//     customerContacts: [{ title, name, email, phone }],
//     customerQS: { name, email, phone } | null,
//     hasIhm: bool }
export function resolveProjectPeople({ jobNo, opsProjects = [], users = [], override = {} }) {
  const userLookup = buildUserLookup(users)
  const ihm = findIhmByJob(opsProjects, jobNo)
  const d = ihm?.data || {}
  const ov = override || {}

  const team = {}
  for (const key of ROLE_KEYS) {
    // commercial override name wins, else IHM name, else blank — then enrich.
    // An override key that EXISTS wins — even an empty string, which means the
    // field was deliberately cleared and must NOT fall back to the IHM.
    const name = (ov[key] !== undefined) ? (ov[key] || '') : (d[key] || '')
    team[key] = enrich(name, userLookup)
  }

  // Customer contacts: override list wins if present, else IHM site contacts.
  // If the override is an array at all (even empty), it wins — an empty array
  // means the contacts were deliberately cleared, so don't fall back to the IHM.
  let customerContacts = Array.isArray(ov.customerContacts)
    ? ov.customerContacts
    : (Array.isArray(d.siteContacts) ? d.siteContacts : [])
  customerContacts = customerContacts
    .map(c => ({ title: c.title || '', name: c.name || '', email: c.email || '', phone: c.phone || '' }))
    .filter(c => c.name || c.email)

  // Customer QS = the contact whose title is Quantity Surveyor (or QS).
  const qsMatch = customerContacts.find(c => /quantity\s*surveyor|(^|\W)qs(\W|$)/i.test(c.title || ''))
  const customerQS = qsMatch ? { name: qsMatch.name, email: qsMatch.email, phone: qsMatch.phone } : null

  // Scalar fields that also follow override → IHM → blank. Retention in the IHM
  // is free text (e.g. "5%" or "5"); parse to a fraction (0.05) for the commercial
  // side, which stores retentionPct as a fraction.
  const pick = (ovKey, ihmKey) => (ov[ovKey] !== undefined) ? (ov[ovKey] || '') : (d[ihmKey] || '')
  const projectAddress = pick('projectAddress', 'projectAddress')
  const orderRef = pick('orderRef', 'customerOrderRef')
  const customerCompany = (ov.customerCompany !== undefined) ? (ov.customerCompany || '') : (d.customerCompany || '')
  const customerAddress = (ov.customerAddress !== undefined) ? (ov.customerAddress || '') : (d.customerAddress || '')
  const retentionPct = resolveRetention(ov.retentionPct, d.retention, ov)
  // MCD follows the same route: commercial override -> IHM -> nothing. Kept as a
  // PERCENTAGE here (2.5 means 2.5%), not a fraction, because that is how applications
  // store mcdPct and how the field is entered on both screens. Retention is a fraction
  // for historical reasons and the two are easy to confuse - hence saying so here.
  const mcdPct = resolveMcd(ov.mcdPct, d.discount, ov)

  return {
    team,
    customerContacts,
    customerQS,
    projectAddress,
    orderRef,
    customerCompany,
    customerAddress,
    retentionPct,          // fraction (0.05) or null
    mcdPct,                // PERCENTAGE (2.5) or null - not a fraction
    ihmMcdRaw: d.discount || '',
    ihmRetentionRaw: d.retention || '',
    hasIhm: !!ihm,
  }
}

// Parse a fraction from either an explicit override (already a fraction) or the
// IHM's free-text retention (e.g. "5", "5%", "5 %"). Returns null if neither.
// If the override key EXISTS (ov passed and key present), it wins — an empty
// override means "cleared" and must not fall back to the IHM.
function resolveRetention(ovVal, ihmRaw, ov) {
  const hasOvKey = ov && Object.prototype.hasOwnProperty.call(ov, 'retentionPct')
  if (hasOvKey) {
    if (ovVal === '' || ovVal == null) return null   // deliberately cleared
    const n = parseFloat(ovVal)
    return isNaN(n) ? null : n
  }
  if (ihmRaw != null && ihmRaw !== '') {
    const m = String(ihmRaw).match(/-?\d+(\.\d+)?/)
    if (m) {
      const n = parseFloat(m[0])
      if (!isNaN(n)) return n / 100     // IHM text is a percentage -> fraction
    }
  }
  return null
}

export { ROLE_KEYS }

// MCD, override -> IHM -> null. Returned as a percentage, not a fraction, to match how
// applications store mcdPct. The IHM field used to be free text called "Discount", so
// values like "2.5%" or "MCD 2.5" exist on older handovers; the number is pulled out of
// whatever is there rather than demanding it be clean.
//
// ZERO IS A REAL ANSWER and must survive. An earlier version of this used a falsy check
// and turned 0% into "not set", which would have sent the retention register looking for
// a discount that had been deliberately recorded as none.
function resolveMcd(ovVal, ihmRaw, ov) {
  const hasOvKey = ov && Object.prototype.hasOwnProperty.call(ov, 'mcdPct')
  if (hasOvKey) {
    if (ovVal === '' || ovVal == null) return null   // deliberately cleared
    const n = parseFloat(ovVal)
    return isNaN(n) ? null : n
  }
  if (ihmRaw != null && ihmRaw !== '') {
    const m = String(ihmRaw).match(/-?\d+(\.\d+)?/)
    if (m) {
      const n = parseFloat(m[0])
      if (!isNaN(n)) return n
    }
  }
  return null
}
