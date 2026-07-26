import { useState, useEffect, useMemo, useRef } from 'react'
import Head from 'next/head'
import CommercialNav from '../components/CommercialNav'
import { computeApplicationSummary } from '../lib/applications'

// ── Layout constants (mirror the planning gantt) ──
const NAME_W = 280, DATE_W = 92, CELL_W = 34, ROW_H = 42
const INK = '#1a1a19'
// Forecast application colours - cycle through 5 (app 1..5 then repeat).
const APP_COLOURS = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed']
const appColour = (i) => APP_COLOURS[i % APP_COLOURS.length]
const darken = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, ((n >> 16) & 255) - 55), g = Math.max(0, ((n >> 8) & 255) - 55), b = Math.max(0, (n & 255) - 55)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

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
  const [allForecasts, setAllForecasts] = useState({}) // projectKey -> forecast apps[] (gantt bands)
  const dragging = useRef(false)
  const dragKey = useRef(null)
  const dragAnchor = useRef(null)   // first cell iso of the current drag

  useEffect(() => {
    fetch('/api/planning').then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
    fetch('/api/dashboard').then(r => r.json()).then(d => {
      const m = {}
      for (const p of (d.projects || [])) if (p.jobNo) m[String(p.jobNo)] = String(p.xeroId)
      setXeroMap(m)
    }).catch(() => {})
    loadAllForecasts()
  }, [])

  function loadAllForecasts() {
    fetch('/api/project-cashflow?all=1').then(r => r.json()).then(d => setAllForecasts(d.all || {})).catch(() => {})
  }

  useEffect(() => {
    const up = () => { dragging.current = false; dragKey.current = null; dragAnchor.current = null }
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

  // ── Selection (drag across cells on a single project row; fills the whole span) ──
  function cellDown(key, d) {
    dragging.current = true; dragKey.current = key
    const k = iso(d)
    dragAnchor.current = k
    setSel(prev => {
      // Clicking the same single selected cell toggles it off.
      if (prev && prev.key === key && prev.dates.size === 1 && prev.dates.has(k)) { dragAnchor.current = null; return null }
      return { key, dates: new Set([k]) }
    })
  }
  function cellEnter(key, d) {
    if (!dragging.current || dragKey.current !== key || !dragAnchor.current) return
    const k = iso(d)
    // Fill every day between the anchor and the current cell (inclusive).
    const a = dragAnchor.current
    const lo = a < k ? a : k, hi = a < k ? k : a
    const dates = new Set()
    for (let dd = new Date(parseISO(lo)); dd <= parseISO(hi); dd = addDays(dd, 1)) dates.add(iso(dd))
    setSel({ key, dates })
  }
  const projName = (k) => { const p = (data.projects || []).find(x => x.key === k); return p ? `${p.projectNo ? p.projectNo + ' — ' : ''}${p.name}` : k }

  // Open a saved forecast for viewing/editing.
  function openForecast(projectKey, fc) {
    const p = (data.projects || []).find(x => x.key === projectKey)
    const xeroId = p && p.projectNo ? (xeroMap[String(p.projectNo)] || '') : ''
    setModal({ projectKey, projectName: projName(projectKey), xeroId, from: fc.from, to: fc.to, editId: fc.id })
  }

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
                Mirrors the Operations planning programme (dates and sequence). Bars are greyed and blank here - select a period on any project row (drag across the cells, with or without bars) to build a forecasted application for that period. Selections here never change the real programme or applications.
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

          {/* Forecast colour key */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, fontSize: 11.5, color: '#666' }}>
            <span style={{ fontWeight: 700, color: '#888' }}>Forecast key:</span>
            {APP_COLOURS.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 16, height: 12, background: c, borderRadius: 2, display: 'inline-block' }} /> App {i + 1}
              </span>
            ))}
            <span style={{ color: '#999' }}>(cycles every 5)</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 16, height: 12, background: darken('#2563eb'), borderRadius: 2, display: 'inline-block' }} /> darker = materials delivery day</span>
          </div>

          {/* Selection info bar (fixed overlay so it never shifts the gantt) */}
          {selRange && (
            <div style={{ position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: 14, background: '#111827', color: '#fff', borderRadius: 10, padding: '10px 16px', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
              <span style={{ fontSize: 13 }}><strong>{projName(sel.key)}</strong> — {fmtDMY(parseISO(selRange.from))} to {fmtDMY(parseISO(selRange.to))} ({selRange.count} day{selRange.count === 1 ? '' : 's'})</span>
              <button style={{ background: '#ca8a04', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
                title="Build a forecasted application for this period"
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
                  countOnDay={countOnDay} sel={sel} onCellDown={cellDown} onCellEnter={cellEnter} todayKey={todayKey} forecasts={allForecasts[p.key] || []} onView={openForecast} />)}

                {negotiated.length > 0 && <SectionLabel>Negotiated projects</SectionLabel>}
                {negotiated.map(p => <Row key={p.key} p={p} days={days} weekGroups={weekGroups} view={view} data={data} meta={metaAll[p.key] || {}}
                  countOnDay={countOnDay} sel={sel} onCellDown={cellDown} onCellEnter={cellEnter} todayKey={todayKey} forecasts={allForecasts[p.key] || []} onView={openForecast} neg />)}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#aaa', marginTop: 10 }}>
            Bars are greyed and intentionally blank - financial detail is added via the forecasted application per selected period. This page reads the live planning programme, so if Operations move a project the sequence here moves with it. Forecasted applications are forecast-only and never written to the real applications.
          </div>
        </div>

        {modal && <HypAppModal modal={modal} onClose={() => setModal(null)} onSaved={(key, count) => { setHypCounts(c => ({ ...c, [key]: count })); loadAllForecasts() }} />}
      </div>
    </>
  )
}

function Row({ p, days, weekGroups, view, data, meta, countOnDay, sel, onCellDown, onCellEnter, todayKey, forecasts = [], onView, neg }) {
  const complD = parseISO(meta.completionDate || '')
  const projDays = (data.allocations || {})[p.key] || {}
  let plannedStart = ''
  { const dated = Object.keys(projDays).filter(dk => countOnDay(p, dk) > 0).sort(); if (dated.length) plannedStart = dated[0] }
  const selDates = sel && sel.key === p.key ? sel.dates : null

  // Sort forecasts by period so colours read App 1,2,3... in order.
  const sortedFc = forecasts.slice().sort((a, b) => (a.from || '').localeCompare(b.from || ''))
  const firstDayKey = days.length ? iso(days[0]) : ''
  const lastDayKey = days.length ? iso(days[days.length - 1]) : ''
  const dayIndex = (k) => { const d = parseISO(k); const f = parseISO(firstDayKey); return Math.round((d - f) / 86400000) }

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
        ? (
          <div style={{ position: 'relative', display: 'flex' }}>
            {days.map((d, i) => {
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
            })}
            {/* Forecast bands overlaid across their period */}
            {sortedFc.map((fc, idx) => {
              if (!fc.from || !fc.to) return null
              if (fc.to < firstDayKey || fc.from > lastDayKey) return null   // off-screen
              const s = Math.max(0, dayIndex(fc.from < firstDayKey ? firstDayKey : fc.from))
              const e = Math.min(days.length - 1, dayIndex(fc.to > lastDayKey ? lastDayKey : fc.to))
              if (e < s) return null
              const col = appColour(idx)
              const left = s * CELL_W, width = (e - s + 1) * CELL_W
              const matIn = fc.matDeliverDay && fc.matDeliverDay >= firstDayKey && fc.matDeliverDay <= lastDayKey
              const matLeft = matIn ? dayIndex(fc.matDeliverDay) * CELL_W : 0
              return (
                <div key={fc.id} style={{ position: 'absolute', top: 3, bottom: 3, left, width, pointerEvents: 'none' }}>
                  <div style={{ position: 'absolute', inset: 0, background: col, opacity: 0.82, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <span style={{ color: '#fff', fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap', textShadow: '0 1px 1px rgba(0,0,0,0.3)', padding: '0 4px' }}>
                      App {idx + 1} · Rev {gbpK(fc.revenueThisPeriod)} · Lab {gbpK(fc.labourThisPeriod)}{fc.materialsThisPeriod ? ` · Mat ${gbpK(fc.materialsThisPeriod)}` : ''}
                    </span>
                  </div>
                  {matIn && <div title={`Materials delivered ${fmtDMY(parseISO(fc.matDeliverDay))} · ${gbpK(fc.materialsThisPeriod)}`}
                    style={{ position: 'absolute', top: 0, bottom: 0, left: matLeft - left, width: CELL_W, background: darken(col), borderRadius: 3 }} />}
                  <button onClick={() => onView && onView(p.key, fc)} title="View / edit this forecast application"
                    style={{ position: 'absolute', top: 1, right: 1, pointerEvents: 'auto', background: 'rgba(255,255,255,0.92)', color: '#111', border: 'none', borderRadius: 3, fontSize: 8.5, fontWeight: 700, padding: '1px 4px', cursor: 'pointer', lineHeight: 1.3 }}>View</button>
                </div>
              )
            })}
          </div>
        )
        : weekGroups.map((g, i) => {
          const anyBar = g.some(d => countOnDay(p, iso(d)) > 0)
          const anySel = selDates && g.some(d => selDates.has(iso(d)))
          const wkStart = iso(g[0]), wkEnd = iso(g[g.length - 1])
          const fcHere = sortedFc.findIndex(fc => fc.from && fc.to && !(fc.to < wkStart || fc.from > wkEnd))
          const col = fcHere >= 0 ? appColour(fcHere) : null
          return (
            <div key={i}
              onMouseDown={(e) => { e.preventDefault(); onCellDown(p.key, g[0]) }}
              onMouseEnter={() => onCellEnter(p.key, g[0])}
              title={`W/C ${fmtDMY(g[0])}`}
              style={{ width: 46, cursor: 'pointer', userSelect: 'none', borderLeft: '1px solid #eee',
                background: anySel ? '#fde68a' : (col ? col : (anyBar ? '#d4d4d4' : '#fff')), opacity: col ? 0.82 : 1 }} />
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

// ── Forecasted application modal ──
// Full mirror of the real application (contract works + variations + certificate
// block via computeApplicationSummary), but forecast-only. Revenue + labour are
// driven by % complete per line. Materials are added separately (a % or figure toward
// the materials budget) and land on a single delivery day. Cumulative: each period
// starts from the previous saved forecasted application. Never written to the real
// applications store.
function gbp(n) { return `£${Math.round(n || 0).toLocaleString('en-GB')}` }
function gbpK(n) { const v = n || 0; return Math.abs(v) >= 1000 ? `£${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `£${Math.round(v)}` }
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n }

// Compute the cash date from a reference date + a payment term.
// term = { basis: 'days' | 'eom', days: N }
//  - 'days': refDate + N days
//  - 'eom' : last day of refDate's month, then + N days (last day of month included)
function paymentDate(refISO, term) {
  if (!refISO) return ''
  const [y, m, d] = refISO.split('-').map(Number)
  const days = num(term && term.days)
  let base
  if (term && term.basis === 'eom') {
    base = new Date(y, m, 0)               // day 0 of next month = last day of this month
  } else {
    base = new Date(y, m - 1, d)
  }
  base.setDate(base.getDate() + days)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
}
const termLabel = (term) => term ? (term.basis === 'eom' ? `EOM + ${num(term.days)}d` : `${num(term.days)} days`) : ''

// Count Mon-Fri working days between two ISO dates (inclusive).
function workingDaysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return 0
  let n = 0
  for (let d = new Date(fromISO + 'T00:00:00'); d <= new Date(toISO + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
    const wd = d.getDay(); if (wd !== 0 && wd !== 6) n++
  }
  return n
}
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Labour payment schedule -> [{ date, amount, window }].
//  - 'eom'                 : single payment on EOM(period end) + days.
//  - 'weekly'/'fortnightly': split the labour total across each week/fortnight window
//    of the period BY WORKING DAYS; each instalment pays on that window's end + days.
function labourSchedule(fromISO, toISO, total, term) {
  const t = term || { basis: 'weekly', days: 7 }
  if (!fromISO || !toISO || !(total > 0)) return []
  if (t.basis === 'eom') return [{ date: paymentDate(toISO, { basis: 'eom', days: num(t.days) }), amount: total, window: `${fromISO}..${toISO}` }]
  const step = t.basis === 'fortnightly' ? 14 : 7
  const start = new Date(fromISO + 'T00:00:00')
  const end = new Date(toISO + 'T00:00:00')
  const totalWD = workingDaysBetween(fromISO, toISO) || 1
  const out = []
  let ws = new Date(start)
  while (ws <= end) {
    let we = new Date(ws); we.setDate(we.getDate() + step - 1)
    if (we > end) we = new Date(end)
    const wsISO = isoOf(ws), weISO = isoOf(we)
    const wd = workingDaysBetween(wsISO, weISO)
    if (wd > 0) {
      const amount = total * (wd / totalWD)
      const payISO = paymentDate(weISO, { basis: 'days', days: num(t.days) })  // window end + days
      out.push({ date: payISO, amount, window: `${wsISO}..${weISO}` })
    }
    ws.setDate(ws.getDate() + step)
  }
  return out
}

function HypAppModal({ modal, onClose, onSaved }) {
  const { projectKey, projectName, xeroId, editId } = modal
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [seed, setSeed] = useState([])            // contract works seeded from rates
  const [rates, setRates] = useState(null)
  const [hypApps, setHypApps] = useState([])      // previously saved forecast apps
  const [rows, setRows] = useState([])            // this period's contract works (with pctComplete)
  const [mcdPct, setMcdPct] = useState(0)
  const [retPct, setRetPct] = useState(5)
  const [matItems, setMatItems] = useState([])    // [{ id, mode, value, comment, deliverDay }]
  const [salesTerm, setSalesTerm] = useState({ basis: 'eom', days: 30 })    // sales cash received
  const [labourTerm, setLabourTerm] = useState({ basis: 'weekly', days: 7 })  // weekly | fortnightly | eom
  const [from, setFrom] = useState(modal.from || '')   // editable period
  const [to, setTo] = useState(modal.to || '')
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
        const base = (d.seedContractWorks || []).map(r => ({ ...r }))
        const editing = editId ? (d.hypApps || []).find(a => a.id === editId) : null
        if (editing) {
          // VIEW / EDIT an existing forecast: load its own values + period.
          const byId = new Map((editing.contractWorks || []).filter(r => r.kind === 'item').map(r => [r.id, r]))
          for (const r of base) { if (r.kind === 'item') { const p = byId.get(r.id); if (p) r.pctComplete = p.pctComplete || 0 } }
          setMcdPct(editing.mcdPct || 0); setRetPct(editing.retentionPct != null ? editing.retentionPct : 5)
          setMatItems((editing.matItems || []).map(m => ({ ...m, term: m.term || { basis: 'eom', days: 30 } })))
          setSalesTerm(editing.salesTerm || { basis: 'eom', days: 30 })
          setLabourTerm(editing.labourTerm || { basis: 'weekly', days: 7 })
          setFrom(editing.from || ''); setTo(editing.to || '')
        } else {
          // NEW forecast: start from the most recent prior app's % complete (cumulative).
          const prev = (d.hypApps || []).slice().sort((a, b) => (a.to || '').localeCompare(b.to || '')).pop()
          if (prev && Array.isArray(prev.contractWorks)) {
            const byId = new Map(prev.contractWorks.filter(r => r.kind === 'item').map(r => [r.id, r]))
            for (const r of base) { if (r.kind === 'item') { const p = byId.get(r.id); if (p) r.pctComplete = p.pctComplete || 0 } }
            setMcdPct(prev.mcdPct || 0); setRetPct(prev.retentionPct != null ? prev.retentionPct : 5)
          }
        }
        setRows(base)
        setLoading(false)
      }).catch(() => { setErr('Could not load.'); setLoading(false) })
  }, [projectKey, xeroId, editId])

  // Previous cumulative gross so "this cert" reflects only the newly-added work this
  // period. When editing, the "previous" app is the latest one dated BEFORE this
  // period's start (excluding the app being edited itself).
  const prevGross = useMemo(() => {
    const others = hypApps.filter(a => a.id !== editId)
    const priors = others.filter(a => !from || (a.to || '') < from).sort((a, b) => (a.to || '').localeCompare(b.to || ''))
    const prev = priors.length ? priors[priors.length - 1] : (from ? null : others.slice().sort((a, b) => (a.to || '').localeCompare(b.to || '')).pop())
    if (!prev) return 0
    const s = computeApplicationSummary({ contractWorks: prev.contractWorks || [], variations: [], materials: prev.materials || [], mcdPct: prev.mcdPct || 0, retentionPct: prev.retentionPct != null ? prev.retentionPct : 5 }, 0)
    return s.grossCurrent
  }, [hypApps, editId, from])

  // Materials budget from rates (above-the-line materials).
  const materialsBudget = useMemo(() => {
    const items = (rates && Array.isArray(rates.items)) ? rates.items : []
    return items.filter(x => x.section === 'above' && !x.struck && x.kind !== 'heading')
      .reduce((s, x) => s + num(x.matRate) * num(x.qty), 0)
  }, [rates])

  // Value of a single material line (from % of budget or a £ figure).
  const matLineValue = (m) => m.mode === 'pct' ? materialsBudget * (num(m.value) / 100) : num(m.value)
  const materialsThisPeriod = useMemo(() => matItems.reduce((s, m) => s + matLineValue(m), 0), [matItems, materialsBudget])

  // Build a materials array for computeApplicationSummary (each line at 100% so it
  // counts fully in this cert; delivery timing is per-line and handled separately).
  const materialsForCalc = useMemo(() => (
    matItems.filter(m => matLineValue(m) > 0).map(m => ({ id: m.id, kind: 'item', total: matLineValue(m), pctComplete: 100 }))
  ), [matItems, materialsBudget])

  const workApp = { contractWorks: rows, variations: [], materials: materialsForCalc, mcdPct: num(mcdPct), retentionPct: num(retPct) }
  const sum = useMemo(() => computeApplicationSummary(workApp, prevGross), [rows, materialsForCalc, mcdPct, retPct, prevGross])

  // Revenue + labour split for the works this period (value-to-date on works lines).
  // Labour value to date on the current rows (labRate x qty x pct).
  const labourToDate = useMemo(() => {
    const items = (rates && Array.isArray(rates.items)) ? rates.items : []
    const byId = new Map(items.map(x => [x.id, x]))
    let lab = 0
    for (const r of rows) {
      if (r.kind !== 'item') continue
      const src = byId.get(r.id); if (!src) continue
      lab += num(src.labRate) * num(src.qty) * (num(r.pctComplete) / 100)
    }
    return lab
  }, [rows, rates])

  // Labour value to date on the PREVIOUS app (so labour this period is the increment).
  const prevLabourToDate = useMemo(() => {
    const others = hypApps.filter(a => a.id !== editId)
    const priors = others.filter(a => !from || (a.to || '') < from).sort((a, b) => (a.to || '').localeCompare(b.to || ''))
    const prev = priors.length ? priors[priors.length - 1] : null
    if (!prev) return 0
    const items = (rates && Array.isArray(rates.items)) ? rates.items : []
    const byId = new Map(items.map(x => [x.id, x]))
    let lab = 0
    for (const r of (prev.contractWorks || [])) {
      if (r.kind !== 'item') continue
      const src = byId.get(r.id); if (!src) continue
      lab += num(src.labRate) * num(src.qty) * (num(r.pctComplete) / 100)
    }
    return lab
  }, [hypApps, editId, from, rates])

  const labourThisPeriod = Math.max(0, labourToDate - prevLabourToDate)

  // Labour cash schedule for this period (weekly / fortnightly / EOM).
  const labSchedule = useMemo(() => labourSchedule(from, to, labourThisPeriod, labourTerm), [from, to, labourThisPeriod, labourTerm])

  const setPct = (id, v) => {
    const n = v === '' ? 0 : Math.max(0, Math.min(100, parseFloat(v) || 0))
    setRows(list => list.map(r => r.id === id ? { ...r, pctComplete: n } : r))
  }

  async function save() {
    if (!from || !to) { alert('Set the period (from and to dates) for this forecast.'); return }
    setSaving(true)
    const app = {
      id: editId || `hyp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      from, to,
      contractWorks: rows,
      materials: materialsForCalc,
      matItems: matItems.filter(m => matLineValue(m) > 0).map(m => ({ ...m, value: num(m.value), amount: matLineValue(m), term: m.term || { basis: 'eom', days: 30 }, payDate: paymentDate(m.deliverDay, m.term || { basis: 'eom', days: 30 }) })),
      matDeliverDay: matItems.filter(m => matLineValue(m) > 0 && m.deliverDay).map(m => m.deliverDay).sort()[0] || '',
      salesTerm, labourTerm,
      salesDate: paymentDate(to, salesTerm),
      labourSchedule: labSchedule.map(s => ({ date: s.date, amount: Math.round(s.amount) })),
      mcdPct: num(mcdPct), retentionPct: num(retPct),
      thisCertTotal: sum.thisCert.total,
      revenueThisPeriod: sum.thisCert.total,
      labourThisPeriod,
      materialsThisPeriod,
      createdAt: (editId && (hypApps.find(a => a.id === editId)?.createdAt)) || Date.now(),
      updatedAt: Date.now(),
    }
    const next = editId ? hypApps.map(a => a.id === editId ? app : a) : [...hypApps, app]
    try {
      await fetch('/api/project-cashflow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-hyp', projectKey, hypApps: next }) })
      setHypApps(next)
      if (onSaved) onSaved(projectKey, next.length)
    } catch {}
    setSaving(false)
    onClose()
  }

  async function deleteHyp(id) {
    if (!confirm('Delete this forecasted application?')) return
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
            <div style={{ fontSize: 17, fontWeight: 700, color: INK }}>Forecasted application <span style={{ fontSize: 12, color: '#aaa', fontWeight: 400 }}>· {editId ? 'edit' : 'new'} · forecast only</span></div>
            <div style={{ fontSize: 12.5, color: '#666', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span>{projectName} — period</span>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inpS, padding: '4px 6px', fontSize: 12 }} />
              <span>to</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inpS, padding: '4px 6px', fontSize: 12 }} />
            </div>
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
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 8 }}>Saved forecasted applications for this project</div>
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
                <MiniBox label="Materials this period" value={gbp(materialsThisPeriod)} color="#7c3aed" sub={matItems.length ? `${matItems.length} line${matItems.length === 1 ? '' : 's'}` : ''} />
                <MiniBox label="Gross to date" value={gbp(sum.grossCurrent)} />
              </div>

              {/* Payment terms (sales received, labour paid) */}
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end', background: '#f7f9fb', border: '1px solid #e4ebf1', borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <TermEditor label="Sales received" term={salesTerm} setTerm={setSalesTerm} refDate={to} refLabel="period end" />
                <LabourTermEditor term={labourTerm} setTerm={setLabourTerm} schedule={labSchedule} />
                <div style={{ fontSize: 10.5, color: '#9a958c', maxWidth: 260 }}>Materials terms are set per line below (per supplier).</div>
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

              {/* Materials - multiple line items, each with a comment (e.g. supplier)
                  and its own delivery day */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Materials on site <span style={{ fontSize: 11, color: '#aaa', fontWeight: 400 }}>(budget {gbp(materialsBudget)})</span></div>
                <button onClick={() => setMatItems(l => [...l, { id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, mode: 'figure', value: '', comment: '', deliverDay: to, term: { basis: 'eom', days: 30 } }])}
                  style={{ ...ghostBtn, padding: '5px 12px' }}>+ Add material</button>
              </div>
              <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'auto', marginBottom: 18 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ background: '#faf9f7', color: '#999' }}>
                    <th style={{ textAlign: 'left', padding: '6px 10px', width: 100 }}>Add by</th>
                    <th style={{ textAlign: 'left', padding: '6px 10px', width: 90 }}>Value</th>
                    <th style={{ textAlign: 'left', padding: '6px 10px' }}>Comment (e.g. supplier)</th>
                    <th style={{ textAlign: 'left', padding: '6px 10px', width: 130 }}>Delivery day</th>
                    <th style={{ textAlign: 'left', padding: '6px 10px', width: 170 }}>Payment term</th>
                    <th style={{ textAlign: 'right', padding: '6px 10px', width: 90 }}>Amount</th>
                    <th style={{ width: 30 }}></th>
                  </tr></thead>
                  <tbody>
                    {matItems.length === 0 && <tr><td colSpan={7} style={{ padding: '10px', textAlign: 'center', color: '#bbb' }}>No materials added. Use &quot;+ Add material&quot; for each supplier / delivery.</td></tr>}
                    {matItems.map((m) => {
                      const upd = (patch) => setMatItems(l => l.map(x => x.id === m.id ? { ...x, ...patch } : x))
                      const term = m.term || { basis: 'eom', days: 30 }
                      const payISO = paymentDate(m.deliverDay, term)
                      return (
                        <tr key={m.id} style={{ borderTop: '1px solid #f3f2ee' }}>
                          <td style={{ padding: '5px 10px' }}>
                            <select value={m.mode} onChange={e => upd({ mode: e.target.value })} style={{ ...inpS, padding: '5px 6px' }}>
                              <option value="figure">£ figure</option>
                              <option value="pct">% of budget</option>
                            </select>
                          </td>
                          <td style={{ padding: '5px 10px' }}>
                            <input type="number" value={m.value} onChange={e => upd({ value: e.target.value })} placeholder={m.mode === 'pct' ? '%' : '£'} style={{ ...inpS, width: 80, padding: '5px 6px' }} />
                          </td>
                          <td style={{ padding: '5px 10px' }}>
                            <input type="text" value={m.comment} onChange={e => upd({ comment: e.target.value })} placeholder="Supplier / note" style={{ ...inpS, width: '100%', padding: '5px 6px' }} />
                          </td>
                          <td style={{ padding: '5px 10px' }}>
                            <input type="date" value={m.deliverDay || ''} onChange={e => upd({ deliverDay: e.target.value })} style={{ ...inpS, padding: '5px 6px' }} />
                          </td>
                          <td style={{ padding: '5px 10px' }}>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <select value={term.basis} onChange={e => upd({ term: { ...term, basis: e.target.value } })} style={{ ...inpS, padding: '5px 4px', fontSize: 11 }}>
                                <option value="eom">EOM +</option>
                                <option value="days">days</option>
                              </select>
                              <input type="number" value={term.days} onChange={e => upd({ term: { ...term, days: e.target.value } })} style={{ ...inpS, width: 46, padding: '5px 4px' }} />
                            </div>
                            <div style={{ fontSize: 10, color: '#0f766e', marginTop: 2 }}>{payISO ? `cash ${fmtD(payISO)}` : ''}</div>
                          </td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 600, color: '#7c3aed' }}>{gbp(matLineValue(m))}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                            <button onClick={() => setMatItems(l => l.filter(x => x.id !== m.id))} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14 }} title="Remove">×</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {matItems.length > 0 && <tfoot><tr style={{ borderTop: '2px solid #eee', background: '#faf9f7', fontWeight: 700 }}>
                    <td colSpan={5} style={{ padding: '6px 10px', textAlign: 'right' }}>Total materials this period</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', color: '#7c3aed' }}>{gbp(materialsThisPeriod)}</td><td></td>
                  </tr></tfoot>}
                </table>
              </div>

              {/* Cert settings + save */}
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div><div style={lblS}>MCD %</div><input type="number" value={mcdPct} onChange={e => setMcdPct(e.target.value)} style={{ ...inpS, width: 70 }} /></div>
                  <div><div style={lblS}>Retention %</div><input type="number" value={retPct} onChange={e => setRetPct(e.target.value)} style={{ ...inpS, width: 70 }} /></div>
                </div>
                <button onClick={save} disabled={saving} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : (editId ? 'Update forecast' : 'Save forecasted application')}</button>
              </div>
            </div>
          )}
      </div>
    </div>
  )
}

function LabourTermEditor({ term, setTerm, schedule }) {
  const fmtD = (s) => { if (!s) return '-'; const [y, m, d] = s.split('-'); return `${d}/${m}/${String(y).slice(2)}` }
  const isInstalment = term.basis === 'weekly' || term.basis === 'fortnightly'
  return (
    <div>
      <div style={lblS}>Labour paid</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select value={term.basis} onChange={e => setTerm({ ...term, basis: e.target.value })} style={{ ...inpS, padding: '5px 6px' }}>
          <option value="weekly">Weekly</option>
          <option value="fortnightly">Fortnightly</option>
          <option value="eom">EOM + days</option>
        </select>
        <input type="number" value={term.days} onChange={e => setTerm({ ...term, days: e.target.value })} style={{ ...inpS, width: 56, padding: '5px 6px' }} title={isInstalment ? 'Days after each week/fortnight end' : 'Days after end of month'} />
        <span style={{ fontSize: 10.5, color: '#999' }}>{isInstalment ? 'days after each period end' : 'days after EOM'}</span>
      </div>
      {schedule && schedule.length > 0 && (
        <div style={{ fontSize: 10.5, color: '#b45309', marginTop: 3, maxWidth: 340 }}>
          {schedule.length === 1
            ? `cash on ${fmtD(schedule[0].date)}`
            : `${schedule.length} payments: ${schedule.slice(0, 3).map(s => fmtD(s.date)).join(', ')}${schedule.length > 3 ? '…' : ''}`}
        </div>
      )}
    </div>
  )
}

function TermEditor({ label, term, setTerm, refDate, refLabel }) {
  const cash = paymentDate(refDate, term)
  const fmtD = (s) => { if (!s) return '-'; const [y, m, d] = s.split('-'); return `${d}/${m}/${String(y).slice(2)}` }
  return (
    <div>
      <div style={lblS}>{label}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select value={term.basis} onChange={e => setTerm({ ...term, basis: e.target.value })} style={{ ...inpS, padding: '5px 6px' }}>
          <option value="days">days from {refLabel}</option>
          <option value="eom">EOM + days</option>
        </select>
        <input type="number" value={term.days} onChange={e => setTerm({ ...term, days: e.target.value })} style={{ ...inpS, width: 64, padding: '5px 6px' }} />
      </div>
      <div style={{ fontSize: 10.5, color: '#0f766e', marginTop: 3 }}>cash on {fmtD(cash)}</div>
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
