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

// ---------------------------------------------------------------------------
// ORGANIZATIONS export -> CRM company records.
// Keyed on "Organization - ID". Column headers verbatim from organizations-*.
// ---------------------------------------------------------------------------
export function mapOrganizationRow(row) {
  const id = num(row['Organization - ID'])
  const name = s(row['Organization - Name'])
  if (id == null && !name) return null
  const sca = s(row['Organization - Supply Chain Approved?'])
  return {
    id: id != null ? id : name,
    name: name || `Organization ${id}`,
    org_type: s(row['Organization - Company Type']),
    org_phone: s(row['Organization - Phone']),
    org_email: s(row['Organization - email']),
    org_website: s(row['Organization - Website']),
    org_address: s(row['Organization - Full/combined address of Address']) || s(row['Organization - Address']),
    org_postcode: s(row['Organization - ZIP/Postal code of Address']),
    org_region: s(row['Organization - Region of Address']),
    org_reg_number: s(row['Organization - Registration Number']),
    org_owner: s(row['Organization - Owner']),
    supply_chain_approved: sca,
    // Deal counts straight from Pipedrive (kept as a fallback / cross-check;
    // the CRM also computes live counts from its own deals).
    pd_open_deals: num(row['Organization - Open deals']) || 0,
    pd_won_deals: num(row['Organization - Won deals']) || 0,
    pd_lost_deals: num(row['Organization - Lost deals']) || 0,
    email_count: num(row['Organization - Email messages count']) || 0,
  }
}
export function mapOrganizationRows(rows) {
  const byId = new Map()
  let skipped = 0
  for (const row of (rows || [])) {
    const o = mapOrganizationRow(row)
    if (!o) { skipped++; continue }
    byId.set(o.id, o)
  }
  return { orgs: Array.from(byId.values()), skipped }
}

// ---------------------------------------------------------------------------
// PEOPLE export -> CRM contact records.
// Keyed on "Person - ID". Column headers verbatim from people-*.
// Job Role (well populated) is preferred over Job title (nearly empty).
// ---------------------------------------------------------------------------
export function mapPersonRow(row) {
  const id = num(row['Person - ID'])
  const name = s(row['Person - Name'])
  if (id == null && !name) return null
  const email = s(row['Person - Email - Work']) || s(row['Person - Email - Other']) || s(row['Person - Email - Home'])
  const phone = s(row['Person - Phone - Work']) || s(row['Person - Phone - Mobile']) || s(row['Person - Phone - Other']) || s(row['Person - Phone - Home'])
  return {
    id: id != null ? id : name,
    name: name || `Person ${id}`,
    first_name: s(row['Person - First name']),
    last_name: s(row['Person - Last name']),
    organization: s(row['Person - Organization']),
    contact_email: email,
    contact_phone: phone,
    contact_job_role: s(row['Person - Job Role']) || s(row['Person - Job title']),
    contact_owner: s(row['Person - Owner']),
    notes: s(row['Person - Notes']),
    pd_open_deals: num(row['Person - Open deals']) || 0,
    pd_won_deals: num(row['Person - Won deals']) || 0,
    pd_lost_deals: num(row['Person - Lost deals']) || 0,
    email_count: num(row['Person - Email messages count']) || 0,
    last_email_sent: s(row['Person - Last email sent']),
    last_email_received: s(row['Person - Last email received']),
  }
}
export function mapPeopleRows(rows) {
  const byId = new Map()
  let skipped = 0
  for (const row of (rows || [])) {
    const c = mapPersonRow(row)
    if (!c) { skipped++; continue }
    byId.set(c.id, c)
  }
  return { contacts: Array.from(byId.values()), skipped }
}

// ---------------------------------------------------------------------------
// ACTIVITIES export -> per-deal activity records.
// Headers are PLAIN here ('ID', 'Subject', 'Deal ID'), not the 'Deal - x' style
// used by the deals/orgs/people exports - which is why detection has to look for
// a different signature.
// ---------------------------------------------------------------------------
const asText = (v) => (v == null ? '' : String(v).trim())
const asMs = (v) => {
  const t = asText(v)
  if (!t) return 0
  // Pipedrive exports 'YYYY-MM-DD HH:MM:SS'. Treat as local time.
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime()
  const d = new Date(t)
  return isNaN(d) ? 0 : d.getTime()
}
const asDateOnly = (v) => {
  const t = asText(v)
  const m = t.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

export function mapActivityRow(row) {
  const dealId = asText(row['Deal ID'])
  if (!dealId) return null
  const doneRaw = asText(row['Done']).toLowerCase()
  return {
    id: `pd_act_${asText(row['ID'])}`,
    pipedriveId: asText(row['ID']),
    dealId,
    dealTitle: asText(row['Deal']),
    subject: asText(row['Subject']) || asText(row['Type']) || 'Activity',
    type: asText(row['Type']),
    text: asText(row['Note']),
    dueDate: asDateOnly(row['Due date']),
    dueTime: asText(row['Due time']),
    done: doneRaw === 'done' || doneRaw === 'yes' || doneRaw === 'true' || doneRaw === '1',
    doneAt: asMs(row['Marked as done time']),
    assignee: asText(row['Assigned to user']),
    createdBy: asText(row['Creator']),
    createdAt: asMs(row['Add time']),
    org: asText(row['Organization']),
    contact: asText(row['Contact person']),
    imported: true,
  }
}

export function mapActivityRows(rows) {
  const out = []
  let skipped = 0
  for (const r of (rows || [])) {
    const a = mapActivityRow(r)
    if (a) out.push(a); else skipped++
  }
  out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  return { activities: out, skipped }
}

// ---------------------------------------------------------------------------
// NOTES export -> per-deal note records.
// ---------------------------------------------------------------------------
export function mapNoteRow(row) {
  const dealId = asText(row['Deal ID'])
  if (!dealId) return null
  const content = asText(row['Content'])
  if (!content) return null
  return {
    id: `pd_note_${asText(row['ID'])}`,
    pipedriveId: asText(row['ID']),
    dealId,
    dealTitle: asText(row['Deal title']),
    // Pipedrive note content is HTML.
    html: content,
    author: asText(row['User']),
    createdAt: asMs(row['Add time']),
    updatedAt: asMs(row['Update time']),
    pinned: asText(row['Note is pinned to deal']).toLowerCase() === 'yes',
    org: asText(row['Organization']),
    contact: asText(row['Contact person']),
    comments: [],
    imported: true,
  }
}

export function mapNoteRows(rows) {
  const out = []
  let skipped = 0
  for (const r of (rows || [])) {
    const n = mapNoteRow(r)
    if (n) out.push(n); else skipped++
  }
  out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  return { notes: out, skipped }
}

// Group mapped activities/notes by deal id, ready for per-deal storage.
export function groupByDeal(items) {
  const by = new Map()
  for (const it of (items || [])) {
    if (!by.has(it.dealId)) by.set(it.dealId, [])
    by.get(it.dealId).push(it)
  }
  return Array.from(by.entries()).map(([dealId, list]) => ({ dealId, items: list }))
}

// Detect which Pipedrive export a set of column headers represents.
// Returns 'deals' | 'orgs' | 'people' | 'activities' | 'notes' | null.
export function detectExportType(headers) {
  const h = new Set((headers || []).map((x) => String(x)))
  if (h.has('Deal - ID') || h.has('Deal - Title')) return 'deals'
  if (h.has('Organization - ID') || h.has('Organization - Name')) return 'orgs'
  if (h.has('Person - ID') || h.has('Person - Name')) return 'people'
  // Activities and notes both carry a plain 'Deal ID'; tell them apart on their
  // own distinctive columns.
  if (h.has('Deal ID') && (h.has('Subject') || h.has('Marked as done time'))) return 'activities'
  if (h.has('Deal ID') && h.has('Content')) return 'notes'
  return null
}
