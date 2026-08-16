import { get, set } from './db'

// Value-change records, sourced entirely from the CRM.
//
// WHY THIS EXISTS
//   The Sales Dashboard and Scorecards build three metrics from value-change records:
//   total value of work priced, value priced to existing customers, and projects priced
//   over 200k. Those records used to be written ONLY by pages/api/webhook.js, when
//   Pipedrive fired an event. Switch Pipedrive off and those three metrics quietly stop
//   moving, on every page, old and new alike.
//
//   This derives the same records from the CRM's own deal history instead, so the
//   (CRM) pages have no Pipedrive dependency at all.
//
// WHAT IS DERIVED
//   1. A value edit on a deal            -> type 'value_change'
//   2. A deal moving INTO a priced stage -> type 'stage_entry'
//
//   Both are read from the history the CRM already keeps on every deal. Nothing new has
//   to be recorded for this to work on changes made before today - see the text parsing
//   below, which is exactly why it is there.
//
// WHAT IS STORED
//   crm:value-changes holds entries added BY HAND on the dashboard, plus anything seeded
//   from the old Pipedrive-era store. Derived entries are computed on read and never
//   written, so they cannot drift from the deals they came from.

const STORE_KEY = 'crm:value-changes'
const LEGACY_KEY = 'value_changes:all'

// The stages that mean a price has been put to the job. Mirrors TRACKED_STAGES in the
// old webhook, so the two produce comparable numbers.
const PRICED_STAGES = ['MC Unsecured', 'MC Secured', 'Negotiating', 'Variations']

// History text reads "Value: £100,000 -> £250,000". Newer entries also carry the numbers
// outright; this is the fallback that makes everything recorded before today usable.
function parseMoneyPair(text) {
  const nums = String(text || '').match(/£\s*[\d,]+(?:\.\d+)?/g)
  if (!nums || nums.length < 2) return null
  const n = (s) => Number(String(s).replace(/[£,\s]/g, ''))
  const a = n(nums[0]), b = n(nums[1])
  if (isNaN(a) || isNaN(b)) return null
  return { old: a, next: b }
}

// "Stage: Received -> MC Secured"
function parseStagePair(text) {
  const m = /Stage:\s*(.+?)\s*(?:->|\u2192)\s*(.+)$/.exec(String(text || ''))
  if (!m) return null
  return { from: m[1].trim(), to: m[2].trim() }
}

const dayOf = (ts) => {
  if (!ts) return null
  const d = new Date(ts)
  return isNaN(d) ? null : d.toISOString().split('T')[0]
}

// Everything a deal's history says about what it was priced at, and when.
export function deriveValueChanges(crmDeals) {
  const out = []
  for (const d of (Array.isArray(crmDeals) ? crmDeals : [])) {
    if (!d || d.id == null) continue
    const dealId = String(d.id)
    const dealTitle = d.title || ''
    const f = d.fields || {}
    const organizationName = f.organization || ''
    const estimator = f.estimator_responsible || ''
    const history = Array.isArray(d.history) ? d.history : []

    // Walked oldest first, so "the value at the time" is right for each stage entry
    // rather than whatever the deal happens to be worth today.
    // Oldest first, and where two entries share a timestamp the VALUE goes before the
    // STAGE. Creating a project writes both at the same instant; with the stage first,
    // the "has this money already been counted" guard below had nothing to compare
    // against and the same £250k was recorded twice - once as entering the stage, once as
    // the value being set.
    const rank = (h) => (h.type === 'value' ? 0 : 1)
    const ordered = [...history].sort((a, b) => {
      const t = String(a.ts || '').localeCompare(String(b.ts || ''))
      return t !== 0 ? t : rank(a) - rank(b)
    })
    let runningValue = null
    let lastLogged = null

    for (const h of ordered) {
      const changeDate = dayOf(h.ts)
      if (!changeDate) continue

      if (h.type === 'value') {
        // Numbers outright where we have them; parsed from the text where we do not.
        const pair = (h.oldValue != null && h.newValue != null)
          ? { old: Number(h.oldValue), next: Number(h.newValue) }
          : parseMoneyPair(h.text)
        if (!pair || pair.next === pair.old) continue
        runningValue = pair.next
        lastLogged = pair.next
        out.push({
          id: `crmvc-${dealId}-${h.id || changeDate}`,
          type: 'value_change',
          dealId, dealTitle, organizationName, estimator,
          oldValue: pair.old,
          newValue: pair.next,
          valueChange: pair.next - pair.old,
          changeDate,
          stage: '',
          notes: 'Value edited in the CRM',
          createdAt: h.ts,
          source: 'crm',
        })
      }

      if (h.type === 'stage') {
        const st = (h.stageTo && h.stageFrom)
          ? { from: h.stageFrom, to: h.stageTo }
          : parseStagePair(h.text)
        if (!st) continue
        const entering = PRICED_STAGES.includes(st.to) && !PRICED_STAGES.includes(st.from)
        if (!entering) continue

        const value = h.value != null ? Number(h.value)
          : runningValue != null ? runningValue
          : Number(f.value) || 0

        // Only worth a record if the number has moved since the last one - otherwise
        // moving in and out of a stage would inflate the month's total every time.
        if (value === lastLogged) continue
        lastLogged = value
        out.push({
          id: `crmse-${dealId}-${h.id || changeDate}`,
          type: 'stage_entry',
          dealId, dealTitle, organizationName, estimator,
          oldValue: null,
          newValue: value,
          valueChange: value,
          changeDate,
          stage: st.to,
          noValue: !value,
          notes: `Entered ${st.to}`,
          createdAt: h.ts,
          source: 'crm',
        })
      }
    }
  }
  return out
}

export async function getStoredValueChanges() {
  const v = await get(STORE_KEY)
  return Array.isArray(v) ? v : []
}

export async function saveStoredValueChanges(list) {
  await set(STORE_KEY, Array.isArray(list) ? list : [])
}

// Derived plus stored, newest first. Stored wins on a clash of id, so a hand-made
// correction is never overwritten by the derivation.
export async function getAllCrmValueChanges() {
  const [deals, stored] = await Promise.all([
    get('crm:deals').then((v) => (Array.isArray(v) ? v : [])),
    getStoredValueChanges(),
  ])
  const derived = deriveValueChanges(deals)
  const byId = new Map(derived.map((e) => [e.id, e]))
  for (const e of stored) byId.set(e.id, e)
  return [...byId.values()].sort((a, b) => String(b.changeDate).localeCompare(String(a.changeDate)))
}

// One-off: copy the Pipedrive-era records across so the history is not lost when the
// webhook stops. They are your records; only the collection method was Pipedrive's.
export async function seedFromLegacy() {
  const legacy = await get(LEGACY_KEY)
  if (!Array.isArray(legacy) || !legacy.length) return { ok: true, copied: 0, alreadyHad: 0 }
  const stored = await getStoredValueChanges()
  const have = new Set(stored.map((e) => e.id))
  const fresh = legacy
    .filter((e) => e && e.id && !have.has(e.id))
    .map((e) => ({ ...e, source: e.source === 'webhook' ? 'pipedrive-archive' : (e.source || 'legacy') }))
  if (fresh.length) await saveStoredValueChanges([...stored, ...fresh])
  return { ok: true, copied: fresh.length, alreadyHad: stored.length }
}
