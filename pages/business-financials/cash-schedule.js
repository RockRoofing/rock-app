import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, GOLD, gbp, monthLbl, Card } from '../../components/BizNav'

const pad = (n) => String(n).padStart(2, '0')
const nowMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
// Next 6 months as options for carry-forward targets.
function futureMonths(n = 12) {
  const out = []
  const d = new Date()
  for (let i = 0; i < n; i++) { out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); d.setMonth(d.getMonth() + 1) }
  return out
}

export default function CashSchedule() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState(null)
  const [schedule, setSchedule] = useState({})   // { code: {mode, day, days:[{day,amount}], carry:[{from,to,amount}]} }
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  async function load() {
    setLoading(true)
    try {
      const d = await fetch('/api/business-financials?view=budgets-overheads').then(r => r.json())
      setData(d)
      setSchedule(d.cashflowSchedule || {})
    } catch (e) { console.error(e) }
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  async function save() {
    setSaving(true)
    try {
      await fetch('/api/business-financials?view=budgets-overheads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cashflowSchedule: schedule }),
      })
      setDirty(false)
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  const accounts = data?.overheadAccounts || []
  const budgets = data?.budgets || {}
  const hidden = new Set(data?.hiddenRows || [])
  const visible = accounts.filter(a => !hidden.has(a.code))

  function setCode(code, patch) {
    setSchedule(s => ({ ...s, [code]: { ...(s[code] || defaultSched()), ...patch } }))
    setDirty(true)
  }
  function defaultSched() { return { mode: '', day: 28, days: [], carry: [] } }

  if (!ok) return null

  return (
    <>
      <Head><title>Cash Schedule - Rock Roofing</title></Head>
      <BizNav />
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 24px 90px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
          <div>
            <h1 style={{ margin: 0, color: INK, fontSize: 26 }}>Cash Schedule</h1>
            <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4 }}>Set when each overhead&apos;s monthly budget lands, so the 13-week cash flow times it correctly. Nothing is scheduled by default - configure each line you want in the forecast.</div>
          </div>
          <a href="/business-financials/budgets" style={{ fontSize: 13, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>Set the monthly amounts in Budgets &rarr;</a>
        </div>

        {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : (
          <>
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#075985', marginBottom: 16 }}>
              How timing works: <strong>Spread evenly</strong> divides the month&apos;s budget across its weeks. <strong>One day</strong> lands the whole amount on a chosen day (e.g. PAYE on the 22nd). <strong>Specific days</strong> splits it across dates you set (must add up to the monthly budget). <strong>Carry forward</strong> moves an amount out of one month into a future month without editing the budgets.
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'visible' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                    <th style={{ ...th, textAlign: 'left' }}>Overhead</th>
                    <th style={th}>Monthly budget</th>
                    <th style={{ ...th, textAlign: 'left' }}>Timing</th>
                    <th style={{ ...th, textAlign: 'left', minWidth: 260 }}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#bbb', padding: 24 }}>No overhead accounts. Sync Xero and check Account Categorisation.</td></tr>}
                  {visible.map(a => {
                    const sc = schedule[a.code] || defaultSched()
                    const budget = Number(budgets[a.code] || 0)
                    return (
                      <tr key={a.code} style={{ borderBottom: '1px solid #f2f0ec', verticalAlign: 'top' }}>
                        <td style={{ ...td, textAlign: 'left' }}>
                          <div style={{ fontWeight: 600, color: INK }}>{a.name || a.code}</div>
                          <div style={{ fontSize: 11, color: '#aaa' }}>Code {a.code}</div>
                        </td>
                        <td style={{ ...td }}>{budget ? gbp(budget) : <span style={{ color: '#c9a227' }}>not set</span>}</td>
                        <td style={{ ...td, textAlign: 'left' }}>
                          <select value={sc.mode || ''} onChange={e => setCode(a.code, { mode: e.target.value })} style={inp}>
                            <option value="">- not in forecast -</option>
                            <option value="even">Spread evenly</option>
                            <option value="oneday">One day</option>
                            <option value="multiday">Specific days</option>
                          </select>
                        </td>
                        <td style={{ ...td, textAlign: 'left' }}>
                          {sc.mode === 'oneday' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ color: '#888', fontSize: 12 }}>Day of month</span>
                              <input type="number" min={1} max={31} value={sc.day ?? 28} onChange={e => setCode(a.code, { day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} style={{ ...inp, width: 64 }} />
                            </div>
                          )}
                          {sc.mode === 'multiday' && (
                            <DayAllocator sc={sc} budget={budget} onChange={(days) => setCode(a.code, { days })} />
                          )}
                          {sc.mode === 'even' && <span style={{ color: '#888', fontSize: 12 }}>{budget ? `${gbp(budget)} spread across the month` : 'Set a monthly budget first'}</span>}
                          {!sc.mode && <span style={{ color: '#ccc', fontSize: 12 }}>Not included</span>}

                          {sc.mode && (
                            <CarryForward sc={sc} onChange={(carry) => setCode(a.code, { carry })} />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Sticky save bar */}
      {dirty && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e6e3dc', padding: '12px 24px', display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center', zIndex: 30 }}>
          <span style={{ fontSize: 12, color: '#b45309' }}>Unsaved changes</span>
          <button onClick={save} disabled={saving} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving...' : 'Save schedule'}</button>
        </div>
      )}
    </>
  )
}

function DayAllocator({ sc, budget, onChange }) {
  const days = sc.days || []
  const total = days.reduce((s, d) => s + (Number(d.amount) || 0), 0)
  const remaining = Math.round((budget - total) * 100) / 100
  const update = (i, patch) => { const next = days.map((d, j) => j === i ? { ...d, ...patch } : d); onChange(next) }
  const add = () => onChange([...days, { day: 28, amount: remaining > 0 ? remaining : 0 }])
  const remove = (i) => onChange(days.filter((_, j) => j !== i))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {days.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#888', fontSize: 12 }}>Day</span>
          <input type="number" min={1} max={31} value={d.day} onChange={e => update(i, { day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} style={{ ...inp, width: 56 }} />
          <span style={{ color: '#999' }}>&pound;</span>
          <input type="number" value={d.amount} onChange={e => update(i, { amount: e.target.value })} style={{ ...inp, width: 90 }} />
          <button onClick={() => remove(i)} style={rmBtn}>&times;</button>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={add} style={addBtn}>+ Add day</button>
        <span style={{ fontSize: 11, color: Math.abs(remaining) < 0.01 ? '#16a34a' : '#b45309' }}>
          {Math.abs(remaining) < 0.01 ? 'Balances to budget' : `${gbp(remaining)} unallocated`}
        </span>
      </div>
    </div>
  )
}

function CarryForward({ sc, onChange }) {
  const carry = sc.carry || []
  const opts = futureMonths(12)
  const update = (i, patch) => onChange(carry.map((c, j) => j === i ? { ...c, ...patch } : c))
  const add = () => onChange([...carry, { from: opts[0], to: opts[1], amount: '' }])
  const remove = (i) => onChange(carry.filter((_, j) => j !== i))
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #eee' }}>
      {carry.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, flexWrap: 'wrap' }}>
          <span style={{ color: '#999' }}>&pound;</span>
          <input type="number" value={c.amount} onChange={e => update(i, { amount: e.target.value })} placeholder="amount" style={{ ...inp, width: 84 }} />
          <span style={{ color: '#888', fontSize: 12 }}>from</span>
          <select value={c.from} onChange={e => update(i, { from: e.target.value })} style={inp}>{opts.map(m => <option key={m} value={m}>{monthLbl(m)}</option>)}</select>
          <span style={{ color: '#888', fontSize: 12 }}>to</span>
          <select value={c.to} onChange={e => update(i, { to: e.target.value })} style={inp}>{opts.map(m => <option key={m} value={m}>{monthLbl(m)}</option>)}</select>
          <button onClick={() => remove(i)} style={rmBtn}>&times;</button>
        </div>
      ))}
      <button onClick={add} style={addBtn}>+ Carry an amount to a later month</button>
    </div>
  )
}

const th = { padding: '10px 14px', textAlign: 'right', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: '#9a958c', whiteSpace: 'nowrap' }
const td = { padding: '11px 14px', textAlign: 'right' }
const inp = { padding: '5px 8px', border: '1px solid #ddd', borderRadius: 7, fontSize: 12.5, background: '#fff' }
const addBtn = { background: 'none', border: '1px dashed #cbb99a', color: '#8a6d1a', borderRadius: 7, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer' }
const rmBtn = { background: 'none', border: 'none', color: '#c66', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }
