import { get, set } from './db'

// WHEN A PROJECT FIRST ENTERED "RECEIVED", AND WHAT IT SCORED.
//
// All three Glenigan metrics are dated by the day a project first entered the Received
// stage, and one of them also needs the project score. Neither is a field on the deal -
// the received date is a fact about a stage TRANSITION, so it only exists if something
// was watching when it happened.
//
// Pipedrive's webhook was watching, for years. The CRM import was a snapshot: it brought
// across what each deal looks like now, not the history of how it got there. That is why
// the adapter hard-coded receivedDate to null, and why all three metrics read zero.
//
// Two sources, merged:
//   1. DERIVED from CRM stage history - correct from the day the CRM went live
//   2. SEEDED once from the Pipedrive-era cache - the years before that
//
// The seed is a copy of your own historical record. Nothing reads Pipedrive afterwards.

const STORE_KEY = 'crm:deal-milestones'
const LEGACY_DEALS_KEY = 'pipedrive:deals'

const RECEIVED_LABEL = 'Received'
const RECEIVED_STAGE_ID = 'stage_received'

const dayOf = (ts) => {
  if (!ts) return null
  const d = new Date(ts)
  return isNaN(d) ? null : d.toISOString().split('T')[0]
}

// The FIRST time this deal entered Received, from its own history. First, not latest:
// a project that goes back through Received later has not been received twice.
export function deriveMilestones(crmDeals) {
  const out = {}
  for (const d of (Array.isArray(crmDeals) ? crmDeals : [])) {
    if (!d || d.id == null) continue
    const history = Array.isArray(d.history) ? d.history : []
    const ordered = [...history].sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')))

    let receivedDate = null
    for (const h of ordered) {
      if (h.type !== 'stage') continue
      const to = h.stageTo || (/(?:->|\u2192)\s*(.+)$/.exec(String(h.text || '')) || [])[1]
      if (!to || String(to).trim() !== RECEIVED_LABEL) continue
      receivedDate = dayOf(h.ts)
      break
    }

    // A deal sitting in Received with no recorded transition into it was imported that
    // way. We know it IS received; we do not know when, so the date stays unknown and
    // the seed below is the only thing that can supply it.
    const inReceivedNow = d.stageId === RECEIVED_STAGE_ID

    if (receivedDate || inReceivedNow) {
      out[String(d.id)] = { receivedDate, everInReceived: true }
    }
  }
  return out
}

export async function getStoredMilestones() {
  const v = await get(STORE_KEY)
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}
}

export async function saveStoredMilestones(map) {
  await set(STORE_KEY, map || {})
}

// Derived wins where it has a date, because it came from the CRM's own record of what
// happened. The seed fills the gaps behind it.
export async function getMilestones(crmDeals) {
  const [stored, deals] = await Promise.all([
    getStoredMilestones(),
    crmDeals ? Promise.resolve(crmDeals) : get('crm:deals').then((v) => (Array.isArray(v) ? v : [])),
  ])
  const derived = deriveMilestones(deals)
  const out = { ...stored }
  for (const [id, m] of Object.entries(derived)) {
    const had = out[id] || {}
    out[id] = {
      receivedDate: m.receivedDate || had.receivedDate || null,
      everInReceived: m.everInReceived || had.everInReceived || false,
      score: had.score ?? null,
    }
  }
  return out
}

// One-off. Copies the received dates and project scores the Pipedrive webhook recorded
// over the years into the CRM's own store. Safe to run more than once.
export async function seedMilestonesFromLegacy() {
  const legacy = await get(LEGACY_DEALS_KEY)
  if (!Array.isArray(legacy) || !legacy.length) {
    return { ok: false, error: 'No Pipedrive-era deal cache found to copy from.' }
  }
  const stored = await getStoredMilestones()
  let dates = 0, scores = 0
  for (const d of legacy) {
    if (!d || d.id == null) continue
    const id = String(d.id)
    const cur = stored[id] || {}
    const next = { ...cur }
    if (!cur.receivedDate && d.receivedDate) { next.receivedDate = d.receivedDate; dates++ }
    if (cur.everInReceived == null) next.everInReceived = !!d.everInReceived
    if (d.everInReceived) next.everInReceived = true
    if (cur.score == null && d.label != null && d.label !== '') { next.score = d.label; scores++ }
    stored[id] = next
  }
  await saveStoredMilestones(stored)
  return { ok: true, receivedDatesCopied: dates, scoresCopied: scores, dealsSeen: legacy.length }
}
