import { get, getOpsProjects, getCachedDeals } from '../../lib/db'

// Assembles one week's labour allocation BY OPERATIVE (the Weekly Labour Allocation view).
//
// GET /api/planning-week?monday=YYYY-MM-DD
//   -> { weekStart, days:[iso x7], rows:[ { opId, name, email, phone, company, cells:[{date, projectName, half}|null x7] } ],
//        dailyTotals:[num x7] }
//
// Only operatives with at least one allocation in the week are returned.

const DAY = 86400000
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const addDays = (d, n) => new Date(d.getTime() + n * DAY)
const mondayOf = (d) => { const x = new Date(d); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd) }

async function projectNameMap() {
  const map = {}
  try {
    const ops = await getOpsProjects()
    for (const p of (ops || [])) map[`L:${p.projectNo}`] = { name: p.data?.projectName || p.projectNo, address: p.data?.projectAddress || p.data?.siteLocation || '' }
  } catch {}
  try {
    const deals = (await getCachedDeals()) || []
    for (const d of deals) if (d.stageName === 'Negotiating') map[`N:${d.id}`] = { name: (d.title || `Deal ${d.id}`) + ' (neg.)', address: d.siteLocation || d.organizationName || '' }
  } catch {}
  return map
}

export async function assembleWeek(mondayStr) {
    const monday = mondayStr ? mondayOf(parseISO(mondayStr)) : mondayOf(new Date())
    const days = Array.from({ length: 7 }, (_, i) => iso(addDays(monday, i)))

    const [alloc, roster, names, waterIngress] = await Promise.all([
      get('ops:planning-allocations').then(v => v || {}),
      get('ops:operatives-roster').then(v => v || []),
      projectNameMap(),
      get('ops:water-ingress').then(v => v || {}),
    ])
    const opById = Object.fromEntries(roster.map(o => [o.id, o]))

    // opId -> { [dateISO]: [{projectName, half, status}] }
    const byOp = {}
    const unnamedByProjDay = {}  // pk -> { dk: {count, status, projectName} }
    for (const [pk, daysMap] of Object.entries(alloc)) {
      const pinfo = names[pk] || { name: pk, address: '' }
      const pname = pinfo.name; const paddr = pinfo.address
      for (const dk of days) {
        const cell = daysMap[dk]
        if (!cell) continue
        const entries = Array.isArray(cell) ? cell : (cell.entries || [])
        const status = Array.isArray(cell) ? 'confirmed' : (cell.status || 'confirmed')
        const unnamed = Array.isArray(cell) ? 0 : (Number(cell.unnamed) || 0)
        for (const e of entries) {
          byOp[e.opId] = byOp[e.opId] || {}
          byOp[e.opId][dk] = byOp[e.opId][dk] || []
          byOp[e.opId][dk].push({ projectName: pname, projectAddress: paddr, half: e.half || 'full', status })
        }
        if (unnamed > 0) {
          unnamedByProjDay[pk] = unnamedByProjDay[pk] || {}
          unnamedByProjDay[pk][dk] = { count: unnamed, status, projectName: pname }
        }
      }
    }

    // Water Ingress visits: each carries its own job name + address; multiple per day.
    for (const dk of days) {
      const visits = waterIngress[dk] || []
      for (const v of visits) {
        const pname = `💧 ${v.jobName}`; const paddr = v.jobAddress || ''
        const status = v.status || 'confirmed'
        for (const e of (v.entries || [])) {
          byOp[e.opId] = byOp[e.opId] || {}
          byOp[e.opId][dk] = byOp[e.opId][dk] || []
          byOp[e.opId][dk].push({ projectName: pname, projectAddress: paddr, half: e.half || 'full', status })
        }
        const un = Number(v.unnamed) || 0
        if (un > 0) {
          const pk = `wi:${v.id}`
          unnamedByProjDay[pk] = unnamedByProjDay[pk] || {}
          unnamedByProjDay[pk][dk] = { count: un, status, projectName: pname }
          if (!names[pk]) names[pk] = { name: pname, address: paddr }
        }
      }
    }

    const rows = Object.keys(byOp).map(opId => {
      const o = opById[opId] || {}
      const cells = days.map(dk => {
        const list = byOp[opId][dk] || []
        if (!list.length) return null
        return { date: dk, entries: list }
      })
      return {
        opId, name: `${o.firstName || ''} ${o.lastName || ''}`.trim() || opId,
        email: o.email || '', phone: o.phone || '', company: o.company || '',
        cells,
      }
    }).sort((a, b) => a.name.localeCompare(b.name))

    // One "TBC — unnamed" row per project that has unnamed slots in the week.
    const unnamedRows = Object.entries(unnamedByProjDay).map(([pk, dayMap]) => {
      const pname = (names[pk] && names[pk].name) || pk
      const cells = days.map(dk => dayMap[dk] ? { date: dk, entries: [{ projectName: pname, half: 'full', status: dayMap[dk].status, unnamed: dayMap[dk].count }] } : null)
      return { opId: `unnamed:${pk}`, name: `TBC — ${pname}`, email: '', phone: '', company: 'Unnamed', unnamed: true, cells }
    }).sort((a, b) => a.name.localeCompare(b.name))

    const allRows = [...rows, ...unnamedRows]

    const dailyTotals = days.map((dk, i) => {
      let s = 0
      for (const r of rows) { const c = r.cells[i]; if (c) s += c.entries.reduce((ss, e) => ss + (e.half !== 'full' ? 0.5 : 1), 0) }
      for (const [pk, dayMap] of Object.entries(unnamedByProjDay)) { if (dayMap[dk]) s += dayMap[dk].count }
      return s
    })

    return { weekStart: iso(monday), days, rows: allRows, dailyTotals }
}

export default async function handler(req, res) {
  try {
    const week = await assembleWeek(req.query.monday)
    return res.json(week)
  } catch (e) {
    console.error('planning-week error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
