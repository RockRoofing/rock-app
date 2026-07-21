import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, fmtDate, Card } from '../../components/BizNav'

// Monday of the week containing d.
const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; return new Date(x.getTime() - wd * 86400000) }
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function CashFlow() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [weeks, setWeeks] = useState(10)
  const [startCash, setStartCash] = useState('')   // optional manual override of cash at bank

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/business-financials?view=cashflow').then(r => r.json()); setData(d) } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  const forecast = useMemo(() => {
    if (!data) return []
    const startBank = startCash !== '' ? Number(startCash) : (data.cashAtBank || 0)
    const weeklyOverhead = (data.avgOverheadMonthly || 0) * 12 / 52
    const start = mondayOf(new Date())
    const rows = []
    let running = startBank
    for (let w = 0; w < weeks; w++) {
      const wkStart = new Date(start.getTime() + w * 7 * 86400000)
      const wkEnd = new Date(wkStart.getTime() + 6 * 86400000)
      const s = isoDay(wkStart), e = isoDay(wkEnd)
      const inFlow = (data.receivables || []).filter(i => i.dueDate >= s && i.dueDate <= e).reduce((a, i) => a + (i.amountDue || 0), 0)
      const billsOut = (data.bills || []).filter(i => i.dueDate >= s && i.dueDate <= e).reduce((a, i) => a + (i.amountDue || 0), 0)
      const predicted = weeklyOverhead   // predicted overheads/costs not yet on a bill
      const net = inFlow - billsOut - predicted
      running += net
      rows.push({
        week: `w/c ${wkStart.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`,
        moneyIn: Math.round(inFlow),
        knownBills: -Math.round(billsOut),
        predicted: -Math.round(predicted),
        closing: Math.round(running),
      })
    }
    return rows
  }, [data, weeks, startCash])

  if (!ok) return null
  const history = (data?.history || []).slice(-6).map(h => ({ week: h.month, closing: Math.round(h.closing) }))
  const combined = [...history.map(h => ({ ...h, hist: h.closing })), ...forecast.map(f => ({ week: f.week, closing: f.closing, fc: f.closing }))]

  return (
    <>
      <Head><title>Cash Flow · Business Financials</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <BizNav />
        <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>Cash Flow Forecast</h1>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#888' }}>Weeks
                <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} style={{ ...sel, marginLeft: 6 }}>
                  {[8, 9, 10, 12].map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </label>
            </div>
          </div>

          {loading ? <div style={{ color: '#999', padding: 40 }}>Loading…</div> : !data ? <div style={{ color: '#b91c1c', padding: 40 }}>Could not load.</div> : (
            <>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
                <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 18px', minWidth: 220 }}>
                  <div style={{ fontSize: 12, color: '#888' }}>Cash at bank (start)</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <span style={{ color: '#999' }}>£</span>
                    <input type="number" value={startCash} onChange={e => setStartCash(e.target.value)} placeholder={String(Math.round(data.cashAtBank || 0))}
                      style={{ width: 140, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 18, fontWeight: 700 }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 3 }}>From Xero: {gbp(data.cashAtBank)}. Override to model scenarios.</div>
                </div>
                <Stat label="Known invoices in (next 8–10wk)" value={gbp(forecast.reduce((a, r) => a + r.moneyIn, 0))} color="#16a34a" />
                <Stat label="Known bills out" value={gbp(-forecast.reduce((a, r) => a + r.knownBills, 0))} color="#dc2626" />
                <Stat label="Projected closing cash" value={gbp(forecast.length ? forecast[forecast.length - 1].closing : data.cashAtBank)} color={forecast.length && forecast[forecast.length - 1].closing < 0 ? '#dc2626' : INK} />
              </div>

              <Card title="Cash at bank — where it's been and where it's heading" sub="Actual closing balance (history) then projected weekly balance">
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={combined} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                    <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={52} />
                    <Tooltip formatter={(v) => v == null ? '—' : gbp(v)} />
                    <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="hist" name="Actual" stroke="#6b7280" strokeWidth={2.5} dot={{ r: 2 }} connectNulls />
                    <Line type="monotone" dataKey="fc" name="Forecast" stroke={GOLD} strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 2 }} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>

              <div style={{ marginTop: 16 }}>
                <Card title="Weekly movement" sub="Known invoices in vs known bills + predicted overheads out">
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={forecast} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="week" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                      <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={52} />
                      <Tooltip formatter={(v) => gbp(Math.abs(v))} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <ReferenceLine y={0} stroke="#999" />
                      <Bar dataKey="moneyIn" name="Invoices in" fill="#16a34a" stackId="a" />
                      <Bar dataKey="knownBills" name="Known bills" fill="#dc2626" stackId="a" />
                      <Bar dataKey="predicted" name="Predicted overheads" fill="#f59e0b" stackId="a" />
                      <Line type="monotone" dataKey="closing" name="Closing cash" stroke={INK} strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </Card>
              </div>

              <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
                  <thead>
                    <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                      <th style={{ ...th, textAlign: 'left' }}>Week</th>
                      <th style={th}>Invoices in</th><th style={th}>Known bills</th><th style={th}>Predicted</th><th style={th}>Closing cash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f2f0ec' }}>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{r.week}</td>
                        <td style={{ ...td, color: '#16a34a' }}>{gbp(r.moneyIn)}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{gbp(-r.knownBills)}</td>
                        <td style={{ ...td, color: '#b45309' }}>{gbp(-r.predicted)}</td>
                        <td style={{ ...td, fontWeight: 700, color: r.closing < 0 ? '#dc2626' : INK }}>{gbp(r.closing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
                Predicted overheads = recent 3-month average overhead, spread weekly ({gbp((data.avgOverheadMonthly || 0) * 12 / 52)}/wk). Known bills/invoices come from the Bills to Pay and Invoices Owed syncs. Sync those pages for up-to-date figures.
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 18px', minWidth: 190 }}>
      <div style={{ fontSize: 12, color: '#888' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || INK, marginTop: 2 }}>{value}</div>
    </div>
  )
}
const th = { padding: '10px 12px', fontSize: 12, color: '#777', fontWeight: 600, textAlign: 'right' }
const td = { padding: '9px 12px', textAlign: 'right' }
const sel = { padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }
