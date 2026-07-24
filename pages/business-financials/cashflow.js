import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, Card } from '../../components/BizNav'

const pad = (n) => String(n).padStart(2, '0')
const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; return new Date(x.getTime() - wd * 86400000) }
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
const clampDay = (y, m, day) => Math.min(day, daysInMonth(y, m))

// Build every scheduled overhead cash event across a date window [start,end].
// Returns [{ date:'YYYY-MM-DD', amount, code }]. Applies carry-forwards.
function overheadEvents(schedule, budgets, start, end) {
  const events = []
  // Distinct months spanned by the window (plus a month either side for safety).
  const months = []
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cur <= last) { months.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1) }

  for (const [code, sc] of Object.entries(schedule || {})) {
    if (!sc || !sc.mode) continue
    const monthlyBudget = Number(budgets[code] || 0)
    if (!monthlyBudget && sc.mode !== 'multiday') continue

    // Net carry adjustments per month for this code: subtract from 'from', add to 'to'.
    const carryAdj = {}
    for (const c of (sc.carry || [])) {
      const amt = Number(c.amount || 0)
      if (!amt || !c.from || !c.to) continue
      carryAdj[c.from] = (carryAdj[c.from] || 0) - amt
      carryAdj[c.to] = (carryAdj[c.to] || 0) + amt
    }

    for (const mDate of months) {
      const y = mDate.getFullYear(), m = mDate.getMonth()
      const mk = `${y}-${pad(m + 1)}`
      const adj = carryAdj[mk] || 0

      if (sc.mode === 'oneday') {
        const amount = monthlyBudget + adj
        if (Math.abs(amount) < 0.005) continue
        const day = clampDay(y, m, Number(sc.day || 28))
        events.push({ date: `${mk}-${pad(day)}`, amount, code })
      } else if (sc.mode === 'multiday') {
        // Specific-day splits; carry adjustment is applied pro-rata across the splits.
        const splits = (sc.days || []).filter(d => Number(d.amount) || d.amount === 0)
        const base = splits.reduce((s, d) => s + (Number(d.amount) || 0), 0)
        for (const d of splits) {
          const share = base ? (Number(d.amount) || 0) / base : 1 / (splits.length || 1)
          const amount = (Number(d.amount) || 0) + adj * share
          if (Math.abs(amount) < 0.005) continue
          const day = clampDay(y, m, Number(d.day || 28))
          events.push({ date: `${mk}-${pad(day)}`, amount, code })
        }
      } else if (sc.mode === 'even') {
        // Spread across the weeks that start in this month: one event per Monday.
        const total = monthlyBudget + adj
        if (Math.abs(total) < 0.005) continue
        const mondays = []
        let d = mondayOf(new Date(y, m, 1))
        if (d.getMonth() !== m) d = new Date(d.getTime() + 7 * 86400000)
        while (d.getMonth() === m && d.getFullYear() === y) { mondays.push(new Date(d)); d = new Date(d.getTime() + 7 * 86400000) }
        const per = mondays.length ? total / mondays.length : total
        for (const md of mondays) events.push({ date: isoDay(md), amount: per, code })
      }
    }
  }
  return events.filter(e => e.date >= isoDay(start) && e.date <= isoDay(end))
}

// Retention releases (unreceived) as dated cash-in events.
function retentionEvents(entries) {
  const out = []
  for (const e of (entries || [])) {
    if ((e.retStatus || '') === 'complete') { /* still include unreceived flags below */ }
    const r1 = parseFloat(e.release1Value || 0) || 0
    const r2 = parseFloat(e.release2Value || 0) || 0
    if (r1 && !e.release1Received && e.release1Date) out.push({ date: e.release1Date, amount: r1 })
    if (r2 && !e.release2Received && e.release2Date) out.push({ date: e.release2Date, amount: r2 })
  }
  return out
}

export default function CashFlow() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [startCash, setStartCash] = useState('')   // optional manual override

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  async function load() {
    setLoading(true)
    try { setData(await fetch('/api/business-financials?view=cashflow').then(r => r.json())) } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  const WEEKS = 13
  const forecast = useMemo(() => {
    if (!data) return []
    const openBank = startCash !== '' ? Number(startCash) : (data.cashAtBank || 0)
    const start = mondayOf(new Date())
    const end = new Date(start.getTime() + (WEEKS * 7 - 1) * 86400000)

    const ohEvents = overheadEvents(data.cashflowSchedule, data.ohBudgets, start, end)
    const retEvents = retentionEvents(data.retentionEntries)

    // VAT landing at month-end: filed Box 5 if entered, else the estimate.
    // Convention: positive = refund IN, negative = payment OUT.
    const vatByMonth = {}
    const allVatMonths = new Set([...Object.keys(data.vatFiled || {}), ...Object.keys(data.vatEstimateMonths || {})])
    for (const mk of allVatMonths) {
      const f = (data.vatFiled || {})[mk]
      if (f && f.box5 != null) {
        vatByMonth[mk] = f.direction === 'payable' ? -Math.abs(f.box5) : Math.abs(f.box5)
      } else {
        const e = (data.vatEstimateMonths || {})[mk]
        // estimate netVat: negative = refund. Flip so positive = refund in.
        if (e) vatByMonth[mk] = -(e.netVat || 0)
      }
    }

    const rows = []
    let running = openBank
    for (let w = 0; w < WEEKS; w++) {
      const wkStart = new Date(start.getTime() + w * 7 * 86400000)
      const wkEnd = new Date(wkStart.getTime() + 6 * 86400000)
      const s = isoDay(wkStart), e = isoDay(wkEnd)
      const inWk = (dstr) => dstr >= s && dstr <= e

      const invoicesIn = (data.receivables || []).filter(i => inWk(i.expectedDate || i.dueDate || '')).reduce((a, i) => a + (i.amountDue || 0), 0)
      const retIn = retEvents.filter(r => inWk(r.date)).reduce((a, r) => a + r.amount, 0)
      // VAT: any month whose month-end falls in this week.
      let vatIn = 0
      for (const mk of Object.keys(vatByMonth)) {
        const [yy, mm] = mk.split('-').map(Number)
        const monthEnd = isoDay(new Date(yy, mm, 0))
        if (inWk(monthEnd)) vatIn += vatByMonth[mk]
      }
      const vatInPos = vatIn > 0 ? vatIn : 0
      const vatOut = vatIn < 0 ? -vatIn : 0

      const billsOut = (data.bills || []).filter(i => inWk(i.dueDate || '')).reduce((a, i) => a + (i.amountDue || 0), 0)
      const ohOut = ohEvents.filter(x => inWk(x.date)).reduce((a, x) => a + x.amount, 0)

      const moneyIn = invoicesIn + retIn + vatInPos
      const moneyOut = billsOut + ohOut + vatOut
      const net = moneyIn - moneyOut
      running += net
      rows.push({
        wk: `w/c ${wkStart.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`,
        weekStart: s,
        invoicesIn: Math.round(invoicesIn), retIn: Math.round(retIn), vatIn: Math.round(vatInPos),
        bills: Math.round(billsOut), overheads: Math.round(ohOut), vatOut: Math.round(vatOut),
        moneyIn: Math.round(moneyIn), moneyOut: Math.round(moneyOut),
        net: Math.round(net), closing: Math.round(running),
      })
    }
    return rows
  }, [data, startCash])

  if (!ok) return null
  const lowest = forecast.reduce((min, r) => r.closing < min ? r.closing : min, forecast.length ? forecast[0].closing : 0)
  const lowestWk = forecast.find(r => r.closing === lowest)
  const chartData = forecast.map(r => ({ wk: r.wk, closing: r.closing, moneyIn: r.moneyIn, moneyOut: -r.moneyOut }))

  return (
    <>
      <Head><title>Cash Flow (13 week) - Rock Roofing</title></Head>
      <BizNav />
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '24px 24px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, color: INK, fontSize: 26 }}>13-Week Cash Flow</h1>
            <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4 }}>Rolling weekly forecast. Money in: invoices owed, retention releases, VAT refunds. Money out: bills, scheduled overheads, VAT payments.</div>
          </div>
          <a href="/business-financials/cash-schedule" style={{ fontSize: 13, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>Edit overhead timing in Cash Schedule &rarr;</a>
        </div>

        {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : !data ? <div style={{ color: '#b91c1c', padding: 40 }}>Could not load.</div> : (
          <>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
              <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 18px', minWidth: 230 }}>
                <div style={{ fontSize: 12, color: '#888' }}>Opening cash (from Xero)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{ color: '#999' }}>&pound;</span>
                  <input type="number" value={startCash} onChange={e => setStartCash(e.target.value)} placeholder={String(Math.round(data.cashAtBank || 0))}
                    style={{ width: 150, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 18, fontWeight: 700 }} />
                </div>
                <div style={{ fontSize: 11, color: '#999', marginTop: 3 }}>Xero: {gbp(data.cashAtBank)}. Override to model a scenario.</div>
              </div>
              <Stat label="Total money in (13wk)" value={gbp(forecast.reduce((a, r) => a + r.moneyIn, 0))} color="#16a34a" />
              <Stat label="Total money out (13wk)" value={gbp(forecast.reduce((a, r) => a + r.moneyOut, 0))} color="#dc2626" />
              <Stat label="Projected closing (wk 13)" value={gbp(forecast.length ? forecast[forecast.length - 1].closing : data.cashAtBank)} color={forecast.length && forecast[forecast.length - 1].closing < 0 ? '#dc2626' : INK} />
              <Stat label="Lowest point" value={gbp(lowest)} sub={lowestWk?.wk} color={lowest < 0 ? '#dc2626' : '#b45309'} />
            </div>

            <Card title="Projected cash balance" sub="Weekly closing balance across the next 13 weeks. Red line = zero.">
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="wk" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={64} />
                  <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={54} />
                  <Tooltip formatter={(v) => gbp(v)} />
                  <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="closing" name="Closing cash" stroke={GOLD} strokeWidth={2.5} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>

            <div style={{ marginTop: 16 }}>
              <Card title="Weekly money in vs out" sub="Green above the line is cash in; red below is cash out.">
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="wk" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={64} />
                    <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={54} />
                    <Tooltip formatter={(v) => gbp(Math.abs(v))} />
                    <ReferenceLine y={0} stroke="#999" />
                    <Bar dataKey="moneyIn" name="In" fill="#16a34a" />
                    <Bar dataKey="moneyOut" name="Out" fill="#dc2626" />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>
            </div>

            <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 900 }}>
                <thead>
                  <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                    <th style={{ ...th, textAlign: 'left' }}>Week</th>
                    <th style={th}>Invoices in</th>
                    <th style={th}>Retention in</th>
                    <th style={th}>VAT in</th>
                    <th style={th}>Bills out</th>
                    <th style={th}>Overheads out</th>
                    <th style={th}>VAT out</th>
                    <th style={th}>Net</th>
                    <th style={th}>Closing cash</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f2f0ec' }}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{r.wk}</td>
                      <td style={{ ...td, color: r.invoicesIn ? '#16a34a' : '#ccc' }}>{r.invoicesIn ? gbp(r.invoicesIn) : '-'}</td>
                      <td style={{ ...td, color: r.retIn ? '#16a34a' : '#ccc' }}>{r.retIn ? gbp(r.retIn) : '-'}</td>
                      <td style={{ ...td, color: r.vatIn ? '#16a34a' : '#ccc' }}>{r.vatIn ? gbp(r.vatIn) : '-'}</td>
                      <td style={{ ...td, color: r.bills ? '#dc2626' : '#ccc' }}>{r.bills ? gbp(-r.bills) : '-'}</td>
                      <td style={{ ...td, color: r.overheads ? '#dc2626' : '#ccc' }}>{r.overheads ? gbp(-r.overheads) : '-'}</td>
                      <td style={{ ...td, color: r.vatOut ? '#dc2626' : '#ccc' }}>{r.vatOut ? gbp(-r.vatOut) : '-'}</td>
                      <td style={{ ...td, fontWeight: 600, color: r.net < 0 ? '#dc2626' : '#16a34a' }}>{gbp(r.net)}</td>
                      <td style={{ ...td, fontWeight: 800, color: r.closing < 0 ? '#dc2626' : INK, background: r.closing < 0 ? '#fef2f2' : 'transparent' }}>{gbp(r.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
              Opening cash and bills/invoices come from your Xero syncs (Bills to Pay, Invoices Owed, and the bank summary). Overheads are timed by the Cash Schedule using your Budgets figures. Retention lands on each release date from the Retention Tracker. VAT lands at month-end using the filed Box 5 (or estimate) from the VAT Refund page. Keep those pages synced for accuracy. Sales pipeline is not yet included.
            </div>
          </>
        )}
      </div>
    </>
  )
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 18px', minWidth: 180 }}>
      <div style={{ fontSize: 12, color: '#888' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || INK, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9a958c', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
const th = { padding: '10px 12px', fontSize: 11, color: '#9a958c', fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap' }
