import { useState, useEffect, useMemo } from 'react'
import Head from 'next/head'
import CommercialNav from './CommercialNav'

export const WEEKLY = [
  { id: 'w1', text: 'Have the project financials been updated? (Sync Bills, Sync Wages, Upload Bills)' },
  { id: 'w2', text: 'Have the project cash flows been updated for the next 13 weeks?' },
  { id: 'w3', text: 'Have the Project Details been fully completed?' },
  { id: 'w4', text: 'Has the Variation tracker been fully updated? (new variations added, correctly marked instructed / not instructed, correct amounts)' },
  { id: 'w5', text: 'Have the project financials been checked for accuracy? (budgets & spends accurate? correct cost allocations? missing costs? any projects strangely under/over performing?)' },
  { id: 'w6', text: 'Have all project reports been completed for all projects we were on site this week?' },
]
export const MONTHLY = [
  { id: 'm1', text: 'Has the retention tracker been updated and is it accurate? (correct numbers? correct stages?)' },
  { id: 'm2', text: 'Have we raised invoices for any retentions that have become due?' },
  { id: 'm3', text: 'Does the applied-for amount match the invoiced amount in the retention tracker?' },
  { id: 'm4', text: 'Does the Retention Owed match 612 Allocated in the retention tracker?' },
  { id: 'm5', text: 'Have the project cash flows been updated for at least the next 12 months?' },
  { id: 'm6', text: 'Has the WIP been completed?' },
]

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: '2-digit' }) }
function thursdayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + (4 - x.getDay())); return x }
const weekKey = (d) => iso(thursdayOf(d))
const weekLabel = (key) => { const [y, m, dd] = key.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) }

function buildWeeks(back, fwd) { const out = []; const t0 = thursdayOf(new Date()); for (let i = -back; i <= fwd; i++) { const d = new Date(t0); d.setDate(t0.getDate() + i * 7); out.push(iso(d)) } return out }
function buildMonths(back, fwd) { const out = []; const b = new Date(); b.setDate(1); for (let i = -back; i <= fwd; i++) { const d = new Date(b.getFullYear(), b.getMonth() + i, 1); out.push(monthKey(d)) } return out }

const START_WEEK = weekKey(new Date(2026, 6, 30))
const START_MONTH = '2026-07'

function completionPct(cadence, objectives, data) {
  const today = new Date()
  let periods = []
  if (cadence === 'weekly') {
    const todayWk = weekKey(today)
    const sixAgo = new Date(today); sixAgo.setMonth(sixAgo.getMonth() - 6)
    let start = weekKey(sixAgo); if (start < START_WEEK) start = START_WEEK
    periods = buildWeeks(120, 0).filter(k => k >= start && k <= todayWk)
  } else {
    const todayMo = monthKey(today)
    const sixAgo = new Date(today); sixAgo.setMonth(sixAgo.getMonth() - 6)
    let start = monthKey(sixAgo); if (start < START_MONTH) start = START_MONTH
    periods = buildMonths(120, 0).filter(k => k >= start && k <= todayMo)
  }
  const total = objectives.length * periods.length
  if (total === 0) return null
  let done = 0
  for (const obj of objectives) for (const c of periods) if (data[`${obj.id}|${c}`]?.v === 'yes') done++
  return Math.round((done / total) * 100)
}

// cadence: 'weekly' | 'monthly'
export default function CommercialTaskTable({ cadence, active, title, subtitle }) {
  const objectives = cadence === 'weekly' ? WEEKLY : MONTHLY
  const colType = cadence === 'weekly' ? 'week' : 'month'
  const colLabel = cadence === 'weekly' ? weekLabel : monthLabel
  const todayKey = cadence === 'weekly' ? weekKey(new Date()) : monthKey(new Date())

  const defaultCols = useMemo(() => cadence === 'weekly' ? buildWeeks(6, 3) : buildMonths(6, 3), [cadence])
  const [data, setData] = useState({ weekly: {}, monthly: {} })
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')

  useEffect(() => { (async () => {
    try { const d = await fetch('/api/commercial-objectives').then(r => r.json()); if (d.data) setData(d.data) } catch {}
    setLoading(false)
  })() }, [])

  const cols = useMemo(() => {
    if (!from && !to) return defaultCols
    if (cadence === 'weekly') {
      const f = from ? weekKey(new Date(from)) : null, t = to ? weekKey(new Date(to)) : null
      return buildWeeks(200, 200).filter(k => (!f || k >= f) && (!t || k <= t))
    }
    return buildMonths(240, 240).filter(k => (!from || k >= from) && (!to || k <= to))
  }, [from, to, defaultCols, cadence])

  const filtered = !!(from || to)
  const cell = data[cadence] || {}
  const pct = completionPct(cadence, objectives, cell)

  async function setCell(objId, colKey, current) {
    const next = current === 'yes' ? 'no' : current === 'no' ? '' : 'yes'
    setData(d => { const copy = { ...d, [cadence]: { ...(d[cadence] || {}) } }; const k = `${objId}|${colKey}`; if (next) copy[cadence][k] = { v: next }; else delete copy[cadence][k]; return copy })
    try { await fetch('/api/commercial-objectives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cadence, objId, month: colKey, value: next }) }) } catch {}
  }

  const inputType = colType === 'week' ? 'date' : 'month'

  return (
    <>
      <Head><title>Rock Roofing — {title}</title></Head>
      <div style={{ minHeight: '100vh', background: '#f5f6f8' }}>
        <CommercialNav active={active} />
        <div style={{ padding: '20px 28px 50px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <div>
              <h1 style={{ margin: '0 0 2px', fontSize: 23, color: '#1a1a2e' }}>{title}</h1>
              <div style={{ fontSize: 13, color: '#8a857c' }}>{subtitle}</div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '6px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 10.5, color: '#8a857c', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Completed (last 6 months)</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: pct == null ? '#bbb' : pct === 100 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626' }}>{pct == null ? '—' : pct + '%'}</div>
              </div>
              <div><div style={lbl}>From</div><input type={inputType} value={from} onChange={e => setFrom(e.target.value)} style={inp} /></div>
              <div><div style={lbl}>To</div><input type={inputType} value={to} onChange={e => setTo(e.target.value)} style={inp} /></div>
              {filtered && <button onClick={() => { setFrom(''); setTo('') }} style={ghost}>Reset</button>}
            </div>
          </div>

          {loading ? <div style={{ color: '#999', padding: 20 }}>Loading…</div> : (
            <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflowX: filtered ? 'auto' : 'visible' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%', tableLayout: filtered ? 'auto' : 'fixed' }}>
                <thead>
                  <tr style={{ background: '#faf9f7' }}>
                    <th style={{ ...th, position: 'sticky', left: 0, background: '#faf9f7', minWidth: 560, width: filtered ? 560 : undefined, zIndex: 2 }}>Task</th>
                    {cols.map(c => <th key={c} style={{ ...th, textAlign: 'center', minWidth: filtered ? 58 : undefined, background: c === todayKey ? '#eef2ff' : '#faf9f7' }}>{colLabel(c)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {objectives.map(obj => (
                    <tr key={obj.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                      <td style={{ ...td, position: 'sticky', left: 0, background: '#fff', fontWeight: 500, color: '#1a1a2e', zIndex: 1, boxShadow: '1px 0 0 #eee', minWidth: 560, maxWidth: 560 }} title={obj.text}>
                        <div style={{ fontSize: 13, lineHeight: 1.4 }}>{obj.text}</div>
                      </td>
                      {cols.map(c => {
                        const v = cell[`${obj.id}|${c}`]?.v || ''
                        const bg = v === 'yes' ? '#dcfce7' : v === 'no' ? '#fee2e2' : (c === todayKey ? '#f5f8ff' : '#fff')
                        const fg = v === 'yes' ? '#16a34a' : v === 'no' ? '#dc2626' : '#ccc'
                        return (
                          <td key={c} style={{ ...td, textAlign: 'center', padding: 0 }}>
                            <button onClick={() => setCell(obj.id, c, v)} style={{ width: '100%', height: 36, border: 'none', background: bg, color: fg, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
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
          )}
        </div>
      </div>
    </>
  )
}

const th = { textAlign: 'left', padding: '9px 12px', fontSize: 11.5, color: '#8a857c', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid #eee' }
const td = { padding: '8px 12px', verticalAlign: 'middle' }
const lbl = { fontSize: 11, color: '#8a857c', marginBottom: 3, fontWeight: 600 }
const inp = { padding: '6px 9px', border: '1px solid #ddd', borderRadius: 8, fontSize: 12.5 }
const ghost = { background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }
