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

// ---------------------------------------------------------------------------
// COLUMN LOOKUP - tolerant of BOTH Pipedrive export formats.
//
// Older exports prefixed every column with its entity: "Deal - ID",
// "Organization - Name", "Person - Email - Work".
// Current exports drop that prefix entirely: "ID", "Name", "Email - Work".
//
// Rather than pick one and break the other, every field is looked up by its
// FULL name first and then by the name with the leading "<Entity> - " removed.
// So both the files already imported and the ones coming out of Pipedrive today
// map identically, and this keeps working if the format flips back.
// ---------------------------------------------------------------------------
const PREFIXES = ['Deal - ', 'Organization - ', 'Person - ', 'Activity - ', 'Note - ']
function cell(row, name) {
  if (row == null) return undefined
  if (row[name] !== undefined) return row[name]
  for (const p of PREFIXES) {
    if (name.startsWith(p)) {
      const bare = name.slice(p.length)
      if (row[bare] !== undefined) return row[bare]
      break
    }
  }
  return undefined
}

// A single Pipedrive export row (object keyed by the exact column headers) -> CRM deal.
export function mapPipedriveRow(row) {
  const id = num(cell(row, 'Deal - ID'))
  if (id == null) return null   // skip rows without a Pipedrive ID
  const status = statusToId(cell(row, 'Deal - Status'))
  return {
    id,
    title: s(cell(row, 'Deal - Title')) || `Deal ${id}`,
    stageId: stageLabelToId(cell(row, 'Deal - Stage')),
    status,
    fields: {
      value: num(cell(row, 'Deal - Value')) || 0,
      organization: s(cell(row, 'Deal - Organization')),
      contact_person: s(cell(row, 'Deal - Contact person')),
      owner: s(cell(row, 'Deal - Owner')),
      expected_close_date: dateOnly(cell(row, 'Deal - Expected close date')),
      created: s(cell(row, 'Deal - Deal created')),
      won_time: s(cell(row, 'Deal - Won time')),
      lost_time: s(cell(row, 'Deal - Lost time')),
      lost_reason: s(cell(row, 'Deal - Lost reason')),
      project_type: s(cell(row, 'Deal - Project Type')),
      project_stage: s(cell(row, 'Deal - Project Stage')),
      project_start_date: dateOnly(cell(row, 'Deal - Project Start Date')),
      estimator_responsible: s(cell(row, 'Deal - Estimator Responsible')),
      sales_person: s(cell(row, 'Deal - Sales Person')),
      lead_source: s(cell(row, 'Deal - Lead Source')),
      systems_priced: s(cell(row, 'Deal - Systems Priced')),
      scope_of_works: s(cell(row, 'Deal - Description of Project Scope of Works')),
      general_info: s(cell(row, 'Deal - General Information')),
      region: s(cell(row, 'Deal - Region')),
      site_location: s(cell(row, 'Deal - Site Location')),
      site_postcode: s(cell(row, 'Deal - ZIP/Postal code of Site Location')),
      roofing_works_onsite: s(cell(row, 'Deal - Roofing Works On-Site')),
      size_m2: num(cell(row, 'Deal - Size: m2')),
      credit_score: num(cell(row, 'Deal - Credit Score')),
      credit_limit: num(cell(row, 'Deal - Credit Limit')),
      insured_credit_limit: num(cell(row, 'Deal - Insured Credit Limit')),
      glenigan_id: s(cell(row, 'Deal - Glenigan Project ID')),
      // PROJECT SCORE. Pipedrive calls this column "Label". It was in the export all
      // along - 415 deals carry a score of 1 to 9 - and this mapping simply did not read
      // it, so every score was dropped on import and the "Glenigan scored 5 or more"
      // metric had nothing to count.
      project_score: s(cell(row, 'Deal - Label')),
      supply_chain_approved: s(cell(row, 'Deal - Supply Chain Approved?')),
      // Email signal (counts/dates only - bodies are not in this export).
      email_count: num(cell(row, 'Deal - Email messages count')) || 0,
      last_email_sent: s(cell(row, 'Deal - Last email sent')),
      last_email_received: s(cell(row, 'Deal - Last email received')),
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
  const id = num(cell(row, 'Organization - ID'))
  const name = s(cell(row, 'Organization - Name'))
  if (id == null && !name) return null
  const sca = s(cell(row, 'Organization - Supply Chain Approved?'))
  return {
    id: id != null ? id : name,
    name: name || `Organization ${id}`,
    org_type: s(cell(row, 'Organization - Company Type')),
    org_phone: s(cell(row, 'Organization - Phone')),
    org_email: s(cell(row, 'Organization - email')),
    org_website: s(cell(row, 'Organization - Website')),
    org_address: s(cell(row, 'Organization - Full/combined address of Address')) || s(cell(row, 'Organization - Address')),
    org_postcode: s(cell(row, 'Organization - ZIP/Postal code of Address')),
    org_region: s(cell(row, 'Organization - Region of Address')),
    org_reg_number: s(cell(row, 'Organization - Registration Number')),
    org_owner: s(cell(row, 'Organization - Owner')),
    supply_chain_approved: sca,
    // Deal counts straight from Pipedrive (kept as a fallback / cross-check;
    // the CRM also computes live counts from its own deals).
    pd_open_deals: num(cell(row, 'Organization - Open deals')) || 0,
    pd_won_deals: num(cell(row, 'Organization - Won deals')) || 0,
    pd_lost_deals: num(cell(row, 'Organization - Lost deals')) || 0,
    email_count: num(cell(row, 'Organization - Email messages count')) || 0,
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
  const id = num(cell(row, 'Person - ID'))
  const name = s(cell(row, 'Person - Name'))
  if (id == null && !name) return null
  const email = s(cell(row, 'Person - Email - Work')) || s(cell(row, 'Person - Email - Other')) || s(cell(row, 'Person - Email - Home'))
  const phone = s(cell(row, 'Person - Phone - Work')) || s(cell(row, 'Person - Phone - Mobile')) || s(cell(row, 'Person - Phone - Other')) || s(cell(row, 'Person - Phone - Home'))
  return {
    id: id != null ? id : name,
    name: name || `Person ${id}`,
    first_name: s(cell(row, 'Person - First name')),
    last_name: s(cell(row, 'Person - Last name')),
    organization: s(cell(row, 'Person - Organization')),
    contact_email: email,
    contact_phone: phone,
    contact_job_role: s(cell(row, 'Person - Job Role')) || s(cell(row, 'Person - Job title')),
    contact_owner: s(cell(row, 'Person - Owner')),
    notes: s(cell(row, 'Person - Notes')),
    pd_open_deals: num(cell(row, 'Person - Open deals')) || 0,
    pd_won_deals: num(cell(row, 'Person - Won deals')) || 0,
    pd_lost_deals: num(cell(row, 'Person - Lost deals')) || 0,
    email_count: num(cell(row, 'Person - Email messages count')) || 0,
    last_email_sent: s(cell(row, 'Person - Last email sent')),
    last_email_received: s(cell(row, 'Person - Last email received')),
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
  const dealId = asText(cell(row, 'Deal ID'))
  if (!dealId) return null
  const doneRaw = asText(cell(row, 'Done')).toLowerCase()
  return {
    id: `pd_act_${asText(cell(row, 'ID'))}`,
    pipedriveId: asText(cell(row, 'ID')),
    dealId,
    dealTitle: asText(cell(row, 'Deal')),
    subject: asText(cell(row, 'Subject')) || asText(cell(row, 'Type')) || 'Activity',
    type: asText(cell(row, 'Type')),
    text: asText(cell(row, 'Note')),
    dueDate: asDateOnly(cell(row, 'Due date')),
    dueTime: asText(cell(row, 'Due time')),
    done: doneRaw === 'done' || doneRaw === 'yes' || doneRaw === 'true' || doneRaw === '1',
    doneAt: asMs(cell(row, 'Marked as done time')),
    assignee: asText(cell(row, 'Assigned to user')),
    createdBy: asText(cell(row, 'Creator')),
    createdAt: asMs(cell(row, 'Add time')),
    org: asText(cell(row, 'Organization')),
    contact: asText(cell(row, 'Contact person')),
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
  const dealId = asText(cell(row, 'Deal ID'))
  if (!dealId) return null
  const content = asText(cell(row, 'Content'))
  if (!content) return null
  return {
    id: `pd_note_${asText(cell(row, 'ID'))}`,
    pipedriveId: asText(cell(row, 'ID')),
    dealId,
    dealTitle: asText(cell(row, 'Deal title')),
    // Pipedrive note content is HTML.
    html: content,
    author: asText(cell(row, 'User')),
    createdAt: asMs(cell(row, 'Add time')),
    updatedAt: asMs(cell(row, 'Update time')),
    pinned: asText(cell(row, 'Note is pinned to deal')).toLowerCase() === 'yes',
    org: asText(cell(row, 'Organization')),
    contact: asText(cell(row, 'Contact person')),
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

  // --- prefixed (older) exports ---
  if (h.has('Deal - ID') || h.has('Deal - Title')) return 'deals'
  if (h.has('Organization - ID') || h.has('Organization - Name')) return 'orgs'
  if (h.has('Person - ID') || h.has('Person - Name')) return 'people'

  // --- child exports: both carry a plain 'Deal ID' ---
  if (h.has('Deal ID') && (h.has('Subject') || h.has('Marked as done time'))) return 'activities'
  if (h.has('Deal ID') && h.has('Content')) return 'notes'

  // --- unprefixed (current) exports ---
  // All three start with a bare 'ID', so they have to be told apart on columns unique
  // to each. Order matters: deals are checked first because they also carry
  // 'Organization', which would otherwise look like an organizations export.
  if (h.has('ID')) {
    if (h.has('Pipeline') || h.has('Stage') || h.has('Title')) return 'deals'
    if (h.has('First name') || h.has('Last name') || h.has('Email - Work') || h.has('Job Role')) return 'people'
    if (h.has('People') || h.has('Company Type') || h.has('Registration Number')) return 'orgs'
  }
  return null
}
