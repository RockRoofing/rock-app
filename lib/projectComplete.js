// Single source of truth for "are a project's edit-details complete?"
// Used by Project Financials (Budget Tracker / EOM) and the Retention register to
// show a "project details not complete" banner.
//
// Every field in edit project details is required except the retention release date
// comments and variations, which are optional. 0% retention counts as complete (0 is a
// valid answer). The two retention dates may be explicitly marked TBC (pcDateTBC /
// defectsDateTBC), which counts as complete.

const has = (v) => v !== undefined && v !== null && String(v).trim() !== ''
// Numeric fields where 0 is a valid, complete answer (e.g. 0% retention).
const hasNum = (v) => v !== undefined && v !== null && v !== '' && !isNaN(parseFloat(v))

// Returns the list of missing field labels for a project settings object.
// `people` (optional) is the resolved team + customer contacts (IHM merged with
// overrides) so we can require all Rock Roofing team roles and >=1 customer contact.
// An empty array means complete.
export function missingProjectFields(settings = {}, people = null) {
  const missing = []

  // Payment schedule can be supplied EITHER as fixed "same day each month" settings
  // OR as a manual per-month table (dateOverrides). If the manual table has any month
  // filled in, the fixed day-settings are not required. Whichever way, every month row
  // that has ANY date must have ALL THREE dates (application, valuation, payment).
  const overrides = settings.dateOverrides || {}
  const monthKeys = Object.keys(overrides).filter(k => {
    const r = overrides[k] || {}
    return r.applicationDate || r.valuationDate || r.paymentDate
  })
  const hasManualMonths = monthKeys.length > 0

  if (!hasManualMonths) {
    if (!has(settings.applicationDay)) missing.push('Application day')
    if (!has(settings.valuationDay)) missing.push('Valuation day')
    if (!has(settings.paymentDay)) missing.push('Payment day')
  } else {
    const incomplete = []
    for (const k of monthKeys) {
      const r = overrides[k] || {}
      if (!has(r.applicationDate) || !has(r.valuationDate) || !has(r.paymentDate)) incomplete.push(monthLabel(k))
    }
    if (incomplete.length) missing.push(`Complete all monthly dates for: ${incomplete.join(', ')}`)
  }

  if (!hasNum(settings.contractValue)) missing.push('Contract value')
  if (!hasNum(settings.labourBudget)) missing.push('Labour budget')
  if (!hasNum(settings.materialsBudget)) missing.push('Materials budget')
  // 0% retention is a valid answer - accept 0, only flag when truly blank.
  if (!hasNum(settings.retentionPct)) missing.push('Retention %')
  // Retention release date comments are OPTIONAL - not required for completeness.
  if (!has(settings.pcDate) && !settings.pcDateTBC) missing.push('PC date (or TBC)')
  if (!has(settings.defectsDate) && !settings.defectsDateTBC) missing.push('Defects date (or TBC)')

  // Rock Roofing team - all roles required (resolved from IHM or override).
  if (people) {
    // Project & customer details (resolved from IHM or override).
    if (!has(people.projectAddress)) missing.push('Site address')
    if (!has(people.orderRef)) missing.push('Order reference')
    if (!has(people.customerCompany)) missing.push('Company name')
    if (!has(people.customerAddress)) missing.push('Company address')

    const team = people.team || {}
    const teamRoles = [
      ['contractsManager', 'Contracts Manager'],
      ['operationsManager', 'Operations Manager'],
      ['quantitySurveyor', 'Quantity Surveyor'],
      ['estimator', 'Estimator'],
    ]
    for (const [key, label] of teamRoles) {
      if (!has(team[key] && team[key].name)) missing.push(label)
    }
    // At least one customer contact with a name.
    const contacts = Array.isArray(people.customerContacts) ? people.customerContacts : []
    if (!contacts.some(c => has(c && c.name))) missing.push('Customer contact')
  }
  return missing
}

export function isProjectComplete(settings = {}, people = null) {
  return missingProjectFields(settings, people).length === 0
}

// "2026-03" -> "Mar 2026"
function monthLabel(key) {
  const [y, m] = String(key).split('-').map(n => parseInt(n, 10))
  if (!y || !m) return key
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' })
}
