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
    for (const p of (ops || [])) map[`L:${p.projectNo}`] = p.data?.projectName || p.projectNo
  } catch {}
  try {
    const deals = (await getCachedDeals()) || []
    for (const d of deals) if (d.stageName === 'Negotiating') map[`N:${d.id}`] = (d.title || `Deal ${d.id}`) + ' (neg.)'
  } catch {}
  return map
}

export default async function handler(req, res) {
  try {
    const mondayStr = req.query.monday
    const monday = mondayStr ? mondayOf(parseISO(mondayStr)) : mondayOf(new Date())
    const days = Array.from({ length: 7 }, (_, i) => iso(addDays(monday, i)))

    const [alloc, roster, names] = await Promise.all([
      get('ops:planning-allocations').then(v => v || {}),
      get('ops:operatives-roster').then(v => v || []),
      projectNameMap(),
    ])
    const opById = Object.fromEntries(roster.map(o => [o.id, o]))

    // opId -> { [dateISO]: [{projectName, half}] }
    const byOp = {}
    for (const [pk, daysMap] of Object.entries(alloc)) {
      const pname = names[pk] || pk
      for (const dk of days) {
        for (const e of (daysMap[dk] || [])) {
          byOp[e.opId] = byOp[e.opId] || {}
          byOp[e.opId][dk] = byOp[e.opId][dk] || []
          byOp[e.opId][dk].push({ projectName: pname, half: e.half || 'full' })
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

    const dailyTotals = days.map((dk, i) => rows.reduce((s, r) => {
      const c = r.cells[i]; if (!c) return s
      return s + c.entries.reduce((ss, e) => ss + (e.half !== 'full' ? 0.5 : 1), 0)
    }, 0))

    return res.json({ weekStart: iso(monday), days, rows, dailyTotals })
  } catch (e) {
    console.error('planning-week error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
