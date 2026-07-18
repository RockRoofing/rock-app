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

const ROLE_KEYS = ['estimator', 'contractsManager', 'operationsManager', 'quantitySurveyor']

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
    const name = (ov[key] != null && ov[key] !== '') ? ov[key] : (d[key] || '')
    team[key] = enrich(name, userLookup)
  }

  // Customer contacts: override list wins if present, else IHM site contacts.
  let customerContacts = Array.isArray(ov.customerContacts) && ov.customerContacts.length
    ? ov.customerContacts
    : (Array.isArray(d.siteContacts) ? d.siteContacts : [])
  customerContacts = customerContacts
    .map(c => ({ title: c.title || '', name: c.name || '', email: c.email || '', phone: c.phone || '' }))
    .filter(c => c.name || c.email)

  // Customer QS = the contact whose title is Quantity Surveyor (or QS).
  const qsMatch = customerContacts.find(c => /quantity\s*surveyor|(^|\W)qs(\W|$)/i.test(c.title || ''))
  const customerQS = qsMatch ? { name: qsMatch.name, email: qsMatch.email, phone: qsMatch.phone } : null

  return {
    team,
    customerContacts,
    customerQS,
    customerCompany: d.customerCompany || '',
    customerAddress: d.customerAddress || '',
    hasIhm: !!ihm,
  }
}

export { ROLE_KEYS }
