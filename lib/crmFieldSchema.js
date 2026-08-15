// lib/crmFieldSchema.js
// -----------------------------------------------------------------------------
// Editable field schema for the CRM sidebar.
// Types: text | number | currency | date | select | multiselect | yesno
// Options preloaded from observed Pipedrive data — edit/complete them in-app.
//
// This is the DEFAULT schema. In the preview it's held in React state so you
// can add / remove / reorder fields and edit dropdown options live. When we
// persist, this moves to KV (crm:field-schema) as the source of truth.
// -----------------------------------------------------------------------------

export const DEFAULT_FIELD_SCHEMA = [
  // Summary group
  { key: 'value', label: 'Value', type: 'currency', group: 'summary' },
  // Tender return date. group 'none' keeps it OUT of the deal summary - it drives a
  // "Tender return" activity instead - while still telling the forms it is a DATE. Without
  // an entry here the field falls back to a plain text box.
  { key: 'expected_close_date', label: 'Tender return date', type: 'date', group: 'none' },
  { key: 'organization', label: 'Organization', type: 'text', group: 'summary' },
  { key: 'contact_person', label: 'Contact', type: 'text', group: 'summary' },
  { key: 'owner', label: 'Owner', type: 'text', group: 'summary' },
  { key: 'project_score', label: 'Project Score', type: 'text', group: 'summary' },

  // Details group
  { key: 'glenigan_id', label: 'Glenigan Project ID', type: 'text', group: 'details' },
  { key: 'site_location', label: 'Site Location', type: 'text', group: 'details' },
  { key: 'region', label: 'Region', type: 'select', group: 'details',
    options: ['London','South East','South West','East of England','East Midlands','West Midlands','North West','North East','Yorkshire and Humber','Scotland','Wales','Northern Ireland','Isle of Man'] },
  { key: 'size_m2', label: 'Size: m2', type: 'number', group: 'details' },
  { key: 'credit_score', label: 'Credit Score', type: 'number', group: 'details' },
  { key: 'credit_limit', label: 'Credit Limit', type: 'currency', group: 'details' },
  { key: 'insured_credit_limit', label: 'Insured Credit Limit', type: 'currency', group: 'details' },
  { key: 'project_stage', label: 'Project Stage', type: 'select', group: 'details',
    options: ['Live Project','Contractor tendering','End User'] },
  { key: 'roofing_works_onsite', label: 'Roofing Works On-Site', type: 'text', group: 'details' },
  // Options are filled in at runtime from the portal users (pre-contract + admin), so the
  // estimator on a deal always matches a real person and lines up with activity owners.
  { key: 'estimator_responsible', label: 'Estimator Responsible', type: 'select', group: 'details',
    options: [], fromPortalUsers: true },
  { key: 'systems_priced', label: 'Systems Priced', type: 'multiselect', group: 'details',
    options: ['Single Ply','Felt','Standing Seam','Composite Panels','Hot Melt','Roof Coating','Liquids','Pitched tiles','Aluminium Rainscreen','Built up twin skin','Single Skin Sheeting','Curtain Walling','Timber Cladding'] },
  { key: 'scope_of_works', label: 'Description of Project Scope of Works', type: 'text', group: 'details' },
  { key: 'general_info', label: 'General Information', type: 'text', group: 'details' },
  // Same as the estimator - filled from the portal users at runtime, so the name on the
  // deal is the same name an activity can be assigned to.
  { key: 'sales_person', label: 'Sales Person', type: 'select', group: 'details',
    options: [], fromPortalUsers: true },
  { key: 'project_start_date', label: 'Project Start Date', type: 'date', group: 'details' },
  { key: 'project_type', label: 'Project Type', type: 'select', group: 'details',
    options: ['New Build','Refurbishment'] },
  { key: 'lead_source', label: 'Lead Source', type: 'select', group: 'details',
    options: ['Glenigan','Website New Build','Website Refurb','Other'] },

  // Person group (header shown as "Customer Contact")
  { key: 'contact_person', label: 'Name', type: 'text', group: 'person', ref: 'person_name' },
  { key: 'contact_phone', label: 'Phone', type: 'text', group: 'person' },
  { key: 'contact_email', label: 'Email', type: 'text', group: 'person' },
  { key: 'contact_job_role', label: 'Job Role', type: 'text', group: 'person' },

  // Organization group
  { key: 'org_address', label: 'Address', type: 'text', group: 'organization' },
  { key: 'org_phone', label: 'Phone', type: 'text', group: 'organization' },
  { key: 'org_website', label: 'Website', type: 'text', group: 'organization' },
  { key: 'org_email', label: 'Email', type: 'text', group: 'organization' },
  { key: 'org_reg_number', label: 'Registration Number', type: 'text', group: 'organization' },
  { key: 'supply_chain_approved', label: 'Supply Chain Approved?', type: 'yesno', group: 'organization' },
];

// Users who can be @mentioned / selected as estimator.
// PREVIEW placeholder — swap to real "pre-contract portal access" list from
// lib/roles.js when auth is wired.
export const MENTION_USERS = [
  { username: 'roman', name: 'Roman' },
  { username: 'niall', name: 'Niall' },
  { username: 'james', name: 'James' },
  { username: 'simon', name: 'Simon' },
  { username: 'edita', name: 'Edita' },
];

// Stage id -> label, so emails and reports can show a readable stage without importing the
// CRM page. Kept here alongside the field definitions.
export const STAGE_LABELS = {
  stage_project_in: 'Project In', stage_1st_contact: '1st Contact', stage_calls_x3: 'Calls x 3',
  stage_in_abeyance: 'In Abeyance', stage_tbf: 'TBF', stage_mc_unsec_np: 'MC Unsecured Not Priced',
  stage_received: 'Received', stage_1: 'Stage 1', stage_2: 'Stage 2', stage_review: 'Review',
  stage_mc_unsecured: 'MC Unsecured', stage_variations: 'Variations', stage_mc_secured: 'MC Secured',
  stage_negotiating: 'Negotiating', stage_info_pending: 'Info Pending',
}
