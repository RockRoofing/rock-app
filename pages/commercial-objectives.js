import { useState, useEffect, useMemo } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import CommercialNav from '../components/CommercialNav'

const WEEKLY = [
  { id: 'w1', text: 'Have the project financials been updated? (Sync Bills, Sync Wages, Upload Bills)' },
  { id: 'w2', text: 'Have the project cash flows been updated for the next 13 weeks?' },
  { id: 'w3', text: 'Have the Project Details been fully completed?' },
  { id: 'w4', text: 'Has the Variation tracker been fully updated? (new variations added, correctly marked instructed / not instructed, correct amounts)' },
  { id: 'w5', text: 'Have the project financials been checked for accuracy? (budgets & spends accurate? correct cost allocations? missing costs? any projects strangely under/over performing?)' },
]
const MONTHLY = [
  { id: 'm1', text: 'Has the retention tracker been updated and is it accurate? (correct numbers? correct stages?)' },
  { id: 'm2', text: 'Have we raised invoices for any retentions that have become due?' },
  { id: 'm3', text: 'Does the applied-for amount match the invoiced amount in the retention tracker?' },
  { id: 'm4', text: 'Does the Retention Owed match 612 Allocated in the retention tracker?' },
  { id: 'm5', text: 'Have the project cash flows been updated for at least the next 12 months?' },
  { id: 'm6', text: 'Has the WIP been completed?' },
]

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: '2-digit' }) }

// 12 months back -> 12 months forward (25 columns), oldest first.
function buildMonths() {
  const out = []
  const base = new Date(); base.setDate(1)
  for (let i = -12; i <= 12; i++) { const d = new Date(base.getFullYear(), base.getMonth() + i, 1); out.push(monthKey(d)) }
  return out
}

export default function CommercialObjectives() {
  const allMonths = useMemo(buildMonths, [])
  const [data, setData] = useState({ weekly: {}, monthly: {} })
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => { (async () => {
    try { const d = await fetch('/api/commercial-objectives').then(r => r.json()); if (d.data) setData(d.data) } catch {}
    setLoading(false)
  })() }, [])

  const months = allMonths.filter(m => (!from || m >= from) && (!to || m <= to))

  async function setCell(cadence, objId, month, current) {
    // Cycle: blank -> yes -> no -> blank
    const next = current === 'yes' ? 'no' : current === 'no' ? '' : 'yes'
    // optimistic
    setData(d => {
      const copy = { ...d, [cadence]: { ...(d[cadence] || {}) } }
      const k = `${objId}|${month}`
      if (next) copy[cadence][k] = { v: next }; else delete copy[cadence][k]
      return copy
    })
    try {
      await fetch('/api/commercial-objectives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cadence, objId, month, value: next }) })
    } catch {}
  }

  return (
    <>
      <Head><title>Rock Roofing — Commercial Objectives</title></Head>
      <div style={{ minHeight: '100vh', background: '#f5f6f8' }}>
        <CommercialNav active="/commercial-objectives" />
        <div style={{ padding: 24, maxWidth: 1600, margin: '0 auto' }}>
          <h1 style={{ margin: '0 0 2px', fontSize: 24, color: '#1a1a2e' }}>Commercial Objectives</h1>
          <p style={{ color: '#8a857c', fontSize: 14, marginTop: 2 }}>Weekly and monthly tasks for the Commercial team. Click a cell to cycle Yes / No / blank.</p>

          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', margin: '16px 0 20px', flexWrap: 'wrap' }}>
            <div>
              <div style={lbl}>From month</div>
              <input type="month" value={from} onChange={e => setFrom(e.target.value)} style={inp} />
            </div>
            <div>
              <div style={lbl}>To month</div>
              <input type="month" value={to} onChange={e => setTo(e.target.value)} style={inp} />
            </div>
            {(from || to) && <button onClick={() => { setFrom(''); setTo('') }} style={ghost}>Reset dates</button>}
            <span style={{ fontSize: 12.5, color: '#aaa' }}>{months.length} month{months.length === 1 ? '' : 's'} shown</span>
          </div>

          {loading ? <div style={{ color: '#999', padding: 20 }}>Loading…</div> : (
            <>
              <ObjTable title="Weekly Commercial Tasks" cadence="weekly" objectives={WEEKLY} months={months} data={data.weekly || {}} onCell={setCell} />
              <div style={{ height: 28 }} />
              <ObjTable title="Monthly Commercial Tasks" cadence="monthly" objectives={MONTHLY} months={months} data={data.monthly || {}} onCell={setCell} />
            </>
          )}
        </div>
      </div>
    </>
  )
}

function ObjTable({ title, cadence, objectives, months, data, onCell }) {
  const nowKey = monthKey(new Date())
  return (
    <div>
      <h2 style={{ margin: '0 0 10px', fontSize: 17, color: '#1a1a2e' }}>{title}</h2>
      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%' }}>
          <thead>
            <tr style={{ background: '#faf9f7' }}>
              <th style={{ ...th, position: 'sticky', left: 0, background: '#faf9f7', minWidth: 320, zIndex: 2 }}>Objective</th>
              {months.map(m => (
                <th key={m} style={{ ...th, textAlign: 'center', minWidth: 62, background: m === nowKey ? '#eef2ff' : '#faf9f7' }}>{monthLabel(m)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {objectives.map(obj => (
              <tr key={obj.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                <td style={{ ...td, position: 'sticky', left: 0, background: '#fff', fontWeight: 500, color: '#1a1a2e', zIndex: 1, boxShadow: '1px 0 0 #eee' }}>{obj.text}</td>
                {months.map(m => {
                  const cell = data[`${obj.id}|${m}`]
                  const v = cell?.v || ''
                  const bg = v === 'yes' ? '#dcfce7' : v === 'no' ? '#fee2e2' : (m === nowKey ? '#f5f8ff' : '#fff')
                  const fg = v === 'yes' ? '#16a34a' : v === 'no' ? '#dc2626' : '#ccc'
                  return (
                    <td key={m} style={{ ...td, textAlign: 'center', padding: 0 }}>
                      <button onClick={() => onCell(cadence, obj.id, m, v)}
                        title={cell?.by ? `${v.toUpperCase()} — ${cell.by}${cell.at ? ' · ' + new Date(cell.at).toLocaleDateString('en-GB') : ''}` : 'Click to set'}
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
const lbl = { fontSize: 12, color: '#8a857c', marginBottom: 4, fontWeight: 600 }
const inp = { padding: '8px 11px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13.5 }
const ghost = { background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }
