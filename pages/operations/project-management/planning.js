import { useState, useEffect, useMemo, useRef } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, Loading, primaryBtn, ghostBtn, linkBtn } from '../../../components/opsUI'

const DAY = 86400000
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parseISO = (s) => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const addDays = (d, n) => new Date(d.getTime() + n * DAY)
const mondayOf = (d) => { const x = new Date(d); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd) }
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const fmtDMY = (d) => d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
const fmtLong = (d) => d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : ''
const sameDay = (a, b) => a && b && iso(a) === iso(b)
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6

const NAME_W = 280, DATE_W = 92, CELL_W = 34, WEEKCELL_W = 46, ROW_H = 42

// Allocation colours
const C_ACTUAL = '#15803d'      // dark green
const C_CONFIRMED = '#86efac'   // light green
const C_PROVISIONAL = '#60a5fa' // blue
const C_UNNAMED = '#fb923c'     // orange (any unnamed slot)
const C_ACTUAL_BG = '#4ade80', C_CONFIRMED_BG = '#f0fdf4', C_PROV_BG = '#dbeafe', C_UNNAMED_BG = '#ffedd5'

// Normalise a day-cell (legacy array OR new object) to a consistent shape.
function cellData(cell) {
  if (!cell) return { status: 'confirmed', unnamed: 0, entries: [], count: 0 }
  if (Array.isArray(cell)) {
    const count = cell.reduce((s, e) => s + (e.half && e.half !== 'full' ? 0.5 : 1), 0)
    return { status: 'confirmed', unnamed: 0, entries: cell, count }
  }
  const entries = Array.isArray(cell.entries) ? cell.entries : []
  const named = entries.reduce((s, e) => s + (e.half && e.half !== 'full' ? 0.5 : 1), 0)
  const unnamed = Number(cell.unnamed) || 0
  return { status: cell.status || 'confirmed', unnamed, entries, count: named + unnamed }
}
// Cell background + number colour by status/unnamed. Unnamed present -> orange.
function cellColours(cd) {
  if (cd.unnamed > 0) return { bg: C_UNNAMED_BG, edge: C_UNNAMED, num: '#9a3412' }
  if (cd.status === 'actual') return { bg: C_ACTUAL_BG, edge: C_ACTUAL, num: '#14532d' }
  if (cd.status === 'provisional') return { bg: C_PROV_BG, edge: C_PROVISIONAL, num: '#1e40af' }
  return { bg: C_CONFIRMED_BG, edge: C_CONFIRMED, num: '#166534' } // confirmed
}

export default function PlanningPage() {
  const [data, setData] = useState(null)
  const [ops, setOps] = useState([])
  const [comp, setComp] = useState({})   // opId -> { isSupervisor, hasCSCS, hasWAH }
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('day')          // 'day' | 'week'
  const [anchorMonday, setAnchorMonday] = useState(() => mondayOf(new Date()))
  const [historic, setHistoric] = useState(false)
  const [filters, setFilters] = useState({ project: '', installer: '', from: '', to: '' })
  // selection: { key, dates:Set<iso> }  — active drag project row
  const [sel, setSel] = useState(null)
  const [allocModal, setAllocModal] = useState(null)  // { proj, dates:[iso] }
  const [weekModal, setWeekModal] = useState(null)    // monday iso
  const [viewModal, setViewModal] = useState(false)   // historic viewer
  const [clearing, setClearing] = useState(false)
  const [wiDay, setWiDay] = useState(null)            // Water Ingress day (iso) being edited
  const dragging = useRef(false)

  async function load() {
    setLoading(true)
    try {
      const [pl, opr, cmp] = await Promise.all([
        fetch('/api/planning').then(r => r.json()).catch(() => ({})),
        fetch('/api/operatives').then(r => r.json()).catch(() => ({})),
        fetch('/api/hs-matrix?competency=1').then(r => r.json()).catch(() => ({})),
      ])
      setData({ projects: pl.projects || [], allocations: pl.allocations || {}, meta: pl.meta || {}, waterIngress: pl.waterIngress || {} })
      setOps(opr.operatives || [])
      setComp(cmp.competency || {})
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Default forward horizon = 3 years; historic view starts 2 weeks before today
  // and can scroll back to 6 weeks (or as far as data exists).
  const RANGE_WEEKS = 156

  // Earliest allocated day across all projects — lets historic scroll back as far
  // as there is data, beyond the default 6-week floor.
  const earliestAlloc = useMemo(() => {
    if (!data) return null
    let earliest = null
    for (const alloc of Object.values(data.allocations || {})) {
      for (const dk of Object.keys(alloc || {})) {
        const cd = cellData(alloc[dk]); if (cd.count <= 0) continue
        if (!earliest || dk < earliest) earliest = dk
      }
    }
    return earliest ? mondayOf(parseISO(earliest)) : null
  }, [data])

  const days = useMemo(() => {
    let start = anchorMonday
    let end = addDays(anchorMonday, RANGE_WEEKS * 7 - 1)
    if (filters.from) { const f = mondayOf(parseISO(filters.from)); if (f) start = f }
    if (filters.to) { const t = parseISO(filters.to); if (t) end = t }
    const out = []
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(new Date(d))
    return out
  }, [anchorMonday, filters.from, filters.to])

  const weekGroups = useMemo(() => {
    const groups = []
    for (let i = 0; i < days.length; i += 7) groups.push(days.slice(i, i + 7))
    return groups
  }, [days])

  useEffect(() => {
    const up = () => { dragging.current = false }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  if (loading || !data) return (
    <OperationsShell active="pm:planning" section="pm" title="Planning" wide><PageHeading title="Planning" /><Loading /></OperationsShell>
  )

  const live = data.projects.filter(p => p.type === 'live')
  const negotiated = data.projects.filter(p => p.type === 'negotiated')
  const matchProject = (p) => {
    if (filters.project && p.key !== filters.project) return false
    if (filters.installer) {
      const opDays = data.allocations[p.key] || {}
      if (!Object.values(opDays).some(list => (list || []).some(e => e.opId === filters.installer))) return false
    }
    return true
  }
  const liveRows = live.filter(matchProject)
  const negRows = negotiated.filter(matchProject)

  const countOnDay = (p, dateKey) => cellData((data.allocations[p.key] || {})[dateKey]).count
  const dayTotal = (date) => {
    const key = iso(date); let t = 0
    for (const p of [...liveRows, ...negRows]) t += countOnDay(p, key)
    return t
  }
  // Historic back-scroll floor: 6 weeks before this Monday, or the earliest
  // allocation if data goes further back.
  const sixWeekFloor = mondayOf(addDays(new Date(), -42))
  const backFloor = earliestAlloc && earliestAlloc < sixWeekFloor ? earliestAlloc : sixWeekFloor
  const canGoBack = !historic || anchorMonday > backFloor
  const shift = (deltaWeeks) => setAnchorMonday(m => {
    let next = mondayOf(addDays(m, deltaWeeks * 7))
    if (historic && deltaWeeks < 0 && next < backFloor) next = backFloor
    return next
  })

  // selection helpers (day view only)
  const toggleCell = (key, date) => {
    setSel(prev => {
      const dates = new Set(prev && prev.key === key ? prev.dates : [])
      const k = iso(date)
      if (dates.has(k)) dates.delete(k); else dates.add(k)
      return { key, dates }
    })
  }
  const dragTo = (key, date) => {
    if (!dragging.current) return
    setSel(prev => {
      if (!prev || prev.key !== key) return { key, dates: new Set([iso(date)]) }
      const dates = new Set(prev.dates); dates.add(iso(date)); return { key, dates }
    })
  }
  const startDrag = (key, date) => { dragging.current = true; toggleCell(key, date) }

  const openAllocate = (mode = 'add') => {
    if (!sel || !sel.dates.size) return
    const proj = data.projects.find(p => p.key === sel.key)
    if (!proj) return
    const dates = [...sel.dates].sort()
    setAllocModal({ proj, dates, mode })
  }
  // does the current selection already have any labour allocated?
  const selectionHasLabour = () => {
    if (!sel || !sel.dates.size) return false
    const days3 = data.allocations[sel.key] || {}
    for (const dk of sel.dates) if (cellData(days3[dk]).count > 0) return true
    return false
  }
  // wipe the labour/contents of the selected cells (set-day with empty entries clears the cell)
  async function clearSelectionLabour() {
    if (!sel || !sel.dates.size) return
    if (!window.confirm(`Clear all labour from ${sel.dates.size} selected day${sel.dates.size === 1 ? '' : 's'}? This removes the allocations on those days.`)) return
    setClearing(true)
    try {
      for (const dk of sel.dates) {
        await fetch('/api/planning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-day', key: sel.key, date: dk, entries: [], unnamed: 0 }) }).catch(() => {})
      }
      dragging.current = false
      setSel(null)
      await load()
    } catch {}
    setClearing(false)
  }

  return (
    <OperationsShell active="pm:planning" section="pm" title="Planning" wide>
      <PageHeading title="Planning" sub="Project programme — installers per project per day. Live projects first, then negotiated (not yet secured)." />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
        <div><div style={lbl}>Project</div>
          <select value={filters.project} onChange={e => setFilters(f => ({ ...f, project: e.target.value }))} style={{ ...fInput, minWidth: 160, fontFamily: 'inherit' }}>
            <option value="">All projects</option>
            {data.projects.map(p => <option key={p.key} value={p.key}>{p.name}{p.type === 'negotiated' ? ' (neg.)' : ''}</option>)}
          </select>
        </div>
        <div><div style={lbl}>Installer</div>
          <select value={filters.installer} onChange={e => setFilters(f => ({ ...f, installer: e.target.value }))} style={{ ...fInput, minWidth: 150, fontFamily: 'inherit' }}>
            <option value="">All installers</option>
            {ops.map(o => <option key={o.id} value={o.id}>{o.firstName} {o.lastName}</option>)}
          </select>
        </div>
        <div><div style={lbl}>From</div><input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} style={fInput} /></div>
        <div><div style={lbl}>To</div><input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} style={fInput} /></div>
        {(filters.project || filters.installer || filters.from || filters.to) &&
          <button onClick={() => setFilters({ project: '', installer: '', from: '', to: '' })} style={{ ...ghostBtn, padding: '7px 12px' }}>Clear</button>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setWeekModal(iso(mondayOf(new Date())))} style={primaryBtn}>Send Weekly Labour Allocation</button>
          <button onClick={() => setViewModal(true)} style={ghostBtn}>View Weekly Labour Allocations</button>
          <div style={{ display: 'flex', border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => setView('day')} style={{ ...segBtn, background: view === 'day' ? GOLD : '#fff', color: view === 'day' ? '#fff' : '#555' }}>Day</button>
            <button onClick={() => setView('week')} style={{ ...segBtn, background: view === 'week' ? GOLD : '#fff', color: view === 'week' ? '#fff' : '#555' }}>Week</button>
          </div>
          <button onClick={() => setHistoric(h => {
              const next = !h
              // Turning Historic ON: start the view 2 weeks before today. Turning it
              // OFF: snap back to this week.
              setAnchorMonday(mondayOf(addDays(new Date(), next ? -14 : 0)))
              return next
            })} title="Show past weeks (starts 2 weeks ago; scroll back up to 6 weeks or as far as there's data)"
            style={{ ...ghostBtn, background: historic ? '#fffbeb' : '#f2f2f0', color: historic ? '#92400e' : '#555', fontWeight: historic ? 700 : 400 }}>
            {historic ? '✓ Historic' : 'Historic'}
          </button>
          <button onClick={() => shift(historic ? -1 : -12)} disabled={historic && !canGoBack} style={{ ...ghostBtn, opacity: (historic && !canGoBack) ? 0.4 : 1 }} title={historic ? 'Back one week' : 'Back 12 weeks'}>‹</button>
          <button onClick={() => { setHistoric(false); setAnchorMonday(mondayOf(new Date())) }} style={ghostBtn}>Today</button>
          <button onClick={() => shift(historic ? 1 : 12)} style={ghostBtn} title={historic ? 'Forward one week' : 'Forward 12 weeks'}>›</button>
        </div>
      </div>

      {/* selection action bar (day view) */}
      {view === 'day' && sel && sel.dates.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fffbeb', border: '1px solid #f0e2b0', borderRadius: 10, padding: '10px 14px', marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: '#92400e' }}>
            <strong>{data.projects.find(p => p.key === sel.key)?.name}</strong> — {sel.dates.size} day{sel.dates.size === 1 ? '' : 's'} selected
          </div>
          <button onClick={() => openAllocate('add')} style={primaryBtn}>Allocate labour →</button>
          {selectionHasLabour() && <button onClick={() => openAllocate('edit')} style={{ ...ghostBtn, background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>Edit labour allocation</button>}
          {selectionHasLabour() && <button onClick={clearSelectionLabour} disabled={clearing} style={{ ...ghostBtn, color: '#dc2626', borderColor: '#f3c0c0' }}>{clearing ? 'Clearing…' : 'Clear labour'}</button>}
          <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }} onClick={(e) => { e.stopPropagation(); dragging.current = false; setSel(null) }} style={ghostBtn}>Deselect</button>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 10, fontSize: 11.5, color: '#555' }}>
        <span style={{ fontWeight: 700, color: '#888' }}>Key:</span>
        <Legend c={C_ACTUAL} label="Actual" />
        <Legend c={C_CONFIRMED} label="Confirmed" />
        <Legend c={C_PROVISIONAL} label="Provisional" />
        <Legend c={C_UNNAMED} label="Provisional — labour not confirmed (unnamed)" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ color: '#dc2626', fontWeight: 700, fontSize: 14 }}>3</span> past contracted completion</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ color: '#ea580c' }}>⚑</span> historic needs confirming</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 4, height: 14, background: '#15803d', display: 'inline-block' }} /> today</span>
      </div>

      <div style={{ border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: NAME_W + DATE_W * 2 + (view === 'day' ? days.length * CELL_W : weekGroups.length * WEEKCELL_W) }}>

            {/* Week/date header */}
            <div style={{ display: 'flex', borderBottom: '1px solid #eee', background: '#faf9f7' }}>
              <Frozen w={NAME_W} left={0} style={{ fontWeight: 700, background: '#faf9f7' }}>Project</Frozen>
              <PlainCell w={DATE_W} style={{ background: '#faf9f7' }}>Start</PlainCell>
              <PlainCell w={DATE_W} style={{ background: '#faf9f7' }}>Contract Compl.</PlainCell>
              {view === 'day'
                ? weekGroups.map((g, i) => (
                  <div key={i} style={{ width: g.length * CELL_W, borderLeft: '2px solid #d9d5cc', padding: '4px 6px', fontSize: 10.5, color: '#666', fontWeight: 600 }}>W/C {fmtDMY(g[0])}</div>
                ))
                : weekGroups.map((g, i) => (
                  <div key={i} style={{ width: WEEKCELL_W, borderLeft: '1px solid #eee', padding: '4px 2px', fontSize: 9, color: '#666', fontWeight: 600, textAlign: 'center' }}>{fmtDMY(g[0])}</div>
                ))
              }
            </div>

            {/* Totals + day letters (day view only) */}
            {view === 'day' && (
              <div style={{ display: 'flex', borderBottom: '2px solid #e6e2d8', background: '#fff' }}>
                <Frozen w={NAME_W} left={0} style={{ fontSize: 10.5, color: '#999' }}>Total installers →</Frozen>
                <PlainCell w={DATE_W}></PlainCell>
                <PlainCell w={DATE_W}></PlainCell>
                {days.map((d, i) => {
                  const we = isWeekend(d); const t = dayTotal(d)
                  return (
                    <div key={i} style={{ width: CELL_W, textAlign: 'center', padding: '2px 0', background: we ? '#f3f1ec' : '#fff', borderLeft: (d.getDay() === 1 ? '2px solid #d9d5cc' : '1px solid #f2f2f2') }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: t ? INK : '#ccc' }}>{t || ''}</div>
                      <div style={{ fontSize: 9.5, color: we ? '#b91c1c' : '#aaa' }}>{DOW[(d.getDay() + 6) % 7]}</div>
                      <div style={{ fontSize: 8.5, color: '#bbb' }}>{d.getDate()}</div>
                    </div>
                  )
                })}
              </div>
            )}

            <SectionLabel>LIVE PROJECTS</SectionLabel>
            {liveRows.length === 0 && <EmptyRow>No live projects.</EmptyRow>}
            {liveRows.map(p => <GanttRow key={p.key} p={p} days={days} weekGroups={weekGroups} view={view} data={data} countOnDay={countOnDay} comp={comp}
              sel={sel} onCellDown={startDrag} onCellEnter={dragTo} onSaveMeta={load} />)}

            <SectionLabel>WATER INGRESS</SectionLabel>
            <WaterIngressRow days={days} weekGroups={weekGroups} view={view} data={data} onOpenDay={(dk) => view === 'day' && setWiDay(dk)} />

            <SectionLabel neg>NEGOTIATED — NOT YET SECURED</SectionLabel>
            {negRows.length === 0 && <EmptyRow>No negotiated projects.</EmptyRow>}
            {negRows.map(p => <GanttRow key={p.key} p={p} days={days} weekGroups={weekGroups} view={view} data={data} countOnDay={countOnDay} neg comp={comp}
              sel={sel} onCellDown={startDrag} onCellEnter={dragTo} onSaveMeta={load} />)}

          </div>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: '#999', marginTop: 8 }}>
        {view === 'day'
          ? 'Click a day to select it (click again to deselect); drag across days to select a range, then “Allocate labour”. Turn on “Historic” to see and edit past days (last 2 weeks). Edit Start / Contracted Completion directly in the row.'
          : 'Week view is read-only. Each column is a week; part-weeks are filled proportionally (x/5 working days). Switch to Day view to allocate labour.'}
      </div>

      {allocModal && <AllocateModal proj={allocModal.proj} dates={allocModal.dates} mode={allocModal.mode} data={data} ops={ops} comp={comp}
        onClose={() => setAllocModal(null)} onDone={() => { setAllocModal(null); setSel(null); load() }} reloadOps={async () => { const d = await fetch('/api/operatives').then(r => r.json()); setOps(d.operatives || []); return d.operatives || [] }} />}
      {weekModal && <WeekModal monday={weekModal} onClose={() => setWeekModal(null)} />}
      {viewModal && <ViewWeekModal onClose={() => setViewModal(false)} />}
      {wiDay && <WaterIngressDayModal date={wiDay} data={data} ops={ops} comp={comp} onClose={() => setWiDay(null)} onDone={() => { setWiDay(null); load() }} reloadOps={async () => { const d = await fetch('/api/operatives').then(r => r.json()); setOps(d.operatives || []); return d.operatives || [] }} />}
    </OperationsShell>
  )
}

function GanttRow({ p, days, weekGroups, view, data, neg, countOnDay, comp, sel, onCellDown, onCellEnter, onSaveMeta }) {
  const meta = data.meta[p.key] || {}
  const _today = new Date(); const todayCellKey = iso(_today)
  const [start, setStart] = useState(meta.startDate || '')
  const [compl, setCompl] = useState(meta.completionDate || '')
  useEffect(() => { setStart(meta.startDate || ''); setCompl(meta.completionDate || '') }, [meta.startDate, meta.completionDate])

  const startD = parseISO(start), complD = parseISO(compl)
  const missing = !start || !compl
  let lastAlloc = null
  let projectHasLabour = false
  let projectHasNamedLabour = false
  let ganttHasSupervisor = false
  const today = new Date()
  const todayKey = iso(today)

  // Week windows for the historic-actual rule.
  const thisMon = mondayOf(today)
  const thisWeekStart = iso(thisMon), thisWeekEnd = iso(addDays(thisMon, 6))
  const prevWeekStart = iso(addDays(thisMon, -7)), prevWeekEnd = iso(addDays(thisMon, -1))
  const prev2WeekStart = iso(addDays(thisMon, -14)), prev2WeekEnd = iso(addDays(thisMon, -8))
  const inRange = (dk, a, b) => dk >= a && dk <= b
  const isThursdayOrLater = today.getDay() === 0 || today.getDay() >= 4   // Thu(4) Fri Sat, plus Sun(0)

  let unconfirmedThisWeek = false        // any not-actual allocation in the current week
  let unconfirmedPriorWeeks = false      // any not-actual allocation in the previous two weeks

  for (const [dk, cell] of Object.entries(data.allocations[p.key] || {})) {
    const dd = parseISO(dk); if (dd && (!lastAlloc || dd > lastAlloc)) lastAlloc = dd
    const cd = cellData(cell); if (cd.count > 0) projectHasLabour = true
    if (cd.entries && cd.entries.length > 0) projectHasNamedLabour = true
    if (cd.entries && cd.entries.some(e => comp && comp[e.opId] && comp[e.opId].isSupervisor)) ganttHasSupervisor = true
    const notActual = cd.count > 0 && cd.status !== 'actual'
    if (notActual && dk < todayKey && inRange(dk, thisWeekStart, thisWeekEnd)) unconfirmedThisWeek = true
    if (notActual && (inRange(dk, prevWeekStart, prevWeekEnd) || inRange(dk, prev2WeekStart, prev2WeekEnd))) unconfirmedPriorWeeks = true
  }

  // Flag historic-needs-actual only from Thursday onwards for the current week's
  // unconfirmed dates — UNLESS a prior week (last week or the one before) still
  // has unconfirmed inputs, which always flags.
  const historicNeedsActual = unconfirmedPriorWeeks || (isThursdayOrLater && unconfirmedThisWeek)
  const overrun = complD && lastAlloc && lastAlloc > complD
  // Project-level supervisor flag: live project with NAMED labour but NO supervisor either assigned in
  // Project Details OR allocated on the Gantt. (Never flags with no labour or only unnamed labour.)
  const noProjectSupervisor = p.type === 'live' && projectHasNamedLabour && !p.siteSupervisor && !ganttHasSupervisor

  async function saveMeta(nextStart, nextCompl) {
    await fetch('/api/planning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-meta', key: p.key, startDate: nextStart, completionDate: nextCompl }) }).catch(() => {})
    onSaveMeta && onSaveMeta()
  }

  const selDates = (sel && sel.key === p.key) ? sel.dates : null

  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #f2f2f2', minHeight: ROW_H, alignItems: 'stretch' }}>
      <Frozen w={NAME_W} left={0} style={{ background: neg ? '#fbfaf8' : '#fff', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', display: 'flex' }}>
        <div style={{ fontSize: 12.5, fontWeight: overrun ? 700 : 600, color: overrun ? '#dc2626' : (neg ? '#8a6d1a' : INK), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: NAME_W - 16 }}>
          {p.projectNo ? `${p.projectNo} — ` : ''}{p.name}
        </div>
        {missing && <div title="No start / completion dates set for this project" style={warnLine}>⚠ Start and Completion Dates needed</div>}
        {!projectHasLabour && <div title="No man days allocated on the Gantt for this project" style={warnLine}>⚠ Man day allocation needed</div>}
        {overrun && <div title="Man days allocated after the contracted completion date" style={warnLine}>⚠ Runs past completion date</div>}
        {historicNeedsActual && <div title="Historic allocations still need confirming as Actual" style={{ ...warnLine, color: '#ea580c' }}>⚑ Historic dates need confirming actual</div>}
        {noProjectSupervisor && <div title="No supervisor assigned in Project Details or allocated on the Gantt" style={warnLine}>⚠ No supervisor</div>}
        {p.location && <div style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: NAME_W - 16 }}>{p.location}</div>}
      </Frozen>
      {/* inline date editors */}
      <PlainCell w={DATE_W} style={{ background: !start ? '#fff8f8' : '#fff' }}>
        <input type="date" value={start} onChange={e => { setStart(e.target.value); saveMeta(e.target.value, compl) }} style={dateInput} />
      </PlainCell>
      <PlainCell w={DATE_W} style={{ background: !compl ? '#fff8f8' : '#fff' }}>
        <input type="date" value={compl} onChange={e => { setCompl(e.target.value); saveMeta(start, e.target.value) }} style={{ ...dateInput, color: overrun ? '#dc2626' : undefined, fontWeight: overrun ? 700 : undefined }} />
      </PlainCell>

      {view === 'day'
        ? days.map((d, i) => {
          const we = isWeekend(d); const key = iso(d)
          const cd = cellData((data.allocations[p.key] || {})[key])
          const n = cd.count
          const isCompl = complD && sameDay(d, complD)
          const pastCompl = complD && d > complD && n > 0
          const selected = selDates && selDates.has(key)
          const col = n ? cellColours(cd) : null
          const isToday = key === todayCellKey
          // Layer markers via box-shadow insets (base status edge, then today's green right line)
          const shadows = []
          if (isCompl) shadows.push('inset -2px 0 0 0 #dc2626')
          else if (col) shadows.push(`inset 0 -3px 0 0 ${col.edge}`)
          if (isToday) shadows.push('inset -2px 0 0 0 #15803d')
          return (
            <div key={i}
              onMouseDown={() => onCellDown(p.key, d)}
              onMouseEnter={() => onCellEnter(p.key, d)}
              title={isToday ? 'Today' : (isCompl ? 'Contracted completion date' : (we ? 'Weekend' : ''))}
              style={{
                width: CELL_W, textAlign: 'center', cursor: 'pointer', userSelect: 'none',
                background: selected ? '#fde68a' : (col ? col.bg : (we ? '#f3f1ec' : '#fff')),
                borderLeft: (d.getDay() === 1 ? '2px solid #d9d5cc' : '1px solid #f5f5f5'),
                boxShadow: shadows.length ? shadows.join(', ') : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: pastCompl ? 15 : 12, fontWeight: pastCompl ? 900 : 700,
                color: pastCompl ? '#ff0000' : (col ? col.num : '#999'),
              }}>{n || ''}</div>
          )
        })
        : weekGroups.map((g, i) => {
          // Week view: numerator = ALL days worked in the week (incl. weekends);
          // denominator = working days (Mon–Fri = 5). Bar fill is capped at 5/5.
          const workdayCount = g.filter(d => !isWeekend(d)).length || 5
          const worked = g.filter(d => countOnDay(p, iso(d)) > 0).length
          const frac = Math.min(1, worked / workdayCount)
          const anyOverrun = complD && g.some(d => d > complD && countOnDay(p, iso(d)) > 0)
          const hasCompl = complD && g.some(d => sameDay(d, complD))
          return (
            <div key={i} title={worked ? `${worked}/${workdayCount} days worked` : ''} style={{ width: WEEKCELL_W, borderLeft: '1px solid #eee', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', boxShadow: hasCompl ? 'inset -2px 0 0 0 #dc2626' : 'none' }}>
              {frac > 0 && <div style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: `${frac * 100}%`, background: anyOverrun ? '#fca5a5' : (neg ? '#fde68a' : '#93c5fd'), borderRadius: 3 }} />}
              {worked > 0 && <span style={{ position: 'relative', fontSize: 9.5, fontWeight: 700, color: '#1e3a8a' }}>{worked}/{workdayCount}</span>}
            </div>
          )
        })
      }
    </div>
  )
}

// ── Water Ingress row: one permanent row; each day shows total headcount across all WI visits ──
function WaterIngressRow({ days, weekGroups, view, data, onOpenDay }) {
  const wi = data.waterIngress || {}
  const todayKey = iso(new Date())
  const headcount = (dk) => (wi[dk] || []).reduce((s, v) => s + (v.entries ? v.entries.length : 0) + (Number(v.unnamed) || 0), 0)
  const visitCount = (dk) => (wi[dk] || []).length
  // Combined status for a day's visits -> use the shared cellColours scheme.
  const dayCellData = (dk) => {
    const visits = wi[dk] || []
    let unnamed = 0, hasProvisional = false, allActual = visits.length > 0, hasAny = false
    for (const v of visits) {
      unnamed += Number(v.unnamed) || 0
      const named = (v.entries || []).length
      if (named > 0 || (Number(v.unnamed) || 0) > 0) hasAny = true
      if (v.status === 'provisional') hasProvisional = true
      if (v.status !== 'actual') allActual = false
    }
    const status = allActual ? 'actual' : (hasProvisional ? 'provisional' : 'confirmed')
    return { status, unnamed, hasAny }
  }
  // ⚑ historic-needs-confirming: a past day with visits not all marked Actual.
  let historicNeedsActual = false
  for (const [dk, visits] of Object.entries(wi)) {
    if (dk < todayKey && (visits || []).some(v => v.status !== 'actual' && ((v.entries || []).length > 0 || (Number(v.unnamed) || 0) > 0))) historicNeedsActual = true
  }
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #f2f2f2', minHeight: ROW_H, alignItems: 'stretch' }}>
      <Frozen w={NAME_W} left={0} style={{ background: '#f2f8fc', flexDirection: 'column', justifyContent: 'center', display: 'flex' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0e5a8a' }}>
          {historicNeedsActual && <span title="Historic water-ingress dates need confirming as Actual" style={{ color: '#ea580c' }}>⚑ </span>}💧 Water Ingress
        </div>
        <div style={{ fontSize: 10, color: '#7799aa' }}>Reactive visits — job name & address per allocation</div>
      </Frozen>
      <PlainCell w={DATE_W} style={{ background: '#f2f8fc' }} />
      <PlainCell w={DATE_W} style={{ background: '#f2f8fc' }} />
      {view === 'day'
        ? days.map((d, i) => {
          const dk = iso(d); const n = headcount(dk); const vc = visitCount(dk); const we = isWeekend(d)
          const col = n ? cellColours(dayCellData(dk)) : null
          const shadows = col ? [`inset 0 -3px 0 0 ${col.edge}`] : []
          return (
            <div key={i} onClick={() => onOpenDay(dk)} title={vc ? `${vc} water-ingress job${vc === 1 ? '' : 's'} — click to view/edit` : 'Click to add a water-ingress visit'}
              style={{ width: CELL_W, textAlign: 'center', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: col ? col.bg : (we ? '#f3f1ec' : '#fff'), borderLeft: (d.getDay() === 1 ? '2px solid #d9d5cc' : '1px solid #f5f5f5'),
                boxShadow: shadows.length ? shadows.join(', ') : 'none',
                fontSize: 12, fontWeight: 700, color: col ? col.num : '#ddd' }}>{n || ''}</div>
          )
        })
        : weekGroups.map((g, i) => {
          const total = g.reduce((s, d) => s + headcount(iso(d)), 0)
          return <div key={i} style={{ width: WEEKCELL_W, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid #eee', fontSize: 11, color: total ? '#0e5a8a' : '#ddd', fontWeight: 700 }}>{total || ''}</div>
        })}
    </div>
  )
}

// ── Water Ingress day modal: list visits for a day; add/edit/delete each ──
function WaterIngressDayModal({ date, data, ops, comp = {}, onClose, onDone, reloadOps }) {
  const existing = (data.waterIngress || {})[date] || []
  const [visits, setVisits] = useState(existing)
  const [editing, setEditing] = useState(null)
  const dObj = parseISO(date)

  async function del(id) {
    if (!window.confirm('Delete this water-ingress visit?')) return
    await fetch('/api/planning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'wi-delete', date, id }) }).catch(() => {})
    setVisits(prev => prev.filter(v => v.id !== id))
    onDone()
  }
  const opName = (id) => { const o = ops.find(x => x.id === id); return o ? `${o.firstName} ${o.lastName}` : id }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 2vw', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 640 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid #eee' }}>
          <div>
            <div style={{ fontWeight: 700, color: INK, fontSize: 16 }}>💧 Water Ingress — {dObj.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div>
            <div style={{ fontSize: 12, color: '#888' }}>One or more reactive visits. Each needs a job name and address.</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 24, border: 'none', background: 'none', cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        <div style={{ padding: '16px 22px 22px' }}>
          {editing ? (
            <WIVisitEditor date={date} visit={editing === 'new' ? null : editing} data={data} ops={ops} comp={comp}
              onCancel={() => setEditing(null)}
              onSaved={(v) => { setVisits(prev => { const i = prev.findIndex(x => x.id === v.id); if (i >= 0) { const n = [...prev]; n[i] = v; return n } return [...prev, v] }); setEditing(null); onDone() }}
              reloadOps={reloadOps} />
          ) : (
            <>
              {visits.length === 0 && <div style={{ color: '#999', fontSize: 13, padding: '10px 0' }}>No water-ingress visits yet for this day.</div>}
              {visits.map(v => (
                <div key={v.id} style={{ border: '1px solid #e8e8e8', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: INK, fontSize: 14 }}>{v.jobName}</div>
                      <div style={{ fontSize: 12, color: '#666' }}>{v.jobAddress}</div>
                      <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                        {(v.entries || []).map(e => opName(e.opId)).join(', ')}{v.unnamed > 0 ? `${v.entries && v.entries.length ? ', ' : ''}${v.unnamed} unnamed` : ''}
                        <span style={{ marginLeft: 8, textTransform: 'capitalize', color: v.status === 'provisional' ? '#2563eb' : (v.status === 'actual' ? '#15803d' : '#16a34a') }}>· {v.status}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setEditing(v)} style={{ ...ghostBtn, padding: '5px 10px', fontSize: 12 }}>Edit</button>
                      <button onClick={() => del(v.id)} style={{ ...ghostBtn, padding: '5px 10px', fontSize: 12, color: '#dc2626' }}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={() => setEditing('new')} style={{ ...primaryBtn, marginTop: 4 }}>+ Add water-ingress visit</button>
            </>
          )}
          {!editing && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, borderTop: '1px solid #eee', paddingTop: 14 }}><button onClick={onClose} style={ghostBtn}>Close</button></div>}
        </div>
      </div>
    </div>
  )
}

function WIVisitEditor({ date, visit, data, ops, comp = {}, onCancel, onSaved, reloadOps }) {
  const liveProjects = (data.projects || []).filter(p => p.type === 'live')
  const [jobName, setJobName] = useState(visit?.jobName || '')
  const [jobAddress, setJobAddress] = useState(visit?.jobAddress || '')
  const [projectNo, setProjectNo] = useState(visit?.projectNo || '')
  const [manualJob, setManualJob] = useState(!visit?.projectNo && !!visit?.jobName)
  const [picked, setPicked] = useState((visit?.entries || []).map(e => e.opId))
  const [unnamed, setUnnamed] = useState(visit?.unnamed || 0)
  const [status, setStatus] = useState(visit?.status || '')
  const [pick, setPick] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const todayKey = iso(new Date())
  const isPast = date < todayKey

  function selectProject(no) {
    setProjectNo(no)
    const p = liveProjects.find(x => x.projectNo === no)
    if (p) { setJobName(p.projectNo + (p.name && p.name !== p.projectNo ? ` — ${p.name}` : '')); setJobAddress(p.location || '') }
  }
  function addPick(id) {
    if (!id || picked.includes(id)) return
    const c = comp[id] || {}
    if (!c.hasCSCS || !c.hasWAH) {
      const o = ops.find(x => x.id === id); const nm = o ? `${o.firstName} ${o.lastName}` : 'this operative'
      window.alert(`You cannot allocate ${nm} because they do not have a valid Working at Height or CSCS. These are mandatory trainings for all operatives.`)
      setPick(''); return
    }
    setPicked([...picked, id]); setPick('')
  }

  async function save() {
    setErr('')
    if (!jobName.trim() || !jobAddress.trim()) { setErr('Job name and address are both required.'); return }
    if (!picked.length && unnamed <= 0) { setErr('Add at least one installer or an unnamed headcount.'); return }
    if (!status) { setErr('Choose a status.'); return }
    setSaving(true)
    try {
      const body = { action: 'wi-save', date, visit: { id: visit?.id, jobName: jobName.trim(), jobAddress: jobAddress.trim(), projectNo: manualJob ? '' : projectNo, status, unnamed, entries: picked.map(id => ({ opId: id, half: 'full' })) } }
      const r = await fetch('/api/planning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Save failed')
      onSaved(d.visit)
    } catch (e) { setErr(e.message || 'Could not save.') }
    setSaving(false)
  }

  const available = ops.filter(o => !picked.includes(o.id))
  const input = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }

  return (
    <div>
      <div style={{ fontWeight: 700, color: INK, marginBottom: 10 }}>{visit ? 'Edit visit' : 'New water-ingress visit'}</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, marginBottom: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={manualJob} onChange={e => { setManualJob(e.target.checked); if (e.target.checked) setProjectNo(''); }} /> Enter an old / unlisted job manually
      </label>
      {!manualJob ? (
        <>
          <div style={lbl}>Job (live project)</div>
          <select value={projectNo} onChange={e => selectProject(e.target.value)} style={{ ...input, fontFamily: 'inherit' }}>
            <option value="">Select a project…</option>
            {liveProjects.map(p => <option key={p.projectNo} value={p.projectNo}>{p.projectNo}{p.name && p.name !== p.projectNo ? ` — ${p.name}` : ''}</option>)}
          </select>
        </>
      ) : (
        <>
          <div style={lbl}>Job name</div>
          <input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="e.g. Old Mill Warehouse" style={input} />
        </>
      )}
      <div style={{ ...lbl, marginTop: 10 }}>Project address</div>
      <textarea value={jobAddress} onChange={e => setJobAddress(e.target.value)} placeholder="Site address (required)" style={{ ...input, minHeight: 52, resize: 'vertical' }} />

      <div style={{ ...lbl, marginTop: 12 }}>Installers</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {picked.map(id => { const o = ops.find(x => x.id === id); return <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#eef6ff', border: '1px solid #cfe4fb', borderRadius: 16, padding: '4px 10px', fontSize: 12.5 }}>{o ? `${o.firstName} ${o.lastName}` : id}<button onClick={() => setPicked(picked.filter(x => x !== id))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#888' }}>×</button></span> })}
        {picked.length === 0 && <span style={{ fontSize: 12.5, color: '#aaa' }}>None selected.</span>}
      </div>
      <OperativeSearchSelect options={available} comp={comp} onPick={id => addPick(id)} placeholder="+ Add installer…" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <span style={lbl}>Unnamed headcount</span>
        <button onClick={() => setUnnamed(Math.max(0, unnamed - 1))} style={stepBtn}>−</button>
        <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{unnamed}</span>
        <button onClick={() => setUnnamed(unnamed + 1)} style={stepBtn}>+</button>
      </div>

      <div style={{ ...lbl, marginTop: 12 }}>Status {!status && <span style={{ color: '#dc2626', fontWeight: 600 }}>— choose one</span>}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {[['confirmed', 'Confirmed', C_CONFIRMED], ['provisional', 'Provisional', C_PROVISIONAL], ['actual', 'Actual', C_ACTUAL]].map(([v, label, c]) => {
          const disabled = v === 'actual' && !isPast
          return <button key={v} disabled={disabled} onClick={() => setStatus(v)} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: status === v ? `2px solid ${c}` : '1px solid #ddd', background: disabled ? '#f4f4f4' : (status === v ? c + '22' : '#fff'), fontWeight: status === v ? 700 : 500, fontSize: 12.5, cursor: disabled ? 'not-allowed' : 'pointer', color: disabled ? '#bbb' : '#333' }}>{label}</button>
        })}
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 12 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16, borderTop: '1px solid #eee', paddingTop: 14 }}>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        <button onClick={save} disabled={saving} style={{ ...primaryBtn, ...(saving ? { opacity: 0.5 } : {}) }}>{saving ? 'Saving…' : (visit ? 'Save visit' : 'Add visit')}</button>
      </div>
    </div>
  )
}

// Frozen left columns use sticky positioning so they stay visible when scrolling.
function Frozen({ w, left, children, style }) {
  return (
    <div style={{ width: w, minWidth: w, position: 'sticky', left, zIndex: 3, padding: '4px 8px', borderRight: '1px solid #f0f0f0', background: '#fff', ...style }}>{children}</div>
  )
}
// Non-sticky fixed-width cell (scrolls with the calendar).
function PlainCell({ w, children, style }) {
  return (
    <div style={{ width: w, minWidth: w, padding: '4px 8px', borderRight: '1px solid #f0f0f0', background: '#fff', display: 'flex', alignItems: 'center', ...style }}>{children}</div>
  )
}

const HeadCell = ({ w, children, style }) => <div style={{ width: w, padding: '6px 8px', fontSize: 11, color: '#666', ...style }}>{children}</div>
const SectionLabel = ({ children, neg }) => (
  <div style={{ position: 'sticky', left: 0, padding: '5px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: neg ? '#8a6d1a' : GOLD, background: neg ? '#fdfbf3' : '#faf9f7', borderBottom: '1px solid #eee', borderTop: '1px solid #eee' }}>{children}</div>
)
const EmptyRow = ({ children }) => <div style={{ padding: '10px 12px', fontSize: 12, color: '#aaa', position: 'sticky', left: 0 }}>{children}</div>
function Legend({ c, label }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid rgba(0,0,0,0.1)', display: 'inline-block' }} />{label}</span>
}

const lbl = { fontSize: 11, color: '#888', marginBottom: 3 }
const fInput = { padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5 }
const segBtn = { border: 'none', padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }
const stepBtn = { width: 28, height: 28, borderRadius: 6, border: '1px solid #d9d5cc', background: '#fff', fontSize: 16, cursor: 'pointer', lineHeight: '1' }
const dateInput = { width: '100%', boxSizing: 'border-box', border: '1px solid #e8e8e8', borderRadius: 6, padding: '4px 4px', fontSize: 10.5, fontFamily: 'inherit', background: 'transparent' }
const warnLine = { fontSize: 10.5, fontWeight: 700, color: '#ff2d2d', whiteSpace: 'nowrap' }

// ── Weekly labour pop-out: filters + one stacked table per week + Download/Send ──
function WeekModal({ monday, onClose }) {
  const [weeksAhead, setWeeksAhead] = useState(1)      // 1..4 forward weeks (week 1 = next Monday)
  const [includePrev, setIncludePrev] = useState(false) // Previous week (download-only), off by default
  const [weeksData, setWeeksData] = useState(null)     // array of { week, kind:'prev'|'ahead', label }
  const [excluded, setExcluded] = useState(new Set())
  const [emailing, setEmailing] = useState(false)
  const [sent, setSent] = useState(false)
  const [msg, setMsg] = useState('')

  const DOWFULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const statusColour = (s) => s === 'actual' ? C_ACTUAL : s === 'provisional' ? C_PROVISIONAL : C_CONFIRMED

  // `monday` = current week's Monday. Week 1 = NEXT Monday (current + 7). Previous = current - 7.
  const thisMon = parseISO(monday)
  const nextMon = new Date(thisMon.getTime() + 7 * 86400000)
  const prevMon = new Date(thisMon.getTime() - 7 * 86400000)
  const aheadMondays = Array.from({ length: weeksAhead }, (_, i) => iso(new Date(nextMon.getTime() + i * 7 * 86400000)))
  const prevMonISO = iso(prevMon)

  // Load previous (if selected) + the forward weeks.
  useEffect(() => {
    let cancelled = false
    async function loadWeeks() {
      setWeeksData(null)
      const plan = []
      if (includePrev) plan.push({ monday: prevMonISO, kind: 'prev', label: 'Previous week' })
      aheadMondays.forEach((m, i) => plan.push({ monday: m, kind: 'ahead', label: i === 0 ? 'Week 1 (next week)' : `Week ${i + 1}` }))
      const results = await Promise.all(plan.map(p => fetch(`/api/planning-week?monday=${encodeURIComponent(p.monday)}`).then(r => r.json()).then(week => ({ week, kind: p.kind, label: p.label })).catch(() => null)))
      if (!cancelled) setWeeksData(results.filter(Boolean))
    }
    loadWeeks()
    return () => { cancelled = true }
  }, [monday, weeksAhead, includePrev])

  // Emailable = named rows with an email, but ONLY from forward (ahead) weeks — never the previous week.
  const emailable = useMemo(() => {
    if (!weeksData) return []
    const map = {}
    for (const w of weeksData) { if (w.kind !== 'ahead') continue; for (const r of w.week.rows) if (!r.unnamed) map[r.opId] = r }
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name))
  }, [weeksData])

  const toggleExcl = (opId) => setExcluded(prev => { const n = new Set(prev); n.has(opId) ? n.delete(opId) : n.add(opId); return n })

  async function sendEmails() {
    setEmailing(true); setMsg('')
    try {
      const weeks = aheadMondays  // forward weeks only; previous week is never emailed
      const includeOpIds = emailable.filter(r => !excluded.has(r.opId)).map(r => r.opId)
      const d = await fetch('/api/planning-week-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weeks, includeOpIds }) }).then(r => r.json())
      setMsg(`Sent to ${d.sent} operative${d.sent === 1 ? '' : 's'}.${d.skipped?.length ? ` Skipped: ${d.skipped.join(', ')}.` : ''}`)
      setSent(true)
    } catch { setMsg('Could not send.') }
    setEmailing(false)
  }

  // PDF: covers the forward weeks (and previous week if selected). We pass the earliest monday + count.
  const pdfStart = includePrev ? prevMonISO : aheadMondays[0]
  const pdfCount = weeksAhead + (includePrev ? 1 : 0)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 2vw', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 1000 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff', borderRadius: '14px 14px 0 0', zIndex: 5 }}>
          <div>
            <div style={{ fontWeight: 700, color: INK, fontSize: 16 }}>Send Weekly Labour Allocation</div>
            <div style={{ fontSize: 12, color: '#888' }}>Week 1 = w/c {nextMon.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 24, border: 'none', background: 'none', cursor: 'pointer', color: '#999' }}>×</button>
        </div>

        <div style={{ padding: '14px 22px 22px' }}>
          <div style={{ fontSize: 12.5, color: '#92400e', background: '#fffbeb', border: '1px solid #f0e2b0', borderRadius: 8, padding: '9px 12px', marginBottom: 14 }}>
            Emails cover the upcoming weeks only (Week 1 is next week). The Previous week is download-only and is never emailed.
          </div>
          {/* filters */}
          <div style={{ padding: 14, border: '1px solid #eee', background: '#faf9f7', borderRadius: 10, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#555' }}>How far ahead:</span>
              {[1, 2, 3, 4].map(w => (
                <button key={w} onClick={() => setWeeksAhead(w)} style={{ padding: '6px 12px', borderRadius: 8, border: weeksAhead === w ? `2px solid ${GOLD}` : '1px solid #ddd', background: weeksAhead === w ? '#fffbeb' : '#fff', fontWeight: weeksAhead === w ? 700 : 500, fontSize: 12.5, cursor: 'pointer' }}>{w} week{w > 1 ? 's' : ''}</button>
              ))}
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, marginLeft: 6, cursor: 'pointer', color: '#555' }}>
                <input type="checkbox" checked={includePrev} onChange={e => setIncludePrev(e.target.checked)} />
                Include previous week (download only)
              </label>
            </div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Untick anyone you don't want to email (upcoming weeks only):</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {emailable.length === 0 && <span style={{ fontSize: 12.5, color: '#aaa' }}>No named operatives in the upcoming weeks.</span>}
              {emailable.map(r => (
                <label key={r.opId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 20, padding: '5px 12px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!excluded.has(r.opId)} onChange={() => toggleExcl(r.opId)} />
                  {r.name}{!r.email ? ' (no email)' : ''}
                </label>
              ))}
            </div>
          </div>

          {/* colour key */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 12, fontSize: 11.5, color: '#555' }}>
            <span style={{ fontWeight: 700, color: '#888' }}>Key:</span>
            <Legend c={C_ACTUAL} label="Actual" />
            <Legend c={C_CONFIRMED} label="Confirmed" />
            <Legend c={C_PROVISIONAL} label="Provisional" />
            <Legend c={C_UNNAMED} label="Unnamed / TBC" />
          </div>

          {/* stacked week tables */}
          {!weeksData ? <Loading /> : weeksData.map((w, wi) => {
            const week = w.week
            return (
            <div key={wi} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: w.kind === 'prev' ? '#92400e' : GOLD, marginBottom: 6 }}>
                {w.label} — W/C {parseISO(week.weekStart).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}{w.kind === 'prev' ? ' · download only' : ''}
              </div>
              {week.rows.length === 0 ? (
                <div style={{ color: '#aaa', fontSize: 12.5, padding: '10px 0' }}>No labour allocated this week.</div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: 10 }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820 }}>
                    <thead>
                      <tr style={{ background: '#faf9f7' }}>
                        <th style={{ ...wth, textAlign: 'left', minWidth: 150 }}>Operative</th>
                        {week.days.map((dk, i) => <th key={i} style={{ ...wth, background: i >= 5 ? '#f3f1ec' : undefined, color: i >= 5 ? '#b91c1c' : '#444' }}>{DOWFULL[i]}<div style={{ fontSize: 9, color: '#aaa', fontWeight: 400 }}>{parseISO(dk).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div></th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {week.rows.map(r => (
                        <tr key={r.opId} style={{ borderTop: '1px solid #f0f0f0', background: r.unnamed ? '#fff7ed' : undefined }}>
                          <td style={{ ...wtd, fontWeight: 600, color: r.unnamed ? '#9a3412' : INK }}>{r.name}{r.company && !r.unnamed ? <div style={{ fontSize: 10, color: '#aaa', fontWeight: 400 }}>{r.company}</div> : null}</td>
                          {r.cells.map((c, i) => (
                            <td key={i} style={{ ...wtd, textAlign: 'center', background: i >= 5 ? '#faf8f4' : undefined, fontSize: 11 }}>
                              {c ? c.entries.map((e, j) => {
                                const col = r.unnamed ? C_UNNAMED : statusColour(e.status)
                                return <div key={j} style={{ color: '#333' }}><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, background: col, marginRight: 4 }} />{e.unnamed ? `${e.unnamed} unnamed` : e.projectName}{e.half !== 'full' ? ` (${e.half.toUpperCase()})` : ''}</div>
                              }) : <span style={{ color: '#ddd' }}>—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr style={{ borderTop: '2px solid #e6e2d8', background: '#faf9f7' }}>
                        <td style={{ ...wtd, fontWeight: 700 }}>Total installers</td>
                        {week.dailyTotals.map((t, i) => <td key={i} style={{ ...wtd, textAlign: 'center', fontWeight: 700 }}>{t || 0}</td>)}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            )
          })}

          {msg && <div style={{ fontSize: 12.5, color: '#16a34a', marginTop: 12 }}>{msg}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8, borderTop: '1px solid #eee', paddingTop: 16, position: 'sticky', bottom: 0, background: '#fff' }}>
            <button onClick={onClose} style={ghostBtn}>Close</button>
            <a href={`/api/planning-week-pdf?monday=${encodeURIComponent(pdfStart)}&weeks=${pdfCount}`} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block' }}>Download PDF</a>
            <button onClick={sendEmails} disabled={emailing || sent || emailable.length === 0} style={{ ...primaryBtn, ...(sent ? { background: '#16a34a', cursor: 'default' } : {}) }}>{sent ? '✓ Sent' : (emailing ? 'Sending…' : 'Send to operatives')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Historic viewer: pick any W/C, view + download PDF only (no send) ──
function ViewWeekModal({ onClose }) {
  // Offer a list of W/C Mondays: 2 years back to 1 year forward.
  const wcOptions = useMemo(() => {
    const base = mondayOf(new Date())
    const opts = []
    for (let i = -104; i <= 52; i++) opts.push(iso(new Date(base.getTime() + i * 7 * 86400000)))
    return opts
  }, [])
  const thisMon = iso(mondayOf(new Date()))
  const [fromMonISO, setFromMonISO] = useState(thisMon)
  const [toMonISO, setToMonISO] = useState(thisMon)

  const fromMon = parseISO(fromMonISO)
  const toMon = parseISO(toMonISO)
  const weekCount = Math.min(26, Math.max(1, Math.round((toMon - fromMon) / (7 * 86400000)) + 1))
  const wcLabel = (m) => `W/C ${parseISO(m).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`

  // the weeks that will be in the PDF
  const weeksInRange = Array.from({ length: weekCount }, (_, i) => iso(new Date(fromMon.getTime() + i * 7 * 86400000)))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 2vw', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid #eee' }}>
          <div>
            <div style={{ fontWeight: 700, color: INK, fontSize: 16 }}>View Weekly Labour Allocations</div>
            <div style={{ fontSize: 12, color: '#888' }}>Download past &amp; upcoming weeks as a PDF</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 24, border: 'none', background: 'none', cursor: 'pointer', color: '#999' }}>×</button>
        </div>

        <div style={{ padding: '18px 22px 22px' }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
            <div><div style={lbl}>From</div>
              <select value={fromMonISO} onChange={e => { const v = e.target.value; setFromMonISO(v); if (parseISO(v) > parseISO(toMonISO)) setToMonISO(v) }} style={{ ...fInput, minWidth: 190, fontFamily: 'inherit' }}>
                {wcOptions.map(m => <option key={m} value={m}>{wcLabel(m)}</option>)}
              </select>
            </div>
            <div><div style={lbl}>To</div>
              <select value={toMonISO} onChange={e => setToMonISO(e.target.value)} style={{ ...fInput, minWidth: 190, fontFamily: 'inherit' }}>
                {wcOptions.filter(m => parseISO(m) >= fromMon).map(m => <option key={m} value={m}>{wcLabel(m)}</option>)}
              </select>
            </div>
          </div>

          <div style={{ fontSize: 12.5, color: '#555', marginBottom: 8 }}>{weekCount} week{weekCount === 1 ? '' : 's'} will be included (one page each, max 26):</div>
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #eee', borderRadius: 10, padding: '6px 0' }}>
            {weeksInRange.map(m => (
              <div key={m} style={{ padding: '6px 14px', fontSize: 13, color: INK, borderBottom: '1px solid #f5f5f5' }}>{wcLabel(m)}</div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18, borderTop: '1px solid #eee', paddingTop: 16 }}>
            <button onClick={onClose} style={ghostBtn}>Close</button>
            <a href={`/api/planning-week-pdf?monday=${encodeURIComponent(fromMonISO)}&weeks=${weekCount}`} target="_blank" rel="noreferrer" style={{ ...primaryBtn, textDecoration: 'none', display: 'inline-block' }}>Download PDF ({weekCount} wk{weekCount === 1 ? '' : 's'})</a>
          </div>
        </div>
      </div>
    </div>
  )
}

const wth = { padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#444', textAlign: 'center', borderBottom: '1px solid #eee' }
const wtd = { padding: '7px 10px', fontSize: 12, color: '#333', verticalAlign: 'top' }

// ── Searchable installer picker: type to filter the roster, click to add ──
function OperativeSearchSelect({ options, comp = {}, onPick, placeholder = 'Search installer…' }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ql = q.trim().toLowerCase()
  const filtered = !ql ? options : options.filter(o => {
    const name = `${o.firstName} ${o.lastName}`.toLowerCase()
    const company = (o.company || '').toLowerCase()
    return name.startsWith(ql) || name.split(/\s+/).some(w => w.startsWith(ql)) || name.includes(ql) || company.includes(ql)
  })
  return (
    <div style={{ position: 'relative' }}>
      <input value={q} onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder={placeholder}
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
      {open && (
        <div style={{ position: 'absolute', zIndex: 40, top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #ddd', borderRadius: 10, boxShadow: '0 6px 20px rgba(0,0,0,0.12)', maxHeight: 240, overflowY: 'auto' }}>
          {filtered.length === 0 && <div style={{ padding: '10px 12px', color: '#aaa', fontSize: 13 }}>No matching installers.</div>}
          {filtered.map(o => {
            const c = comp[o.id] || {}; const bad = !c.hasCSCS || !c.hasWAH
            return (
              <div key={o.id} onMouseDown={() => { onPick(o.id); setQ(''); setOpen(false) }}
                style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13.5, display: 'flex', justifyContent: 'space-between', gap: 8, borderBottom: '1px solid #f4f4f4' }}
                onMouseEnter={e => e.currentTarget.style.background = '#faf9f7'} onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                <span>{o.firstName} {o.lastName}{o.company ? ` (${o.company})` : ''}</span>
                {bad && <span style={{ color: '#dc2626', fontSize: 11, whiteSpace: 'nowrap' }}>⚠ no CSCS/WAH</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Allocate / edit labour for the selected dates ──
function AllocateModal({ proj, dates, mode = 'add', data, ops, comp = {}, onClose, onDone, reloadOps }) {
  const isEdit = mode === 'edit'
  // In edit mode, pre-load everyone currently allocated across ANY of the selected dates,
  // plus the max unnamed count and a common status.
  const cellOf = (dk) => cellData((data.allocations[proj.key] || {})[dk])
  const initialPicked = () => {
    if (!isEdit) return []
    const set = new Set()
    for (const dk of dates) for (const e of cellOf(dk).entries) set.add(e.opId)
    return [...set]
  }
  const initialUnnamed = () => { if (!isEdit) return 0; let m = 0; for (const dk of dates) m = Math.max(m, cellOf(dk).unnamed); return m }
  const initialStatus = () => {
    if (!isEdit) return ''   // add mode: no status pre-selected — user must choose
    const statuses = [...new Set(dates.map(dk => cellOf(dk).status))]
    return statuses.length === 1 ? statuses[0] : ''
  }
  const [picked, setPicked] = useState(initialPicked)   // named opIds
  const [unnamed, setUnnamed] = useState(initialUnnamed)  // extra unnamed slots
  const [status, setStatus] = useState(initialStatus)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [opList, setOpList] = useState(ops)
  useEffect(() => { setOpList(ops) }, [ops])

  const opName = (id) => { const o = opList.find(x => x.id === id); return o ? `${o.firstName} ${o.lastName}` : id }
  const opTrades = (id) => { const o = opList.find(x => x.id === id); return (o?.trades || []).join(', ') }
  const dateObjs = dates.map(parseISO).sort((a, b) => a - b)
  // Actual is only valid when EVERY selected date is before today.
  const todayKey = iso(new Date())
  const allPast = dates.length > 0 && dates.every(dk => dk < todayKey)
  const anyFuture = dates.some(dk => dk >= todayKey)
  // If a preloaded status is 'actual' but the selection isn't all-past, fall back to confirmed.
  useEffect(() => { if (status === 'actual' && !allPast) setStatus('confirmed') }, [])

  function addPick(id) {
    if (!id || picked.includes(id)) return
    const c = comp[id] || {}
    if (!c.hasCSCS || !c.hasWAH) {
      const o = opList.find(x => x.id === id)
      const nm = o ? `${o.firstName} ${o.lastName}` : 'this operative'
      window.alert(`You cannot allocate ${nm} because they do not have a valid Working at Height or CSCS. These are mandatory trainings for all operatives.\n\nAdd the in-date certificates in the H&S Training Matrix first.`)
      setPick('')
      return
    }
    setPicked([...picked, id]); setPick('')
  }
  function removePick(id) { setPicked(picked.filter(x => x !== id)) }

  async function save() {
    setErr('')
    const hasLabour = picked.length > 0 || unnamed > 0
    // In edit mode with all labour removed, saving clears the cells — no status needed.
    const clearing = isEdit && !hasLabour
    if (!clearing) {
      if (!hasLabour) { setErr('Add at least one installer, or set an unnamed headcount.'); return }
      if (!status) { setErr('Choose an allocation status (Confirmed, Provisional or Actual) before allocating.'); return }
    }
    setSaving(true)
    try {
      const clashes = []
      for (const dk of dates) {
        let entries
        if (isEdit) {
          entries = picked.map(id => ({ opId: id, half: 'full' }))
        } else {
          const existing = cellOf(dk).entries
          entries = [...existing.map(e => ({ opId: e.opId, half: e.half || 'full' }))]
          for (const id of picked) if (!entries.some(e => e.opId === id)) entries.push({ opId: id, half: 'full' })
        }
        // unnamed: in edit mode set to the chosen value; in add mode add to existing
        const dayUnnamed = isEdit ? unnamed : (cellOf(dk).unnamed + unnamed)
        const r = await fetch('/api/planning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-day', key: proj.key, date: dk, entries, unnamed: dayUnnamed, status }) })
        const d = await r.json()
        if (r.status === 409) clashes.push(`${opName(d.opId)} on ${fmtDMY(parseISO(dk))}`)
        else if (!r.ok) throw new Error(d.error || 'Save failed')
      }
      if (clashes.length) { setErr(`Some allocations clashed and were skipped: ${clashes.join('; ')}. Those installers are already on another project those days.`); setSaving(false); onDone(); return }
      onDone()
    } catch (e) { setErr(e.message || 'Could not save.') }
    setSaving(false)
  }

  const available = opList.filter(o => !picked.includes(o.id))
  const input = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 2vw', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid #eee' }}>
          <div>
            <div style={{ fontWeight: 700, color: INK, fontSize: 16 }}>{proj.name}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{isEdit ? 'Editing labour for' : 'Allocating labour for'} {dates.length} day{dates.length === 1 ? '' : 's'}{proj.type === 'negotiated' ? ' · not yet secured' : ''}</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 24, border: 'none', background: 'none', cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        <div style={{ padding: '12px 22px 22px' }}>
          {/* the dates being allocated */}
          <div style={lbl}>{isEdit ? 'Dates being edited' : 'Dates being allocated'}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, maxHeight: 96, overflowY: 'auto' }}>
            {dateObjs.map((d, i) => <span key={i} style={{ fontSize: 11.5, background: '#f3f4f6', borderRadius: 12, padding: '3px 9px', color: '#444' }}>{fmtLong(d)}</span>)}
          </div>
          {isEdit && <div style={{ fontSize: 11, color: '#b45309', background: '#fffbeb', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>Editing shows everyone currently allocated across the selected days. Saving sets this exact list on every selected day (remove someone to take them off those days).</div>}

          {/* Status */}
          <div style={lbl}>Allocation status {!status && (picked.length > 0 || unnamed > 0) && <span style={{ color: '#dc2626', fontWeight: 600 }}>— choose one to allocate</span>}{isEdit && !status && picked.length === 0 && unnamed === 0 && <span style={{ color: '#dc2626', fontWeight: 600 }}>— saving with no labour will clear these days</span>}</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            {[['confirmed', 'Confirmed', C_CONFIRMED], ['provisional', 'Provisional', C_PROVISIONAL], ['actual', 'Actual', C_ACTUAL]].map(([v, label, c]) => {
              const disabled = v === 'actual' && !allPast
              return (
                <button key={v} disabled={disabled} onClick={() => !disabled && setStatus(v)} title={disabled ? 'Actual can only be set on dates that have already passed' : ''}
                  style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: status === v ? `2px solid ${c}` : '1px solid #ddd', background: disabled ? '#f4f4f4' : (status === v ? c + '22' : '#fff'), fontWeight: status === v ? 700 : 500, fontSize: 12.5, cursor: disabled ? 'not-allowed' : 'pointer', color: disabled ? '#bbb' : '#333' }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: disabled ? '#ccc' : c, marginRight: 6 }} />{label}
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 12 }}>
            {allPast
              ? 'These dates have passed — set to Actual to confirm the work happened as planned (edit the people/headcount first if it differed).'
              : anyFuture ? 'Actual is only available once dates have passed. Use Confirmed or Provisional for upcoming work.' : ''}
          </div>

          <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '8px 0 6px' }}>{isEdit ? 'Installers allocated (full day)' : 'Installers to allocate (full day)'}</div>
          {picked.length === 0 && <div style={{ fontSize: 12.5, color: '#aaa', marginBottom: 8 }}>{isEdit ? 'No named installers.' : 'None selected yet.'}</div>}
          {picked.map(id => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#faf9f7', borderRadius: 8, marginBottom: 6 }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{opName(id)}</div>{opTrades(id) && <div style={{ fontSize: 10.5, color: '#999' }}>{opTrades(id)}</div>}</div>
              <button onClick={() => removePick(id)} style={{ ...linkBtn, color: '#dc2626' }}>Remove</button>
            </div>
          ))}

          {/* Unnamed headcount */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: '10px 12px', background: unnamed > 0 ? '#fff7ed' : '#faf9f7', borderRadius: 8, border: unnamed > 0 ? '1px solid #fed7aa' : '1px solid transparent' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>Unnamed slots {isEdit ? '(sets the total)' : '(added to the day)'}</div>
              <div style={{ fontSize: 11, color: '#9a3412' }}>Installers needed but not yet named — the cell shows orange until all are named.</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => setUnnamed(Math.max(0, unnamed - 1))} style={stepBtn}>−</button>
              <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{unnamed}</span>
              <button onClick={() => setUnnamed(unnamed + 1)} style={stepBtn}>+</button>
            </div>
          </div>

          {!addOpen ? (
            <div style={{ marginTop: 10 }}>
              <div style={lbl}>Add installer</div>
              <OperativeSearchSelect options={available} comp={comp} onPick={id => addPick(id)} />
              <button onClick={() => setAddOpen(true)} style={{ ...linkBtn, marginTop: 8, paddingLeft: 0 }}>+ Add new operative to the roster</button>
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>Clashes (same installer already on another project that day) are skipped and reported.</div>
            </div>
          ) : (
            <AddOperativeInline onCancel={() => setAddOpen(false)} onAdded={async (newId) => { const list = await reloadOps(); setOpList(list); setAddOpen(false); if (newId) setPicked(prev => prev.includes(newId) ? prev : [...prev, newId]) }} />
          )}

          {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 12 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18, borderTop: '1px solid #eee', paddingTop: 16 }}>
            <button onClick={onClose} style={ghostBtn}>Cancel</button>
            {(() => {
              const hasLabour = picked.length > 0 || unnamed > 0
              const clearMode = isEdit && !hasLabour
              const blocked = saving || (!clearMode && !status)
              const label = saving
                ? (isEdit ? 'Saving…' : 'Allocating…')
                : clearMode
                  ? `Clear labour on ${dates.length} day${dates.length === 1 ? '' : 's'}`
                  : (isEdit ? `Save changes to ${dates.length} day${dates.length === 1 ? '' : 's'}` : `Allocate to ${dates.length} day${dates.length === 1 ? '' : 's'}`)
              return <button onClick={save} disabled={blocked} style={{ ...primaryBtn, ...(clearMode ? { background: '#dc2626' } : {}), ...(blocked ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>{label}</button>
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}

const TRADES = ['Single Ply', 'Felt', 'Liquids', 'Hot Melt', 'Rainscreen', 'Composite Panels', 'Aluminium', 'Standing Seam', 'Labourer', 'Other']
function AddOperativeInline({ onCancel, onAdded }) {
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '', company: '', trades: [] })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (patch) => setF(prev => ({ ...prev, ...patch }))
  const toggleTrade = (t) => set({ trades: f.trades.includes(t) ? f.trades.filter(x => x !== t) : [...f.trades, t] })
  const input = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }

  async function save() {
    setErr('')
    if (!f.firstName.trim() || !f.lastName.trim()) return setErr('First and last name are required.')
    if (!f.email.trim()) return setErr('Email is required.')
    if (!f.phone.trim()) return setErr('Phone is required.')
    if (!f.company.trim()) return setErr('Company is required.')
    if (!f.trades.length) return setErr('Select at least one trade.')
    setSaving(true)
    try {
      const r = await fetch('/api/operatives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operative: f }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Save failed')
      onAdded(d.operative?.id)
    } catch (e) { setErr(e.message || 'Could not save.') }
    setSaving(false)
  }

  return (
    <div style={{ marginTop: 10, padding: 14, border: '1px solid #f0e2b0', background: '#fffdf5', borderRadius: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#92400e', marginBottom: 8 }}>New operative</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input placeholder="First name *" value={f.firstName} onChange={e => set({ firstName: e.target.value })} style={input} />
        <input placeholder="Last name *" value={f.lastName} onChange={e => set({ lastName: e.target.value })} style={input} />
        <input placeholder="Email *" value={f.email} onChange={e => set({ email: e.target.value })} style={input} type="email" />
        <input placeholder="Phone *" value={f.phone} onChange={e => set({ phone: e.target.value })} style={input} />
      </div>
      <input placeholder="Company *" value={f.company} onChange={e => set({ company: e.target.value })} style={{ ...input, marginTop: 8 }} />
      <div style={{ fontSize: 11, color: '#888', margin: '10px 0 6px' }}>Trade * (select all that apply)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {TRADES.map(t => { const on = f.trades.includes(t); return <button key={t} onClick={() => toggleTrade(t)} style={{ padding: '6px 11px', borderRadius: 16, border: on ? `2px solid ${GOLD}` : '1px solid #d9d5cc', background: on ? '#fffbeb' : '#fff', color: on ? '#92400e' : '#555', fontSize: 12, fontWeight: on ? 700 : 500, cursor: 'pointer' }}>{on ? '✓ ' : ''}{t}</button> })}
      </div>
      {err && <div style={{ color: '#dc2626', fontSize: 12.5, marginTop: 10 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Adding…' : 'Add operative'}</button>
      </div>
    </div>
  )
}
