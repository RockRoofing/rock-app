import { useState, useEffect, useMemo, useRef } from 'react'
import Head from 'next/head'
import CommercialNav from '../components/CommercialNav'
import { computeApplicationSummary, resolveAppDates } from '../lib/applications'

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
  // Which project the horizontal cash rows are limited to. null = everything.
  const [focusKey, setFocusKey] = useState(null)
  const [xeroMap, setXeroMap] = useState({})         // projectNo -> xeroId (for live rates)
  const [projectNames, setProjectNames] = useState({})  // xeroId -> 'J240 - Market Drayton'
  const [retFin, setRetFin] = useState({})              // xeroId -> retention financials
  const [modal, setModal] = useState(null)           // { projectKey, projectName, xeroId, from, to }
  const [hypCounts, setHypCounts] = useState({})     // projectKey -> number of saved hyp apps
  const [allForecasts, setAllForecasts] = useState({}) // projectKey -> forecast apps[] (gantt bands)
  const [appActuals, setAppActuals] = useState({})           // xeroId -> real applications[]
  const [retention, setRetention] = useState([])       // retention tracker entries
  const dragging = useRef(false)
  const dragKey = useRef(null)
  const dragAnchor = useRef(null)   // first cell iso of the current drag

  useEffect(() => {
    fetch('/api/planning').then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
    fetch('/api/dashboard').then(r => r.json()).then(d => {
      const m = {}
      // xeroId -> "J240 - Market Drayton", so a breakdown line names the project instead
      // of showing a raw Xero id. Built here because the dashboard is already being
      // fetched for the job-number map and it carries the names.
      const nm = {}
      const rf = {}
      for (const p of (d.projects || [])) {
        if (p.jobNo) m[String(p.jobNo)] = String(p.xeroId)
        if (p.xeroId) {
          nm[String(p.xeroId)] = [p.jobNo, p.name].filter(Boolean).join(' - ') || String(p.xeroId)
          // The retention tracker MERGES these onto a Xero row at render time, but
          // /api/retention returns the raw saved entry - so on a project where only the
          // release dates were set, finalAccount and retentionPct are blank there.
          rf[String(p.xeroId)] = {
            finalAccount: p.afa || p.contractValue || 0,
            retentionPct: (p.retentionPct || 0) * 100,   // stored as a fraction
            totalRetention: p.totalRetention || 0,
          }
        }
      }
      setXeroMap(m); setProjectNames(nm); setRetFin(rf)
    }).catch(() => {})
    loadAllForecasts()
    fetch('/api/retention').then(r => r.json()).then(d => setRetention(d.entries || [])).catch(() => {})
  }, [])

  function loadAllForecasts() {
    fetch('/api/project-cashflow?all=1').then(r => r.json())
      .then(d => { setAllForecasts(d.all || {}); setAppActuals(d.actuals || {}) }).catch(() => {})
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

  // WHICH FORECASTS HAVE BEEN OVERTAKEN BY A REAL APPLICATION.
  //
  // A forecast is a guess at a period. Once that period has been applied for, the guess
  // is history and the ACTUAL certificate is what will be paid. Leaving both in would
  // count the same money twice.
  //
  // Superseded when the application's valuation date is at or past the forecast's end -
  // a forecast still running when the application lands is left alone, because only part
  // of its period has been certified and it is still forecasting the rest.
  //
  // Nothing is deleted. The forecast stays on the record and on the list, greyed, so a
  // prediction can still be read against what actually happened.
  // Declared ABOVE the memos that read it - a const is not hoisted, so leaving it further
  // down was a temporal dead zone that throws on first render.
  const todayKey = iso(new Date())

  const supersededIds = useMemo(() => {
    const out = new Set()
    for (const [pk, list] of Object.entries(allForecasts || {})) {
      const no = String(pk).startsWith('L:') ? String(pk).slice(2) : ''
      const xid = no ? xeroMap[no] : ''
      const apps = (xid && appActuals[xid]) || []
      if (!apps.length) continue
      const lastEnd = apps.reduce((m, a) => (a.endDate > m ? a.endDate : m), '')
      if (!lastEnd) continue
      for (const fc of (list || [])) {
        if (fc.to && fc.to <= lastEnd) out.add(fc.id)
      }
    }
    return out
  }, [allForecasts, appActuals, xeroMap])

  // PROJECTS WHOSE FORECAST NEEDS REDOING.
  //
  // A forecast is superseded the moment an application covers its period - the money is
  // now a real invoice and the forecast stops counting. That is correct, but it happens
  // SILENTLY: the plan quietly loses a period and nobody is told the remaining work has
  // not been re-forecast.
  //
  // Two triggers, both meaning "go and redo this":
  //   1. an application was raised AFTER the forecast was last saved - the position has
  //      moved and the forecast predates it;
  //   2. a forecast period has ENDED without being applied for - it has slipped, and its
  //      sales are dropped from the cash flow, so the work needs re-planning.
  const needsUpdate = useMemo(() => {
    const out = {}
    for (const [pk, list] of Object.entries(allForecasts || {})) {
      const no = String(pk).startsWith('L:') ? String(pk).slice(2) : ''
      const xid = no ? xeroMap[no] : ''
      const apps = (xid && appActuals[xid]) || []
      const reasons = []
      // Latest application, by the date it was created or its period end.
      const lastApp = apps.reduce((m, a) => {
        const t = a.createdAt || (a.endDate ? Date.parse(a.endDate) : 0)
        return t > (m.t || 0) ? { t, a } : m
      }, {})
      const newestSave = (list || []).reduce((m, f) => Math.max(m, f.updatedAt || f.createdAt || 0), 0)
      if (lastApp.t && newestSave && lastApp.t > newestSave) {
        reasons.push(`Application ${lastApp.a.appNumber || lastApp.a.seq || ''} raised since this forecast was saved`.replace('  ', ' '))
      }
      const elapsed = (list || []).filter(f => f.to && f.to < todayKey && !supersededIds.has(f.id))
      if (elapsed.length) reasons.push(`${elapsed.length} period${elapsed.length === 1 ? '' : 's'} ended without an application`)
      if (reasons.length) out[pk] = reasons
    }
    return out
  }, [allForecasts, appActuals, xeroMap, supersededIds, todayKey])

  // Per-day cash movement across all saved forecasts (in = sales + retention released;
  // out = labour instalments + materials). Kept ABOVE the loading return (rules of hooks).
  // Reverse of xeroMap, as a fallback for a project the dashboard did not name.
  const jobNoOfXeroId = useMemo(() => {
    const out = {}
    for (const [no, xid] of Object.entries(xeroMap || {})) if (xid) out[String(xid)] = no
    return out
  }, [xeroMap])
  const labelOfXeroId = (xid) => projectNames[String(xid)] || jobNoOfXeroId[String(xid)] || String(xid).slice(0, 8)

  const cashByDay = useMemo(() => {
    // FOCUS ON ONE PROJECT. Click a forecast bar and the horizontal rows above show only
    // that project's money - sales in, retention in, labour out, materials out - so you
    // can see where a forecast's cash actually lands without reading it out of a combined
    // total. Click again to go back to everything.
    const only = focusKey
    const keep = (pk) => !only || pk === only
    const map = {}
    // salesIn stays as the combined figure so nothing downstream changes; actualIn and
    // forecastIn split the same money so the two rows can be shown separately.
    const add = (d, k, amt) => {
      if (!d || !amt) return
      if (!map[d]) map[d] = { salesIn: 0, actualIn: 0, forecastIn: 0, retIn: 0, labourOut: 0, matOut: 0 }
      map[d][k] += amt
      if (k === 'actualIn' || k === 'forecastIn') map[d].salesIn += amt
    }
    // Every contributor, kept so the month bands can show WHAT made up a figure rather
    // than just asserting it.
    // Bucketed by TRANSACTION date - the valuation date the work is applied for - not by
    // the date the cash lands. A sale belongs to the month it was valued in; the payment
    // term only decides when the money shows up, and that is what the cash rows above
    // are for. An August valuation paid in October is August sales.
    const detail = {}
    const note = (txDate, cashDate, kind, label, amt, gross) => {
      const d = txDate || cashDate
      if (!d || !amt) return
      const mk = String(d).slice(0, 7)
      if (!detail[mk]) detail[mk] = []
      detail[mk].push({ kind, label, txDate: d, date: cashDate || '', amount: amt, gross: gross == null ? amt : gross })
    }
    // A forecast stores its NET figure. The sales rows want the figure AFTER MCD but
    // BEFORE retention, so only the retention is added back - the MCD stays deducted,
    // which is what makes this match the sales line in the P&L.
    const salesValue = (net, ret) => {
      const d = 1 - num(ret) / 100
      return d > 0 ? net / d : net
    }
    const monthEnd = (mk) => { const [y, m] = String(mk).split('-').map(Number); return y && m ? isoOf(new Date(y, m, 0)) : '' }

    // ACTUALS FIRST. A raised application is money that will be paid on a contractual
    // date, which is better than any forecast of it.
    //
    // Records duplicated across two Redis keys are de-duplicated server-side, so every
    // application here is counted once.
    for (const [xid, apps] of Object.entries(appActuals || {})) {
      // Actuals are keyed by Xero id, forecasts by "L:<jobNo>" - map across so the focus
      // filter catches both sides of the same project.
      if (only && `L:${jobNoOfXeroId[String(xid)] || ''}` !== only) continue
      for (const a of (apps || [])) {
        if (!a.dueDate || !a.thisCert) continue
        add(a.dueDate, 'actualIn', a.thisCert)
        note(a.endDate, a.dueDate, 'actual', `${labelOfXeroId(xid)} App ${a.appNumber || a.seq}${a.status === 'draft' ? ' (draft)' : ''}`, a.thisCert, a.thisCertGross != null ? a.thisCertGross : a.thisCert)
      }
    }

    for (const [pk, list] of Object.entries(allForecasts || {})) {
      // Forecast keys are "L:<jobNo>" or "N:<dealId>", so the name comes via xeroMap for
      // a live project. A negotiated one has no Xero record, so its key is all there is.
      const fcLabel = pk.startsWith('L:')
        ? labelOfXeroId(xeroMap[pk.slice(2)] || '') || pk.slice(2)
        : `${pk.slice(2)} (negotiated)`
      if (!keep(pk)) continue
      for (const fc of (list || [])) {
        // Overtaken by a real application - its cash is already in from the actual above.
        if (supersededIds.has(fc.id)) continue
        if (Array.isArray(fc.salesSchedule) && fc.salesSchedule.length) {
          for (const s of fc.salesSchedule) { add(s.date, 'forecastIn', s.amount || 0); note(s.appDate || monthEnd(s.month) || fc.to, s.date, 'forecast', `${fcLabel} forecast`, s.amount || 0, salesValue(s.amount || 0, fc.retentionPct)) }
        } else if (fc.salesDate) { add(fc.salesDate, 'forecastIn', fc.revenueThisPeriod || 0); note(fc.to, fc.salesDate, 'forecast', `${fcLabel} forecast`, fc.revenueThisPeriod || 0, salesValue(fc.revenueThisPeriod || 0, fc.retentionPct)) }
        for (const s of (fc.labourSchedule || [])) add(s.date, 'labourOut', s.amount || 0)
        if ((!fc.labourSchedule || !fc.labourSchedule.length) && fc.labourDate) add(fc.labourDate, 'labourOut', fc.labourThisPeriod || 0)
        for (const m of (fc.matItems || [])) add(m.payDate, 'matOut', m.amount || 0)
      }
    }
    // RETENTION RELEASES.
    //
    // The DATES come only from the tracker's 1st and 2nd release fields - whatever is
    // typed there wins, whatever the PC or sub label says. A blank date contributes
    // nothing, which is right: an unknown release date is not a forecast.
    //
    // The VALUES need more care. A saved override on a Xero project often carries only
    // the dates, because the tracker merges finalAccount and retentionPct in from Xero
    // when it renders and never writes them onto the entry. Reading the entry alone gave
    // zero and dropped the row silently.
    for (const e of (retention || [])) {
      if (only && `L:${(e.xeroId && jobNoOfXeroId[String(e.xeroId)]) || e.ourRef || ''}` !== only) continue
      const fin = (e.xeroId && retFin[String(e.xeroId)]) || {}
      const fa = parseFloat(e.finalAccount || e.projectValue || fin.finalAccount || 0) || 0
      const pct = (parseFloat(e.retentionPct || fin.retentionPct || 0) || 0) / 100
      const totalRet = (fa * pct) || parseFloat(fin.totalRetention || 0) || 0
      // Explicit half values win - the two halves are not always equal.
      const h1 = parseFloat(e.release1Value || 0) || (totalRet / 2)
      const h2 = parseFloat(e.release2Value || 0) || (totalRet / 2)
      const label = [e.ourRef, e.projectName].filter(Boolean).join(' - ') || (e.xeroId ? labelOfXeroId(e.xeroId) : '')
      if (e.release1Date && !e.release1Received && h1 > 0) { add(e.release1Date, 'retIn', h1); note(e.release1Date, e.release1Date, 'retention', `${label} retention 1st half`, h1) }
      if (e.release2Date && !e.release2Received && h2 > 0) { add(e.release2Date, 'retIn', h2); note(e.release2Date, e.release2Date, 'retention', `${label} retention 2nd half`, h2) }
    }
    // NON-ENUMERABLE on purpose. The month band builder walks Object.entries(cashByDay)
    // and slices a month key off each date - a plain property would show up there as a
    // month called "__detai" carrying every figure twice.
    Object.defineProperty(map, '__detail', { value: detail, enumerable: false })
    return map
  }, [allForecasts, retention, appActuals, supersededIds, jobNoOfXeroId, projectNames, xeroMap, retFin, focusKey])

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
            <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 230px)' }}>
              <div style={{ minWidth: NAME_W + DATE_W * 2 + days.length * CELL_W }}>
                {/* header (sticky top row) */}
                <div style={{ display: 'flex', borderBottom: '1px solid #eee', background: '#faf9f7', position: 'sticky', top: 0, zIndex: 5 }}>
                  <Frozen w={NAME_W} style={{ background: '#faf9f7', zIndex: 6 }}>Project</Frozen>
                  <PlainCell w={DATE_W} style={{ background: '#faf9f7' }}>Planned / Actual</PlainCell>
                  <PlainCell w={DATE_W} style={{ background: '#faf9f7' }}>Contract Compl.</PlainCell>
                  {view === 'day'
                    ? weekGroups.map((g, i) => <div key={i} style={{ width: g.length * CELL_W, borderLeft: '2px solid #d9d5cc', padding: '4px 6px', fontSize: 10.5, color: '#666', fontWeight: 600 }}>W/C {fmtDMY(g[0])}</div>)
                    : weekGroups.map((g, i) => <div key={i} style={{ width: 46, borderLeft: '1px solid #eee', padding: '4px 2px', fontSize: 9, color: '#666', fontWeight: 600, textAlign: 'center' }}>{fmtDMY(g[0])}</div>)}
                </div>

                {/* FOCUS BANNER. Filtering silently would be worse than not filtering at
                    all - a total that is quietly one project's is indistinguishable from
                    the whole picture. */}
                {focusKey && (
                  <div style={{ position: 'sticky', left: 0, zIndex: 6, background: '#eef4ff', border: '1px solid #c7d7f5', borderRadius: 8, padding: '6px 12px', margin: '0 0 6px', fontSize: 12, color: '#1e40af', display: 'flex', alignItems: 'center', gap: 10, width: 'fit-content' }}>
                    <strong>Showing {focusKey.startsWith('L:')
                      ? (labelOfXeroId(Object.keys(jobNoOfXeroId).find(x => jobNoOfXeroId[x] === focusKey.slice(2)) || '') || focusKey.slice(2))
                      : `${focusKey.slice(2)} (negotiated)`} only</strong>
                    <span style={{ color: '#5b7085' }}>Sales, retention, labour and materials below are this project alone.</span>
                    <button onClick={() => setFocusKey(null)} style={{ background: '#fff', border: '1px solid #c7d7f5', borderRadius: 6, padding: '2px 10px', fontSize: 11.5, cursor: 'pointer' }}>Show all</button>
                  </div>
                )}

                {/* Cash totals by stream, per column (works in day + week view). Rows are
                    sticky under the header so they stay visible when scrolling down. */}
                {(() => {
                  const cols = view === 'day' ? days.map(d => [d]) : weekGroups
                  const colSum = (colDays, stream) => colDays.reduce((s, d) => s + ((cashByDay[iso(d)] || {})[stream] || 0), 0)
                  const colSumMany = (colDays, streams) => streams.reduce((t, st) => t + colSum(colDays, st), 0)
                  const brdr = (colDays) => (view === 'day' ? (colDays[0].getDay() === 1 ? '2px solid #d9d5cc' : '1px solid #f5f5f5') : '1px solid #eee')
                  const HEADER_H = 30, ROW_H2 = 22
                  const TotalRow = ({ label, streams, colour, bg, top, bold, big }) => (
                    <div style={{ display: 'flex', borderBottom: bold ? '2px solid #d9d5cc' : '1px solid #eee', background: bg, position: 'sticky', top, zIndex: 4, height: ROW_H2 }}>
                      <Frozen w={NAME_W} style={{ background: bg, fontSize: big ? 11 : 10, fontWeight: 700, color: colour, zIndex: 6 }}>{label}</Frozen>
                      <PlainCell w={DATE_W} style={{ background: bg }} />
                      <PlainCell w={DATE_W} style={{ background: bg }} />
                      {cols.map((colDays, i) => { const v = colSumMany(colDays, streams); return (
                        <div key={i} title={v ? `${label}: ${gbp(v)}` : ''} style={{ width: view === 'day' ? CELL_W : 46, borderLeft: brdr(colDays), fontSize: big ? 8.5 : 8, fontWeight: 700, color: colour, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', lineHeight: 1 }}>{v ? gbpK(v) : ''}</div>
                      )})}
                    </div>
                  )
                  return (
                    <>
                      <TotalRow label="Sales in" streams={['salesIn']} colour="#0f766e" bg="#f4faf6" top={HEADER_H} />
                      <TotalRow label="Retention in" streams={['retIn']} colour="#15803d" bg="#f4faf6" top={HEADER_H + ROW_H2} />
                      <TotalRow label="Total IN / week" streams={['salesIn', 'retIn']} colour="#0f766e" bg="#e9f7ef" top={HEADER_H + ROW_H2 * 2} big bold />
                      <TotalRow label="Labour out" streams={['labourOut']} colour="#b45309" bg="#fdf7f2" top={HEADER_H + ROW_H2 * 3} />
                      <TotalRow label="Materials out" streams={['matOut']} colour="#7c3aed" bg="#faf7fd" top={HEADER_H + ROW_H2 * 4} />
                      <TotalRow label="Total OUT / week" streams={['labourOut', 'matOut']} colour="#b91c1c" bg="#fdecec" top={HEADER_H + ROW_H2 * 5} big bold />
                      {(() => {
                        // INCOME BY CALENDAR MONTH, banded across the columns that month
                        // covers, each month a different colour so the boundaries read at
                        // a glance.
                        //
                        // A week column can straddle two months. It is assigned to the
                        // month holding the MAJORITY of its days - its middle day - so the
                        // band breaks where the month mostly changes. The FIGURE is always
                        // the true calendar-month total, summed from cashByDay, never the
                        // sum of the columns in the band. Summing the band would silently
                        // mis-state a month whenever a week straddled the boundary.
                        const detail = (cashByDay && cashByDay.__detail) || {}
                        // Summed off the detail, which is keyed by TRANSACTION date, so a
                        // sale sits in the month it was valued rather than the month it
                        // gets paid. cashByDay is keyed by payment date and drives the
                        // cash rows above - the two answer different questions and must
                        // not be mixed.
                        //
                        // Retention releases are excluded. A release is cash arriving
                        // against work sold months ago, not a new sale, and it already has
                        // its own "Retention in" row above.
                        const monthSales = {}
                        for (const [mk, rows] of Object.entries(detail)) {
                          const m = { actual: 0, forecast: 0 }
                          for (const x of rows) {
                            // GROSS - the certificate's Gross line, before MCD and before
                            // retention is held. The cash rows above use the net figure,
                            // because that is what actually gets paid.
                            // After MCD, before retention - the P&L sales basis.
                            if (x.kind === 'actual') m.actual += x.gross
                            else if (x.kind === 'forecast') m.forecast += x.gross
                          }
                          monthSales[mk] = m
                        }
                        const groups = []
                        for (const colDays of cols) {
                          const d = colDays[Math.floor(colDays.length / 2)] || colDays[0]
                          const mk = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
                          const last = groups[groups.length - 1]
                          if (last && last.mk === mk) last.count += 1
                          else groups.push({ mk, count: 1 })
                        }
                        const cw = view === 'day' ? CELL_W : 46
                        // Every contributor to the month, so a figure that looks wrong can
                        // be traced without guessing at it.
                        const tip = (mk, kinds, total) => {
                          const rows = (detail[mk] || []).filter(x => kinds.includes(x.kind))
                            .sort((a, b) => b.gross - a.gross)
                          const head = `${monthShort(mk)}: ${gbp(total)} from ${rows.length} item${rows.length === 1 ? '' : 's'} (valued in ${monthShort(mk)})`
                          const lines = rows.slice(0, 14).map(x =>
                            `  val ${x.txDate}${x.date && x.date !== x.txDate ? ` -> cash ${x.date}` : ''}  ${x.label}  ${gbp(x.gross)}${Math.round(x.gross) !== Math.round(x.amount) ? ` (net ${gbp(x.amount)})` : ''}`)
                          if (rows.length > 14) lines.push(`  ...and ${rows.length - 14} more`)
                          return [head, ...lines].join('\n')
                        }
                        const BAND_H = 36
                        const BandRow = ({ label, colour, kinds, pick, top }) => (
                          <div style={{ display: 'flex', borderBottom: '2px solid #d9d5cc', position: 'sticky', top, zIndex: 4, height: BAND_H }}>
                            <Frozen w={NAME_W} style={{ background: '#fff', color: colour, zIndex: 6, padding: '3px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.15 }}>{label}</span>
                              <span style={{ fontSize: 8, fontWeight: 500, color: '#9a958c', lineHeight: 1.15 }}>(Total Sales at transaction date, less MCD, inc. Retention - matches P&amp;L sales)</span>
                            </Frozen>
                            <PlainCell w={DATE_W} style={{ background: '#fff' }} />
                            <PlainCell w={DATE_W} style={{ background: '#fff' }} />
                            {groups.map((g, i) => {
                              const band = MONTH_BANDS[i % MONTH_BANDS.length]
                              const v = pick(monthSales[g.mk] || { actual: 0, forecast: 0 })
                              const w = g.count * cw
                              return (
                                <div key={`${g.mk}-${i}`} title={tip(g.mk, kinds, v)}
                                  style={{
                                    width: w, background: band.bg, color: band.fg,
                                    borderLeft: '2px solid #fff', fontSize: 9.5, fontWeight: 800,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    overflow: 'hidden', whiteSpace: 'nowrap', lineHeight: 1,
                                    opacity: v ? 1 : 0.45,
                                  }}>
                                  {/* Below about 54px there is not room for both, and a
                                      truncated month name is worse than none - the colour
                                      and the tooltip still identify it. */}
                                  {w >= 54 ? `${monthShort(g.mk)}${v ? ` ${gbpK(v)}` : ''}` : (v ? gbpK(v) : '')}
                                </div>
                              )
                            })}
                          </div>
                        )
                        return (
                          <>
                            <BandRow label="Forecasted Sales / month" colour="#0f766e"
                              kinds={['forecast']} pick={m => m.forecast} top={HEADER_H + ROW_H2 * 6} />
                            <BandRow label="Actual Sales / month" colour="#15803d"
                              kinds={['actual']} pick={m => m.actual} top={HEADER_H + ROW_H2 * 6 + BAND_H} />
                          </>
                        )
                      })()}
                    </>
                  )
                })()}

                {live.length > 0 && <SectionLabel>Live projects</SectionLabel>}
                {live.map(p => <Row key={p.key} p={p} days={days} weekGroups={weekGroups} view={view} data={data} meta={metaAll[p.key] || {}}
                  countOnDay={countOnDay} sel={sel} onCellDown={cellDown} onCellEnter={cellEnter} todayKey={todayKey} forecasts={allForecasts[p.key] || []} superseded={supersededIds} stale={needsUpdate[p.key] || null} onView={openForecast} />)}

                {negotiated.length > 0 && <SectionLabel>Negotiated projects</SectionLabel>}
                {negotiated.map(p => <Row key={p.key} p={p} days={days} weekGroups={weekGroups} view={view} data={data} meta={metaAll[p.key] || {}}
                  countOnDay={countOnDay} sel={sel} onCellDown={cellDown} onCellEnter={cellEnter} todayKey={todayKey} forecasts={allForecasts[p.key] || []} superseded={supersededIds} stale={needsUpdate[p.key] || null} onView={openForecast} neg />)}
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

function Row({ p, days, weekGroups, view, data, meta, countOnDay, sel, onCellDown, onCellEnter, todayKey, forecasts = [], superseded, stale, onView, neg }) {
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
        {/* The bar going dark red says something is wrong; this says WHAT and that it is
            on you to fix. A superseded period disappearing silently is how a plan quietly
            stops matching the job. */}
        {stale && (
          <div title={stale.join('\n')}
            style={{ fontSize: 9.5, fontWeight: 700, color: '#fff', background: '#7f1d1d', borderRadius: 4, padding: '1px 5px', marginTop: 2, maxWidth: NAME_W - 16, cursor: 'help' }}>
            CASH FLOW TO BE UPDATED
          </div>
        )}
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
              // DARK RED when the forecast needs redoing. A superseded period going grey
              // is not enough - it says "this one is done", not "the plan is out of date".
              const col = stale ? '#7f1d1d' : appColour(idx)
              // Overtaken by a real application. Kept on the chart so you can read the
              // prediction against what happened, but faded and struck so it is obvious
              // it is no longer contributing cash.
              const gone = superseded && superseded.has(fc.id)
              const left = s * CELL_W, width = (e - s + 1) * CELL_W
              const matIn = fc.matDeliverDay && fc.matDeliverDay >= firstDayKey && fc.matDeliverDay <= lastDayKey
              const matLeft = matIn ? dayIndex(fc.matDeliverDay) * CELL_W : 0
              // CLICKABLE. It was pointerEvents:'none', which is why the only way in was
              // the View button. Clicking the bar now limits the cash rows above to this
              // project alone - clicking again clears it.
              return (
                <div key={fc.id} onClick={() => setFocusKey(k => k === pk ? null : pk)}
                  title={focusKey === pk ? 'Showing only this project above - click to show all' : 'Click to show only this project in the cash rows above'}
                  style={{ position: 'absolute', top: 3, bottom: 3, left, width, cursor: 'pointer', outline: focusKey === pk ? '2px solid #1a1a19' : 'none', outlineOffset: 1, borderRadius: 4 }}>
                  <div title={gone
                    ? 'Superseded - this period has been applied for, so the real application is in the cash flow instead'
                    // Shows what is STORED on the record, so a bar disagreeing with the
                    // modal can be settled here instead of by guesswork.
                    : stale
                    ? `PROJECT CASH FLOW NEEDS UPDATING\n${stale.join('\n')}\n\nOpen the forecast and re-plan the remaining work.`
                    : `Stored on this forecast:\nrevenueThisPeriod ${fc.revenueThisPeriod == null ? '(not set)' : gbp(fc.revenueThisPeriod)}\nthisCertTotal ${fc.thisCertTotal == null ? '(not set)' : gbp(fc.thisCertTotal)}\ngrossClaimedToDate ${fc.grossClaimedToDate == null ? '(not set)' : gbp(fc.grossClaimedToDate)}\nprevGrossOverride ${fc.prevGrossOverride == null ? '(none)' : gbp(fc.prevGrossOverride)}\nrevenueOverride ${fc.revenueOverride == null ? '(none)' : gbp(fc.revenueOverride)}\nsaved ${fc.updatedAt ? new Date(fc.updatedAt).toLocaleString('en-GB') : '-'}`}
                    style={{ position: 'absolute', inset: 0, background: gone ? '#c9c5bd' : col, opacity: gone ? 0.5 : 0.82, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', pointerEvents: gone ? 'auto' : 'none' }}>
                    <span style={{ color: '#fff', fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap', textShadow: '0 1px 1px rgba(0,0,0,0.3)', padding: '0 4px', textDecoration: gone ? 'line-through' : 'none' }}>
                      {/* revenueThisPeriod is what was STORED. Where it is missing or
                          zero but the certificate value is not, the bar falls back to
                          thisCertTotal and marks it - a forecast saved while its prior was
                          wrong stored 0, and the bar then read "Rev £0" for ever after,
                          with no way to tell that from a genuine nil period. */}
                      {gone ? 'Superseded' : `App ${idx + 1}`} · Rev {gbpK(fc.revenueThisPeriod || fc.thisCertTotal || 0)}{(!fc.revenueThisPeriod && fc.thisCertTotal) ? '*' : ''} · Lab {gbpK(fc.labourThisPeriod)}{fc.materialsThisPeriod ? ` · Mat ${gbpK(fc.materialsThisPeriod)}` : ''}
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
function gbp(n) { return `\u00a3${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
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

// Calendar months a period spans, as ['YYYY-MM', ...] (inclusive of both ends).
function monthsInPeriod(fromISO, toISO) {
  if (!fromISO || !toISO) return []
  const [fy, fm] = fromISO.split('-').map(Number)
  const [ty, tm] = toISO.split('-').map(Number)
  const out = []
  let y = fy, m = fm
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}
// Month bands on the totals row. Distinct enough to read at a glance where one month
// ends and the next begins, muted enough not to fight the project rows above.
const MONTH_BANDS = [
  { bg: '#dcfce7', fg: '#14532d' },
  { bg: '#dbeafe', fg: '#1e3a5f' },
  { bg: '#fef3c7', fg: '#78350f' },
  { bg: '#ede9fe', fg: '#4c1d95' },
  { bg: '#ffe4e6', fg: '#881337' },
  { bg: '#ccfbf1', fg: '#134e4a' },
]

const monthShort = (mk) => { const [y, m] = mk.split('-').map(Number); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${String(y).slice(2)}` }
// Even default split (%) across n months, remainder on the last.
function evenSplit(n) { if (n <= 0) return []; const base = Math.floor(100 / n); const arr = Array(n).fill(base); arr[n - 1] += 100 - base * n; return arr }

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

// Copy the percentages off a prior certificate (a real application or an earlier
// forecast) onto a fresh set of seed rows.
//
// Prior records only reliably carry id / code / pctComplete. The rates, quantities
// and totals must come from the CURRENT seed, so the prior is valued on today's
// rates - otherwise "this period" would silently absorb any rate change as though
// it were new work.
//
// id first, then code. Rows come from the same buildContractWorksFromRates() so ids
// normally match, but a re-upload of the rates regenerates them and code is then the
// only stable handle.
// Materials on site as a single synthetic line for computeApplicationSummary, which
// expects an array of material rows. pctComplete 100 because the figure IS the
// to-date value, not a percentage of a budget.
function mosLine(v) {
  const n = Number(v) || 0
  return n ? [{ id: 'mos', total: n, pctComplete: 100 }] : []
}

function applyPriorPct(baseRows, priorWorks) {
  const works = (Array.isArray(priorWorks) ? priorWorks : []).filter(r => r && r.kind !== 'heading')
  const byId = new Map(works.filter(r => r.id != null).map(r => [r.id, r]))
  const byCode = new Map(works.filter(r => r.code != null).map(r => [String(r.code), r]))
  return (baseRows || []).map(r => {
    if (r.kind !== 'item') return { ...r }
    const p = byId.get(r.id) || byCode.get(String(r.code))
    return { ...r, pctComplete: p ? (p.pctComplete || 0) : 0 }
  })
}

function HypAppModal({ modal, onClose, onSaved }) {
  const { projectKey, projectName, xeroId, editId } = modal
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [seed, setSeed] = useState([])            // contract works seeded from rates
  const [rates, setRates] = useState(null)
  const [hypApps, setHypApps] = useState([])      // previously saved forecast apps
  const [latestApp, setLatestApp] = useState(null) // latest REAL application on the project
  const [trackerVars, setTrackerVars] = useState([])   // variation tracker for this project
  const [varRows, setVarRows] = useState([])           // [{ key, pctComplete, include }]
  const [rows, setRows] = useState([])            // this period's contract works (with pctComplete)
  const [mcdPct, setMcdPct] = useState(0)
  const [retPct, setRetPct] = useState(5)
  const [matItems, setMatItems] = useState([])    // [{ id, mode, value, comment, deliverDay }]
  const [salesTerm, setSalesTerm] = useState({ basis: 'eom', days: 30, cycle: 'applications', startDate: '' })  // sales cash received
  const [labourTerm, setLabourTerm] = useState({ basis: 'weekly', days: 7 })  // weekly | fortnightly | eom
  // null = follow the calculation. Anything else is a manual figure that wins.
  // Kept as the raw string so the box can be cleared and retyped without fighting it.
  const [labourOverride, setLabourOverride] = useState(null)
  // Materials on site CLAIMED (money in), cumulative. null = follow the auto wind-down.
  const [mosOverride, setMosOverride] = useState(null)
  // null = follow the certificate maths. Anything else is a typed figure that wins.
  const [revOverride, setRevOverride] = useState(null)
  // null = follow the chain; a string is a typed 'previously claimed (gross)'.
  const [prevGrossOverride, setPrevGrossOverride] = useState(null)
  // The revenue figure stored on the forecast, i.e. what the timeline bar reads.
  const [savedRevenue, setSavedRevenue] = useState(null)
  const [actuals, setActuals] = useState(null)   // real spend from Project Financials
  const [contractTerms, setContractTerms] = useState({})  // retention / MCD from Edit Project Details
  const [appCalendar, setAppCalendar] = useState(null)    // application/valuation/payment days
  const [from, setFrom] = useState(modal.from || '')   // editable period
  const [to, setTo] = useState(modal.to || '')
  const [salesSpread, setSalesSpread] = useState({})   // { 'YYYY-MM': pct }
  const [labourSpread, setLabourSpread] = useState({}) // { 'YYYY-MM': pct }
  const [saving, setSaving] = useState(false)
  const [showList, setShowList] = useState(false)
  // What the percentages on screen were seeded from, so the modal can say so rather
  // than leaving you to guess whether a figure is real or a leftover.
  const [seededFrom, setSeededFrom] = useState(null)

  // Escape closes; a backdrop click does NOT. This modal holds a period, percentages
  // across every rate line, materials lines and payment terms - a stray click outside
  // it must not throw that away.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setLoading(true); setErr(''); setSeededFrom(null); setLabourOverride(null); setMosOverride(null); setRevOverride(null); setPrevGrossOverride(null); setSavedRevenue(null)
    fetch(`/api/project-cashflow?projectKey=${encodeURIComponent(projectKey)}${xeroId ? `&xeroId=${encodeURIComponent(xeroId)}` : ''}`)
      .then(r => r.json()).then(d => {
        if (!d.hasRates) { setErr(d && d.contractedRates === null ? 'No contracted rates for this project yet. Upload & lock them on the Contracted Rates page first (for a live project, add it in Xero so it appears there).' : 'No contracted rates found.'); setLoading(false); return }
        setSeed(d.seedContractWorks || [])
        setRates(d.contractedRates || null)
        setHypApps(d.hypApps || [])
        setLatestApp(d.latestApplication || null)
        setActuals(d.actuals || null)
        const terms = d.contractTerms || {}
        setContractTerms(terms)
        setAppCalendar(d.appCalendar || null)
        const tv = Array.isArray(d.variations) ? d.variations : []
        setTrackerVars(tv)
        // Variation rows mirror the tracker, carrying a percentage and an include flag.
        //
        // Instructed variations are in by default. Uninstructed ones are LISTED but off
        // until you tick them - they are not agreed money, and quietly forecasting them
        // would overstate the job.
        const seedVarRows = (pctByKey, includeExtra) => tv.map(v => ({
          key: v.key,
          pctComplete: pctByKey && pctByKey[v.key] != null ? num(pctByKey[v.key]) : 0,
          include: v.instructed === 'yes' || !!(includeExtra && includeExtra[v.key]),
        }))
        const base = (d.seedContractWorks || []).map(r => ({ ...r }))
        const editing = editId ? (d.hypApps || []).find(a => a.id === editId) : null
        if (editing) {
          // VIEW / EDIT an existing forecast: load its own values + period.
          const byId = new Map((editing.contractWorks || []).filter(r => r.kind === 'item').map(r => [r.id, r]))
          for (const r of base) { if (r.kind === 'item') { const p = byId.get(r.id); if (p) r.pctComplete = p.pctComplete || 0 } }
          setMcdPct(editing.mcdPct || 0); setRetPct(editing.retentionPct != null ? editing.retentionPct : 5)
          setMatItems((editing.matItems || []).map(m => ({ ...m, term: m.term || { basis: 'eom', days: 30 } })))
          setSalesTerm(editing.salesTerm || { basis: 'eom', days: 30, cycle: 'applications', startDate: '' })
          setLabourTerm(editing.labourTerm || { basis: 'weekly', days: 7 })
          setLabourOverride(editing.labourOverride == null ? null : String(editing.labourOverride))
          setMosOverride(editing.materialsOnSiteOverride == null ? null : String(editing.materialsOnSiteOverride))
          setRevOverride(editing.revenueOverride == null ? null : String(editing.revenueOverride))
          // What the timeline bar is currently showing, so the two can be compared.
          setSavedRevenue(editing.revenueThisPeriod == null ? null : num(editing.revenueThisPeriod))
          setPrevGrossOverride(editing.prevGrossOverride == null ? null : String(editing.prevGrossOverride))
          if (editing.salesSpread) setSalesSpread(editing.salesSpread)
          if (editing.labourSpread) setLabourSpread(editing.labourSpread)
          setFrom(editing.from || ''); setTo(editing.to || '')
          // Saved variation rows win; a variation raised since is added at 0%.
          const savedPct = {}, savedInc = {}
          for (const v of (editing.varRows || [])) { savedPct[v.key] = v.pctComplete; if (v.include) savedInc[v.key] = true }
          setVarRows(tv.map(v => ({
            key: v.key,
            pctComplete: savedPct[v.key] != null ? num(savedPct[v.key]) : 0,
            include: (editing.varRows || []).some(x => x.key === v.key) ? !!savedInc[v.key] : v.instructed === 'yes',
          })))
        } else {
          // NEW forecast. Start from the latest REAL application - that is the last
          // agreed picture of how complete the job is, and it is what a forecast
          // should carry on from.
          //
          // If a forecast already exists for a LATER period than that application,
          // that one wins instead. Otherwise a second forecast would jump backwards
          // to the real application's percentages and undo the first one. So the rule
          // is "whichever ends last", not "always the application".
          //
          // With neither, the rows stay at 0% straight off the contracted rates -
          // the existing behaviour, and the right start for a job not yet applied for.
          const app = d.latestApplication || null
          const lastHyp = (d.hypApps || []).slice().sort((a, b) => (a.to || '').localeCompare(b.to || '')).pop() || null
          const appEnd = app ? (app.endDate || '') : ''
          const hypEnd = lastHyp ? (lastHyp.to || '') : ''
          // Ties go to the real application - it is the certified position.
          const useApp = !!app && (!lastHyp || appEnd >= hypEnd)
          const src = useApp ? app : lastHyp

          if (src) {
            const works = (Array.isArray(src.contractWorks) ? src.contractWorks : []).filter(r => r && r.kind !== 'heading')
            const byId = new Map(works.filter(r => r.id != null).map(r => [r.id, r]))
            // Also match on code. A real application's rows come from the same
            // buildContractWorksFromRates(), so ids normally line up - but if the rates
            // have been re-uploaded since, they will not, and the code is the only
            // stable handle. Seeding everything at 0% would look like a job that had
            // never started.
            const byCode = new Map(works.filter(r => r.code != null).map(r => [String(r.code), r]))
            for (const r of base) {
              if (r.kind !== 'item') continue
              const p = byId.get(r.id) || byCode.get(String(r.code))
              if (p) r.pctComplete = p.pctComplete || 0
            }
            // RETENTION AND MCD COME FROM EDIT PROJECT DETAILS.
            //
            // They are contract terms, not a property of the last certificate - if the
            // rate on the project is corrected, every forecast from then on should use
            // the corrected one. The prior certificate only fills the gap where the
            // project has no figure set, and 5% / 0% only where neither does.
            //
            // Retention is not part of gross, so changing it cannot disturb the
            // already-claimed chain - it only changes what is deducted this period.
            setMcdPct(terms.mcdPct != null ? terms.mcdPct : (src.mcdPct != null ? src.mcdPct : 0))
            setRetPct(terms.retentionPct != null ? terms.retentionPct : (src.retentionPct != null ? src.retentionPct : 5))
            setSeededFrom(useApp
              ? { kind: 'application', label: `Application ${src.appNumber || src.seq || ''}`.trim(), status: src.status || '' }
              : { kind: 'forecast', label: 'the previous forecast', status: '' })
            // Variation percentages come from the same source as the works percentages.
            // An application stores them as varPct; a forecast stores varRows.
            const vPct = useApp ? (src.varPct || {}) : {}
            const vInc = {}
            if (!useApp) for (const v of (src.varRows || [])) { vPct[v.key] = v.pctComplete; if (v.include) vInc[v.key] = true }
            setVarRows(seedVarRows(vPct, vInc))
          } else {
            setSeededFrom({ kind: 'rates', label: 'contracted rates', status: '' })
            setVarRows(seedVarRows({}, {}))
            if (terms.mcdPct != null) setMcdPct(terms.mcdPct)
            if (terms.retentionPct != null) setRetPct(terms.retentionPct)
          }
        }
        setRows(base)
        setLoading(false)
      }).catch(() => { setErr('Could not load.'); setLoading(false) })
  }, [projectKey, xeroId, editId])

  // WHAT HAS ALREADY BEEN CLAIMED.
  //
  // The percentages on screen are cumulative value-to-date, not this period's work.
  // Everything below the last certificate has already been applied for and must NOT
  // be spread across this period's cash - only the increment is new money.
  //
  // This used to look at FORECASTS ONLY. On a live job with three real applications
  // and no forecasts yet it returned nothing, so the entire value to date - all of it
  // already claimed - was spread as this period's revenue.
  //
  // The prior is now whichever certificate ENDS LAST before this period starts:
  // a real application or an earlier forecast. Same rule as the seeding, and it has
  // to be the same rule, or the figure carried in and the figure deducted would
  // disagree.
  const prior = useMemo(() => {
    const cands = []
    for (const a of hypApps) {
      if (a.id === editId) continue        // never treat the app being edited as its own prior
      const vp = {}
      for (const v of (a.varRows || [])) vp[v.key] = num(v.pctComplete)
      cands.push({
        end: a.to || '', works: a.contractWorks || [], varPct: vp, mos: num(a.materialsOnSite),
        // What that forecast RECORDED as claimed to date. On a forecast whose revenue or
        // labour was overridden this is HIGHER than its percentages account for - the
        // money was claimed without measuring it - so the percentages alone understate
        // what has gone, and the next forecast would offer it again.
        grossClaimed: a.grossClaimedToDate == null ? null : num(a.grossClaimedToDate),
        labourClaimed: a.labourClaimedToDate == null ? null : num(a.labourClaimedToDate),
        kind: 'forecast',
      })
    }
    // MATERIALS ON SITE ALREADY CLAIMED comes across as part of the prior. Leave it out
    // and the forecast believes only the measured work and variations have been claimed
    // - so every pound of stock already invoiced gets forecast a second time as the work
    // it was bought for is measured. On J240 that was 65,690.28 of a 92,766.50 claim.
    if (latestApp) cands.push({ end: latestApp.endDate || '', works: latestApp.contractWorks || [], varPct: latestApp.varPct || {}, mos: num(latestApp.materialsClaimed), kind: 'application' })
    // WHEN EDITING, the prior is the certificate ending before this one's period, so a
    // forecast in the middle of a chain still deducts only what came before it.
    //
    // FOR A NEW ONE, take the latest of everything regardless of period. Money already
    // claimed is already claimed - it cannot be un-claimed by choosing an earlier start
    // date. Filtering on `from` here meant that picking a period starting before the
    // last application's valuation date dropped it out, prevGross fell to zero, and the
    // whole value to date was spread again - the very thing this is meant to prevent.
    // A REAL APPLICATION IS NEVER FILTERED OUT BY THE PERIOD DATES.
    //
    // The rule above was applied to everything when editing: only certificates ending
    // BEFORE this period's start counted. So editing a forecast whose period begins
    // before the last application's end date dropped that application entirely -
    // previously claimed fell to ZERO and the whole contract was offered again as this
    // period's work. On J190 that showed 401,663.50 gross to date with 0.00 previously
    // claimed, and the entire labour budget as "labour this period".
    //
    // Certified money cannot be un-certified by choosing an earlier start date - which
    // the comment above already says about NEW forecasts. It is just as true when
    // editing, and it was only ever the FORECAST chain that needed sequencing: a
    // forecast in the middle of a chain should still deduct only what came before it.
    const apps = cands.filter(c => c.kind === 'application')
    const fcs = cands.filter(c => c.kind !== 'application')
    const priorFcs = editId ? fcs.filter(c => !from || (c.end || '') < from) : fcs
    const pool = [...apps, ...priorFcs]
    if (!pool.length) return null
    // Ties go to the application - it is the certified position, a forecast is not.
    return pool.slice().sort((a, b) =>
      (a.end || '').localeCompare(b.end || '') || (a.kind === 'application' ? 1 : -1)
    ).pop()
  }, [hypApps, latestApp, editId, from])

  // VARIATIONS INCLUDED THIS PERIOD, shaped for computeApplicationSummary.
  //
  // Only the ticked ones are passed in at all. That matters: variationValueToDate() in
  // lib/applications.js tests `v.instructed === false`, and instructed is the STRING
  // 'no' on this codebase - so an uninstructed variation handed to it would be counted
  // in full. Filtering here means it never gets the chance.
  const varsForCert = useMemo(() => {
    const byKey = new Map(trackerVars.map(v => [v.key, v]))
    return varRows.filter(r => r.include).map(r => {
      const v = byKey.get(r.key) || {}
      return { key: r.key, instructed: true, materials: v.materials || 0, labour: v.labour || 0, profit: v.profit || 0, pctComplete: num(r.pctComplete) }
    })
  }, [varRows, trackerVars])

  // The same list at the PRIOR certificate's percentages, so variation revenue this
  // period is the increment - exactly as the contract works are handled.
  const priorVarsForCert = useMemo(() => {
    const byKey = new Map(trackerVars.map(v => [v.key, v]))
    const pct = (prior && prior.varPct) || {}
    return varRows.filter(r => r.include).map(r => {
      const v = byKey.get(r.key) || {}
      return { key: r.key, instructed: true, materials: v.materials || 0, labour: v.labour || 0, profit: v.profit || 0, pctComplete: num(pct[r.key] || 0) }
    })
  }, [varRows, trackerVars, prior])
  const priorRows = useMemo(() => (prior ? applyPriorPct(seed, prior.works) : []), [prior, seed])
  // Materials on site already claimed on the prior certificate. Declared here because
  // prevGross below reads it, and a memo that reads a const declared under it throws.
  const mosPriorRaw = prior ? num(prior.mos) : 0

  // MCD BASIS, sent on EVERY computeApplicationSummary call in this modal.
  // computeApplicationSummary defaults both to true when absent, the applications screen
  // defaults them to false - so leaving them off does not mean "use the project setting",
  // it means "discount everything", which is the opposite of an unticked box.
  const mcdBasis = {
    mcdOnVariations: contractTerms.mcdOnVariations === true,
    mcdOnMaterials: contractTerms.mcdOnMaterials === true,
  }


  // Previous cumulative gross, so "this cert" is only the newly-added work.
  // Variations are counted on BOTH sides at their respective percentages - include them
  // here only and the prior would be overstated, omit them here only and every
  // variation already certified would be forecast as new money a second time.
  // What the prior's PERCENTAGES account for.
  const priorMeasuredGross = useMemo(() => {
    if (!priorRows.length && !priorVarsForCert.length && !mosPriorRaw) return 0
    const s = computeApplicationSummary({ contractWorks: priorRows, variations: priorVarsForCert, materials: mosLine(mosPriorRaw), mcdPct: num(mcdPct), retentionPct: num(retPct), ...mcdBasis }, 0)
    return s.grossCurrent
  }, [priorRows, priorVarsForCert, mosPriorRaw, mcdPct, retPct, contractTerms])

  // What was actually CLAIMED. The two differ only where a previous forecast's revenue
  // was overridden instead of its percentages being filled in - which is a perfectly
  // reasonable way to work, and the chain has to carry it or that money gets claimed
  // twice. A real application always measures everything, so there it is the same number.
  const prevGrossAuto = prior && prior.grossClaimed != null ? prior.grossClaimed : priorMeasuredGross

  // PREVIOUSLY CLAIMED, TYPED. Blank = use the calculation above.
  //
  // The automatic chain cannot always reconstruct what an earlier OVERRIDE represented.
  // Override revenue to claim materials on site, and grossClaimedToDate is built as
  //     sum.grossCurrent + (prevGross - priorMeasuredGross) + revUpliftGross
  // where grossCurrent ALREADY contains that period's materials - so the same money
  // enters twice and every later application deducts too much. On a 135k contract with
  // 60k + 36k claimed, app 3 offered -23,000 instead of 39,000.
  //
  // What you know for certain is the cash claimed. This lets you say so, exactly as the
  // applications screen already allows.
  const prevGross = prevGrossOverride === null || prevGrossOverride === '' ? prevGrossAuto : num(prevGrossOverride)

  // SHOW THE ARITHMETIC on the revenue box, with the actual rates.
  //
  // "Increment less MCD and retention" sitting next to "X left after the last forecast"
  // reads as two versions of the same number that ought to agree. One is GROSS, the other
  // is after deductions, and neither said so - it cost a round trip working out whether a
  // 3% gap was retention working correctly or retention missing entirely.
  //
  // retentionPct is stored as a FRACTION (0.05) while mcdPct is a PERCENTAGE (2.5), so a
  // value under 1 is read as a fraction and scaled for display. Getting that wrong is how
  // 3% becomes 300%.
  const retPctShown = num(retPct) > 0 && num(retPct) < 1 ? num(retPct) * 100 : num(retPct)

  // Materials budget from rates (above-the-line materials).
  const materialsBudget = useMemo(() => {
    const items = (rates && Array.isArray(rates.items)) ? rates.items : []
    return items.filter(x => x.section === 'above' && !x.struck && x.kind !== 'heading')
      .reduce((s, x) => s + num(x.matRate) * num(x.qty), 0)
  }, [rates])

  // MATERIALS CONSUMED BY THE WORK MEASURED THIS PERIOD, from each line's own material
  // rate on the contracted rates (matRate x qty), applied to the percentage ADDED this
  // period rather than the cumulative figure - the same increment logic as revenue and
  // labour.
  //
  // Lines that went backwards are ignored rather than netted off. A reduced percentage
  // does not send materials back to the supplier.
  const materialsConsumed = useMemo(() => {
    const items = (rates && Array.isArray(rates.items)) ? rates.items : []
    const byId = new Map(items.map(x => [x.id, x]))
    const priorById = new Map(priorRows.filter(r => r.kind === 'item').map(r => [r.id, r]))
    let v = 0
    for (const r of rows) {
      if (r.kind !== 'item') continue
      const src = byId.get(r.id); if (!src) continue
      const was = priorById.has(r.id) ? num(priorById.get(r.id).pctComplete) : 0
      const delta = num(r.pctComplete) - was
      if (delta <= 0) continue
      v += num(src.matRate) * num(src.qty) * (delta / 100)
    }
    // Variations are treated exactly as the contracted scope is: their MATERIALS
    // element, against the percentage added this period.
    const priorVarPct = new Map(priorVarsForCert.map(x => [x.key, num(x.pctComplete)]))
    for (const x of varsForCert) {
      const delta = num(x.pctComplete) - (priorVarPct.get(x.key) || 0)
      if (delta <= 0) continue
      v += num(x.materials) * (delta / 100)
    }
    return v
  }, [rows, priorRows, rates, varsForCert, priorVarsForCert])

  // MATERIALS CLAIMED AGAINST THE LINE ITEMS, cumulative - the materials element of
  // everything measured to date, not just this period. Sits alongside materials on site
  // to give the total materials position claimed off the customer.
  const materialsClaimedOnLines = useMemo(() => {
    const items = (rates && Array.isArray(rates.items)) ? rates.items : []
    const byId = new Map(items.map(x => [x.id, x]))
    let v = 0
    for (const r of rows) {
      if (r.kind !== 'item') continue
      const src = byId.get(r.id); if (!src) continue
      v += num(src.matRate) * num(src.qty) * (num(r.pctComplete) / 100)
    }
    for (const x of varsForCert) v += num(x.materials) * (num(x.pctComplete) / 100)
    return v
  }, [rows, rates, varsForCert])

  // MATERIALS ON SITE (claimed from the customer, money IN - not the supplier lines).
  //
  // Carried in from the last certificate, then wound down automatically as the work is
  // measured: the stock bought for a roof stops being "on site" the moment that roof is
  // valued as measured work. Winding it down by exactly what the measured work consumed
  // is what stops the customer being asked to pay for the same materials twice.
  //
  // Manual override for the cases the rule cannot know about - a delivery landing that
  // you want to claim before it is fixed, which pushes the figure UP.
  //
  // It has to reach zero by final account, because by then everything is measured.
  const mosAuto = Math.max(0, mosPriorRaw - materialsConsumed)
  const mosToDate = mosOverride == null ? mosAuto : Math.max(0, num(mosOverride))

  // What actually has to be BOUGHT this period, as opposed to consumed. Materials drawn
  // out of stock already on site were paid for in an earlier period, so charging them to
  // suppliers again here would double the cash out.
  //
  //   drawdown negative = you have ADDED stock, so that gets bought on top.
  const mosDrawdown = mosPriorRaw - mosToDate
  const materialsToBuy = Math.max(0, materialsConsumed - mosDrawdown)
  const matLineValue = (m) => m.mode === 'pct' ? materialsBudget * (num(m.value) / 100) : num(m.value)
  const materialsThisPeriod = useMemo(() => matItems.reduce((s, m) => s + matLineValue(m), 0), [matItems, materialsBudget])

  // Above-the-line budgets from rates: labour (labRate x qty) and sales (contract total).
  const labourBudget = useMemo(() => {
    const items = (rates && Array.isArray(rates.items)) ? rates.items : []
    return items.filter(x => x.section === 'above' && !x.struck && x.kind !== 'heading')
      .reduce((s, x) => s + num(x.labRate) * num(x.qty), 0)
  }, [rates])
  const salesBudget = useMemo(() => {
    const items = (rates && Array.isArray(rates.items)) ? rates.items : []
    return items.filter(x => x.section === 'above' && !x.struck && x.kind !== 'heading')
      .reduce((s, x) => s + (x.total != null ? num(x.total) : num(x.rate) * num(x.qty)), 0)
  }, [rates])

  // INSTRUCTED variations only, for the "remaining" figures. Gross to date counts
  // variations, so budgets measured against it have to as well or "remaining" reads low
  // by the whole variation account. Uninstructed ones are excluded even when ticked into
  // a forecast - they are not agreed money and must not inflate a budget.
  //
  // Deliberately SEPARATE from materialsBudget: that one drives the "% of budget"
  // material lines, and moving it would silently revalue every saved forecast.
  const instructedVarTotals = useMemo(() => {
    const ins = trackerVars.filter(v => v.instructed === 'yes')
    return {
      value: ins.reduce((s, v) => s + num(v.value), 0),
      labour: ins.reduce((s, v) => s + num(v.labour), 0),
      materials: ins.reduce((s, v) => s + num(v.materials), 0),
    }
  }, [trackerVars])
  const salesBudgetTotal = salesBudget + instructedVarTotals.value
  const labourBudgetTotal = labourBudget + instructedVarTotals.labour
  const materialsBudgetTotal = materialsBudget + instructedVarTotals.materials

  // Materials used across every OTHER saved forecast (to date), for the remaining figure.
  const materialsUsedPrior = useMemo(() => {
    let used = 0
    for (const a of hypApps) { if (a.id === editId) continue; used += num(a.materialsThisPeriod) }
    return used
  }, [hypApps, editId])

  // Gross = measured work + included variations + MATERIALS ON SITE, exactly as the
  // application computes it. The supplier lines ("Materials forecasted on site") are a
  // separate thing entirely - cash going OUT, scheduled off each line's pay date - and
  // are not part of this.
  const workApp = { contractWorks: rows, variations: varsForCert, materials: mosLine(mosToDate), mcdPct: num(mcdPct), retentionPct: num(retPct), ...mcdBasis }
  const sum = useMemo(() => computeApplicationSummary(workApp, prevGross), [rows, varsForCert, mosToDate, mcdPct, retPct, prevGross, contractTerms])

  // AFTER `sum` - it reads sum.grossCurrent. Declared above it this is a temporal dead
  // zone: a const is not hoisted like a function, so it throws on the first render.
  const grossIncrement = Math.max(0, (sum?.grossCurrent || 0) - prevGross)

  // REVENUE THIS PERIOD.
  //
  // Calculated is the increment over the last certificate, net of MCD and retention.
  // That is the right default and it is still only a model of what will actually be
  // certified - a QS disputes a percentage, a claim is part-certified, an application
  // lands late and slips a month. So it can be overridden outright.
  //
  // The override drives the CASH ONLY: the month spread, the payment schedule and the
  // sales-in stream. It deliberately does NOT rewrite the percentages, so "Gross to
  // date" and the labour and materials positions still show the true measured position
  // and the next forecast still carries on from the real numbers. Otherwise one typed
  // figure would quietly corrupt everything after it.
  // What the "remaining" lines are measured AFTER. The grey figure answers "how much is
  // left to claim", so it is budget less what the PREVIOUS certificate had - it must not
  // move as you type this period's percentages, or it stops being headroom and becomes a
  // running total of the same thing the box above already shows.
  const salesCycle = (salesTerm && salesTerm.cycle) || 'applications'
  // The project calendar is only usable if it can actually produce a cash date. A
  // valuation day with no payment day gives an application date and no payment, which
  // would drop the money out of the forecast silently.
  const appCalendarUsable = !!(appCalendar && appCalendar.paymentDay && (appCalendar.valuationDay || appCalendar.applicationDay))

  const priorLabel = !prior ? 'the start'
    : prior.kind === 'application' ? `App ${(latestApp && (latestApp.appNumber || latestApp.seq)) || ''}`.trim()
    : 'the last forecast'

  const revenueCalculated = sum.thisCert.total || 0
  const revenueThisPeriod = revOverride == null ? revenueCalculated : Math.max(0, num(revOverride))

  // THE OVERRIDE UPLIFT, EXPRESSED AS GROSS.
  //
  // Revenue is net of MCD and retention; the claimed position is gross, before both. So
  // an extra 1,000 of revenue represents MORE than 1,000 of gross claim, and adding the
  // net figure straight onto a gross total would understate what has been claimed.
  //
  // Grossed up on the same deductions the certificate used. With 2.5% MCD and 5%
  // retention, 1,000 of extra revenue is 1,000 / (0.975 x 0.95) = 1,079.80 of gross.
  const revUpliftGross = useMemo(() => {
    if (revOverride == null) return 0
    const net = revenueThisPeriod - revenueCalculated
    if (!net) return 0
    // Derived from the certificate itself rather than assuming MCD applies to the whole
    // account - on a contract-works-only basis the flat formula would gross up too far.
    const g = sum.thisCert.gross, t = sum.thisCert.total
    const d = (g > 0 && t > 0) ? (t / g) : ((1 - num(mcdPct) / 100) * (1 - num(retPct) / 100))
    return d > 0 ? net / d : net
  }, [revOverride, revenueThisPeriod, revenueCalculated, mcdPct, retPct, sum])

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
    // Variations the same way as the contracted scope: their LABOUR element at their
    // own percentage.
    for (const x of varsForCert) lab += num(x.labour) * (num(x.pctComplete) / 100)
    return lab
  }, [rows, rates, varsForCert])

  // Labour value to date on the PREVIOUS certificate, so labour this period is the
  // increment. Uses the same `prior` as prevGross above - it previously had its own
  // forecasts-only lookup, which meant labour and revenue could disagree about what
  // had already been claimed.
  const prevLabourToDate = useMemo(() => {
    if (!priorRows.length) return 0
    const items = (rates && Array.isArray(rates.items)) ? rates.items : []
    const byId = new Map(items.map(x => [x.id, x]))
    let lab = 0
    for (const r of priorRows) {
      if (r.kind !== 'item') continue
      const src = byId.get(r.id); if (!src) continue
      lab += num(src.labRate) * num(src.qty) * (num(r.pctComplete) / 100)
    }
    for (const x of priorVarsForCert) lab += num(x.labour) * (num(x.pctComplete) / 100)
    return lab
  }, [priorRows, rates, priorVarsForCert])

  // Same again for labour: what the prior RECORDED beats what its percentages imply.
  const prevLabour = prior && prior.labourClaimed != null ? prior.labourClaimed : prevLabourToDate

  // LABOUR THIS PERIOD.
  //
  // The calculation is the labour element of the work added this period - labRate x qty
  // across the contract works, plus the labour split of any included variation, less
  // whatever the prior certificate already carried.
  //
  // That is a SUGGESTION, not a fact. It assumes labour is spent in exactly the same
  // shape as the work is valued, and on a real job it is not - a gang goes on early, a
  // sub-contractor invoices in one lump, a week is lost to weather. So the figure can
  // be overridden outright and everything downstream (the month spread, the payment
  // schedule, the cash-out stream) follows the override.
  //
  // Overriding does NOT touch the percentages. Revenue stays driven by the works, which
  // is right - being paid for labour early does not mean the customer owes more.
  const labourCalculated = Math.max(0, labourToDate - prevLabour)
  const labourThisPeriod = labourOverride == null ? labourCalculated : Math.max(0, num(labourOverride))
  // Labour is not subject to MCD or retention, so its uplift needs no grossing up.
  const labourUplift = labourOverride == null ? 0 : (labourThisPeriod - labourCalculated)

  // Calendar months this period spans, and keep the sales/labour spreads in step.
  const periodMonths = useMemo(() => monthsInPeriod(from, to), [from, to])
  useEffect(() => {
    if (!periodMonths.length) return
    const fix = (spread) => {
      const cur = periodMonths.every(m => spread[m] != null) && Object.keys(spread).length === periodMonths.length
      if (cur) return spread
      const even = evenSplit(periodMonths.length)
      const next = {}; periodMonths.forEach((m, i) => { next[m] = spread[m] != null ? spread[m] : even[i] })
      // If months were added/removed, re-even only when totals look wrong.
      const tot = periodMonths.reduce((s, m) => s + num(next[m]), 0)
      if (Object.keys(spread).length !== periodMonths.length || tot === 0) periodMonths.forEach((m, i) => { next[m] = even[i] })
      return next
    }
    setSalesSpread(s => fix(s))
    setLabourSpread(s => fix(s))
  }, [periodMonths.join(',')])

  // Sales cash schedule.
  //
  // Two ways of applying, and they produce quite different cash:
  //
  //   'applications'  one application for the whole period, its value spread across the
  //                   calendar months it covers, each month's share paid off that month
  //                   end. This is the original behaviour and stays the default.
  //
  //   weekly /        applications go in on a fixed cycle from a start date, and each is
  //   fortnightly     paid its own term after ITS OWN date. On a job that applies every
  //                   fortnight, month-end spreading puts the money in the wrong weeks.
  //
  // The cycle dates are the APPLICATION dates. The payment term then runs from each one,
  // so "fortnightly, 30 days from application" gives an application every 14 days and
  // cash 30 days after each.
  const salesSchedule = useMemo(() => {
    const rev = revenueThisPeriod
    if (!(rev > 0)) return []
    const cycle = (salesTerm && salesTerm.cycle) || 'applications'

    if (cycle === 'weekly' || cycle === 'fortnightly') {
      const step = cycle === 'weekly' ? 7 : 14
      // Falls back to the period start, so choosing a cycle without setting a date still
      // produces something sensible rather than nothing.
      const start = (salesTerm && salesTerm.startDate) || from
      if (!start || !to || start > to) return []
      const dates = []
      const end = new Date(`${to}T00:00:00`)
      const d = new Date(`${start}T00:00:00`)
      if (isNaN(d) || isNaN(end)) return []
      // Hard cap: a mistyped start date years back would otherwise spin.
      while (d <= end && dates.length < 60) { dates.push(isoOf(d)); d.setDate(d.getDate() + step) }
      if (!dates.length) return []
      const each = rev / dates.length
      return dates.map(appDate => ({
        month: appDate.slice(0, 7),
        appDate,
        date: paymentDate(appDate, salesTerm),
        amount: each,
      })).filter(s => s.amount > 0.5)
    }

    // The project's OWN application calendar, from Edit Project Details. One application
    // per calendar month, dated on the valuation day, cash on the final date for payment.
    //
    // resolveAppDates() is the same function the applications screen uses, so the forecast
    // lands on the exact dates the real applications will - including any per-month
    // override. Rebuilding the rule here would drift the moment one of them changed.
    if (cycle === 'project') {
      if (!periodMonths.length || !appCalendarUsable) return []
      return periodMonths.map(mk => {
        const dts = resolveAppDates(mk, appCalendar || {})
        const cash = salesTerm.payOn === 'due' ? (dts.paymentDate || dts.finalDate) : (dts.finalDate || dts.paymentDate)
        return {
          month: mk,
          appDate: dts.valDate || dts.appDate || '',
          date: cash,
          amount: rev * (num(salesSpread[mk]) / 100),
        }
      }).filter(s => s.date && s.amount > 0.5)
    }

    // One application for the period: each spread month's portion, timed off month end.
    if (!periodMonths.length) return []
    const days = num(salesTerm.days)
    return periodMonths.map(mk => {
      const pct = num(salesSpread[mk]) / 100
      const date = paymentDate(`${mk}-01`, { basis: 'eom', days })
      return { month: mk, date, amount: rev * pct }
    }).filter(s => s.amount > 0.5)
  }, [revenueThisPeriod, periodMonths, salesSpread, salesTerm, from, to, appCalendar, appCalendarUsable])

  // Labour cash schedule: each spread month's portion, timed by the labour term.
  const labSchedule = useMemo(() => {
    if (!(labourThisPeriod > 0) || !periodMonths.length) return []
    const out = []
    for (const mk of periodMonths) {
      const pct = num(labourSpread[mk]) / 100
      const monthAmt = labourThisPeriod * pct
      if (monthAmt <= 0.5) continue
      const [y, m] = mk.split('-').map(Number)
      const mStart = `${mk}-01`, mEnd = isoOf(new Date(y, m, 0))
      if (labourTerm.basis === 'eom') {
        out.push({ date: paymentDate(mStart, { basis: 'eom', days: num(labourTerm.days) }), amount: monthAmt, window: mk })
      } else {
        for (const s of labourSchedule(mStart, mEnd, monthAmt, labourTerm)) out.push(s)
      }
    }
    return out
  }, [labourThisPeriod, periodMonths, labourSpread, labourTerm])

  const setPct = (id, v) => {
    const n = v === '' ? 0 : Math.max(0, Math.min(100, parseFloat(v) || 0))
    setRows(list => list.map(r => r.id === id ? { ...r, pctComplete: n } : r))
  }
  // Whether every item line is already at 100% (for the header tick state).
  const itemRows = rows.filter(r => r.kind === 'item')
  const allHundred = itemRows.length > 0 && itemRows.every(r => num(r.pctComplete) >= 100)
  const setAllPct = (pct) => setRows(list => list.map(r => r.kind === 'item' ? { ...r, pctComplete: pct } : r))

  // Put every percentage back to the last real application, i.e. exactly the position
  // that has already been certified. Revenue and labour this period then read zero,
  // which is the honest starting point - you add only what you are claiming on top.
  //
  // Deliberately targets the APPLICATION, not whatever the rows were seeded from. A
  // button called "revert to last application" that quietly reverted to a forecast
  // would be lying.
  const revertToApplication = () => {
    if (!latestApp) return
    setRows(applyPriorPct(seed, latestApp.contractWorks || []))
    // Variations go back too, or reverting the works alone would still leave variation
    // revenue sitting in this period.
    const vp = latestApp.varPct || {}
    setVarRows(trackerVars.map(v => ({
      key: v.key,
      pctComplete: vp[v.key] != null ? num(vp[v.key]) : 0,
      include: v.instructed === 'yes',
    })))
    if (latestApp.mcdPct != null) setMcdPct(latestApp.mcdPct || 0)
    if (latestApp.retentionPct != null) setRetPct(latestApp.retentionPct)
    setLabourOverride(null)   // back to the calculation, or the revert would be partial
    setMosOverride(null)
    setRevOverride(null)
    // Must reset with the others. Left out, a "previously claimed" typed on one forecast
    // would silently carry onto the next one opened - the worst kind of stale figure,
    // because it looks deliberate.
    setPrevGrossOverride(null)
    setSeededFrom({ kind: 'application', label: `Application ${latestApp.appNumber || latestApp.seq || ''}`.trim(), status: latestApp.status || '' })
  }

  // Replace any previously generated line and add one valued at this period's
  // increment. One line, not one per rate item - this is a cash-timing figure, and
  // thirty supplier-less lines all landing on the same day is noise.
  const addMaterialsFromLineItems = () => {
    const v = materialsToBuy
    if (!(v > 0)) return
    setMatItems(l => [
      ...l.filter(m => !m.fromLineItems),
      {
        id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        mode: 'figure', value: Math.round(v * 100) / 100,
        comment: 'From line item material rates (% added this period, less stock on site)',
        deliverDay: to, term: { basis: 'eom', days: 30 },
        fromLineItems: true,
      },
    ])
  }

  async function save() {
    if (!from || !to) { alert('Set the period (from and to dates) for this forecast.'); return }
    setSaving(true)
    const app = {
      id: editId || `hyp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      from, to,
      contractWorks: rows,
      // Saved so the next forecast can treat this one as its prior, and so reopening
      // it restores which uninstructed variations were ticked in.
      varRows: varRows.map(r => ({ key: r.key, pctComplete: num(r.pctComplete), include: !!r.include })),
      materials: [],
      matItems: matItems.filter(m => matLineValue(m) > 0).map(m => ({ ...m, value: num(m.value), amount: matLineValue(m), term: m.term || { basis: 'eom', days: 30 }, payDate: paymentDate(m.deliverDay, m.term || { basis: 'eom', days: 30 }) })),
      matDeliverDay: matItems.filter(m => matLineValue(m) > 0 && m.deliverDay).map(m => m.deliverDay).sort()[0] || '',
      salesTerm, labourTerm,
      // null means the saved figure was calculated; a number means somebody typed it.
      labourOverride: labourOverride == null ? null : num(labourOverride),
      // Materials on site CLAIMED, cumulative - the next forecast reads this as its
      // carried-in figure, so it must be the resolved value, not just the override.
      materialsOnSite: mosToDate,
      materialsOnSiteOverride: mosOverride == null ? null : num(mosOverride),
      salesSpread, labourSpread,
      // appDate is kept so a cycled forecast can show which application each payment
      // belongs to, not just when the money lands.
      salesSchedule: salesSchedule.map(s => ({ date: s.date, amount: Math.round(s.amount), month: s.month, appDate: s.appDate || null })),
      salesDate: (salesSchedule[0] && salesSchedule[0].date) || paymentDate(to, salesTerm),
      labourSchedule: labSchedule.map(s => ({ date: s.date, amount: Math.round(s.amount) })),
      mcdPct: num(mcdPct), retentionPct: num(retPct), ...mcdBasis,
      // thisCertTotal stays the CALCULATED certificate value - it is the measured
      // position and must not move. revenueThisPeriod is what the cash flow chart reads,
      // so that one carries the override.
      thisCertTotal: sum.thisCert.total,
      revenueThisPeriod,
      revenueOverride: revOverride == null ? null : num(revOverride),
      // null = follow the chain. A number is a deliberate statement of what has been
      // claimed, and wins over anything the chain works out.
      prevGrossOverride: prevGrossOverride === null || prevGrossOverride === '' ? null : num(prevGrossOverride),
      // WHAT THIS FORECAST CLAIMS TO DATE, cumulative, which is NOT the same as what its
      // percentages measure whenever an override has been used. Overriding revenue rather
      // than filling in percentages is a normal way to work - but without recording it,
      // the next forecast reads only the percentages, believes that money was never
      // claimed, and offers the whole lot again as headroom.
      //
      // Any uplift carried in from an earlier overridden forecast is carried on, so it
      // accumulates down the chain rather than being lost at the next link.
      grossClaimedToDate: sum.grossCurrent + (prevGross - priorMeasuredGross) + revUpliftGross,
      labourClaimedToDate: labourToDate + (prevLabour - prevLabourToDate) + labourUplift,
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

  async function deleteHyp(id, closeAfter) {
    if (!confirm('Delete this forecasted application? This cannot be undone.')) return
    try {
      const d = await fetch('/api/project-cashflow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-hyp', projectKey, id }) }).then(r => r.json())
      setHypApps(d.hypApps || [])
      if (onSaved) onSaved(projectKey, (d.hypApps || []).length)
      if (closeAfter) onClose()
    } catch {}
  }

  const fmtD = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${String(y).slice(2)}` }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflow: 'auto', padding: 24 }}>
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
            {editId && <button onClick={() => deleteHyp(editId, true)} style={{ background: '#fff', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete this forecast</button>}
            <button onClick={() => setShowList(s => !s)} style={ghostBtn}>{showList ? 'Hide' : 'View'} forecasts ({hypApps.length})</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#999' }}>×</button>
          </div>
        </div>

        {loading ? <div style={{ padding: 40, color: '#888' }}>Loading…</div>
          : err ? <div style={{ padding: 30, color: '#b45309' }}>{err}</div>
          : (
            <div style={{ padding: 20 }}>
              {/* Say where the percentages came from. Without this a seeded figure and a
                  figure somebody typed look identical. */}
              {!editId && seededFrom && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                  background: seededFrom.kind === 'rates' ? '#fffbeb' : '#f0f9ff',
                  border: `1px solid ${seededFrom.kind === 'rates' ? '#fde68a' : '#bae6fd'}`,
                  borderRadius: 10, padding: '8px 12px', marginBottom: 16, fontSize: 12.5,
                  color: seededFrom.kind === 'rates' ? '#92400e' : '#075985',
                }}>
                  {seededFrom.kind === 'application' ? (
                    <span><strong>Percentages carried over from {seededFrom.label}</strong>
                      {seededFrom.status ? ` (${seededFrom.status})` : ''} - the latest application on this project. Enter where each item will be by the end of this period.</span>
                  ) : seededFrom.kind === 'forecast' ? (
                    <span><strong>Percentages carried over from {seededFrom.label}</strong>, which runs later than the last application.</span>
                  ) : (
                    <span><strong>No applications yet</strong> - starting from the contracted rates at 0%.</span>
                  )}
                </div>
              )}
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
                {/* OVER-CLAIM WARNING. It should not be possible to claim more than the
                    job is worth, and nothing said so - it surfaced later as a NEGATIVE
                    revenue on the next application, which reads like a broken calculation
                    rather than an over-claim. 158,000 claimed on a 135,000 contract should
                    have been flagged at the point it happened. */}
                {salesBudgetTotal > 0 && prevGross > salesBudgetTotal + 1 && (
                  <div style={{ width: '100%', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginBottom: 4, fontSize: 12, color: '#b91c1c' }}>
                    <strong>Already claimed {gbp(prevGross)} against a contract of {gbp(salesBudgetTotal)}</strong> - over by {gbp(prevGross - salesBudgetTotal)}.
                    {' '}That is why this period offers a negative figure: the excess unwinds here. Check the materials on site on the earlier application, or type what has really been claimed into &quot;Previously claimed&quot; below.
                  </div>
                )}

                {/* PREVIOUSLY CLAIMED. Blank follows the chain; typed wins.
                    The chain cannot reconstruct what an earlier OVERRIDE represented -
                    override revenue to claim materials on site and that money is counted
                    both inside grossCurrent and again as the override uplift, so every
                    later application deducts too much. This is the escape hatch, same as
                    the applications screen has. */}
                <OverrideBox label="Previously claimed (gross)" calculated={prevGrossAuto} override={prevGrossOverride} setOverride={setPrevGrossOverride}
                  colour="#334155" autoNote={`From ${priorLabel}`}
                  sub2="Type what has actually been claimed if an earlier period's revenue was overridden" />
                {/* SAVED vs LIVE. The bar on the timeline reads the SAVED
                    revenueThisPeriod; this box calculates live. They drift apart the
                    moment anything changes - and a forecast saved while the prior was
                    wrong stored 0, so the bar showed "Rev £0" against a live figure of
                    38,125.84 with nothing to explain the difference. */}
                {savedRevenue != null && Math.abs(savedRevenue - revenueThisPeriod) > 1 && (
                  <div style={{ width: '100%', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '7px 12px', marginBottom: 4, fontSize: 12, color: '#92400e' }}>
                    <strong>Not saved yet.</strong> The timeline still shows {gbp(savedRevenue)} for this period because that is what was last saved; the figure below is {gbp(revenueThisPeriod)}. Press Save to update it.
                  </div>
                )}
                <OverrideBox label="Revenue this period" calculated={revenueCalculated} override={revOverride} setOverride={setRevOverride}
                  colour="#0f766e"
                  autoNote={`${gbp(grossIncrement)} gross${num(mcdPct) > 0 ? `, less MCD ${num(mcdPct)}%` : ''}${retPctShown > 0 ? `, less retention ${retPctShown}%` : ', no retention set'}`}
                  sub2={`${gbp(Math.max(0, salesBudgetTotal - prevGross))} of contract left after ${priorLabel} (gross, before deductions)`} />
                <OverrideBox label="Labour this period" calculated={labourCalculated} override={labourOverride} setOverride={setLabourOverride}
                  colour="#b45309" autoNote="From rates and variations" sub2={`${gbp(Math.max(0, labourBudgetTotal - prevLabour))} left after ${priorLabel}`} />
                <MiniBox label="Materials this period" value={gbp(materialsThisPeriod)} color="#7c3aed" sub={matItems.length ? `${matItems.length} line${matItems.length === 1 ? '' : 's'}` : ''} sub2={`${gbp(Math.max(0, materialsBudgetTotal - materialsUsedPrior))} left after ${priorLabel}`} />
                <OverrideBox label="Materials on site (claimed)" calculated={mosAuto} override={mosOverride} setOverride={setMosOverride}
                  colour="#5b21b6"
                  autoNote={mosPriorRaw > 0 ? `${gbp(mosPriorRaw)} carried in, less ${gbp(Math.min(mosPriorRaw, materialsConsumed))} measured` : 'Nothing claimed on site yet'}
                  sub2={mosDrawdown > 0 ? `${gbp(mosDrawdown)} released into measured work` : (mosDrawdown < 0 ? `${gbp(-mosDrawdown)} of new stock claimed` : 'Unchanged this period')} />
                <MiniBox label="Gross to date" value={gbp(sum.grossCurrent)} />
              </div>

              {/* Budget vs claimed vs actual spend. The boxes above are all "this
                  period"; these are the cumulative position for the whole job. */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                <PositionPanel
                  title="Labour" colour="#b45309"
                  budget={labourBudgetTotal}
                  claimed={labourToDate} claimedNote="(labour element of measured work)"
                  spend={actuals ? actuals.labourSpend : null} spendAt={actuals ? actuals.calculatedAt : null}
                />
                <PositionPanel
                  title="Materials" colour="#7c3aed"
                  budget={materialsBudgetTotal}
                  claimed={materialsClaimedOnLines + mosToDate} claimedNote="(line items + on site)"
                  spend={actuals ? actuals.materialsSpend : null} spendAt={actuals ? actuals.calculatedAt : null}
                  rows={<>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '1px 0 1px 12px' }}>
                      <span style={{ fontSize: 11, color: '#b8b3aa' }}>against line items</span>
                      <span style={{ fontSize: 12, color: '#9a958c', whiteSpace: 'nowrap' }}>{gbp(materialsClaimedOnLines)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '1px 0 1px 12px' }}>
                      <span style={{ fontSize: 11, color: '#b8b3aa' }}>materials on site</span>
                      <span style={{ fontSize: 12, color: '#9a958c', whiteSpace: 'nowrap' }}>{gbp(mosToDate)}</span>
                    </div>
                  </>}
                />
              </div>

              {/* Payment terms (sales received, labour paid) */}
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end', background: '#f7f9fb', border: '1px solid #e4ebf1', borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <TermEditor label="Sales received" term={salesTerm} setTerm={setSalesTerm} refDate={to} refLabel="period end" cycles
                  calendar={appCalendar} calendarUsable={appCalendarUsable} previewDates={salesSchedule} />
                <LabourTermEditor term={labourTerm} setTerm={setLabourTerm} schedule={labSchedule} />
                <div style={{ fontSize: 10.5, color: '#9a958c', maxWidth: 260 }}>Materials terms are set per line below (per supplier).</div>
              </div>

              {/* Monthly spread of sales + labour across the calendar months the period covers */}
              {periodMonths.length > 1 && (
                <div style={{ background: '#faf9f7', border: '1px solid #eee', borderRadius: 10, padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 2 }}>Spread across the period&apos;s {periodMonths.length} calendar months</div>
                  <div style={{ fontSize: 11, color: '#9a958c', marginBottom: 8 }}>Set what % of {(salesCycle === 'applications' || salesCycle === 'project') ? 'sales and labour' : 'labour'} falls in each month. The payment term then sets the cash date from each month end. Each row should total 100%.{salesCycle === 'weekly' || salesCycle === 'fortnightly' ? ` Sales are on a ${salesCycle} cycle, so they follow the application dates instead.` : ''}</div>
                  <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ color: '#999' }}>
                      <th style={{ textAlign: 'left', padding: '3px 10px' }}></th>
                      {periodMonths.map(mk => <th key={mk} style={{ padding: '3px 10px', minWidth: 70 }}>{monthShort(mk)}</th>)}
                      <th style={{ padding: '3px 10px' }}>Total</th>
                    </tr></thead>
                    <tbody>
                      {/* Only meaningful when ONE application covers the period. On a
                          weekly or fortnightly cycle the application dates drive the cash
                          and this row would be ignored - showing it would invite you to
                          set numbers that do nothing. */}
                      {(salesCycle === 'applications' || salesCycle === 'project') && <SpreadRow label="Sales %" months={periodMonths} spread={salesSpread} setSpread={setSalesSpread} />}
                      <SpreadRow label="Labour %" months={periodMonths} spread={labourSpread} setSpread={setLabourSpread} />
                    </tbody>
                  </table>
                </div>
              )}

              {/* Contract works with % complete */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Contract works (enter cumulative % complete)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  {latestApp && (
                    <button onClick={revertToApplication} style={{ ...ghostBtn, padding: '5px 12px' }}
                      title="Put every line back to the percentages on the last application. Revenue and labour this period return to zero.">
                      Revert to Application {latestApp.appNumber || latestApp.seq || ''}
                    </button>
                  )}
                  <label style={{ fontSize: 12, color: '#0f766e', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
                    <input type="checkbox" checked={allHundred} onChange={e => setAllPct(e.target.checked ? 100 : 0)} />
                    All lines 100%
                  </label>
                </div>
              </div>
              <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'auto', maxHeight: 320, marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ background: '#faf9f7', color: '#999' }}>
                    <th style={{ textAlign: 'left', padding: '6px 10px' }}>Description</th>
                    <th style={{ textAlign: 'right', padding: '6px 10px' }}>Total</th>
                    <th style={{ textAlign: 'center', padding: '6px 10px' }}>100%</th>
                    <th style={{ textAlign: 'right', padding: '6px 10px' }}>% complete</th>
                    <th style={{ textAlign: 'right', padding: '6px 10px' }}>Value to date</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(r => r.kind === 'heading'
                      ? <tr key={r.id}><td colSpan={5} style={{ padding: '6px 10px', fontWeight: 700, background: '#fcfbf9', color: r.red ? '#b91c1c' : INK }}>{r.description}</td></tr>
                      : (
                        <tr key={r.id} style={{ borderTop: '1px solid #f3f2ee' }}>
                          <td style={{ padding: '5px 10px' }}>{r.description}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right' }}>{r.total ? gbp(r.total) : ''}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                            <input type="checkbox" checked={num(r.pctComplete) >= 100} onChange={e => setPct(r.id, e.target.checked ? 100 : 0)} title="Mark this line 100%" />
                          </td>
                          <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                            <input type="number" value={r.pctComplete ?? 0} onChange={e => setPct(r.id, e.target.value)} style={{ width: 60, textAlign: 'right', border: '1px solid #ddd', borderRadius: 6, padding: '3px 6px', fontSize: 12 }} />
                          </td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 600 }}>{gbp(num(r.total) * (num(r.pctComplete) / 100))}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Variations - instructed ones are in by default, uninstructed are listed
                  but off until ticked. */}
              {trackerVars.length > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Variations <span style={{ fontSize: 11, color: '#aaa', fontWeight: 400 }}>(cumulative % complete, same as the works above)</span></div>
                    <div style={{ fontSize: 11.5, color: '#999' }}>{varsForCert.length} of {trackerVars.length} in this forecast</div>
                  </div>
                  <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'auto', maxHeight: 260, marginBottom: 18 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ background: '#faf9f7', color: '#999' }}>
                        <th style={{ textAlign: 'center', padding: '6px 10px', width: 44 }}>In</th>
                        <th style={{ textAlign: 'left', padding: '6px 10px', width: 70 }}>No.</th>
                        <th style={{ textAlign: 'left', padding: '6px 10px' }}>Description</th>
                        <th style={{ textAlign: 'right', padding: '6px 10px', width: 100 }}>Value</th>
                        <th style={{ textAlign: 'right', padding: '6px 10px', width: 80 }}>% cmp</th>
                        <th style={{ textAlign: 'right', padding: '6px 10px', width: 100 }}>To date</th>
                      </tr></thead>
                      <tbody>
                        {trackerVars.map(v => {
                          const row = varRows.find(r => r.key === v.key) || { pctComplete: 0, include: false }
                          const unins = v.instructed !== 'yes'
                          const upd = (patch) => setVarRows(l => {
                            const found = l.some(r => r.key === v.key)
                            return found ? l.map(r => r.key === v.key ? { ...r, ...patch } : r) : [...l, { key: v.key, pctComplete: 0, include: false, ...patch }]
                          })
                          return (
                            <tr key={v.key} style={{ borderTop: '1px solid #f3f2ee', opacity: row.include ? 1 : 0.55 }}>
                              <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                                <input type="checkbox" checked={!!row.include} onChange={e => upd({ include: e.target.checked })} />
                              </td>
                              <td style={{ padding: '5px 10px', fontWeight: 600 }}>{v.varNumber || '-'}</td>
                              <td style={{ padding: '5px 10px' }}>
                                {v.description}
                                {unins && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '1px 5px' }}>Not instructed</span>}
                              </td>
                              <td style={{ padding: '5px 10px', textAlign: 'right' }}>{gbp(v.value)}</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                                <input type="number" value={row.pctComplete} disabled={!row.include}
                                  onChange={e => upd({ pctComplete: e.target.value === '' ? 0 : Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                                  style={{ ...inpS, width: 62, padding: '4px 6px', textAlign: 'right' }} />
                              </td>
                              <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 600, color: row.include ? '#0f766e' : '#bbb' }}>
                                {gbp(row.include ? v.value * (num(row.pctComplete) / 100) : 0)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Materials - multiple line items, each with a comment (e.g. supplier)
                  and its own delivery day */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Materials forecasted on site <span style={{ fontSize: 11, color: '#aaa', fontWeight: 400 }}>(supplier payments out - budget {gbp(materialsBudget)})</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button onClick={addMaterialsFromLineItems} disabled={!(materialsToBuy > 0)}
                    title={materialsToBuy > 0
                      ? 'Add one line for the materials that actually have to be bought this period - what the measured work consumed, less anything drawn out of stock already on site.'
                      : (materialsConsumed > 0
                        ? 'The materials for the work measured this period are already on site and were paid for earlier.'
                        : 'Nothing added this period yet - move a contract works percentage above first.')}
                    style={{ ...ghostBtn, padding: '5px 12px', opacity: materialsToBuy > 0 ? 1 : 0.45, cursor: materialsToBuy > 0 ? 'pointer' : 'default' }}>
                    Fill from line items {materialsToBuy > 0 ? `(${gbp(materialsToBuy)})` : ''}
                  </button>
                  <button onClick={() => setMatItems(l => [...l, { id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, mode: 'figure', value: '', comment: '', deliverDay: to, term: { basis: 'eom', days: 30 } }])}
                    style={{ ...ghostBtn, padding: '5px 12px' }}>+ Add material</button>
                </div>
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
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                  <div><div style={lblS}>MCD %</div><input type="number" value={mcdPct} onChange={e => setMcdPct(e.target.value)} style={{ ...inpS, width: 70 }} /></div>
                  <div><div style={lblS}>Retention %</div><input type="number" value={retPct} onChange={e => setRetPct(e.target.value)} style={{ ...inpS, width: 70 }} /></div>
                  {/* Say where these came from. A retention rate that appeared by itself
                      and one somebody typed look identical otherwise. */}
                  <div style={{ fontSize: 10.5, color: '#9a958c', paddingBottom: 6, maxWidth: 260 }}>
                    {contractTerms.retentionPct == null && contractTerms.mcdPct == null
                      ? 'Not set on Edit Project Details - set them there and they will come through.'
                      : (num(retPct) !== num(contractTerms.retentionPct != null ? contractTerms.retentionPct : retPct)
                         || num(mcdPct) !== num(contractTerms.mcdPct != null ? contractTerms.mcdPct : mcdPct))
                        ? `Changed here. Project details say ${contractTerms.retentionPct != null ? `${contractTerms.retentionPct}% retention` : 'no retention'}${contractTerms.mcdPct != null ? `, ${contractTerms.mcdPct}% MCD` : ''}.`
                        : 'From Edit Project Details.'}
                  </div>
                </div>
                <button onClick={save} disabled={saving} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : (editId ? 'Update forecast' : 'Save forecasted application')}</button>
              </div>
            </div>
          )}
      </div>
    </div>
  )
}

function SpreadRow({ label, months, spread, setSpread }) {
  const total = months.reduce((s, m) => s + num(spread[m]), 0)
  const off = Math.abs(total - 100) > 0.5
  return (
    <tr style={{ borderTop: '1px solid #eee' }}>
      <td style={{ padding: '4px 10px', fontWeight: 600, color: '#555' }}>{label}</td>
      {months.map(mk => (
        <td key={mk} style={{ padding: '4px 10px' }}>
          <input type="number" value={spread[mk] ?? ''} onChange={e => setSpread(s => ({ ...s, [mk]: e.target.value === '' ? 0 : parseFloat(e.target.value) }))}
            style={{ width: 56, textAlign: 'right', border: '1px solid #ddd', borderRadius: 6, padding: '3px 6px', fontSize: 12 }} />
        </td>
      ))}
      <td style={{ padding: '4px 10px', fontWeight: 700, color: off ? '#dc2626' : '#16a34a' }}>{Math.round(total)}%</td>
    </tr>
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

function TermEditor({ label, term, setTerm, refDate, refLabel, cycles, calendar, calendarUsable, previewDates }) {
  const cycle = (term && term.cycle) || 'applications'
  const cycling = cycles && (cycle === 'weekly' || cycle === 'fortnightly')
  const usingProject = cycles && cycle === 'project'
  // When applications go in on a cycle, the term runs from each APPLICATION date, so the
  // preview has to be off the start date - not the period end, which is the reference
  // for a single application covering the whole period.
  const cash = paymentDate(cycling ? (term.startDate || refDate) : refDate, term)
  const fmtD = (s) => { if (!s) return '-'; const [y, m, d] = s.split('-'); return `${d}/${m}/${String(y).slice(2)}` }
  const first = previewDates && previewDates[0]
  return (
    <div>
      <div style={lblS}>{label}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {cycles && (
          <select value={cycle} onChange={e => setTerm({ ...term, cycle: e.target.value })} style={{ ...inpS, padding: '5px 6px' }}>
            <option value="applications">Per application</option>
            <option value="project">Project application dates</option>
            <option value="weekly">Weekly</option>
            <option value="fortnightly">Fortnightly</option>
          </select>
        )}
        {usingProject ? (
          <select value={term.payOn || 'final'} onChange={e => setTerm({ ...term, payOn: e.target.value })} style={{ ...inpS, padding: '5px 6px' }}>
            <option value="final">cash on final date for payment</option>
            <option value="due">cash on payment due</option>
          </select>
        ) : (
          <>
            <select value={term.basis} onChange={e => setTerm({ ...term, basis: e.target.value })} style={{ ...inpS, padding: '5px 6px' }}>
              <option value="days">days from {cycling ? 'application' : refLabel}</option>
              <option value="eom">EOM + days</option>
            </select>
            <input type="number" value={term.days} onChange={e => setTerm({ ...term, days: e.target.value })} style={{ ...inpS, width: 64, padding: '5px 6px' }} />
          </>
        )}
      </div>
      {cycling && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 10.5, color: '#9a958c' }}>starting</span>
          <input type="date" value={term.startDate || ''} onChange={e => setTerm({ ...term, startDate: e.target.value })} style={{ ...inpS, padding: '4px 6px' }} />
        </div>
      )}
      <div style={{ fontSize: 10.5, color: usingProject && !calendarUsable ? '#b45309' : '#0f766e', marginTop: 3, maxWidth: 300 }}>
        {usingProject
          ? (!calendarUsable
              ? 'No application calendar on this project - set the valuation and payment days on Edit Project Details.'
              : (first
                  ? `val ${fmtD(first.appDate)} -> cash ${fmtD(first.date)}${previewDates.length > 1 ? `, then ${previewDates.length - 1} more` : ''}`
                  : 'From Edit Project Details.'))
          : cycling
            ? `first cash ${fmtD(cash)}${term.startDate ? '' : ' (from period start - set a date)'}`
            : `cash on ${fmtD(cash)}`}
      </div>
    </div>
  )
}

// Budget / claimed / spend for one cost head, so the forecast can be sanity-checked
// against what the job has actually cost.
//
// Three different questions, and they must not be confused:
//   Budget   what the contracted rates and instructed variations allow.
//   Claimed  what has been billed to the CUSTOMER for it, cumulative.
//   Spend    what has actually left the business, from Project Financials.
function PositionPanel({ title, colour, budget, claimed, claimedNote, spend, spendAt, rows }) {
  const pct = budget > 0 ? (spend / budget) * 100 : null
  const over = pct != null && pct > 100
  const Row = ({ k, v, note, strong, tone }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '3px 0' }}>
      <span style={{ fontSize: 11.5, color: '#7a756c' }}>{k}{note ? <span style={{ color: '#b8b3aa' }}> {note}</span> : null}</span>
      <span style={{ fontSize: 13.5, fontWeight: strong ? 800 : 700, color: tone || INK, whiteSpace: 'nowrap' }}>{v}</span>
    </div>
  )
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 10, padding: '10px 14px', minWidth: 280, flex: '1 1 300px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: colour, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{title}</div>
      <Row k="Total budget" v={gbp(budget)} note="(rates + instructed vars)" />
      <Row k="Claimed to date" v={gbp(claimed)} note={claimedNote} tone={colour} />
      {rows}
      <div style={{ borderTop: '1px solid #f0eee9', marginTop: 4, paddingTop: 2 }}>
        {spend == null
          ? <Row k="Spend to date" v="n/a" note="(not in Xero)" />
          : <Row k="Spend to date" v={gbp(spend)} note="(Project Financials)" strong tone={over ? '#b91c1c' : INK} />}
        {spend != null && (
          <div style={{ fontSize: 10, color: over ? '#b91c1c' : '#b8b3aa', textAlign: 'right' }}>
            {pct != null ? `${pct.toFixed(1)}% of budget spent` : ''}
            {spendAt ? ` - synced ${String(spendAt).slice(8, 10)}/${String(spendAt).slice(5, 7)}/${String(spendAt).slice(2, 4)}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

// An override box: a calculated figure that can be replaced by a typed one.
//
// Module scope, not nested - a component declared inside another remounts on every
// render, and these hold focused text inputs. Nested, they lose focus after every
// keypress.
function OverrideBox({ label, calculated, override, setOverride, colour, autoNote, sub2 }) {
  const on = override != null
  return (
    <div style={{ background: '#fff', border: on ? `1.5px solid ${colour}` : '1px solid #e6e3dc', borderRadius: 10, padding: '10px 16px', minWidth: 172 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#888' }}>{label}</span>
        <button
          onClick={() => setOverride(on ? null : String(Math.round(calculated * 100) / 100))}
          title={on ? 'Go back to the calculated figure' : 'Type your own figure instead'}
          style={{ border: 'none', background: 'none', padding: 0, fontSize: 10.5, fontWeight: 700, color: colour, cursor: 'pointer', textDecoration: 'underline' }}>
          {on ? 'Reset' : 'Override'}
        </button>
      </div>
      {on ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: colour }}>{'\u00a3'}</span>
          <input
            type="number" step="0.01" min="0" value={override}
            onChange={e => setOverride(e.target.value)}
            style={{ width: '100%', border: 'none', borderBottom: `1px solid ${colour}44`, outline: 'none', fontSize: 19, fontWeight: 800, color: colour, padding: '1px 0', background: 'transparent' }} />
        </div>
      ) : (
        <div style={{ fontSize: 19, fontWeight: 800, color: colour }}>{gbp(calculated)}</div>
      )}
      <div style={{ fontSize: 10.5, color: on ? colour : '#9a958c' }}>
        {on ? `Manual - calculated was ${gbp(calculated)}` : autoNote}
      </div>
      {sub2 && <div style={{ fontSize: 10.5, color: '#c4c0b8' }}>{sub2}</div>}
    </div>
  )
}

function MiniBox({ label, value, sub, sub2, color, strong }) {
  return (
    <div style={{ background: strong ? '#f7faf9' : '#fff', border: strong ? '1.5px solid #0f766e' : '1px solid #e6e3dc', borderRadius: 10, padding: '10px 16px', minWidth: 150 }}>
      <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color: color || INK }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: '#9a958c' }}>{sub}</div>}
      {sub2 && <div style={{ fontSize: 10.5, color: '#c4c0b8' }}>{sub2}</div>}
    </div>
  )
}
const lblS = { fontSize: 11, color: '#888', marginBottom: 3 }
const inpS = { padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }
