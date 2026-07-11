import { useState, useEffect, useMemo, useRef } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, Loading, primaryBtn, ghostBtn, linkBtn } from '../../../components/opsUI'

const DAY = 86400000
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parseISO = (s) => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const addDays = (d, n) => new Date(d.getTime() + n * DAY)
const mondayOf = (d) => { const x = new Date(d); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd) }
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const fmtDMY = (d) => d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'
const sameDay = (a, b) => a && b && iso(a) === iso(b)

const NAME_W = 210, DATE_W = 96, CELL_W = 34, ROW_H = 40

export default function PlanningPage() {
  const [data, setData] = useState(null)
  const [ops, setOps] = useState([])
  const [loading, setLoading] = useState(true)
  const [weeks, setWeeks] = useState(8)
  const [anchorMonday, setAnchorMonday] = useState(() => mondayOf(new Date()))
  const [dayModal, setDayModal] = useState(null)
  const [filters, setFilters] = useState({ project: '', installer: '', from: '', to: '' })

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

  const days = useMemo(() => {
    let start = anchorMonday
    let end = addDays(anchorMonday, weeks * 7 - 1)
    if (filters.from) { const f = mondayOf(parseISO(filters.from)); if (f) start = f }
    if (filters.to) { const t = parseISO(filters.to); if (t) end = t }
    const out = []
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(new Date(d))
    return out
  }, [anchorMonday, weeks, filters.from, filters.to])

  const weekGroups = useMemo(() => {
    const groups = []
    for (let i = 0; i < days.length; i += 7) groups.push(days.slice(i, i + 7))
    return groups
  }, [days])

  if (loading || !data) return (
    <OperationsShell active="pm:planning" section="pm" title="Planning" wide><PageHeading title="Planning" /><Loading /></OperationsShell>
  )

  const live = data.projects.filter(p => p.type === 'live')
  const negotiated = data.projects.filter(p => p.type === 'negotiated')

  const matchProject = (p) => {
    if (filters.project && p.key !== filters.project) return false
    if (filters.installer) {
      const opDays = data.allocations[p.key] || {}
      const hasOp = Object.values(opDays).some(list => (list || []).some(e => e.opId === filters.installer))
      if (!hasOp) return false
    }
    return true
  }
  const liveRows = live.filter(matchProject)
  const negRows = negotiated.filter(matchProject)

  const dayTotal = (date) => {
    const key = iso(date); let total = 0
    for (const p of [...liveRows, ...negRows]) {
      const list = (data.allocations[p.key] || {})[key] || []
      for (const e of list) total += (e.half && e.half !== 'full') ? 0.5 : 1
    }
    return total
  }
  const countFor = (p, date) => {
    const list = (data.allocations[p.key] || {})[iso(date)] || []
    let n = 0; for (const e of list) n += (e.half && e.half !== 'full') ? 0.5 : 1
    return n
  }
  const shift = (deltaWeeks) => setAnchorMonday(m => mondayOf(addDays(m, deltaWeeks * 7)))

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
        <div><div style={lbl}>From (week)</div><input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} style={fInput} /></div>
        <div><div style={lbl}>To</div><input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} style={fInput} /></div>
        {(filters.project || filters.installer || filters.from || filters.to) &&
          <button onClick={() => setFilters({ project: '', installer: '', from: '', to: '' })} style={{ ...ghostBtn, padding: '7px 12px' }}>Clear</button>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => shift(-weeks)} style={ghostBtn}>‹ Back</button>
          <button onClick={() => setAnchorMonday(mondayOf(new Date()))} style={ghostBtn}>Today</button>
          <button onClick={() => shift(weeks)} style={ghostBtn}>Fwd ›</button>
          <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} style={{ ...fInput, fontFamily: 'inherit' }}>
            <option value={4}>4 weeks</option><option value={8}>8 weeks</option><option value={12}>12 weeks</option><option value={26}>26 weeks</option>
          </select>
        </div>
      </div>

      <div style={{ border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: NAME_W + DATE_W * 2 + days.length * CELL_W }}>

            <div style={{ display: 'flex', borderBottom: '1px solid #eee', background: '#faf9f7' }}>
              <HeadCell w={NAME_W} style={{ fontWeight: 700 }}>Project</HeadCell>
              <HeadCell w={DATE_W}>Start</HeadCell>
              <HeadCell w={DATE_W}>Contract Compl.</HeadCell>
              {weekGroups.map((g, i) => (
                <div key={i} style={{ width: g.length * CELL_W, borderLeft: '2px solid #d9d5cc', padding: '4px 6px', fontSize: 10.5, color: '#666', fontWeight: 600 }}>
                  W/C {fmtDMY(g[0])}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', borderBottom: '2px solid #e6e2d8', background: '#fff' }}>
              <HeadCell w={NAME_W} style={{ fontSize: 10.5, color: '#999' }}>Total installers →</HeadCell>
              <HeadCell w={DATE_W}></HeadCell>
              <HeadCell w={DATE_W}></HeadCell>
              {days.map((d, i) => {
                const we = d.getDay() === 0 || d.getDay() === 6
                const t = dayTotal(d)
                return (
                  <div key={i} style={{ width: CELL_W, textAlign: 'center', padding: '2px 0', background: we ? '#f3f1ec' : '#fff', borderLeft: (d.getDay() === 1 ? '2px solid #d9d5cc' : '1px solid #f2f2f2') }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: t ? INK : '#ccc' }}>{t || ''}</div>
                    <div style={{ fontSize: 9.5, color: we ? '#b91c1c' : '#aaa' }}>{DOW[(d.getDay() + 6) % 7]}</div>
                    <div style={{ fontSize: 8.5, color: '#bbb' }}>{d.getDate()}</div>
                  </div>
                )
              })}
            </div>

            <SectionLabel>LIVE PROJECTS</SectionLabel>
            {liveRows.length === 0 && <EmptyRow>No live projects.</EmptyRow>}
            {liveRows.map(p => (
              <GanttRow key={p.key} p={p} days={days} data={data} countFor={countFor} onCell={(date) => setDayModal({ proj: p, date })} />
            ))}

            <SectionLabel neg>NEGOTIATED — NOT YET SECURED</SectionLabel>
            {negRows.length === 0 && <EmptyRow>No negotiated projects.</EmptyRow>}
            {negRows.map(p => (
              <GanttRow key={p.key} p={p} days={days} data={data} neg countFor={countFor} onCell={(date) => setDayModal({ proj: p, date })} />
            ))}

          </div>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: '#999', marginTop: 8 }}>
        Numbers are installer counts. Click a day cell to assign named operatives. Weekends are shaded.
        The red edge marks the contracted completion date; a ⚠ warning shows if the programme runs past it or dates are missing.
      </div>

      {dayModal && <DayModal proj={dayModal.proj} date={dayModal.date} data={data} ops={ops} onClose={() => setDayModal(null)} onChanged={load} />}
    </OperationsShell>
  )
}

function GanttRow({ p, days, data, neg, countFor, onCell }) {
  const meta = data.meta[p.key] || {}
  const start = parseISO(meta.startDate)
  const compl = parseISO(meta.completionDate)
  const missing = !meta.startDate || !meta.completionDate

  let lastAlloc = null
  const days2 = data.allocations[p.key] || {}
  for (const dk of Object.keys(days2)) { const dd = parseISO(dk); if (dd && (!lastAlloc || dd > lastAlloc)) lastAlloc = dd }
  const overrun = compl && lastAlloc && lastAlloc > compl

  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #f2f2f2', height: ROW_H, alignItems: 'stretch' }}>
      <div style={{ width: NAME_W, padding: '4px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: neg ? '#fbfaf8' : '#fff', borderRight: '1px solid #f0f0f0' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: neg ? '#8a6d1a' : INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {missing && <span title="Start / completion date missing" style={{ color: '#dc2626' }}>⚠ </span>}
          {overrun && <span title="Programme runs past contracted completion" style={{ color: '#dc2626' }}>⚠ </span>}
          {p.projectNo ? `${p.projectNo} — ` : ''}{p.name}
        </div>
        {p.location && <div style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.location}</div>}
      </div>
      <DateCell val={start} missing={!meta.startDate} />
      <DateCell val={compl} missing={!meta.completionDate} warn={overrun} />
      {days.map((d, i) => {
        const we = d.getDay() === 0 || d.getDay() === 6
        const n = countFor(p, d)
        const isCompl = compl && sameDay(d, compl)
        const past = compl && d > compl && n > 0
        return (
          <div key={i} onClick={() => onCell(d)} title={isCompl ? 'Contracted completion date' : ''}
            style={{
              width: CELL_W, textAlign: 'center', cursor: 'pointer', position: 'relative',
              background: past ? '#fee2e2' : (n ? (neg ? '#fef9c3' : '#dbeafe') : (we ? '#f3f1ec' : '#fff')),
              borderLeft: (d.getDay() === 1 ? '2px solid #d9d5cc' : '1px solid #f5f5f5'),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: isCompl ? 'inset -2px 0 0 0 #dc2626' : 'none',
              fontSize: 12, fontWeight: 700, color: neg ? '#8a6d1a' : '#1e40af',
            }}>
            {n || ''}
          </div>
        )
      })}
    </div>
  )
}

function DateCell({ val, missing, warn }) {
  return (
    <div style={{ width: DATE_W, padding: '4px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, borderRight: '1px solid #f0f0f0', color: missing ? '#dc2626' : (warn ? '#dc2626' : '#555'), background: '#fff' }}>
      {missing ? '⚠ set' : fmtDMY(val)}
    </div>
  )
}

const HeadCell = ({ w, children, style }) => (
  <div style={{ width: w, padding: '6px 8px', fontSize: 11, color: '#666', ...style }}>{children}</div>
)
const SectionLabel = ({ children, neg }) => (
  <div style={{ padding: '5px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: neg ? '#8a6d1a' : GOLD, background: neg ? '#fdfbf3' : '#faf9f7', borderBottom: '1px solid #eee', borderTop: '1px solid #eee' }}>{children}</div>
)
const EmptyRow = ({ children }) => <div style={{ padding: '10px 12px', fontSize: 12, color: '#aaa' }}>{children}</div>

const lbl = { fontSize: 11, color: '#888', marginBottom: 3 }
const fInput = { padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5 }

function DayModal({ proj, date, data, ops, onClose, onChanged }) {
  const dk = iso(date)
  const [entries, setEntries] = useState(() => ((data.allocations[proj.key] || {})[dk] || []).map(e => ({ ...e })))
  const [meta, setMeta] = useState(() => data.meta[proj.key] || { startDate: '', completionDate: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState('')

  const opName = (id) => { const o = ops.find(x => x.id === id); return o ? `${o.firstName} ${o.lastName}` : id }
  const opTrades = (id) => { const o = ops.find(x => x.id === id); return (o?.trades || []).join(', ') }

  const bookedElsewhere = useMemo(() => {
    const map = {}
    for (const [pk, dd] of Object.entries(data.allocations || {})) {
      if (pk === proj.key) continue
      for (const e of (dd[dk] || [])) map[e.opId] = e.half || 'full'
    }
    return map
  }, [data, dk, proj.key])

  function addOp(id) { if (!id || entries.some(e => e.opId === id)) return; setEntries([...entries, { opId: id, half: 'full' }]); setPick('') }
  function setHalf(id, half) { setEntries(entries.map(e => e.opId === id ? { ...e, half } : e)) }
  function remove(id) { setEntries(entries.filter(e => e.opId !== id)) }

  async function save() {
    setErr(''); setSaving(true)
    try {
      await fetch('/api/planning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-meta', key: proj.key, startDate: meta.startDate, completionDate: meta.completionDate }) })
      const r = await fetch('/api/planning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-day', key: proj.key, date: dk, entries }) })
      const d = await r.json()
      if (r.status === 409) { setErr(`Clash: ${opName(d.opId)} is already booked on another project this day. Use half-days on both, or remove them.`); setSaving(false); return }
      if (!r.ok) throw new Error(d.error || 'Save failed')
      onChanged(); onClose()
    } catch (e) { setErr(e.message || 'Could not save.') }
    setSaving(false)
  }

  const available = ops.filter(o => !entries.some(e => e.opId === o.id))
  const input = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 2vw', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid #eee' }}>
          <div>
            <div style={{ fontWeight: 700, color: INK, fontSize: 16 }}>{proj.name}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{date.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}{proj.type === 'negotiated' ? ' · not yet secured' : ''}</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 24, border: 'none', background: 'none', cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        <div style={{ padding: '10px 22px 22px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px', marginBottom: 8 }}>
            <div><div style={lbl}>Project start date</div><input type="date" value={meta.startDate || ''} onChange={e => setMeta(m => ({ ...m, startDate: e.target.value }))} style={input} /></div>
            <div><div style={lbl}>Contracted completion</div><input type="date" value={meta.completionDate || ''} onChange={e => setMeta(m => ({ ...m, completionDate: e.target.value }))} style={input} /></div>
          </div>

          <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '14px 0 6px' }}>Installers on site ({entries.reduce((s, e) => s + (e.half !== 'full' ? 0.5 : 1), 0)})</div>
          {entries.length === 0 && <div style={{ fontSize: 12.5, color: '#aaa', marginBottom: 8 }}>No one allocated yet.</div>}
          {entries.map(e => (
            <div key={e.opId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#faf9f7', borderRadius: 8, marginBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{opName(e.opId)}</div>
                {opTrades(e.opId) && <div style={{ fontSize: 10.5, color: '#999' }}>{opTrades(e.opId)}</div>}
              </div>
              <select value={e.half} onChange={ev => setHalf(e.opId, ev.target.value)} style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid #e0e0e0', fontSize: 12 }}>
                <option value="full">Full day</option><option value="am">AM</option><option value="pm">PM</option>
              </select>
              <button onClick={() => remove(e.opId)} style={{ ...linkBtn, color: '#dc2626' }}>Remove</button>
            </div>
          ))}

          <div style={{ marginTop: 10 }}>
            <div style={lbl}>Add installer</div>
            <select value={pick} onChange={e => addOp(e.target.value)} style={input}>
              <option value="">Select installer…</option>
              {available.map(o => {
                const busy = bookedElsewhere[o.id]
                return <option key={o.id} value={o.id}>{o.firstName} {o.lastName}{o.company ? ` (${o.company})` : ''}{busy ? ` — busy ${busy === 'full' ? 'today' : busy.toUpperCase()}` : ''}</option>
              })}
            </select>
            <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>An installer can't be on two projects the same day unless both are half-days (AM on one, PM on the other).</div>
          </div>

          {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 12 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18, borderTop: '1px solid #eee', paddingTop: 16 }}>
            <button onClick={onClose} style={ghostBtn}>Cancel</button>
            <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save day'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
