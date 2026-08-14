import { get, set, getPortalUsers, getOpsUsers } from '../../lib/db'

// H&S Training Matrix.
// Store:
//   ops:hs-matrix-columns = [ { id, label } ]           (training columns; add/delete)
//   ops:hs-matrix-data    = { [personId]: { [colId]: { date:'YYYY-MM-DD' } | { noExpiry:true } } }
//
// personId = operative roster id (op:<id>) or portal user id (pu:<id>).
//
// GET  /api/hs-matrix -> { columns, data, people }
// POST /api/hs-matrix { action:'add-col'|'del-col'|'rename-col'|'set-cell', ... }

const COLS_KEY = 'ops:hs-matrix-columns'
const DATA_KEY = 'ops:hs-matrix-data'
const parseISO = (s) => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }

// Default training columns (from the company's live tracker).
const DEFAULT_COLS = [
  'Latest H&S Policy on Fonn', 'Working at Height', 'Working at Height / H&S (office)', 'CSCS', 'Manual Handling',
  'Fire Safety Training', 'Asbestos Awareness', 'Working on Fragile Roofs',
  'IOSH Safety for Executives and Directors', 'Hazardous substances (COSHH)', 'Ladder Safety',
  'Lone Working', 'Facefit', 'Abrasive Wheels', 'Harness Awareness', 'Forklift / Telehandler',
  'IPAF', 'Internal Supervisor Assessment', 'SSSTS', 'SMSTS', 'IOSH Managing Safely', 'IOSH Managing Safely Refresher',
  'H&S PPE', 'Medical Emergency', 'Can you spot the hazard?', 'Drug and alcohol awareness',
  'First aid', 'Managing personal stress', 'Avoiding slips and trips', 'NVQ Level 2',
  'Renolit', 'Rock Sintoplan', 'Sikaplan', 'Resitrix', 'ICB Alwitra',
]

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40)

async function ensureColumns() {
  let cols = await get(COLS_KEY)
  if (!Array.isArray(cols) || !cols.length) {
    cols = DEFAULT_COLS.map((label, i) => ({ id: `${slug(label)}-${i}`, label }))
    await set(COLS_KEY, cols)
    return cols
  }
  // Backfill any newly-added default columns that aren't present yet (match by label, case-insensitive).
  const have = new Set(cols.map(c => (c.label || '').toLowerCase().trim()))
  let added = false
  for (const label of DEFAULT_COLS) {
    if (!have.has(label.toLowerCase().trim())) { cols.push({ id: `${slug(label)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label }); added = true }
  }
  if (added) await set(COLS_KEY, cols)
  return cols
}

async function buildPeople() {
  const [users, portal] = await Promise.all([
    getOpsUsers(),
    getPortalUsers(),
  ])
  const people = []
  // Site App Users are the source of truth for operatives across the H&S portal.
  for (const u of (users || [])) {
    if (u.active === false) continue
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || ''
    if (!name) continue
    people.push({
      id: `op:${u.id}`, name,
      company: u.company || '', trade: Array.isArray(u.trades) ? u.trades.join(', ') : '',
      phone: u.phone || '', email: u.email || '',
    })
  }
  for (const u of (portal || [])) {
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || ''
    if (!name) continue
    people.push({ id: `pu:${u.id}`, name, company: 'Rock Roofing (office)', trade: '', phone: u.phone || '', email: u.email || '' })
  }
  // de-dupe by lowercased name (Site App user wins over portal)
  const seen = new Set(); const out = []
  for (const p of people) { const k = p.name.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(p) }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

// Existing cert data was stored under legacy roster ids (op:<rosterId>). Site App
// user ids differ, so build a bridge: legacy personId -> new personId, matched by
// name, so historic certificates still appear (and count for planning) without
// re-entry. Returns a data object re-keyed to the new (Site App) ids, preferring any
// data already stored under the new id.
async function bridgedData(people) {
  const [data, oldRoster] = await Promise.all([
    get(DATA_KEY).then(v => v || {}),
    get('ops:operatives-roster').then(v => v || []),
  ])
  const nameToNewId = {}
  for (const p of people) nameToNewId[p.name.toLowerCase()] = p.id
  const oldIdToName = {}
  for (const o of oldRoster) oldIdToName[`op:${o.id}`] = `${o.firstName || ''} ${o.lastName || ''}`.trim().toLowerCase()
  const out = {}
  for (const [pid, cols] of Object.entries(data)) {
    // Keep entries already on a current person id as-is.
    if (people.some(p => p.id === pid)) { out[pid] = { ...(out[pid] || {}), ...cols }; continue }
    // Otherwise try to remap a legacy roster id to the matching Site App user by name.
    const nm = oldIdToName[pid]
    const newId = nm && nameToNewId[nm]
    if (newId) out[newId] = { ...(out[newId] || {}), ...cols }
    else out[pid] = cols   // no match (e.g. portal pu: ids) - leave untouched
  }
  return out
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // Competency map for Planning gating: keyed by operative id (Site App user id).
      if (req.query.competency === '1') {
        const [columns, people] = await Promise.all([ensureColumns(), buildPeople()])
        const data = await bridgedData(people)
        const now = new Date(); now.setHours(0, 0, 0, 0)
        const valid = (cell) => cell && (cell.noExpiry || (cell.date && parseISO(cell.date) >= now))
        const colIdsFor = (matchers) => columns.filter(c => matchers.some(m => (c.label || '').toLowerCase().includes(m))).map(c => c.id)
        const supCols = colIdsFor(['internal supervisor', 'sssts', 'smsts', 'iosh managing safely'])
        const cscsCols = colIdsFor(['cscs'])
        const wahCols = columns.filter(c => (c.label || '').toLowerCase().trim().startsWith('working at height')).map(c => c.id)
        const out = {}
        for (const [pid, cols] of Object.entries(data)) {
          if (!pid.startsWith('op:')) continue
          const opId = pid.slice(3)   // Site App user id (matches /api/operatives + planner)
          const has = (ids) => ids.some(id => valid(cols[id]))
          out[opId] = { isSupervisor: has(supCols), hasCSCS: has(cscsCols), hasWAH: has(wahCols) }
        }
        return res.json({ competency: out })
      }
      // Named supervisor list for dropdowns: operatives holding a supervisor ticket in date.
      if (req.query.supervisors === '1') {
        const [columns, people] = await Promise.all([ensureColumns(), buildPeople()])
        const data = await bridgedData(people)
        const now = new Date(); now.setHours(0, 0, 0, 0)
        const valid = (cell) => cell && (cell.noExpiry || (cell.date && parseISO(cell.date) >= now))
        const supCols = columns.filter(c => ['internal supervisor', 'sssts', 'smsts', 'iosh managing safely'].some(m => (c.label || '').toLowerCase().includes(m))).map(c => c.id)
        const supervisors = []
        for (const p of people) {
          if (!p.id.startsWith('op:')) continue
          const cols = data[p.id] || {}
          if (supCols.some(id => valid(cols[id]))) supervisors.push({ id: p.id.slice(3), name: p.name, email: p.email || '', phone: p.phone || '' })
        }
        supervisors.sort((a, b) => a.name.localeCompare(b.name))
        return res.json({ supervisors })
      }
      const [columns, people] = await Promise.all([ensureColumns(), buildPeople()])
      const data = await bridgedData(people)
      return res.json({ columns, data, people })
    }

    if (req.method === 'POST') {
      const { action } = req.body || {}
      if (action === 'add-col') {
        const label = (req.body.label || '').trim()
        if (!label) return res.status(400).json({ error: 'Label required' })
        const cols = await ensureColumns()
        cols.push({ id: `${slug(label)}-${Date.now()}`, label })
        await set(COLS_KEY, cols)
        return res.json({ ok: true, columns: cols })
      }
      if (action === 'del-col') {
        const { colId } = req.body
        let cols = await ensureColumns()
        cols = cols.filter(c => c.id !== colId)
        await set(COLS_KEY, cols)
        // clean the data for that column
        const data = (await get(DATA_KEY)) || {}
        for (const pid of Object.keys(data)) if (data[pid]) delete data[pid][colId]
        await set(DATA_KEY, data)
        return res.json({ ok: true, columns: cols })
      }
      if (action === 'rename-col') {
        const { colId, label } = req.body
        const cols = await ensureColumns()
        const c = cols.find(x => x.id === colId); if (c) c.label = (label || '').trim() || c.label
        await set(COLS_KEY, cols)
        return res.json({ ok: true, columns: cols })
      }
      if (action === 'set-col') {
        // patch lock and/or colour on a column
        const { colId, locked, colour } = req.body
        const cols = await ensureColumns()
        const c = cols.find(x => x.id === colId)
        if (c) {
          if (typeof locked === 'boolean') c.locked = locked
          if (colour !== undefined) c.colour = colour || ''
        }
        await set(COLS_KEY, cols)
        return res.json({ ok: true, columns: cols })
      }
      if (action === 'reorder-cols') {
        // body.order = array of colIds in new order
        const order = Array.isArray(req.body.order) ? req.body.order : []
        const cols = await ensureColumns()
        const byId = Object.fromEntries(cols.map(c => [c.id, c]))
        const reordered = order.map(id => byId[id]).filter(Boolean)
        // append any columns not in the order list (safety)
        for (const c of cols) if (!order.includes(c.id)) reordered.push(c)
        await set(COLS_KEY, reordered)
        return res.json({ ok: true, columns: reordered })
      }
      if (action === 'set-cell') {
        const { personId, colId, value } = req.body  // value = { date?, noExpiry?, attachment? } | null
        if (!personId || !colId) return res.status(400).json({ error: 'Missing personId/colId' })
        const data = (await get(DATA_KEY)) || {}
        data[personId] = data[personId] || {}
        const att = value && value.attachment ? value.attachment : null   // { url, name, contentType }
        // A cell is kept if it has a date, noExpiry, OR an attachment.
        if (!value || (!value.date && !value.noExpiry && !att)) {
          delete data[personId][colId]
        } else {
          const cell = value.noExpiry ? { noExpiry: true } : (value.date ? { date: value.date } : {})
          if (att) cell.attachment = att
          data[personId][colId] = cell
        }
        if (!Object.keys(data[personId]).length) delete data[personId]
        await set(DATA_KEY, data)
        return res.json({ ok: true })
      }
      return res.status(400).json({ error: 'Unknown action' })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('hs-matrix error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
