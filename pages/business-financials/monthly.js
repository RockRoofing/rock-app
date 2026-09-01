import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, Card } from '../../components/BizNav'
import { pad, normName, mondayOf, isoDay, monthKey, daysInMonth, clampDay, overheadEvents, commitmentEvents, retentionEvents } from '../../lib/cashflowEvents'

const MONTHS = 12
const monthShort = (mk) => { const [y, m] = mk.split('-').map(Number); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${String(y).slice(2)}` }

export default function MonthlyCashFlow() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [startCash, setStartCash] = useState('')
  const [lumps, setLumps] = useState([])
  const [savingLumps, setSavingLumps] = useState(false)

  useEffect(() => { (async () => {
    try {
      const me = await fetch('/api/portal-auth?action=me').then(r => r.json()).catch(() => null)
      if (!me || !me.user) { router.replace('/'); return }
      setOk(true)
      const d = await fetch('/api/business-financials?view=cashflow').then(r => r.json())
      setData(d)
      setLumps(Array.isArray(d.cashflowLumps) ? d.cashflowLumps : [])
    } catch {}
    setLoading(false)
  })() }, [])

  // 12 calendar months starting this month.
  const months = useMemo(() => {
    const out = []
    const now = new Date()
    let y = now.getFullYear(), m = now.getMonth()
    for (let i = 0; i < MONTHS; i++) { out.push(`${y}-${pad(m + 1)}`); m++; if (m > 11) { m = 0; y++ } }
    return out
  }, [])

  const forecast = useMemo(() => {
    if (!data) return []
    const openBank = startCash !== '' ? Number(startCash) : (data.cashAtBank || 0)
    const start = new Date(months[0] + '-01T00:00:00')
    const [ly, lm] = months[months.length - 1].split('-').map(Number)
    const end = new Date(ly, lm, 0)  // last day of final month

    const ohEvents = overheadEvents(data.cashflowSchedule, data.ohBudgets, start, end, data.predictedByCodeMonth)
    const commEvents = commitmentEvents(data.cashCommitments, start, end)
    const retEvents = retentionEvents(data.retentionEntries)

    // VAT per month (positive = refund in, negative = payment out).
    const vatByMonth = {}
    const allVatMonths = new Set([...Object.keys(data.vatFiled || {}), ...Object.keys(data.vatEstimateMonths || {})])
    for (const mk of allVatMonths) {
      const f = (data.vatFiled || {})[mk]
      if (f && f.box5 != null) vatByMonth[mk] = f.direction === 'payable' ? -Math.abs(f.box5) : Math.abs(f.box5)
      else { const e = (data.vatEstimateMonths || {})[mk]; if (e) vatByMonth[mk] = -(e.netVat || 0) }
    }

    // CIS to HMRC: 20% of net labour bills, paid 22nd of month after the pay month.
    const cisByPayMonth = {}
    for (const i of (data.bills || [])) {
      if (!i.cis && !i.cisAuto) continue
      const pd = i.payDate || i.dueDate || ''
      if (!pd) continue
      const mk = pd.slice(0, 7)
      cisByPayMonth[mk] = (cisByPayMonth[mk] || 0) + (i.amountDue || 0) * 0.25
    }
    const cisPayments = Object.entries(cisByPayMonth).map(([mk, amt]) => {
      const [yy, mm] = mk.split('-').map(Number)
      return { date: isoDay(new Date(yy, mm, 22)), amount: amt }
    })

    const inMonth = (dstr, mk) => (dstr || '').slice(0, 7) === mk

    const rows = []
    // Carried between months so CIS lands the month after the labour it came from.
    let fcLabGrossPrev = 0
    let running = openBank
    for (const mk of months) {
      const invoicesIn = (data.receivables || []).filter(i => inMonth(i.expectedDate || i.dueDate, mk)).reduce((a, i) => a + (i.amountDue || 0), 0)
      const retIn = retEvents.filter(r => inMonth(r.date, mk)).reduce((a, r) => a + r.amount, 0)
      const vatRaw = vatByMonth[mk] || 0
      const vatIn = vatRaw > 0 ? vatRaw : 0
      const vatOut = vatRaw < 0 ? -vatRaw : 0
      const billsOut = (data.bills || []).filter(i => inMonth(i.payDate || i.dueDate, mk)).reduce((a, i) => a + (i.amountDue || 0), 0)
      const ohOut = ohEvents.filter(x => inMonth(x.date, mk)).reduce((a, x) => a + x.amount, 0)
      const commOut = commEvents.filter(x => inMonth(x.date, mk)).reduce((a, x) => a + x.amount, 0)
      const cisOut = cisPayments.filter(c => inMonth(c.date, mk)).reduce((a, c) => a + c.amount, 0)

      // PROJECT FORECASTS - same rules as the 13-week, which this had drifted a long way
      // from. It was still on the pre-pkg618 all-or-nothing suppression: one invoice killed
      // a project's whole month of sales, one bill killed its whole month of costs. It also
      // had no CIS on labour, no valuation boundary, no carry-forward and no payment
      // performance - so the two pages could not have agreed even on the weeks they share.
      //
      // Netted, not discarded, on both sides.
      const invByProject = {}
      for (const i of (data.receivables || [])) {
        if (!i.projectNo || !inMonth(i.expectedDate || i.dueDate, mk)) continue
        const k = String(i.projectNo)
        invByProject[k] = (invByProject[k] || 0) + (i.amountDue || 0)
      }
      const billByProject = {}
      for (const b of (data.bills || [])) {
        if (!b.project || !inMonth(b.payDate || b.dueDate, mk)) continue
        const k = normName(b.project)
        billByProject[k] = (billByProject[k] || 0) + Math.abs(b.amountDue || 0)
      }
      const cisRate = Math.min(0.99, Math.max(0, Number((data.financeCfg || {}).cisRate ?? 20) / 100))
      const netOfCis = (g) => g * (1 - cisRate)
      const today = new Date().toISOString().slice(0, 10)

      let fcSalesIn = 0, fcCostOut = 0, fcLabGross = 0, fcMatOut = 0, fcLabNet = 0
      for (const fc of (data.projForecasts || [])) {
        // Applied for -> the real invoice and bills have replaced it.
        const bound = fc.valDate || fc.latestAppEnd || fc.to || ''
        if (fc.latestAppEnd && fc.to && fc.to <= fc.latestAppEnd) continue

        const rawS = (bound && bound < today) ? 0
          : (fc.salesSchedule || []).filter(x => inMonth(x.date, mk)).reduce((a, x) => a + (x.amount || 0), 0)
        const k = String(fc.projectNo || '')
        const offS = Math.min(rawS, invByProject[k] || 0)
        invByProject[k] = Math.max(0, (invByProject[k] || 0) - offS)
        fcSalesIn += Math.max(0, rawS - offS)

        const past = (x) => bound && x.date && x.date <= bound
        // Forecast labour is GROSS; what leaves the bank is net of CIS, and the 20% goes
        // to HMRC separately.
        const rawLg = (fc.labourSchedule || []).filter(x => inMonth(x.date, mk) && !past(x)).reduce((a, x) => a + (x.amount || 0), 0)
        const rawM = (fc.matItems || []).filter(x => inMonth(x.date, mk) && !past(x)).reduce((a, x) => a + (x.amount || 0), 0)
        const nk = normName(fc.projectName || '')
        const avail = billByProject[nk] || 0
        const rawL = netOfCis(rawLg)
        const offL = Math.min(rawL, avail)
        const offM = Math.min(rawM, Math.max(0, avail - offL))
        billByProject[nk] = Math.max(0, avail - offL - offM)
        fcCostOut += Math.max(0, rawL - offL) + Math.max(0, rawM - offM)
        fcLabNet += Math.max(0, rawL - offL)
        fcMatOut += Math.max(0, rawM - offM)
        fcLabGross += rawLg
      }
      // CIS on forecast labour, paid the 22nd of the following month - so it lands in the
      // month AFTER the labour, which over twelve months is a real timing difference.
      const cisOnFc = cisRate > 0 ? fcLabGrossPrev * cisRate : 0
      fcLabGrossPrev = fcLabGross

      // Manual lumps for this month.
      let lumpIn = 0, lumpOut = 0
      for (const l of lumps) {
        if (l.month !== mk) continue
        const amt = Number(l.amount || 0)
        if (l.dir === 'out') lumpOut += amt; else lumpIn += amt
      }

      const moneyIn = invoicesIn + retIn + vatIn + fcSalesIn + lumpIn
      const moneyOut = billsOut + ohOut + commOut + vatOut + cisOut + cisOnFc + fcCostOut + lumpOut
      const net = moneyIn - moneyOut
      running += net
      rows.push({
        mk, label: monthShort(mk),
        invoicesIn: Math.round(invoicesIn), retIn: Math.round(retIn), vatIn: Math.round(vatIn),
        bills: Math.round(billsOut), overheads: Math.round(ohOut), commitments: Math.round(commOut), vatOut: Math.round(vatOut), cisOut: Math.round(cisOut + cisOnFc), cisEstimated: cisOnFc > 0,
        projSalesIn: Math.round(fcSalesIn), projCostOut: Math.round(fcCostOut),
        projMatOut: Math.round(fcMatOut), projLabOut: Math.round(fcLabNet),
        lumpIn: Math.round(lumpIn), lumpOut: Math.round(lumpOut),
        moneyIn: Math.round(moneyIn), moneyOut: Math.round(moneyOut),
        net: Math.round(net), closing: Math.round(running),
      })
    }
    return rows
  }, [data, startCash, months, lumps])

  async function saveLumps(next) {
    setLumps(next); setSavingLumps(true)
    try { await fetch('/api/business-financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'cashflow', action: 'save-lumps', lumps: next }) }) } catch {}
    setSavingLumps(false)
  }
  const addLump = () => saveLumps([...lumps, { id: `l_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, dir: 'in', category: 'revenue', month: months[0], amount: '', comment: '' }])
  const updLump = (id, patch) => setLumps(l => l.map(x => x.id === id ? { ...x, ...patch } : x))
  const commitLumps = () => saveLumps(lumps.map(l => ({ ...l, amount: Number(l.amount || 0) })))
  const delLump = (id) => saveLumps(lumps.filter(x => x.id !== id))

  if (!ok) return null

  const th = { padding: '8px 10px', fontSize: 11, color: '#8a857c', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }
  const td = { padding: '8px 10px', fontSize: 12.5, textAlign: 'right', whiteSpace: 'nowrap' }
  const lowest = forecast.reduce((min, r) => r.closing < min ? r.closing : min, forecast.length ? forecast[0].closing : 0)
  const chartData = forecast.map(r => ({ mk: r.label, closing: r.closing, moneyIn: r.moneyIn, moneyOut: -r.moneyOut }))
  const inpS = { padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 12.5 }

  return (
    <>
      <Head><title>12-Month Cash Flow - Rock Roofing</title></Head>
      <BizNav />
      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '24px 20px 60px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, color: INK, fontSize: 26 }}>12-Month Cash Flow</h1>
            <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4 }}>Monthly forecast: actuals (invoices, bills, overheads, VAT, CIS, retention) + project cash-flow forecasts (gap-filled) + manual lumps for work not yet known.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, color: '#8a857c' }}>Opening cash</label>
            <input type="number" value={startCash} onChange={e => setStartCash(e.target.value)} placeholder={data ? Math.round(data.cashAtBank || 0) : ''} style={{ ...inpS, width: 130 }} />
          </div>
        </div>

        {loading ? <div style={{ color: '#888' }}>Loading...</div> : (
          <>
            <Card title="Projected cash balance" sub="Monthly closing balance across the next 12 months. Red line = zero.">
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="mk" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => gbpK(v)} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => gbp(v)} />
                    <Legend />
                    <ReferenceLine y={0} stroke="#dc2626" />
                    <Bar dataKey="moneyIn" name="Money in" fill="#bbf7d0" />
                    <Bar dataKey="moneyOut" name="Money out" fill="#fecaca" />
                    <Line type="monotone" dataKey="closing" name="Closing cash" stroke={INK} strokeWidth={2} dot={{ r: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {lowest < 0 && <div style={{ marginTop: 8, color: '#dc2626', fontSize: 13, fontWeight: 600 }}>Projected to go below zero (lowest {gbp(lowest)}).</div>}
            </Card>

            <div style={{ marginTop: 18, background: '#fff', border: '1px solid #eee', borderRadius: 12, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #eee' }}>
                    <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: '#fff' }}>Month</th>
                    <th style={th}>Invoices in</th>
                    <th style={th}>Retention in</th>
                    <th style={th}>VAT in</th>
                    <th style={th} title="Sales from the project forecasts.">Project sales</th>
                    <th style={th} title="Materials, on the supplier's payment date. If this is empty while sales is not, the forecasts have no materials scheduled.">Materials out</th>
                    <th style={th} title="What reaches the subcontractor - forecast labour less CIS. The 20% is in the CIS to HMRC column the following month.">Labour out (net of CIS)</th>
                    <th style={th}>Manual in</th>
                    <th style={th}>Bills out</th>
                    <th style={th}>Overheads</th>
                    <th style={th}>Commitments</th>
                    <th style={th}>VAT out</th>
                    <th style={th}>CIS to HMRC</th>
                    <th style={th}>Manual out</th>
                    <th style={th}>Net</th>
                    <th style={th}>Closing cash</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.map((r) => (
                    <tr key={r.mk} style={{ borderBottom: '1px solid #f4f4f4' }}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 600, position: 'sticky', left: 0, background: '#fff' }}>{r.label}</td>
                      <td style={{ ...td, color: r.invoicesIn ? '#16a34a' : '#ccc' }}>{r.invoicesIn ? gbp(r.invoicesIn) : '-'}</td>
                      <td style={{ ...td, color: r.retIn ? '#16a34a' : '#ccc' }}>{r.retIn ? gbp(r.retIn) : '-'}</td>
                      <td style={{ ...td, color: r.vatIn ? '#16a34a' : '#ccc' }}>{r.vatIn ? gbp(r.vatIn) : '-'}</td>
                      {/* THREE COLUMNS, not one net figure. Netted together, a month with
                          166,381 of sales and no cost at all looks identical to one with
                          250,000 of sales and 84,000 of cost - and the curve only ever
                          rises. Same fault the 13-week had before it was split. */}
                      <td style={{ ...td, color: r.projSalesIn ? '#0f766e' : '#ccc' }}>{r.projSalesIn ? gbp(r.projSalesIn) : '-'}</td>
                      <td style={{ ...td, color: r.projMatOut ? '#dc2626' : '#c00' }}>{r.projMatOut ? gbp(-r.projMatOut) : 'none'}</td>
                      <td style={{ ...td, color: r.projLabOut ? '#dc2626' : '#c00' }}>{r.projLabOut ? gbp(-r.projLabOut) : 'none'}</td>
                      <td style={{ ...td, color: r.lumpIn ? '#16a34a' : '#ccc' }}>{r.lumpIn ? gbp(r.lumpIn) : '-'}</td>
                      <td style={{ ...td, color: r.bills ? '#dc2626' : '#ccc' }}>{r.bills ? gbp(-r.bills) : '-'}</td>
                      <td style={{ ...td, color: r.overheads ? '#dc2626' : '#ccc' }}>{r.overheads ? gbp(-r.overheads) : '-'}</td>
                      <td style={{ ...td, color: r.commitments ? '#dc2626' : '#ccc' }}>{r.commitments ? gbp(-r.commitments) : '-'}</td>
                      <td style={{ ...td, color: r.vatOut ? '#dc2626' : '#ccc' }}>{r.vatOut ? gbp(-r.vatOut) : '-'}</td>
                      <td style={{ ...td, color: r.cisOut ? '#dc2626' : '#ccc' }}>{r.cisOut ? gbp(-r.cisOut) : '-'}</td>
                      <td style={{ ...td, color: r.lumpOut ? '#dc2626' : '#ccc' }}>{r.lumpOut ? gbp(-r.lumpOut) : '-'}</td>
                      <td style={{ ...td, fontWeight: 600, color: r.net < 0 ? '#dc2626' : '#16a34a' }}>{gbp(r.net)}</td>
                      <td style={{ ...td, fontWeight: 700, color: r.closing < 0 ? '#dc2626' : INK }}>{gbp(r.closing)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {(() => {
                    const sum = (k) => forecast.reduce((a, r) => a + (r[k] || 0), 0)
                    return (
                      <tr style={{ borderTop: '2px solid #ddd', background: '#faf9f7', fontWeight: 700 }}>
                        <td style={{ ...td, textAlign: 'left', position: 'sticky', left: 0, background: '#faf9f7' }}>12-month total</td>
                        <td style={{ ...td, color: '#16a34a' }}>{gbp(sum('invoicesIn'))}</td>
                        <td style={{ ...td, color: '#16a34a' }}>{gbp(sum('retIn'))}</td>
                        <td style={{ ...td, color: '#16a34a' }}>{gbp(sum('vatIn'))}</td>
                        <td style={{ ...td, color: '#0f766e' }}>{gbp(sum('projSalesIn'))}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{gbp(-sum('projMatOut'))}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{gbp(-sum('projLabOut'))}</td>
                        <td style={{ ...td, color: '#16a34a' }}>{gbp(sum('lumpIn'))}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{gbp(-sum('bills'))}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{gbp(-sum('overheads'))}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{gbp(-sum('commitments'))}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{gbp(-sum('vatOut'))}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{gbp(-sum('cisOut'))}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{gbp(-sum('lumpOut'))}</td>
                        <td style={{ ...td, color: sum('net') < 0 ? '#dc2626' : '#16a34a' }}>{gbp(sum('net'))}</td>
                        <td style={{ ...td }}></td>
                      </tr>
                    )
                  })()}
                </tfoot>
              </table>
            </div>

            {/* Manual lumps */}
            <div style={{ marginTop: 22, background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>Manual lumps</div>
                  <div style={{ fontSize: 12, color: '#8a857c' }}>Add revenue / labour / materials for future work not yet in the system (no project or invoice yet). {savingLumps ? 'Saving...' : ''}</div>
                </div>
                <button onClick={addLump} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ Add lump</button>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr style={{ color: '#8a857c', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>In / out</th>
                  <th style={{ padding: '6px 8px' }}>Category</th>
                  <th style={{ padding: '6px 8px' }}>Month</th>
                  <th style={{ padding: '6px 8px' }}>Amount</th>
                  <th style={{ padding: '6px 8px' }}>Comment</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {lumps.length === 0 && <tr><td colSpan={6} style={{ padding: '10px 8px', color: '#bbb' }}>No manual lumps yet.</td></tr>}
                  {lumps.map(l => (
                    <tr key={l.id} style={{ borderTop: '1px solid #f4f4f4' }}>
                      <td style={{ padding: '5px 8px' }}>
                        <select value={l.dir} onChange={e => updLump(l.id, { dir: e.target.value })} style={inpS}>
                          <option value="in">In</option>
                          <option value="out">Out</option>
                        </select>
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        <select value={l.category} onChange={e => updLump(l.id, { category: e.target.value })} style={inpS}>
                          <option value="revenue">Revenue</option>
                          <option value="labour">Labour</option>
                          <option value="materials">Materials</option>
                          <option value="other">Other</option>
                        </select>
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        <select value={l.month} onChange={e => updLump(l.id, { month: e.target.value })} style={inpS}>
                          {months.map(mk => <option key={mk} value={mk}>{monthShort(mk)}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        <input type="number" value={l.amount} onChange={e => updLump(l.id, { amount: e.target.value })} onBlur={commitLumps} placeholder="£" style={{ ...inpS, width: 120 }} />
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        <input type="text" value={l.comment} onChange={e => updLump(l.id, { comment: e.target.value })} onBlur={commitLumps} placeholder="e.g. expected project X" style={{ ...inpS, width: '100%' }} />
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                        <button onClick={() => delLump(l.id)} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 15 }} title="Remove">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  )
}
