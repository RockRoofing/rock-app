// Single source of truth for "are a project's edit-details complete?"
// Used by Project Financials (Budget Tracker / EOM) and the Retention register to
// show a "project details not complete" banner.
//
// Every field in edit project details is required. The two retention dates may be
// explicitly marked TBC (pcDateTBC / defectsDateTBC), which counts as complete —
// the user has acknowledged them rather than left them blank.

const has = (v) => v !== undefined && v !== null && String(v).trim() !== ''

// Returns the list of missing field labels for a project settings object.
// An empty array means complete.
export function missingProjectFields(settings = {}) {
  const missing = []
  if (!has(settings.applicationDay)) missing.push('Application day')
  if (!has(settings.valuationDay)) missing.push('Valuation day')
  if (!has(settings.paymentDay)) missing.push('Payment day')
  if (!has(settings.contractValue)) missing.push('Contract value')
  if (!has(settings.labourBudget)) missing.push('Labour budget')
  if (!has(settings.materialsBudget)) missing.push('Materials budget')
  if (!has(settings.retentionPct)) missing.push('Retention %')
  if (!has(settings.pcDate) && !settings.pcDateTBC) missing.push('PC date (or TBC)')
  if (!has(settings.defectsDate) && !settings.defectsDateTBC) missing.push('Defects date (or TBC)')
  return missing
}

export function isProjectComplete(settings = {}) {
  return missingProjectFields(settings).length === 0
}
