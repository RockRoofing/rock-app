import { useState, useEffect, useMemo, useRef } from 'react'
import Head from 'next/head'
import CommercialNav from '../components/CommercialNav'
import { computeApplicationSummary } from '../lib/applications'

// ── Layout constants (mirror the planning gantt) ──
const NAME_W = 280, DATE_W = 92, CELL_W = 34, ROW_H = 42
const INK = '#1a1a19'

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd) }
const parseISO = (s) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const fmtDMY = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6
const sameDay = (a, b) => a && b && iso(a) === iso(b)

// Normalise an allocation cell to a headcount (bars are derived from whether a
// day has any labour allocated - we only need presence, not who).
function cellCount(cell) {
  if (!cell) return 0
  const entries = Array.isArray(cell) ? cell : (cell && Array.isArray(cell.entries) ? cell.entries : [])
  const unnamed = (cell && !Array.isArray(cell) && Number(cell.unnamed)) || 0
  return entries.length + unnamed
}

export default function ProjectCashflow() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('day')            // 'day' | 'week'
  const [anchorMonday, setAnchorMonday] = useState(mondayOf(new Date()))
  const [historic, setHistoric] = useState(false)
  const [sel, setSel] = useState(null)               // { key, dates:Set<iso> }
  const [xeroMap, setXeroMap] = useState({})         // projectNo -> xeroId (for live rates)
  const [modal, setModal] = useState(null)           // { projectKey, projectName, xeroId, from, to }
  const [hypCounts, setHypCounts] = useState({})     // projectKey -> number of saved hyp apps
  const dragging = useRef(false)
  const dragKey = useRef(null)

  useEffect(() => {
    fetch('/api/planning').then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
    fetch('/api/dashboard').then(r => r.json()).then(d => {
      const m = {}
      for (const p of (d.projects || [])) if (p.jobNo) m[String(p.jobNo)] = String(p.xeroId)
      setXeroMap(m)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const up = () => { dragging.current = false; dragKey.current = null }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const RANGE_WEEKS = 156
  const days = useMemo(() => {
    const start = anchorMonday
    const end = addDays(anchorMonday, RANGE_WEEKS * 7 - 1)
    const out = []
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(new Date(d))
    return out
  }, [anchorMonday])

  const weekGroups = useMemo(() => {
    const groups = []
    for (let i = 0; i < days.length; i += 7) groups.push(days.slice(i, i + 7))
    return groups
  }, [days])

  const selRange = useMemo(() => {
    if (!sel || !sel.dates.size) return null
    const arr = [...sel.dates].sort()
    return { from: arr[0], to: arr[arr.length - 1], count: arr.length }
  }, [sel])

  const shift = (deltaWeeks) => setAnchorMonday(m => mondayOf(addDays(m, deltaWeeks * 7)))

  if (loading || !data) {
    return (
      <>
        <Head><title>Rock Roofing — Cash Flow</title></Head>
        <div style={{ minHeight: '100vh', background: '#f5f6f8' }}>
          <CommercialNav active="/project-cashflow" />
          <div style={{ padding: 40, color: '#888' }}>Loading planner…</div>
        </div>
      </>
    )
  }

  const live = (data.projects || []).filter(p => p.type === 'live')
  const negotiated = (data.projects || []).filter(p => p.type === 'negotiated')
  const allocations = data.allocations || {}
  const metaAll = data.meta || {}
  const todayKey = iso(new Date())

  const countOnDay = (p, dateKey) => cellCount((allocations[p.key] || {})[dateKey])

  // ── Selection (drag across cells on a single project row) ──
  function cellDown(key, d) {
    dragging.current = true; dragKey.current = key
    const k = iso(d)
    setSel(prev => {
      // Clicking the same single selected cell toggles it off.
      if (prev && prev.key === key && prev.dates.size === 1 && prev.dates.has(k)) return null
      return { key, dates: new Set([k]) }
    })
  }
  function cellEnter(key, d) {
    if (!dragging.current || dragKey.current !== key) return
    const k = iso(d)
    setSel(prev => {
      if (!prev || prev.key !== key) return { key, dates: new Set([k]) }
      const next = new Set(prev.dates); next.add(k)
      return { key, dates: next }
    })
  }
  const projName = (k) => { const p = (data.projects || []).find(x => x.key === k); return p ? `${p.projectNo ? p.projectNo + ' — ' : ''}${p.name}` : k }

  return (
    <>
      <Head><title>Rock Roofing — Cash Flow</title></Head>
      <div style={{ minHeight: '100vh', background: '#f5f6f8' }}>
        <CommercialNav active="/project-cashflow" />
        <div style={{ padding: 20, maxWidth: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, color: INK }}>Project Cash Flow <span style={{ fontSize: 12, color: '#aaa', fontWeight: 400 }}>· forecast</span></h1>
              <div style={{ fontSize: 12.5, color: '#8a857c', marginTop: 4, maxWidth: 760 }}>
                Mirrors the Operations planning programme (dates and sequence). Bars are greyed and blank here - select a period on any project row (drag across the cells, with or without bars) to build a hypothetical application for that period. Selections here never change the real programme or applications.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button onClick={() => setView(v => v === 'day' ? 'week' : 'day')} style={ghostBtn}>{view === 'day' ? 'Week view' : 'Day view'}</button>
              <button onClick={() => setHistoric(h => { const next = !h; setAnchorMonday(mondayOf(addDays(new Date(), next ? -14 : 0))); return next })}
                style={{ ...ghostBtn, background: historic ? '#fffbeb' : '#f2f2f0', color: historic ? '#92400e' : '#555', fontWeight: historic ? 700 : 400 }}>
                {historic ? '✓ Historic' : 'Historic'}
              </button>
              <button onClick={() => shift(historic ? -1 : -12)} style={ghostBtn} title={historic ? 'Back one week' : 'Back 12 weeks'}>‹</button>
              <button onClick={() => { setHistoric(false); setAnchorMonday(mondayOf(new Date())) }} style={ghostBtn}>Today</button>
              <button onClick={() => shift(historic ? 1 : 12)} style={ghostBtn} title={historic ? 'Forward one week' : 'Forward 12 weeks'}>›</button>
            </div>
          </div>

          {/* Selection info bar (fixed overlay so it never shifts the gantt) */}
          {selRange && (
            <div style={{ position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: 14, background: '#111827', color: '#fff', borderRadius: 10, padding: '10px 16px', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
              <span style={{ fontSize: 13 }}><strong>{projName(sel.key)}</strong> — {fmtDMY(parseISO(selRange.from))} to {fmtDMY(parseISO(selRange.to))} ({selRange.count} day{selRange.count === 1 ? '' : 's'})</span>
              <button style={{ background: '#ca8a04', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
                title="Build a hypothetical application for this period"
                onClick={() => {
                  const p = (data.projects || []).find(x => x.key === sel.key)
                  const xeroId = p && p.projectNo ? (xeroMap[String(p.projectNo)] || '') : ''
                  setModal({ projectKey: sel.key, projectName: projName(sel.key), xeroId, from: selRange.from, to: selRange.to })
                }}>Build application →</button>
              <button onClick={() => setSel(null)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
          )}

          <div style={{ border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: NAME_W + DATE_W * 2 + days.length * CELL_W }}>
                {/* header */}
                <div style={{ display: 'flex', borderBottom: '1px solid #eee', background: '#faf9f7' }}>
                  <Frozen w={NAME_W}>Project</Frozen>
                  <PlainCell w={DATE_W}>Planned / Actual</PlainCell>
                  <PlainCell w={DATE_W}>Contract Compl.</PlainCell>
                  {view === 'day'
                    ? weekGroups.map((g, i) => <div key={i} style={{ width: g.length * CELL_W, borderLeft: '2px solid #d9d5cc', padding: '4px 6px', fontSize: 10.5, color: '#666', fontWeight: 600 }}>W/C {fmtDMY(g[0])}</div>)
                    : weekGroups.map((g, i) => <div key={i} style={{ width: 46, borderLeft: '1px solid #eee', padding: '4px 2px', fontSize: 9, color: '#666', fontWeight: 600, textAlign: 'center' }}>{fmtDMY(g[0])}</div>)}
                </div>

                {live.length > 0 && <SectionLabel>Live projects</SectionLabel>}
                {live.map(p => <Row key={p.key} p={p} days={days} weekGroups={weekGroups} view={view} data={data} meta={metaAll[p.key] || {}}
                  countOnDay={countOnDay} sel={sel} onCellDown={cellDown} onCellEnter={cellEnter} todayKey={todayKey} />)}

                {negotiated.length > 0 && <SectionLabel>Negotiated projects</SectionLabel>}
                {negotiated.map(p => <Row key={p.key} p={p} days={days} weekGroups={weekGroups} view={view} data={data} meta={metaAll[p.key] || {}}
                  countOnDay={countOnDay} sel={sel} onCellDown={cellDown} onCellEnter={cellEnter} todayKey={todayKey} neg />)}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#aaa', marginTop: 10 }}>
            Bars are greyed and intentionally blank - financial detail is added via the hypothetical application per selected period. This page reads the live planning programme, so if Operations move a project the sequence here moves with it. Hypothetical applications are forecast-only and never written to the real applications.
          </div>
        </div>

        {modal && <HypAppModal modal={modal} onClose={() => setModal(null)} onSaved={(key, count) => setHypCounts(c => ({ ...c, [key]: count }))} />}
      </div>
    </>
  )
}

function Row({ p, days, weekGroups, view, data, meta, countOnDay, sel, onCellDown, onCellEnter, todayKey, neg }) {
  const complD = parseISO(meta.completionDate || '')
  // Planned/Actual = earliest allocated day (mirrors the planning gantt).
  const projDays = (data.allocations || {})[p.key] || {}
  let plannedStart = ''
  { const dated = Object.keys(projDays).filter(dk => countOnDay(p, dk) > 0).sort(); if (dated.length) plannedStart = dated[0] }
  const selDates = sel && sel.key === p.key ? sel.dates : null

  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #f2f2f2', minHeight: ROW_H, alignItems: 'stretch' }}>
      <Frozen w={NAME_W} style={{ background: neg ? '#fbfaf8' : '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: neg ? '#8a6d1a' : INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: NAME_W - 16 }}>
          {p.projectNo ? `${p.projectNo} — ` : ''}{p.name}
        </div>
        {p.location && <div style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: NAME_W - 16 }}>{p.location}</div>}
      </Frozen>
      <PlainCell w={DATE_W} style={{ fontSize: 11, color: plannedStart ? (plannedStart <= todayKey ? '#166534' : '#1d4ed8') : '#bbb', fontWeight: 600 }}>
        {plannedStart ? fmtDMY(parseISO(plannedStart)) : '—'}
      </PlainCell>
      <PlainCell w={DATE_W} style={{ fontSize: 11, color: '#555' }}>{meta.completionDate ? fmtDMY(parseISO(meta.completionDate)) : '—'}</PlainCell>

      {view === 'day'
        ? days.map((d, i) => {
          const we = isWeekend(d); const key = iso(d)
          const hasBar = countOnDay(p, key) > 0
          const isCompl = complD && sameDay(d, complD)
          const selected = selDates && selDates.has(key)
          const isToday = key === todayKey
          return (
            <div key={i}
              onMouseDown={(e) => { e.preventDefault(); onCellDown(p.key, d) }}
              onMouseEnter={() => onCellEnter(p.key, d)}
              title={`${fmtDMY(d)}${hasBar ? ' · on site (planned)' : ''}`}
              style={{
                width: CELL_W, cursor: 'pointer', userSelect: 'none',
                background: selected ? '#fde68a' : (hasBar ? '#d4d4d4' : (we ? '#f3f1ec' : '#fff')),
                borderLeft: (d.getDay() === 1 ? '2px solid #d9d5cc' : '1px solid #f5f5f5'),
                boxShadow: [isCompl ? 'inset -2px 0 0 0 #dc2626' : '', isToday ? 'inset -2px 0 0 0 #15803d' : ''].filter(Boolean).join(', ') || undefined,
              }} />
          )
        })
        : weekGroups.map((g, i) => {
          const anyBar = g.some(d => countOnDay(p, iso(d)) > 0)
          const anySel = selDates && g.some(d => selDates.has(iso(d)))
          return (
            <div key={i}
              onMouseDown={(e) => { e.preventDefault(); onCellDown(p.key, g[0]) }}
              onMouseEnter={() => onCellEnter(p.key, g[0])}
              title={`W/C ${fmtDMY(g[0])}`}
              style={{ width: 46, cursor: 'pointer', userSelect: 'none', borderLeft: '1px solid #eee',
                background: anySel ? '#fde68a' : (anyBar ? '#d4d4d4' : '#fff') }} />
          )
        })}
    </div>
  )
}

function Frozen({ w, children, style }) {
  return <div style={{ width: w, minWidth: w, position: 'sticky', left: 0, zIndex: 2, borderRight: '1px solid #eee', padding: '6px 10px', boxSizing: 'border-box', background: '#fff', ...style }}>{children}</div>
}
function PlainCell({ w, children, style }) {
  return <div style={{ width: w, minWidth: w, borderRight: '1px solid #f0f0f0', padding: '6px 8px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', ...style }}>{children}</div>
}
function SectionLabel({ children }) {
  return <div style={{ padding: '6px 12px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#9a958c', background: '#f7f6f3', borderBottom: '1px solid #eee', position: 'sticky', left: 0 }}>{children}</div>
}
const ghostBtn = { background: '#f2f2f0', border: '1px solid #e2e2de', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, cursor: 'pointer', color: '#555' }

// ── Hypothetical application modal ──
// Full mirror of the real application (contract works + variations + certificate
// block via computeApplicationSummary), but forecast-only. Revenue + labour are
// driven by % complete per line. Materials are added separately (a % or figure toward
// the materials budget) and land on a single delivery day. Cumulative: each period
// starts from the previous saved hypothetical application. Never written to the real
// applications store.
function gbp(n) { return `£${Math.round(n || 0).toLocaleString('en-GB')}` }
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n }

function HypAppModal({ modal, onClose, onSaved }) {
  const { projectKey, projectName, xeroId, from, to } = modal
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [seed, setSeed] = useState([])            // contract works seeded from rates
  const [rates, setRates] = useState(null)
  const [hypApps, setHypApps] = useState([])      // previously saved hyp apps (cumulative)
  const [rows, setRows] = useState([])            // this period's contract works (with pctComplete)
  const [mcdPct, setMcdPct] = useState(0)
  const [retPct, setRetPct] = useState(5)
  const [matMode, setMatMode] = useState('pct')   // 'pct' | 'figure'
  const [matValue, setMatValue] = useState('')    // % or £ toward materials budget
  const [matDeliverDay, setMatDeliverDay] = useState(to)
  const [saving, setSaving] = useState(false)
  const [showList, setShowList] = useState(false)

  useEffect(() => {
    setLoading(true); setErr('')
    fetch(`/api/project-cashflow?projectKey=${encodeURIComponent(projectKey)}${xeroId ? `&xeroId=${encodeURIComponent(xeroId)}` : ''}`)
      .then(r => r.json()).then(d => {
        if (!d.hasRates) { setErr(d && d.contractedRates === null ? 'No contracted rates for this project yet. Upload & lock them on the Contracted Rates page first (for a live project, add it in Xero so it appears there).' : 'No contracted rates found.'); setLoading(false); return }
        setSeed(d.seedContractWorks || [])
        setRates(d.contractedRates || null)
        setHypApps(d.hypApps || [])
        // Start this period from the most recent prior hyp app's % complete (cumulative),
        // else from a fresh seed at 0%.
        const prev = (d.hypApps || []).slice().sort((a, b) => (a.to || '').localeCompare(b.to || '')).pop()
        const base = (d.seedContractWorks || []).map(r => ({ ...r }))
        if (prev && Array.isArray(prev.contractWorks)) {
          const byId = new Map(prev.contractWorks.filter(r => r.kind === 'item').map(r => [r.id, r]))
          for (const r of base) { if (r.kind === 'item') { const p = byId.get(r.id); if (p) r.pctComplete = p.pctComplete || 0 } }
          setMcdPct(prev.mcdPct || 0); setRetPct(prev.retentionPct != null ? prev.retentionPct : 5)
        }
        setRows(base)
        setLoading(false)
      }).catch(() => { setErr('Could not load.'); setLoading(false) })
  }, [projectKey, xeroId])

  // Previous cumulative gross (sum of prior hyp apps' this-period gross) so the
  // certificate "this cert" reflects only the newly-added work this period.
  const prevGross = useMemo(() => {
    // Cumulative gross to date from the latest prior app equals its own grossCurrent.
    const prev = hypApps.slice().sort((a, b) => (a.to || '').localeCompare(b.to || '')).pop()
    if (!prev) return 0
    const s = computeApplicationSummary({ contractWorks: prev.contractWorks || [], variations: [], materials: prev.materials || [], mcdPct: prev.mcdPct || 0, retentionPct: prev.retentionPct != null ? prev.retentionPct : 5 }, 0)
    return s.grossCurrent
  }, [hypApps])

  // Materials budget from rates (above-the-line materials).
  const materialsBudget = useMemo(() => {
    const items = (rates && Array.isArray(rates.items)) ? rates.items : []
    return items.filter(x => x.section === 'above' && !x.struck && x.kind !== 'heading')
      .reduce((s, x) => s + num(x.matRate) * num(x.qty), 0)
  }, [rates])

  // Materials value applied this period (from % or figure toward budget).
  const materialsThisPeriod = useMemo(() => {
    if (matMode === 'pct') return materialsBudget * (num(matValue) / 100)
    return num(matValue)
  }, [matMode, matValue, materialsBudget])

  // Build a materials array for computeApplicationSummary (single synthetic line at
  // 100% so it counts fully in this cert; delivery timing handled separately).
  const materialsForCalc = useMemo(() => (
    materialsThisPeriod > 0 ? [{ id: 'hypmat', kind: 'item', total: materialsThisPeriod, pctComplete: 100 }] : []
  ), [materialsThisPeriod])

  const workApp = { contractWorks: rows, variations: [], materials: materialsForCalc, mcdPct: num(mcdPct), retentionPct: num(retPct) }
  const sum = useMemo(() => computeApplicationSummary(workApp, prevGross), [rows, materialsForCalc, mcdPct, retPct, prevGross])

  // Revenue + labour split for the works this period (value-to-date on works lines).
  const labourThisPeriod = useMemo(() => {
    const items = (rates && Array.isArray(rates.items)) ? rates.items : []
    const byId = new Map(items.map(x => [x.id, x]))
    // For each works row, labour value to date = labRate * qty * pct.
    let lab = 0
    for (const r of rows) {
      if (r.kind !== 'item') continue
      const src = byId.get(r.id)
      if (!src) continue
      lab += num(src.labRate) * num(src.qty) * (num(r.pctComplete) / 100)
    }
    return lab
  }, [rows, rates])

  const setPct = (id, v) => {
    const n = v === '' ? 0 : Math.max(0, Math.min(100, parseFloat(v) || 0))
    setRows(list => list.map(r => r.id === id ? { ...r, pctComplete: n } : r))
  }

  async function save() {
    setSaving(true)
    const app = {
      id: `hyp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      from, to,
      contractWorks: rows,
      materials: materialsForCalc,
      matMode, matValue: num(matValue), matDeliverDay,
      mcdPct: num(mcdPct), retentionPct: num(retPct),
      thisCertTotal: sum.thisCert.total,
      revenueThisPeriod: sum.thisCert.total,
      labourThisPeriod,
      materialsThisPeriod,
      createdAt: Date.now(),
    }
    const next = [...hypApps, app]
    try {
      await fetch('/api/project-cashflow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-hyp', projectKey, hypApps: next }) })
      setHypApps(next)
      if (onSaved) onSaved(projectKey, next.length)
    } catch {}
    setSaving(false)
    onClose()
  }

  async function deleteHyp(id) {
    if (!confirm('Delete this hypothetical application?')) return
    try {
      const d = await fetch('/api/project-cashflow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-hyp', projectKey, id }) }).then(r => r.json())
      setHypApps(d.hypApps || [])
      if (onSaved) onSaved(projectKey, (d.hypApps || []).length)
    } catch {}
  }

  const fmtD = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${String(y).slice(2)}` }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflow: 'auto', padding: 24 }} onMouseDown={onClose}>
      <div onMouseDown={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 1000, width: '100%', boxShadow: '0 12px 48px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '16px 20px', borderBottom: '1px solid #eee' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: INK }}>Hypothetical application <span style={{ fontSize: 12, color: '#aaa', fontWeight: 400 }}>· forecast only</span></div>
            <div style={{ fontSize: 12.5, color: '#666', marginTop: 2 }}>{projectName} — period {fmtD(from)} to {fmtD(to)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setShowList(s => !s)} style={ghostBtn}>{showList ? 'Hide' : 'View'} forecasts ({hypApps.length})</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#999' }}>×</button>
          </div>
        </div>

        {loading ? <div style={{ padding: 40, color: '#888' }}>Loading…</div>
          : err ? <div style={{ padding: 30, color: '#b45309' }}>{err}</div>
          : (
            <div style={{ padding: 20 }}>
              {showList && (
                <div style={{ background: '#faf9f7', border: '1px solid #eee', borderRadius: 10, padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 8 }}>Saved hypothetical applications for this project</div>
                  {hypApps.length === 0 ? <div style={{ fontSize: 12, color: '#aaa' }}>None yet.</div> : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ color: '#999', textAlign: 'right' }}>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>Period</th><th style={{ padding: '3px 6px' }}>Revenue</th><th style={{ padding: '3px 6px' }}>Labour</th><th style={{ padding: '3px 6px' }}>Materials</th><th></th>
                      </tr></thead>
                      <tbody>
                        {hypApps.slice().sort((a, b) => (a.to || '').localeCompare(b.to || '')).map(a => (
                          <tr key={a.id} style={{ borderTop: '1px solid #eee', textAlign: 'right' }}>
                            <td style={{ textAlign: 'left', padding: '4px 6px' }}>{fmtD(a.from)}–{fmtD(a.to)}</td>
                            <td style={{ padding: '4px 6px' }}>{gbp(a.revenueThisPeriod)}</td>
                            <td style={{ padding: '4px 6px', color: '#b45309' }}>{gbp(a.labourThisPeriod)}</td>
                            <td style={{ padding: '4px 6px', color: '#7c3aed' }}>{gbp(a.materialsThisPeriod)}{a.matDeliverDay ? ` · ${fmtD(a.matDeliverDay)}` : ''}</td>
                            <td style={{ padding: '4px 6px' }}><button onClick={() => deleteHyp(a.id)} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11 }}>Delete</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Summary boxes */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                <MiniBox label="Revenue this period" value={gbp(sum.thisCert.total)} color="#0f766e" strong />
                <MiniBox label="Labour this period" value={gbp(labourThisPeriod)} color="#b45309" />
                <MiniBox label="Materials this period" value={gbp(materialsThisPeriod)} color="#7c3aed" sub={matDeliverDay ? `delivered ${fmtD(matDeliverDay)}` : ''} />
                <MiniBox label="Gross to date" value={gbp(sum.grossCurrent)} />
              </div>

              {/* Contract works with % complete */}
              <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 6 }}>Contract works (enter cumulative % complete)</div>
              <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'auto', maxHeight: 320, marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ background: '#faf9f7', color: '#999' }}>
                    <th style={{ textAlign: 'left', padding: '6px 10px' }}>Description</th>
                    <th style={{ textAlign: 'right', padding: '6px 10px' }}>Total</th>
                    <th style={{ textAlign: 'right', padding: '6px 10px' }}>% complete</th>
                    <th style={{ textAlign: 'right', padding: '6px 10px' }}>Value to date</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(r => r.kind === 'heading'
                      ? <tr key={r.id}><td colSpan={4} style={{ padding: '6px 10px', fontWeight: 700, background: '#fcfbf9', color: r.red ? '#b91c1c' : INK }}>{r.description}</td></tr>
                      : (
                        <tr key={r.id} style={{ borderTop: '1px solid #f3f2ee' }}>
                          <td style={{ padding: '5px 10px' }}>{r.description}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right' }}>{r.total ? gbp(r.total) : ''}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                            <input type="number" value={r.pctComplete ?? 0} onChange={e => setPct(r.id, e.target.value)} style={{ width: 60, textAlign: 'right', border: '1px solid #ddd', borderRadius: 6, padding: '3px 6px', fontSize: 12 }} />
                          </td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 600 }}>{gbp(num(r.total) * (num(r.pctComplete) / 100))}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Materials */}
              <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 6 }}>Materials on site <span style={{ fontSize: 11, color: '#aaa', fontWeight: 400 }}>(budget {gbp(materialsBudget)})</span></div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18, background: '#faf9f7', border: '1px solid #eee', borderRadius: 10, padding: 12 }}>
                <div>
                  <div style={lblS}>Add by</div>
                  <select value={matMode} onChange={e => setMatMode(e.target.value)} style={inpS}>
                    <option value="pct">% of budget</option>
                    <option value="figure">£ figure</option>
                  </select>
                </div>
                <div>
                  <div style={lblS}>{matMode === 'pct' ? 'Percent' : 'Amount (£)'}</div>
                  <input type="number" value={matValue} onChange={e => setMatValue(e.target.value)} placeholder={matMode === 'pct' ? '%' : '£'} style={{ ...inpS, width: 110 }} />
                </div>
                <div>
                  <div style={lblS}>Delivery day (cash out)</div>
                  <input type="date" value={matDeliverDay} onChange={e => setMatDeliverDay(e.target.value)} style={inpS} />
                </div>
                <div style={{ fontSize: 12.5, color: '#7c3aed', fontWeight: 600 }}>= {gbp(materialsThisPeriod)}</div>
              </div>

              {/* Cert settings + save */}
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div><div style={lblS}>MCD %</div><input type="number" value={mcdPct} onChange={e => setMcdPct(e.target.value)} style={{ ...inpS, width: 70 }} /></div>
                  <div><div style={lblS}>Retention %</div><input type="number" value={retPct} onChange={e => setRetPct(e.target.value)} style={{ ...inpS, width: 70 }} /></div>
                </div>
                <button onClick={save} disabled={saving} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save hypothetical application'}</button>
              </div>
            </div>
          )}
      </div>
    </div>
  )
}

function MiniBox({ label, value, sub, color, strong }) {
  return (
    <div style={{ background: strong ? '#f7faf9' : '#fff', border: strong ? '1.5px solid #0f766e' : '1px solid #e6e3dc', borderRadius: 10, padding: '10px 16px', minWidth: 150 }}>
      <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color: color || INK }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: '#9a958c' }}>{sub}</div>}
    </div>
  )
}
const lblS = { fontSize: 11, color: '#888', marginBottom: 3 }
const inpS = { padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }
