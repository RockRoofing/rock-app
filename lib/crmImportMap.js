// lib/crmImportMap.js
// ---------------------------------------------------------------------------
// Maps a row from the Pipedrive "Deals" export (xlsx or csv) into the CRM's
// internal deal shape. Column headers below are taken verbatim from the real
// Pipedrive export (deals-*.xlsx). Keyed on "Deal - ID" so a re-import never
// duplicates a deal.
//
// Used by BOTH the browser (parses the uploaded file, maps, sends JSON) and,
// if ever needed, the server. Pure functions, no imports.
// ---------------------------------------------------------------------------

// Pipedrive stage label -> CRM stage id (see STAGES in pages/crm.js).
// Labels come straight from the export's "Deal - Stage" column.
const STAGE_LABEL_TO_ID = {
  'project in': 'stage_project_in',
  '1st contact': 'stage_1st_contact',
  'calls x 3': 'stage_calls_x3',
  'in abeyance': 'stage_in_abeyance',
  'tbf': 'stage_tbf',
  'mc unsecured - not priced': 'stage_mc_unsec_np',
  'info pending': 'stage_info_pending',
  'received': 'stage_received',
  'stage 1': 'stage_1',
  'stage 2': 'stage_2',
  'review': 'stage_review',
  'mc unsecured': 'stage_mc_unsecured',
  'variations': 'stage_variations',
  'mc secured': 'stage_mc_secured',
  'negotiating': 'stage_negotiating',
}

export function stageLabelToId(label) {
  const key = String(label == null ? '' : label).trim().toLowerCase()
  return STAGE_LABEL_TO_ID[key] || 'stage_project_in'
}

function statusToId(s) {
  const v = String(s == null ? '' : s).trim().toLowerCase()
  if (v === 'won') return 'won'
  if (v === 'lost') return 'lost'
  return 'open'
}

// Trim, collapse blanks to null.
function s(v) {
  if (v == null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}
function num(v) {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[, ]+/g, ''))
  return isNaN(n) ? null : n
}
// Excel/Pipedrive dates arrive as strings like "2026-07-09 07:43:21" or "2026-07-09".
// Keep the date portion for date fields; keep full for the created timestamp.
function dateOnly(v) {
  const t = s(v)
  if (!t) return null
  return t.slice(0, 10)
}

// A single Pipedrive export row (object keyed by the exact column headers) -> CRM deal.
export function mapPipedriveRow(row) {
  const id = num(row['Deal - ID'])
  if (id == null) return null   // skip rows without a Pipedrive ID
  const status = statusToId(row['Deal - Status'])
  return {
    id,
    title: s(row['Deal - Title']) || `Deal ${id}`,
    stageId: stageLabelToId(row['Deal - Stage']),
    status,
    fields: {
      value: num(row['Deal - Value']) || 0,
      organization: s(row['Deal - Organization']),
      contact_person: s(row['Deal - Contact person']),
      owner: s(row['Deal - Owner']),
      expected_close_date: dateOnly(row['Deal - Expected close date']),
      created: s(row['Deal - Deal created']),
      won_time: s(row['Deal - Won time']),
      lost_time: s(row['Deal - Lost time']),
      lost_reason: s(row['Deal - Lost reason']),
      project_type: s(row['Deal - Project Type']),
      project_stage: s(row['Deal - Project Stage']),
      project_start_date: dateOnly(row['Deal - Project Start Date']),
      estimator_responsible: s(row['Deal - Estimator Responsible']),
      sales_person: s(row['Deal - Sales Person']),
      lead_source: s(row['Deal - Lead Source']),
      systems_priced: s(row['Deal - Systems Priced']),
      scope_of_works: s(row['Deal - Description of Project Scope of Works']),
      general_info: s(row['Deal - General Information']),
      region: s(row['Deal - Region']),
      site_location: s(row['Deal - Site Location']),
      site_postcode: s(row['Deal - ZIP/Postal code of Site Location']),
      roofing_works_onsite: s(row['Deal - Roofing Works On-Site']),
      size_m2: num(row['Deal - Size: m2']),
      credit_score: num(row['Deal - Credit Score']),
      credit_limit: num(row['Deal - Credit Limit']),
      insured_credit_limit: num(row['Deal - Insured Credit Limit']),
      glenigan_id: s(row['Deal - Glenigan Project ID']),
      supply_chain_approved: s(row['Deal - Supply Chain Approved?']),
      // Email signal (counts/dates only - bodies are not in this export).
      email_count: num(row['Deal - Email messages count']) || 0,
      last_email_sent: s(row['Deal - Last email sent']),
      last_email_received: s(row['Deal - Last email received']),
    },
    // CRM-native data starts empty on import.
    history: [],
    activities: [],
    notes: [],
  }
}

// Map a whole array of export rows -> array of CRM deals, de-duped by Deal ID
// (last row wins). Returns { deals, skipped }.
export function mapPipedriveRows(rows) {
  const byId = new Map()
  let skipped = 0
  for (const row of (rows || [])) {
    const deal = mapPipedriveRow(row)
    if (!deal) { skipped++; continue }
    byId.set(deal.id, deal)
  }
  return { deals: Array.from(byId.values()), skipped }
}
