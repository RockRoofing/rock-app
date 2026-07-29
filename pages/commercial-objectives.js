import { useState, useEffect, useMemo } from 'react'
import Head from 'next/head'
import CommercialNav from '../components/CommercialNav'

const WEEKLY = [
  { id: 'w1', text: 'Have the project financials been updated? (Sync Bills, Sync Wages, Upload Bills)' },
  { id: 'w2', text: 'Have the project cash flows been updated for the next 13 weeks?' },
  { id: 'w3', text: 'Have the Project Details been fully completed?' },
  { id: 'w4', text: 'Has the Variation tracker been fully updated? (new variations added, correctly marked instructed / not instructed, correct amounts)' },
  { id: 'w5', text: 'Have the project financials been checked for accuracy? (budgets & spends accurate? correct cost allocations? missing costs? any projects strangely under/over performing?)' },
  { id: 'w6', text: 'Have all project reports been completed for all projects we were on site this week?' },
]
const MONTHLY = [
  { id: 'm1', text: 'Has the retention tracker been updated and is it accurate? (correct numbers? correct stages?)' },
  { id: 'm2', text: 'Have we raised invoices for any retentions that have become due?' },
  { id: 'm3', text: 'Does the applied-for amount match the invoiced amount in the retention tracker?' },
  { id: 'm4', text: 'Does the Retention Owed match 612 Allocated in the retention tracker?' },
  { id: 'm5', text: 'Have the project cash flows been updated for at least the next 12 months?' },
  { id: 'm6', text: 'Has the WIP been completed?' },
]

// ---- date helpers ----
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: '2-digit' }) }
// Thursday of the week containing d.
function thursdayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = x.getDay()                 // 0 Sun..6 Sat; Thursday = 4
  x.setDate(x.getDate() + (4 - day))
  return x
}
const weekKey = (d) => iso(thursdayOf(d))   // key each week by its Thursday's date
const weekLabel = (key) => { const [y, m, dd] = key.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) }

// Weeks: 12 back -> 7 forward (Thursdays), oldest first.
function buildWeeks(back = 12, fwd = 7) {
  const out = []
  const t0 = thursdayOf(new Date())
  for (let i = -back; i <= fwd; i++) { const d = new Date(t0); d.setDate(t0.getDate() + i * 7); out.push(iso(d)) }
  return out
}
// Months: 12 back -> 7 forward, oldest first.
function buildMonths(back = 12, fwd = 7) {
  const out = []
  const base = new Date(); base.setDate(1)
  for (let i = -back; i <= fwd; i++) { const d = new Date(base.getFullYear(), base.getMonth() + i, 1); out.push(monthKey(d)) }
  return out
}

export default function CommercialTasks() {
  const defaultWeeks = useMemo(() => buildWeeks(6, 3), [])
  const defaultMonths = useMemo(() => buildMonths(6, 3), [])
  const [data, setData] = useState({ weekly: {}, monthly: {} })
  const [loading, setLoading] = useState(true)
  // Separate filters for each table.
  const [wFrom, setWFrom] = useState(''); const [wTo, setWTo] = useState('')
  const [mFrom, setMFrom] = useState(''); const [mTo, setMTo] = useState('')

  useEffect(() => { (async () => {
    try { const d = await fetch('/api/commercial-objectives').then(r => r.json()); if (d.data) setData(d.data) } catch {}
    setLoading(false)
  })() }, [])

  // Weeks shown: default range, or filtered (by Thursday-week of the chosen dates).
  const weeks = useMemo(() => {
    if (!wFrom && !wTo) return defaultWeeks
    const from = wFrom ? weekKey(new Date(wFrom)) : null
    const to = wTo ? weekKey(new Date(wTo)) : null
    // build a wide range then clip
    const wide = buildWeeks(120, 120)
    return wide.filter(k => (!from || k >= from) && (!to || k <= to))
  }, [wFrom, wTo, defaultWeeks])

  const months = useMemo(() => {
    if (!mFrom && !mTo) return defaultMonths
    const wide = buildMonths(180, 180)
    return wide.filter(k => (!mFrom || k >= mFrom) && (!mTo || k <= mTo))
  }, [mFrom, mTo, defaultMonths])

  const wFiltered = !!(wFrom || wTo)
  const mFiltered = !!(mFrom || mTo)

  async function setCell(cadence, objId, colKey, current) {
    const next = current === 'yes' ? 'no' : current === 'no' ? '' : 'yes'
    setData(d => {
      const copy = { ...d, [cadence]: { ...(d[cadence] || {}) } }
      const k = `${objId}|${colKey}`
      if (next) copy[cadence][k] = { v: next }; else delete copy[cadence][k]
      return copy
    })
    try { await fetch('/api/commercial-objectives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cadence, objId, month: colKey, value: next }) }) } catch {}
  }

  return (
    <>
      <Head><title>Rock Roofing — Commercial Tasks</title></Head>
      <div style={{ minHeight: '100vh', background: '#f5f6f8' }}>
        <CommercialNav active="/commercial-objectives" />
        <div style={{ padding: 24, maxWidth: 1600, margin: '0 auto' }}>
          <h1 style={{ margin: '0 0 2px', fontSize: 24, color: '#1a1a2e' }}>Commercial Tasks</h1>
          <p style={{ color: '#8a857c', fontSize: 14, marginTop: 2 }}>Click a cell to cycle Yes / No / blank. Completion % covers the last 6 months up to today (from 30 Jul 2026, when tracking began). Future periods and days that haven't happened yet are not counted.</p>

          {loading ? <div style={{ color: '#999', padding: 20 }}>Loading…</div> : (
            <>
              <TaskTable
                title="Weekly Commercial Tasks"
                subtitle="All weekly commercial tasks to be completed by latest Close of Play Thursday."
                cadence="weekly" objectives={WEEKLY} cols={weeks} colLabel={weekLabel} colType="week"
                data={data.weekly || {}} onCell={setCell} scroll={wFiltered}
                from={wFrom} to={wTo} setFrom={setWFrom} setTo={setWTo} filtered={wFiltered}
                todayKey={weekKey(new Date())}
              />
              <div style={{ height: 30 }} />
              <TaskTable
                title="Monthly Commercial Tasks"
                subtitle="All Monthly Commercial Tasks to be completed no later than the 15th of every month."
                cadence="monthly" objectives={MONTHLY} cols={months} colLabel={monthLabel} colType="month"
                data={data.monthly || {}} onCell={setCell} scroll={mFiltered}
                from={mFrom} to={mTo} setFrom={setMFrom} setTo={setMTo} filtered={mFiltered}
                todayKey={monthKey(new Date())}
              />
            </>
          )}
        </div>
      </div>
    </>
  )
}

// The tool started on 30 Jul 2026 - nothing before this counts. Completion % looks at
// completed periods from the later of (30 Jul 2026 / 6 months ago) UP TO today only -
// future periods are NOT counted (they haven't happened yet).
const START_KEY = '2026-07-30'          // first day the tool was live
const START_WEEK = weekKey(new Date(2026, 6, 30))   // Thursday of that week
const START_MONTH = '2026-07'

function completionPct(cadence, objectives, data) {
  const today = new Date()
  let periods = []
  if (cadence === 'weekly') {
    const todayWk = weekKey(today)
    const sixAgo = new Date(today); sixAgo.setMonth(sixAgo.getMonth() - 6)
    let start = weekKey(sixAgo)
    if (start < START_WEEK) start = START_WEEK
    // all Thursdays from start up to and including this week
    const all = buildWeeks(120, 0)   // plenty back, none forward
    periods = all.filter(k => k >= start && k <= todayWk)
  } else {
    const todayMo = monthKey(today)
    const sixAgo = new Date(today); sixAgo.setMonth(sixAgo.getMonth() - 6)
    let start = monthKey(sixAgo)
    if (start < START_MONTH) start = START_MONTH
    const all = buildMonths(120, 0)
    periods = all.filter(k => k >= start && k <= todayMo)
  }
  const total = objectives.length * periods.length
  if (total === 0) return null
  let done = 0
  for (const obj of objectives) for (const c of periods) if (data[`${obj.id}|${c}`]?.v === 'yes') done++
  return Math.round((done / total) * 100)
}

function TaskTable({ title, subtitle, cadence, objectives, cols, colLabel, colType, data, onCell, scroll, from, to, setFrom, setTo, filtered, todayKey }) {
  const pct = completionPct(cadence, objectives, data)
  const inputType = colType === 'week' ? 'date' : 'month'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: 17, color: '#1a1a2e' }}>{title}</h2>
          <div style={{ fontSize: 12.5, color: '#8a857c' }}>{subtitle}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '6px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 10.5, color: '#8a857c', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Completed (last 6 months)</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: pct == null ? '#bbb' : pct === 100 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626' }}>{pct == null ? '—' : pct + '%'}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            <div>
              <div style={lbl}>From</div>
              <input type={inputType} value={from} onChange={e => setFrom(e.target.value)} style={inp} />
            </div>
            <div>
              <div style={lbl}>To</div>
              <input type={inputType} value={to} onChange={e => setTo(e.target.value)} style={inp} />
            </div>
            {filtered && <button onClick={() => { setFrom(''); setTo('') }} style={ghost}>Reset</button>}
          </div>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflowX: scroll ? 'auto' : 'visible' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%', tableLayout: scroll ? 'auto' : 'fixed' }}>
          <thead>
            <tr style={{ background: '#faf9f7' }}>
              <th style={{ ...th, position: 'sticky', left: 0, background: '#faf9f7', minWidth: 420, width: scroll ? 420 : undefined, zIndex: 2 }}>Objective</th>
              {cols.map(c => (
                <th key={c} style={{ ...th, textAlign: 'center', minWidth: scroll ? 58 : undefined, background: c === todayKey ? '#eef2ff' : '#faf9f7' }}>{colLabel(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {objectives.map(obj => (
              <tr key={obj.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                <td style={{ ...td, position: 'sticky', left: 0, background: '#fff', fontWeight: 500, color: '#1a1a2e', zIndex: 1, boxShadow: '1px 0 0 #eee', minWidth: 420, maxWidth: 420 }} title={obj.text}>
                  <div style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 12.5, lineHeight: 1.35 }}>{obj.text}</div>
                </td>
                {cols.map(c => {
                  const cell = data[`${obj.id}|${c}`]
                  const v = cell?.v || ''
                  const bg = v === 'yes' ? '#dcfce7' : v === 'no' ? '#fee2e2' : (c === todayKey ? '#f5f8ff' : '#fff')
                  const fg = v === 'yes' ? '#16a34a' : v === 'no' ? '#dc2626' : '#ccc'
                  return (
                    <td key={c} style={{ ...td, textAlign: 'center', padding: 0 }}>
                      <button onClick={() => onCell(cadence, obj.id, c, v)}
                        title={cell?.by ? `${v.toUpperCase()} — ${cell.by}` : 'Click to set'}
                        style={{ width: '100%', height: 34, border: 'none', background: bg, color: fg, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
                        {v === 'yes' ? 'Yes' : v === 'no' ? 'No' : '—'}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const th = { textAlign: 'left', padding: '9px 10px', fontSize: 11.5, color: '#8a857c', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid #eee' }
const td = { padding: '8px 10px', verticalAlign: 'middle' }
const lbl = { fontSize: 11, color: '#8a857c', marginBottom: 3, fontWeight: 600 }
const inp = { padding: '6px 9px', border: '1px solid #ddd', borderRadius: 8, fontSize: 12.5 }
const ghost = { background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }
