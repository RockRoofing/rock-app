// lib/crmDashboardAdapter.js
// ---------------------------------------------------------------------------
// Translates CRM deals (crm:deals, the shape stored by pages/api/crm.js) into
// the flat "normalised deal" shape that the Sales dashboard, Scorecards and
// Negotiating page were written against (previously produced by the Pipedrive
// sync in lib/pipedrive.js). This lets those pages read from the CRM as the
// single source of truth without changing the pages themselves.
//
// Per product decision: customerType / firstContactDate / receivedDate are NOT
// in the Pipedrive export and are left blank here - they will be captured going
// forward, not back-filled.
// ---------------------------------------------------------------------------

// CRM stage id -> Pipedrive stage label (the inverse of crmImportMap's map).
// The Negotiating page filters on stageName === 'Negotiating', so these labels
// must match what the pages expect.
const STAGE_ID_TO_LABEL = {
  stage_project_in: 'Project In',
  stage_1st_contact: '1st Contact',
  stage_calls_x3: 'Calls x 3',
  stage_in_abeyance: 'In Abeyance',
  stage_tbf: 'TBF',
  stage_mc_unsec_np: 'MC Unsecured - Not Priced',
  stage_info_pending: 'info Pending',
  stage_received: 'Received',
  stage_1: 'Stage 1',
  stage_2: 'Stage 2',
  stage_review: 'Review',
  stage_mc_unsecured: 'MC Unsecured',
  stage_variations: 'Variations',
  stage_mc_secured: 'MC Secured',
  stage_negotiating: 'Negotiating',
}

export function stageIdToLabel(stageId) {
  return STAGE_ID_TO_LABEL[stageId] || ''
}

function n(v) {
  if (v == null || v === '') return null
  const x = Number(v)
  return isNaN(x) ? null : x
}

// One CRM deal -> flat normalised deal.
export function crmDealToFlat(d) {
  const f = d.fields || {}
  const value = Number(f.value) || 0
  return {
    id: d.id,
    title: d.title || '',
    value,
    currency: 'GBP',
    status: d.status || 'open',
    stageName: stageIdToLabel(d.stageId),

    organizationName: f.organization || '',
    salesPerson: f.sales_person || '',
    ownerName: f.owner || '',
    estimator: f.estimator_responsible || '',
    leadSource: f.lead_source || '',
    systemPriced: f.systems_priced || '',
    projectType: f.project_type || '',
    projectStage: f.project_stage || '',
    region: f.region || '',
    lostReason: f.lost_reason || '',
    siteLocation: f.site_location || '',
    scopeOfWorks: f.scope_of_works || '',

    createdDate: f.created || null,
    wonTime: f.won_time || null,
    lostTime: f.lost_time || null,
    closeTime: f.won_time || f.lost_time || null,
    expectedCloseDate: f.expected_close_date || null,
    roofingWorksOnSite: f.roofing_works_onsite || null,

    sizeM2: n(f.size_m2),
    creditScore: n(f.credit_score),
    creditLimit: n(f.credit_limit),
    insuredCreditLimit: n(f.insured_credit_limit),

    over200k: value >= 200000,
    label: null,

    // Not in the export - captured going forward, left blank for now.
    customerType: null,
    firstContactDate: null,
    everIn1stContact: false,
    receivedDate: null,
    everInReceived: false,
    wonCount: 0,
  }
}

export function crmDealsToFlat(deals) {
  return (deals || []).map(crmDealToFlat)
}
