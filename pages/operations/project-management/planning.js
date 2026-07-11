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

const NAME_W = 220, DATE_W = 92, CELL_W = 34, WEEKCELL_W = 46, ROW_H = 42

export default function PlanningPage() {
  const [data, setData] = useState(null)
  const [ops, setOps] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('day')          // 'day' | 'week'
  const [anchorMonday, setAnchorMonday] = useState(() => mondayOf(new Date()))
  const [historic, setHistoric] = useState(false)
  const [filters, setFilters] = useState({ project: '', installer: '', from: '', to: '' })
  // selection: { key, dates:Set<iso> }  — active drag project row
  const [sel, setSel] = useState(null)
  const [allocModal, setAllocModal] = useState(null)  // { proj, dates:[iso] }
  const dragging = useRef(false)

  async function load() {
    setLoading(true)
    try {
      const [pl, opr] = await Promise.all([
        fetch('/api/planning').then(r => r.json()).catch(() => ({})),
        fetch('/api/operatives').then(r => r.json()).catch(() => ({})),
      ])
      setData({ projects: pl.projects || [], allocations: pl.allocations || {}, meta: pl.meta || {} })
      setOps(opr.operatives || [])
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Default forward horizon = 3 years; historic pulls the start back 1 year.
  const RANGE_WEEKS = 156
  const days = useMemo(() => {
    let start = historic ? mondayOf(addDays(anchorMonday, -52 * 7)) : anchorMonday
    let end = addDays(anchorMonday, RANGE_WEEKS * 7 - 1)
    if (filters.from) { const f = mondayOf(parseISO(filters.from)); if (f) start = f }
    if (filters.to) { const t = parseISO(filters.to); if (t) end = t }
    const out = []
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(new Date(d))
    return out
  }, [anchorMonday, historic, filters.from, filters.to])

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

  const countOnDay = (p, dateKey) => {
    const list = (data.allocations[p.key] || {})[dateKey] || []
    let n = 0; for (const e of list) n += (e.half && e.half !== 'full') ? 0.5 : 1
    return n
  }
  const dayTotal = (date) => {
    const key = iso(date); let t = 0
    for (const p of [...liveRows, ...negRows]) t += countOnDay(p, key)
    return t
  }
  const shift = (deltaWeeks) => setAnchorMonday(m => mondayOf(addDays(m, deltaWeeks * 7)))

  // selection helpers (day view only)
  const toggleCell = (key, date) => {
    if (isWeekend(date)) return
    setSel(prev => {
      const dates = new Set(prev && prev.key === key ? prev.dates : [])
      const k = iso(date)
      if (dates.has(k)) dates.delete(k); else dates.add(k)
      return { key, dates }
    })
  }
  const dragTo = (key, date) => {
    if (!dragging.current || isWeekend(date)) return
    setSel(prev => {
      if (!prev || prev.key !== key) return { key, dates: new Set([iso(date)]) }
      const dates = new Set(prev.dates); dates.add(iso(date)); return { key, dates }
    })
  }
  const startDrag = (key, date) => { if (isWeekend(date)) return; dragging.current = true; toggleCell(key, date) }

  const openAllocate = () => {
    if (!sel || !sel.dates.size) return
    const proj = data.projects.find(p => p.key === sel.key)
    if (!proj) return
    const dates = [...sel.dates].sort()
    setAllocModal({ proj, dates })
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
          <div style={{ display: 'flex', border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => setView('day')} style={{ ...segBtn, background: view === 'day' ? GOLD : '#fff', color: view === 'day' ? '#fff' : '#555' }}>Day</button>
            <button onClick={() => setView('week')} style={{ ...segBtn, background: view === 'week' ? GOLD : '#fff', color: view === 'week' ? '#fff' : '#555' }}>Week</button>
          </div>
          <button onClick={() => setHistoric(h => !h)} title="Show past weeks"
            style={{ ...ghostBtn, background: historic ? '#fffbeb' : '#f2f2f0', color: historic ? '#92400e' : '#555', fontWeight: historic ? 700 : 400 }}>
            {historic ? '✓ Historic' : 'Historic'}
          </button>
          <button onClick={() => shift(-12)} style={ghostBtn}>‹</button>
          <button onClick={() => setAnchorMonday(mondayOf(new Date()))} style={ghostBtn}>Today</button>
          <button onClick={() => shift(12)} style={ghostBtn}>›</button>
        </div>
      </div>

      {/* selection action bar (day view) */}
      {view === 'day' && sel && sel.dates.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fffbeb', border: '1px solid #f0e2b0', borderRadius: 10, padding: '10px 14px', marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: '#92400e' }}>
            <strong>{data.projects.find(p => p.key === sel.key)?.name}</strong> — {sel.dates.size} day{sel.dates.size === 1 ? '' : 's'} selected
          </div>
          <button onClick={openAllocate} style={primaryBtn}>Allocate labour →</button>
          <button onClick={() => setSel(null)} style={ghostBtn}>Clear selection</button>
        </div>
      )}

      <div style={{ border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: NAME_W + DATE_W * 2 + (view === 'day' ? days.length * CELL_W : weekGroups.length * WEEKCELL_W) }}>

            {/* Week/date header */}
            <div style={{ display: 'flex', borderBottom: '1px solid #eee', background: '#faf9f7' }}>
              <Frozen w={NAME_W} left={0} style={{ fontWeight: 700, background: '#faf9f7' }}>Project</Frozen>
              <Frozen w={DATE_W} left={NAME_W} style={{ background: '#faf9f7' }}>Start</Frozen>
              <Frozen w={DATE_W} left={NAME_W + DATE_W} style={{ background: '#faf9f7' }}>Contract Compl.</Frozen>
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
                <Frozen w={DATE_W} left={NAME_W}></Frozen>
                <Frozen w={DATE_W} left={NAME_W + DATE_W}></Frozen>
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
            {liveRows.map(p => <GanttRow key={p.key} p={p} days={days} weekGroups={weekGroups} view={view} data={data} countOnDay={countOnDay}
              sel={sel} onCellDown={startDrag} onCellEnter={dragTo} onSaveMeta={load} />)}

            <SectionLabel neg>NEGOTIATED — NOT YET SECURED</SectionLabel>
            {negRows.length === 0 && <EmptyRow>No negotiated projects.</EmptyRow>}
            {negRows.map(p => <GanttRow key={p.key} p={p} days={days} weekGroups={weekGroups} view={view} data={data} countOnDay={countOnDay} neg
              sel={sel} onCellDown={startDrag} onCellEnter={dragTo} onSaveMeta={load} />)}

          </div>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: '#999', marginTop: 8 }}>
        {view === 'day'
          ? 'Click a day to select it (click again to deselect); drag across days to select a range, then “Allocate labour”. Weekends can’t be selected. Edit Start / Contracted Completion directly in the row.'
          : 'Week view is read-only. Each column is a week; part-weeks are filled proportionally (x/5 working days). Switch to Day view to allocate labour.'}
      </div>

      {allocModal && <AllocateModal proj={allocModal.proj} dates={allocModal.dates} data={data} ops={ops}
        onClose={() => setAllocModal(null)} onDone={() => { setAllocModal(null); setSel(null); load() }} reloadOps={async () => { const d = await fetch('/api/operatives').then(r => r.json()); setOps(d.operatives || []); return d.operatives || [] }} />}
    </OperationsShell>
  )
}

function GanttRow({ p, days, weekGroups, view, data, neg, countOnDay, sel, onCellDown, onCellEnter, onSaveMeta }) {
  const meta = data.meta[p.key] || {}
  const [start, setStart] = useState(meta.startDate || '')
  const [compl, setCompl] = useState(meta.completionDate || '')
  useEffect(() => { setStart(meta.startDate || ''); setCompl(meta.completionDate || '') }, [meta.startDate, meta.completionDate])

  const startD = parseISO(start), complD = parseISO(compl)
  const missing = !start || !compl
  let lastAlloc = null
  for (const dk of Object.keys(data.allocations[p.key] || {})) { const dd = parseISO(dk); if (dd && (!lastAlloc || dd > lastAlloc)) lastAlloc = dd }
  const overrun = complD && lastAlloc && lastAlloc > complD

  async function saveMeta(nextStart, nextCompl) {
    await fetch('/api/planning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-meta', key: p.key, startDate: nextStart, completionDate: nextCompl }) }).catch(() => {})
    onSaveMeta && onSaveMeta()
  }

  const selDates = (sel && sel.key === p.key) ? sel.dates : null

  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #f2f2f2', minHeight: ROW_H, alignItems: 'stretch' }}>
      <Frozen w={NAME_W} left={0} style={{ background: neg ? '#fbfaf8' : '#fff', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', display: 'flex' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: neg ? '#8a6d1a' : INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: NAME_W - 16 }}>
          {missing && <span title="Start / completion date missing" style={{ color: '#dc2626' }}>⚠ </span>}
          {overrun && <span title="Runs past contracted completion" style={{ color: '#dc2626' }}>⚠ </span>}
          {p.projectNo ? `${p.projectNo} — ` : ''}{p.name}
        </div>
        {p.location && <div style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: NAME_W - 16 }}>{p.location}</div>}
      </Frozen>
      {/* inline date editors */}
      <Frozen w={DATE_W} left={NAME_W} style={{ background: !start ? '#fff8f8' : '#fff' }}>
        <input type="date" value={start} onChange={e => { setStart(e.target.value); saveMeta(e.target.value, compl) }} style={dateInput} />
      </Frozen>
      <Frozen w={DATE_W} left={NAME_W + DATE_W} style={{ background: !compl ? '#fff8f8' : '#fff' }}>
        <input type="date" value={compl} onChange={e => { setCompl(e.target.value); saveMeta(start, e.target.value) }} style={{ ...dateInput, color: overrun ? '#dc2626' : undefined }} />
      </Frozen>

      {view === 'day'
        ? days.map((d, i) => {
          const we = isWeekend(d); const key = iso(d); const n = countOnDay(p, key)
          const isCompl = complD && sameDay(d, complD)
          const past = complD && d > complD && n > 0
          const selected = selDates && selDates.has(key)
          return (
            <div key={i}
              onMouseDown={() => onCellDown(p.key, d)}
              onMouseEnter={() => onCellEnter(p.key, d)}
              title={isCompl ? 'Contracted completion date' : (we ? 'Weekend' : '')}
              style={{
                width: CELL_W, textAlign: 'center', cursor: we ? 'default' : 'pointer', userSelect: 'none',
                background: selected ? '#fde68a' : (past ? '#fee2e2' : (n ? (neg ? '#fef9c3' : '#dbeafe') : (we ? '#f3f1ec' : '#fff'))),
                borderLeft: (d.getDay() === 1 ? '2px solid #d9d5cc' : '1px solid #f5f5f5'),
                boxShadow: isCompl ? 'inset -2px 0 0 0 #dc2626' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, color: neg ? '#8a6d1a' : '#1e40af',
              }}>{n || ''}</div>
          )
        })
        : weekGroups.map((g, i) => {
          // week view: proportion of working days (Mon-Fri) with allocations
          const workdays = g.filter(d => !isWeekend(d))
          const worked = workdays.filter(d => countOnDay(p, iso(d)) > 0).length
          const frac = workdays.length ? worked / workdays.length : 0
          const anyOverrun = complD && g.some(d => d > complD && countOnDay(p, iso(d)) > 0)
          const hasCompl = complD && g.some(d => sameDay(d, complD))
          return (
            <div key={i} title={worked ? `${worked}/${workdays.length} working days` : ''} style={{ width: WEEKCELL_W, borderLeft: '1px solid #eee', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', boxShadow: hasCompl ? 'inset -2px 0 0 0 #dc2626' : 'none' }}>
              {frac > 0 && <div style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: `${frac * 100}%`, background: anyOverrun ? '#fca5a5' : (neg ? '#fde68a' : '#93c5fd'), borderRadius: 3 }} />}
              {worked > 0 && <span style={{ position: 'relative', fontSize: 9.5, fontWeight: 700, color: '#1e3a8a' }}>{worked}/{workdays.length}</span>}
            </div>
          )
        })
      }
    </div>
  )
}

// Frozen left columns use sticky positioning so they stay visible when scrolling.
function Frozen({ w, left, children, style }) {
  return (
    <div style={{ width: w, minWidth: w, position: 'sticky', left, zIndex: 3, padding: '4px 8px', borderRight: '1px solid #f0f0f0', background: '#fff', ...style }}>{children}</div>
  )
}

const HeadCell = ({ w, children, style }) => <div style={{ width: w, padding: '6px 8px', fontSize: 11, color: '#666', ...style }}>{children}</div>
const SectionLabel = ({ children, neg }) => (
  <div style={{ position: 'sticky', left: 0, padding: '5px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: neg ? '#8a6d1a' : GOLD, background: neg ? '#fdfbf3' : '#faf9f7', borderBottom: '1px solid #eee', borderTop: '1px solid #eee' }}>{children}</div>
)
const EmptyRow = ({ children }) => <div style={{ padding: '10px 12px', fontSize: 12, color: '#aaa', position: 'sticky', left: 0 }}>{children}</div>

const lbl = { fontSize: 11, color: '#888', marginBottom: 3 }
const fInput = { padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5 }
const segBtn = { border: 'none', padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }
const dateInput = { width: '100%', boxSizing: 'border-box', border: '1px solid #e8e8e8', borderRadius: 6, padding: '4px 4px', fontSize: 10.5, fontFamily: 'inherit', background: 'transparent' }

// ── Allocate labour to the selected dates ──
function AllocateModal({ proj, dates, data, ops, onClose, onDone, reloadOps }) {
  // pre-fill installers common to ALL selected dates? Start empty; user picks who to add across the range.
  const [picked, setPicked] = useState([])   // opIds to allocate across all selected dates
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [opList, setOpList] = useState(ops)
  useEffect(() => { setOpList(ops) }, [ops])

  const opName = (id) => { const o = opList.find(x => x.id === id); return o ? `${o.firstName} ${o.lastName}` : id }
  const opTrades = (id) => { const o = opList.find(x => x.id === id); return (o?.trades || []).join(', ') }
  const dateObjs = dates.map(parseISO).sort((a, b) => a - b)

  function addPick(id) { if (!id || picked.includes(id)) return; setPicked([...picked, id]); setPick('') }
  function removePick(id) { setPicked(picked.filter(x => x !== id)) }

  async function save() {
    setErr('')
    if (!picked.length) { setErr('Add at least one installer.'); return }
    setSaving(true)
    try {
      const clashes = []
      for (const dk of dates) {
        // merge existing entries for that day with the newly picked (avoid dupes), all full-day
        const existing = (data.allocations[proj.key] || {})[dk] || []
        const merged = [...existing.map(e => ({ opId: e.opId, half: e.half || 'full' }))]
        for (const id of picked) if (!merged.some(e => e.opId === id)) merged.push({ opId: id, half: 'full' })
        const r = await fetch('/api/planning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-day', key: proj.key, date: dk, entries: merged }) })
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
            <div style={{ fontSize: 12, color: '#888' }}>Allocating labour for {dates.length} day{dates.length === 1 ? '' : 's'}{proj.type === 'negotiated' ? ' · not yet secured' : ''}</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 24, border: 'none', background: 'none', cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        <div style={{ padding: '12px 22px 22px' }}>
          {/* the dates being allocated */}
          <div style={lbl}>Dates being allocated</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, maxHeight: 96, overflowY: 'auto' }}>
            {dateObjs.map((d, i) => <span key={i} style={{ fontSize: 11.5, background: '#f3f4f6', borderRadius: 12, padding: '3px 9px', color: '#444' }}>{fmtLong(d)}</span>)}
          </div>

          <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '8px 0 6px' }}>Installers to allocate (full day)</div>
          {picked.length === 0 && <div style={{ fontSize: 12.5, color: '#aaa', marginBottom: 8 }}>None selected yet.</div>}
          {picked.map(id => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#faf9f7', borderRadius: 8, marginBottom: 6 }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{opName(id)}</div>{opTrades(id) && <div style={{ fontSize: 10.5, color: '#999' }}>{opTrades(id)}</div>}</div>
              <button onClick={() => removePick(id)} style={{ ...linkBtn, color: '#dc2626' }}>Remove</button>
            </div>
          ))}

          {!addOpen ? (
            <div style={{ marginTop: 10 }}>
              <div style={lbl}>Add installer</div>
              <select value={pick} onChange={e => addPick(e.target.value)} style={input}>
                <option value="">Select installer…</option>
                {available.map(o => <option key={o.id} value={o.id}>{o.firstName} {o.lastName}{o.company ? ` (${o.company})` : ''}</option>)}
              </select>
              <button onClick={() => setAddOpen(true)} style={{ ...linkBtn, marginTop: 8, paddingLeft: 0 }}>+ Add new operative to the roster</button>
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>Clashes (same installer already on another project that day) are skipped and reported.</div>
            </div>
          ) : (
            <AddOperativeInline onCancel={() => setAddOpen(false)} onAdded={async (newId) => { const list = await reloadOps(); setOpList(list); setAddOpen(false); if (newId) setPicked(prev => prev.includes(newId) ? prev : [...prev, newId]) }} />
          )}

          {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 12 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18, borderTop: '1px solid #eee', paddingTop: 16 }}>
            <button onClick={onClose} style={ghostBtn}>Cancel</button>
            <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Allocating…' : `Allocate to ${dates.length} day${dates.length === 1 ? '' : 's'}`}</button>
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
