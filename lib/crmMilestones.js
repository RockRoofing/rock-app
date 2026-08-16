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
// "Deals researched" = a project put into Project In. Dated by when it went in, which for
// anything created in the CRM is simply when it was created - that IS the moment it was
// added.
const PROJECT_IN_LABEL = 'Project In'
const PROJECT_IN_STAGE_ID = 'stage_project_in'

// HISTORICAL DEALS ONLY.
//
// Imported deals carry a created date and their CURRENT stage, and nothing about the path
// between the two - so there is no way to know whether one was researched into Project In
// or arrived straight into Received as a tender.
//
// The stand-in: a deal still sitting in one of the EARLY stages was almost certainly put
// there by research and never went anywhere. One that has reached Received or beyond
// cannot be told apart from a tender that arrived, so it is not counted.
const RESEARCH_STAGE_IDS = new Set(['stage_project_in', 'stage_1st_contact', 'stage_calls_x3', 'stage_tbf'])

// The day the CRM started recording stage moves for itself. Deals created BEFORE this are
// judged by the stand-in above; deals created after are judged by what actually happened,
// because the history is there.
const CRM_LIVE_FROM = '2026-08-16'

// And how far back the stand-in is trusted at all. Beyond a year the early-stage deals are
// mostly abandoned rather than recently researched.
const HISTORY_MONTHS = 12

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

    // PROJECT IN - the researched milestone.
    // Every project starts life in Project In, so the honest date is the earliest of:
    // a recorded move INTO Project In, or the day the deal was created. Creation counts
    // because creating a project IS adding it to Project In - there is no separate move
    // to record, which is exactly why nothing was ever counted before.
    const createdDate = dayOf((d.fields || {}).created)
    let projectInDate = null
    let recordedProjectIn = false     // a move INTO Project In
    let startedInProjectIn = false    // a move OUT of it, so it was there before that
    for (const h of ordered) {
      if (h.type !== 'stage') continue
      const txt = String(h.text || '')
      const to = h.stageTo || (/(?:->|\u2192)\s*(.+)$/.exec(txt) || [])[1]
      const from = h.stageFrom || (/Stage:\s*(.+?)\s*(?:->|\u2192)/.exec(txt) || [])[1]
      // Moving OUT of Project In proves it was in there from creation until that moment.
      // Without this a project created in Project In and moved on the same day would look
      // as though it had never been there - only the move away was ever recorded.
      if (from && String(from).trim() === PROJECT_IN_LABEL) startedInProjectIn = true
      if (!recordedProjectIn && to && String(to).trim() === PROJECT_IN_LABEL) {
        projectInDate = dayOf(h.ts)
        recordedProjectIn = true
      }
    }
    // EARLIEST wins. Creating a project IS adding it to Project In - createProject
    // defaults to that stage - so the created date is a genuine entry, and it is earlier
    // than any later move back in. A deal created in June and pushed back into Project In
    // in August was researched in June, not August.
    // Was it ever actually in Project In? Sitting there now, a recorded move in, or a
    // recorded move out. A project created straight into Received was never researched
    // and is not counted.
    let everInProjectIn = recordedProjectIn || startedInProjectIn || d.stageId === PROJECT_IN_STAGE_ID
    // Created there = added there. Earliest wins, so a deal created in June and pushed
    // back into Project In in August is dated June.
    if (everInProjectIn && createdDate && (!projectInDate || createdDate < projectInDate)) projectInDate = createdDate

    // HISTORICAL DEALS are judged differently, because there is no history to judge them
    // by. A recorded move into Project In still counts on its own - real evidence,
    // whenever it happened. Otherwise the stand-in applies: created within the last
    // twelve months AND still sitting in one of the early stages.
    const isHistorical = !!createdDate && createdDate < CRM_LIVE_FROM
    if (isHistorical && !recordedProjectIn) {
      const cutoff = new Date()
      cutoff.setMonth(cutoff.getMonth() - HISTORY_MONTHS)
      const withinWindow = createdDate >= dayOf(cutoff.toISOString())
      everInProjectIn = withinWindow && RESEARCH_STAGE_IDS.has(d.stageId)
      projectInDate = everInProjectIn ? createdDate : null
    }

    if (receivedDate || inReceivedNow || everInProjectIn) {
      out[String(d.id)] = {
        receivedDate: receivedDate || null,
        everInReceived: !!(receivedDate || inReceivedNow),
        projectInDate,
        everInProjectIn,
      }
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
      projectInDate: m.projectInDate || had.projectInDate || null,
      everInProjectIn: m.everInProjectIn || had.everInProjectIn || false,
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
