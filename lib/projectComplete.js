// Single source of truth for "are a project's edit-details complete?"
// Used by Project Financials (Budget Tracker / EOM) and the Retention register to
// show a "project details not complete" banner.
//
// Every field in edit project details is required. 0% retention counts as complete
// (0 is a valid answer). The two retention dates may be explicitly marked TBC
// (pcDateTBC / defectsDateTBC), which counts as complete. The retention release date
// comments box is also required.

const has = (v) => v !== undefined && v !== null && String(v).trim() !== ''
// Numeric fields where 0 is a valid, complete answer (e.g. 0% retention).
const hasNum = (v) => v !== undefined && v !== null && v !== '' && !isNaN(parseFloat(v))

// Returns the list of missing field labels for a project settings object.
// `people` (optional) is the resolved team + customer contacts (IHM merged with
// overrides) so we can require all Rock Roofing team roles and >=1 customer contact.
// An empty array means complete.
export function missingProjectFields(settings = {}, people = null) {
  const missing = []
  if (!has(settings.applicationDay)) missing.push('Application day')
  if (!has(settings.valuationDay)) missing.push('Valuation day')
  if (!has(settings.paymentDay)) missing.push('Payment day')
  if (!hasNum(settings.contractValue)) missing.push('Contract value')
  if (!hasNum(settings.labourBudget)) missing.push('Labour budget')
  if (!hasNum(settings.materialsBudget)) missing.push('Materials budget')
  // 0% retention is a valid answer - accept 0, only flag when truly blank.
  if (!hasNum(settings.retentionPct)) missing.push('Retention %')
  if (!has(settings.retentionComments)) missing.push('Retention release date comments')
  if (!has(settings.pcDate) && !settings.pcDateTBC) missing.push('PC date (or TBC)')
  if (!has(settings.defectsDate) && !settings.defectsDateTBC) missing.push('Defects date (or TBC)')

  // Rock Roofing team - all roles required (resolved from IHM or override).
  if (people) {
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
