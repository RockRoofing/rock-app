import { get, set, getOpsProjects, getCachedDeals } from '../../lib/db'

// Planning — the data engine behind the Gantt.
//
// Storage:
//   ops:planning-allocations = { [projectKey]: { [dateISO]: [ { opId, half } ] } }
//       half: 'full' | 'am' | 'pm'
//   ops:planning-meta        = { [projectKey]: { startDate, completionDate } }
//
// projectKey: 'L:<projectNo>' (Live/Ops) or 'N:<dealId>' (Negotiated).
//
// GET  /api/planning                       -> { projects, allocations, meta }
//        projects: [{ key, type:'live'|'negotiated', projectNo, name, location, customer }]
// POST /api/planning { action:'set-meta', key, startDate, completionDate }
// POST /api/planning { action:'assign', key, date, opId, half }   -> add operative to a project-day
//        (clash-checked; half defaults 'full')
// POST /api/planning { action:'unassign', key, date, opId }        -> remove operative from a project-day
// POST /api/planning { action:'set-day', key, date, entries }      -> replace a project-day's list wholesale
//        entries: [{ opId, half }]  (clash-checked against OTHER projects)

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } }

const A_KEY = 'ops:planning-allocations'
const M_KEY = 'ops:planning-meta'
const getAlloc = async () => (await get(A_KEY)) || {}
const saveAlloc = (v) => set(A_KEY, v)
const getMeta = async () => (await get(M_KEY)) || {}
const saveMeta = (v) => set(M_KEY, v)

// A day-cell can be the legacy array [{opId,half}] OR the new object
// { status, unnamed, entries:[{opId,half}] }. Normalise to the entries array.
function cellEntries(cell) {
  if (!cell) return []
  if (Array.isArray(cell)) return cell
  return Array.isArray(cell.entries) ? cell.entries : []
}
function cellUnnamed(cell) { return (cell && !Array.isArray(cell) && Number(cell.unnamed)) || 0 }
function cellStatus(cell) { return (cell && !Array.isArray(cell) && cell.status) || 'confirmed' }

// Two allocations of the same operative on the same day are allowed ONLY if BOTH
// are half days (am/pm split across two projects). Anything else is a clash.
function wouldClash(alloc, key, date, opId, half) {
  const h = half || 'full'
  for (const [pk, days] of Object.entries(alloc)) {
    if (pk === key) continue
    const list = cellEntries(days && days[date])
    for (const e of list) {
      if (e.opId !== opId) continue
      if (h === 'full' || (e.half || 'full') === 'full') return { clash: true, pk }
      if ((e.half || 'full') === h) return { clash: true, pk }
    }
  }
  return { clash: false }
}

async function buildProjects() {
  // Live projects (Ops active)
  const ops = await getOpsProjects()
  const live = (ops || [])
    .filter(p => (p.status || 'active') === 'active')
    .map(p => ({
      key: `L:${p.projectNo}`, type: 'live', projectNo: p.projectNo,
      name: p.data?.projectName || p.projectNo,
      location: p.data?.projectAddress || p.data?.siteLocation || '',
      customer: p.data?.customerCompany || '',
      siteSupervisor: p.data?.siteSupervisor || '',
    }))

  // Negotiated projects (from cached Pipedrive deals at Negotiating stage)
  let negotiated = []
  try {
    const deals = (await getCachedDeals()) || []
    negotiated = (Array.isArray(deals) ? deals : [])
      .filter(d => d.stageName === 'Negotiating' && d.status === 'open')
      .map(d => ({
        key: `N:${d.id}`, type: 'negotiated', projectNo: '',
        name: d.title || `Deal ${d.id}`,
        location: d.siteLocation || d.organizationName || '',
        customer: d.organizationName || '',
      }))
  } catch {}

  return { live, negotiated }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const [{ live, negotiated }, allocations, meta] = await Promise.all([buildProjects(), getAlloc(), getMeta()])
      return res.json({ projects: [...live, ...negotiated], allocations, meta })
    } catch (e) {
      console.error('planning GET failed:', e)
      return res.status(500).json({ error: e.message || 'Load failed' })
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {}
      const { action } = body

      if (action === 'set-meta') {
        const { key, startDate, completionDate } = body
        if (!key) return res.status(400).json({ error: 'Missing key' })
        const meta = await getMeta()
        meta[key] = { ...(meta[key] || {}), startDate: startDate || '', completionDate: completionDate || '' }
        await saveMeta(meta)
        return res.json({ ok: true, meta: meta[key] })
      }

      if (action === 'assign') {
        const { key, date, opId } = body
        const half = body.half || 'full'
        if (!key || !date || !opId) return res.status(400).json({ error: 'Missing key/date/opId' })
        const alloc = await getAlloc()
        const clash = wouldClash(alloc, key, date, opId, half)
        if (clash.clash) return res.status(409).json({ error: 'clash', clashKey: clash.pk })
        alloc[key] = alloc[key] || {}
        alloc[key][date] = alloc[key][date] || []
        // update or add this operative in this project-day
        const existing = alloc[key][date].find(e => e.opId === opId)
        if (existing) existing.half = half
        else alloc[key][date].push({ opId, half })
        await saveAlloc(alloc)
        return res.json({ ok: true, day: alloc[key][date] })
      }

      if (action === 'unassign') {
        const { key, date, opId } = body
        if (!key || !date || !opId) return res.status(400).json({ error: 'Missing key/date/opId' })
        const alloc = await getAlloc()
        if (alloc[key] && alloc[key][date]) {
          alloc[key][date] = alloc[key][date].filter(e => e.opId !== opId)
          if (!alloc[key][date].length) delete alloc[key][date]
          if (alloc[key] && !Object.keys(alloc[key]).length) delete alloc[key]
          await saveAlloc(alloc)
        }
        return res.json({ ok: true })
      }

      if (action === 'set-day') {
        const { key, date } = body
        const entries = Array.isArray(body.entries) ? body.entries : []
        const unnamed = Math.max(0, Number(body.unnamed) || 0)
        const status = ['confirmed', 'provisional', 'actual'].includes(body.status) ? body.status : 'confirmed'
        if (!key || !date) return res.status(400).json({ error: 'Missing key/date' })
        // Actual is only valid for dates that have already passed.
        if (status === 'actual') {
          const todayKey = new Date().toISOString().slice(0, 10)
          if (date >= todayKey) return res.status(400).json({ error: 'Actual can only be set on past dates' })
        }
        const alloc = await getAlloc()
        // Clash-check only NAMED entries against OTHER projects.
        for (const e of entries) {
          if (!e.opId) continue
          const clash = wouldClash(alloc, key, date, e.opId, e.half || 'full')
          if (clash.clash) return res.status(409).json({ error: 'clash', opId: e.opId, clashKey: clash.pk })
        }
        alloc[key] = alloc[key] || {}
        if (entries.length || unnamed > 0) {
          alloc[key][date] = { status, unnamed, entries: entries.map(e => ({ opId: e.opId, half: e.half || 'full' })) }
        } else {
          delete alloc[key][date]; if (!Object.keys(alloc[key]).length) delete alloc[key]
        }
        await saveAlloc(alloc)
        return res.json({ ok: true, day: alloc[key][date] || null })
      }

      return res.status(400).json({ error: 'Unknown action' })
    } catch (e) {
      console.error('planning POST failed:', e)
      return res.status(500).json({ error: e.message || 'Save failed' })
    }
  }

  res.status(405).end()
}
