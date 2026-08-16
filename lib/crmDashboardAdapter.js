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
export function crmDealToFlat(d, milestone) {
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

    // PROJECT SCORE. The Glenigan "scored 5 or more" metric reads this. It is the
    // project_score field on the deal, falling back to whatever the Pipedrive era
    // recorded - it was never mapped in the import, so older deals only have it if it
    // was seeded.
    label: (f.project_score !== undefined && f.project_score !== null && f.project_score !== '')
      ? f.project_score
      : (milestone && milestone.score != null ? milestone.score : null),

    // RECEIVED DATE. Not a field on the deal - it is the day it first entered the
    // Received stage, which is a fact about a transition. Derived from CRM stage
    // history where there is any, seeded from the Pipedrive era where there is not.
    // All three Glenigan metrics are dated by this, so with it null they all read zero,
    // which is exactly what was happening.
    receivedDate: (milestone && milestone.receivedDate) || null,
    everInReceived: !!(milestone && milestone.everInReceived),

    // DEALS RESEARCHED. A project added to Project In counts as one, dated by the day it
    // went in. These were hard-coded null/false, which is why that dashboard was empty no
    // matter what you added. The field names are the old ones so the page keeps working;
    // what they MEAN is now Project In, not 1st Contact.
    firstContactDate: (milestone && milestone.projectInDate) || null,
    everIn1stContact: !!(milestone && milestone.everInProjectIn),

    // Still not captured anywhere - blank rather than wrong.
    customerType: null,
    wonCount: 0,
  }
}

// milestones is the map from lib/crmMilestones (dealId -> { receivedDate, everInReceived,
// score }). Optional, so any existing caller that does not pass it still works - it just
// gets the old blank behaviour rather than an error.
export function crmDealsToFlat(deals, milestones) {
  const m = milestones || {}
  return (deals || []).map((d) => crmDealToFlat(d, m[String(d && d.id)]))
}
