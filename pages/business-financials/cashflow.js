import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, Card } from '../../components/BizNav'

const pad = (n) => String(n).padStart(2, '0')
const normName = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\b(ltd|limited|plc|llp|uk|co|company|the)\b/g, '').replace(/[^a-z0-9]/g, '').trim()
const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; return new Date(x.getTime() - wd * 86400000) }
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
const clampDay = (y, m, day) => Math.min(day, daysInMonth(y, m))

// Build every scheduled overhead cash event across a date window [start,end].
// Returns [{ date:'YYYY-MM-DD', amount, code }]. Applies carry-forwards.
function overheadEvents(schedule, budgets, start, end, predictedByCodeMonth) {
  const events = []
  // Distinct months spanned by the window (plus a month either side for safety).
  const months = []
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cur <= last) { months.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1) }

  // The amount to schedule for a code in a given month: prefer the per-month predicted
  // spend (from the Budgets page), fall back to the flat monthly budget. If the code is
  // VAT-flagged, gross it up by 20% for the cash-out timing (input VAT nets off later
  // at the VAT return, so this only affects WHEN the cash moves, not the net total).
  const amountFor = (code, mk, sc) => {
    const pm = predictedByCodeMonth && predictedByCodeMonth[code]
    let base = (pm && pm[mk] != null) ? (Number(pm[mk]) || 0) : Number(budgets[code] || 0)
    if (sc && sc.vat) base = base * 1.20
    return base
  }

  for (const [code, sc] of Object.entries(schedule || {})) {
    if (!sc || !sc.mode) continue

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
      const monthlyBudget = amountFor(code, mk, sc)
      if (!monthlyBudget && sc.mode !== 'multiday' && !adj) continue

      if (sc.mode === 'oneday') {
        const amount = monthlyBudget + adj
        if (Math.abs(amount) < 0.005) continue
        const day = clampDay(y, m, Number(sc.day || 28))
        events.push({ date: `${mk}-${pad(day)}`, amount, code })
      } else if (sc.mode === 'multiday') {
        // Specific-day splits; carry adjustment is applied pro-rata across the splits.
        // Gross up each split by 20% when the code is VAT-flagged (matches the +VAT tick).
        const vatMult = sc.vat ? 1.20 : 1
        const splits = (sc.days || []).filter(d => Number(d.amount) || d.amount === 0)
        const base = splits.reduce((s, d) => s + (Number(d.amount) || 0), 0)
        for (const d of splits) {
          const share = base ? (Number(d.amount) || 0) / base : 1 / (splits.length || 1)
          const amount = (Number(d.amount) || 0) * vatMult + adj * share
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

// Recurring cash commitments (e.g. vehicle finance / HP) that aren't in the P&L.
// Each: { id, name, amount, day (1-31), start?: 'YYYY-MM', end?: 'YYYY-MM' }.
function commitmentEvents(commitments, start, end) {
  const events = []
  const months = []
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cur <= last) { months.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1) }
  for (const c of (commitments || [])) {
    const amount = Number(c.amount || 0)
    if (!amount) continue
    for (const mDate of months) {
      const y = mDate.getFullYear(), m = mDate.getMonth()
      const mk = `${y}-${pad(m + 1)}`
      if (c.start && mk < c.start) continue
      if (c.end && mk > c.end) continue
      const day = clampDay(y, m, Number(c.day || 1))
      events.push({ date: `${mk}-${pad(day)}`, amount, name: c.name || 'Commitment' })
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
  const [refreshingBal, setRefreshingBal] = useState(false)
  const [finance, setFinance] = useState({ ifLimit: '', ifDrawn: '', ccLimit: '' })
  const [savingFin, setSavingFin] = useState(false)
  const [billOverrides, setBillOverrides] = useState({})  // { billId: 'YYYY-MM-DD' } local layer
  const [cisFlags, setCisFlags] = useState({})            // { billId: true } local layer
  const [openOhWk, setOpenOhWk] = useState(null)          // which week's overhead breakdown is expanded

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
      const d = await fetch('/api/business-financials?view=cashflow').then(r => r.json())
      setData(d)
      const fc = d.financeCfg || {}
      setFinance({ ifLimit: fc.ifLimit ?? '', ifDrawn: fc.ifDrawn ?? '', ccLimit: fc.ccLimit ?? '' })
      // Seed local bill payment-date overrides from what's saved.
      const seed = {}
      for (const b of (d.bills || [])) if (b.payDate) seed[b.id] = b.payDate
      setBillOverrides(seed)
      const cseed = {}
      for (const b of (d.bills || [])) if (b.cis) cseed[b.id] = true
      setCisFlags(cseed)
    } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  async function refreshBalances() {
    setRefreshingBal(true)
    try {
      await fetch('/api/business-financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'cashflow', action: 'refresh-balances' }) })
      await load()
    } catch {}
    setRefreshingBal(false)
  }

  async function saveFinance() {
    setSavingFin(true)
    try {
      const cfg = { ifLimit: Number(finance.ifLimit) || 0, ifDrawn: Number(finance.ifDrawn) || 0, ccLimit: Number(finance.ccLimit) || 0 }
      await fetch('/api/business-financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'cashflow', action: 'save-finance', financeCfg: cfg }) })
    } catch {}
    setSavingFin(false)
  }

  function setBillPayDate(billId, payDate) {
    setBillOverrides(prev => { const n = { ...prev }; if (payDate) n[billId] = payDate; else delete n[billId]; return n })
    fetch('/api/business-financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'cashflow', action: 'save-bill-paydate', billId, payDate }) }).catch(() => {})
  }

  function setBillCis(billId, cis) {
    setCisFlags(prev => { const n = { ...prev }; if (cis) n[billId] = true; else delete n[billId]; return n })
    fetch('/api/business-financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'cashflow', action: 'save-bill-cis', billId, cis }) }).catch(() => {})
  }

  const WEEKS = 13
  const forecast = useMemo(() => {
    if (!data) return []
    const openBank = startCash !== '' ? Number(startCash) : (data.cashAtBank || 0)
    const start = mondayOf(new Date())
    const end = new Date(start.getTime() + (WEEKS * 7 - 1) * 86400000)

    const ohEvents = overheadEvents(data.cashflowSchedule, data.ohBudgets, start, end, data.predictedByCodeMonth)
    const commEvents = commitmentEvents(data.cashCommitments, start, end)
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

    const cisBill = (i) => !!cisFlags[i.id]
    // In Xero the CIS deduction is ALREADY applied - a labour bill's Amount Due is the
    // NET figure paid to the subcontractor (e.g. GBP1,000 on a GBP1,250 gross bill). So the
    // bill pays its full Amount Due; the extra cash event is the 20% CIS to HMRC. From a
    // net figure, gross = net / 0.8, so CIS = gross - net = net * 0.25.
    const cisFromNet = (net) => net * 0.25

    // CIS withheld on labour bills is paid to HMRC on the 22nd of the FOLLOWING month.
    // Group by the month the bill is paid, then schedule the HMRC payment.
    const cisByPayMonth = {}
    for (const i of (data.bills || [])) {
      if (!cisBill(i)) continue
      const pd = billOverrides[i.id] || i.payDate || i.dueDate || ''
      if (!pd) continue
      const mk = pd.slice(0, 7)
      cisByPayMonth[mk] = (cisByPayMonth[mk] || 0) + cisFromNet(i.amountDue || 0)
    }
    // Map to actual HMRC payment dates: 22nd of the month after the pay month.
    const cisPayments = Object.entries(cisByPayMonth).map(([mk, amt]) => {
      const [yy, mm] = mk.split('-').map(Number)   // mm is 1-based
      const payMonth = new Date(yy, mm, 22)         // mm (0-based next month), day 22
      return { date: isoDay(payMonth), amount: amt }
    })

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

      // Bills out: pay the full Amount Due (Xero already nets CIS off labour bills).
      // The 20% CIS to HMRC is scheduled separately below.
      const billsOut = (data.bills || []).filter(i => inWk((billOverrides[i.id] || i.payDate || i.dueDate) || ''))
        .reduce((a, i) => a + (i.amountDue || 0), 0)
      const ohOut = ohEvents.filter(x => inWk(x.date)).reduce((a, x) => a + x.amount, 0)
      // Per-week overhead breakdown by code (for the click-to-expand detail).
      const ohDetailMap = {}
      for (const x of ohEvents.filter(x => inWk(x.date))) {
        ohDetailMap[x.code] = (ohDetailMap[x.code] || 0) + x.amount
      }
      const ohDetail = Object.entries(ohDetailMap)
        .map(([code, amount]) => ({ code, name: (data.overheadNames || {})[code] || code, amount: Math.round(amount) }))
        .sort((a, b) => b.amount - a.amount)
      const commOut = commEvents.filter(x => inWk(x.date)).reduce((a, x) => a + x.amount, 0)
      const cisOut = cisPayments.filter(c => inWk(c.date)).reduce((a, c) => a + c.amount, 0)

      // Project cash flow forecast for this week, with GAP-FILL overlap: a project's
      // forecast SALES are suppressed in any week it has a real invoice; its forecast
      // COSTS (labour + materials) are suppressed in any week it has a real bill. This
      // means as actuals arrive the forecast drops off, leaving only future periods.
      const projNosWithInvoiceThisWk = new Set((data.receivables || [])
        .filter(i => inWk(i.expectedDate || i.dueDate || '') && i.projectNo).map(i => String(i.projectNo)))
      const projNamesWithBillThisWk = new Set((data.bills || [])
        .filter(b => inWk((billOverrides[b.id] || b.payDate || b.dueDate) || '') && b.project).map(b => normName(b.project)))
      let fcSalesIn = 0, fcCostOut = 0
      for (const fc of (data.projForecasts || [])) {
        const hasInvoice = fc.projectNo && projNosWithInvoiceThisWk.has(String(fc.projectNo))
        const hasBill = fc.projectName && projNamesWithBillThisWk.has(normName(fc.projectName))
        if (!hasInvoice) fcSalesIn += (fc.salesSchedule || []).filter(x => inWk(x.date)).reduce((a, x) => a + (x.amount || 0), 0)
        if (!hasBill) {
          fcCostOut += (fc.labourSchedule || []).filter(x => inWk(x.date)).reduce((a, x) => a + (x.amount || 0), 0)
          fcCostOut += (fc.matItems || []).filter(x => inWk(x.date)).reduce((a, x) => a + (x.amount || 0), 0)
        }
      }
      const projNet = fcSalesIn - fcCostOut

      const moneyIn = invoicesIn + retIn + vatInPos + fcSalesIn
      const moneyOut = billsOut + ohOut + commOut + vatOut + cisOut + fcCostOut
      const net = moneyIn - moneyOut
      running += net
      rows.push({
        wk: `w/c ${wkStart.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`,
        weekStart: s,
        invoicesIn: Math.round(invoicesIn), retIn: Math.round(retIn), vatIn: Math.round(vatInPos),
        bills: Math.round(billsOut), overheads: Math.round(ohOut), ohDetail, commitments: Math.round(commOut), vatOut: Math.round(vatOut), cisOut: Math.round(cisOut),
        projSalesIn: Math.round(fcSalesIn), projCostOut: Math.round(fcCostOut), projNet: Math.round(projNet),
        moneyIn: Math.round(moneyIn), moneyOut: Math.round(moneyOut),
        net: Math.round(net), closing: Math.round(running),
      })
    }
    return rows
  }, [data, startCash, billOverrides, cisFlags])

  if (!ok) return null
  const lowest = forecast.reduce((min, r) => r.closing < min ? r.closing : min, forecast.length ? forecast[0].closing : 0)
  const lowestWk = forecast.find(r => r.closing === lowest)
  const chartData = forecast.map(r => ({ wk: r.wk, closing: r.closing, moneyIn: r.moneyIn, moneyOut: -r.moneyOut }))

  return (
    <>
      <Head><title>Cash Flow (13 week) - Rock Roofing</title></Head>
      <BizNav />
      <div style={{ maxWidth: '100%', padding: '24px 32px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, color: INK, fontSize: 26 }}>13-Week Cash Flow</h1>
            <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4 }}>Rolling weekly forecast. Money in: invoices owed, retention releases, VAT refunds. Money out: bills, scheduled overheads, VAT payments.</div>
          </div>
          <a href="/business-financials/cash-schedule" style={{ fontSize: 13, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>Edit overhead timing in Cash Schedule &rarr;</a>
        </div>

        {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : !data ? <div style={{ color: '#b91c1c', padding: 40 }}>Could not load.</div> : (
          <>
            {(() => {
              const bal = data.balances
              const bankAccts = (bal?.accounts || []).filter(a => !a.isCard)
              const cardAccts = (bal?.accounts || []).filter(a => a.isCard)
              const bankTotal = bal?.ok ? (bal.bankTotal || 0) : (data.cashAtBank || 0)
              const cardTotal = bal?.ok ? (bal.cardTotal || 0) : 0   // negative = owed
              const cardDebt = Math.abs(Math.min(0, cardTotal))
              const ccLimit = Number(finance.ccLimit) || 0
              const ccHeadroom = Math.max(0, ccLimit - cardDebt)
              // Invoice-finance headroom: prefer the calculated availability from the
              // Invoice Finance page; fall back to the manual limit-minus-drawn entry.
              const ifCalc = data.ifAvailability
              const ifHeadroom = ifCalc ? Math.max(0, ifCalc.availability) : Math.max(0, (Number(finance.ifLimit) || 0) - (Number(finance.ifDrawn) || 0))
              const maxCash = bankTotal + ifHeadroom + ccHeadroom
              return (
                <>
                  {/* Balance boxes: each account, then combined + max available */}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14, alignItems: 'stretch' }}>
                    {bankAccts.map((a, i) => <BalBox key={'b' + i} label={a.name} value={gbp(a.balance)} color={a.balance < 0 ? '#dc2626' : INK} />)}
                    {cardAccts.map((a, i) => <BalBox key={'c' + i} label={a.name} value={gbp(a.balance)} sub="credit card" color={a.balance < 0 ? '#dc2626' : '#16a34a'} />)}
                    <BalBox label="Opening cash (all bank combined)" value={gbp(bankTotal)} color={bankTotal < 0 ? '#dc2626' : INK} strong />
                    {cardDebt > 0 && <BalBox label="Credit card debt" value={gbp(-cardDebt)} sub="owed" color="#dc2626" />}
                    {ifCalc && <BalBox label="Invoice finance available" value={gbp(Math.max(0, ifCalc.availability))} sub={`${gbp(ifCalc.totalAdvance)} advance - ${gbp(ifCalc.drawn)} drawn`} color="#0f766e" />}
                    <BalBox label="Max cash available" value={gbp(maxCash)} sub="bank + invoice finance + card headroom" color="#0f766e" strong />
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <button onClick={refreshBalances} disabled={refreshingBal} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', opacity: refreshingBal ? 0.6 : 1 }}>{refreshingBal ? 'Refreshing...' : 'Refresh balances from Xero'}</button>
                    </div>
                  </div>
                  {bal && !bal.ok && <div style={{ fontSize: 12, color: '#b45309', marginBottom: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>Could not read balances from Xero (Balance Sheet): {bal.error || 'unknown'}. Opening cash is falling back to the bank-summary figure. If this is a permissions error, the Xero connection may need reconnecting with report access.</div>}
                  {bal?.updatedAt && <div style={{ fontSize: 11, color: '#9a958c', marginBottom: 12 }}>Balances from Xero as at {new Date(bal.updatedAt).toLocaleString('en-GB')}.</div>}

                  {/* Facility settings */}
                  <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', marginBottom: 18, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: INK, alignSelf: 'center' }}>Facilities (for &quot;max cash available&quot;)</div>
                    <FinInput label="Invoice finance limit" value={finance.ifLimit} onChange={v => setFinance(f => ({ ...f, ifLimit: v }))} />
                    <FinInput label="Invoice finance drawn" value={finance.ifDrawn} onChange={v => setFinance(f => ({ ...f, ifDrawn: v }))} />
                    <FinInput label="Credit card limit (total)" value={finance.ccLimit} onChange={v => setFinance(f => ({ ...f, ccLimit: v }))} />
                    <button onClick={saveFinance} disabled={savingFin} style={{ background: INK, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', opacity: savingFin ? 0.6 : 1 }}>{savingFin ? 'Saving...' : 'Save facilities'}</button>
                    <div style={{ fontSize: 11, color: '#9a958c', flexBasis: '100%' }}>Credit card limit sets your card headroom. Invoice finance availability is now calculated on the Invoice Finance page (per-debtor insured limits x advance rate, minus drawn) and feeds &quot;max cash available&quot; automatically - the invoice finance boxes below are only used as a fallback if that page hasn&apos;t been set up.</div>
                  </div>

                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
                    <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 18px', minWidth: 230 }}>
                      <div style={{ fontSize: 12, color: '#888' }}>Opening cash used in forecast</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span style={{ color: '#999' }}>&pound;</span>
                        <input type="number" value={startCash} onChange={e => setStartCash(e.target.value)} placeholder={String(Math.round(bankTotal))}
                          style={{ width: 150, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 18, fontWeight: 700 }} />
                      </div>
                      <div style={{ fontSize: 11, color: '#999', marginTop: 3 }}>Defaults to combined bank cash ({gbp(bankTotal)}). Override to model a scenario.</div>
                    </div>
                    <Stat label="Total money in (13wk)" value={gbp(forecast.reduce((a, r) => a + r.moneyIn, 0))} color="#16a34a" />
                    <Stat label="Total money out (13wk)" value={gbp(forecast.reduce((a, r) => a + r.moneyOut, 0))} color="#dc2626" />
                    <Stat label="Projected closing (wk 13)" value={gbp(forecast.length ? forecast[forecast.length - 1].closing : bankTotal)} color={forecast.length && forecast[forecast.length - 1].closing < 0 ? '#dc2626' : INK} />
                    <Stat label="Lowest point" value={gbp(lowest)} sub={lowestWk?.wk} color={lowest < 0 ? '#dc2626' : '#b45309'} />
                  </div>
                </>
              )
            })()}

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
                    <th style={th}>Vehicles / commitments</th>
                    <th style={th}>VAT out</th>
                    <th style={th}>CIS to HMRC</th>
                    <th style={th} title="Net of the Commercial project cash flow forecasts (sales in minus labour + materials out), only where no real invoice/bill exists yet for that project that week.">Project forecast</th>
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
                      <td style={{ ...td, color: r.overheads ? '#dc2626' : '#ccc', cursor: r.overheads ? 'pointer' : 'default', textDecoration: r.overheads ? 'underline dotted' : 'none' }}
                        onClick={() => r.overheads && setOpenOhWk(openOhWk === i ? null : i)}
                        title={r.overheads ? 'Click to see the breakdown' : ''}>
                        {r.overheads ? gbp(-r.overheads) : '-'}{r.overheads ? <span style={{ fontSize: 9, color: '#999' }}>{openOhWk === i ? ' \u25B2' : ' \u25BC'}</span> : null}
                      </td>
                      <td style={{ ...td, color: r.commitments ? '#dc2626' : '#ccc' }}>{r.commitments ? gbp(-r.commitments) : '-'}</td>
                      <td style={{ ...td, color: r.vatOut ? '#dc2626' : '#ccc' }}>{r.vatOut ? gbp(-r.vatOut) : '-'}</td>
                      <td style={{ ...td, color: r.cisOut ? '#dc2626' : '#ccc' }}>{r.cisOut ? gbp(-r.cisOut) : '-'}</td>
                      <td style={{ ...td, color: r.projNet ? (r.projNet < 0 ? '#dc2626' : '#0f766e') : '#ccc' }} title={r.projSalesIn || r.projCostOut ? `Forecast in ${gbp(r.projSalesIn)} / out ${gbp(r.projCostOut)}` : ''}>{r.projNet ? gbp(r.projNet) : '-'}</td>
                      <td style={{ ...td, fontWeight: 600, color: r.net < 0 ? '#dc2626' : '#16a34a' }}>{gbp(r.net)}</td>
                      <td style={{ ...td, fontWeight: 800, color: r.closing < 0 ? '#dc2626' : INK, background: r.closing < 0 ? '#fef2f2' : 'transparent' }}>{gbp(r.closing)}</td>
                    </tr>
                  ))}
                  {openOhWk != null && forecast[openOhWk] && (
                    <tr style={{ background: '#fbfaf7' }}>
                      <td colSpan={12} style={{ padding: '10px 16px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 6 }}>Overheads in {forecast[openOhWk].wk} - {gbp(-forecast[openOhWk].overheads)}</div>
                        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                          <tbody>
                            {(forecast[openOhWk].ohDetail || []).map((d, j) => (
                              <tr key={j}>
                                <td style={{ padding: '3px 16px 3px 0', color: '#999', fontVariantNumeric: 'tabular-nums' }}>{d.code}</td>
                                <td style={{ padding: '3px 24px 3px 0' }}>{d.name}</td>
                                <td style={{ padding: '3px 0', textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>{gbp(-d.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div style={{ fontSize: 10.5, color: '#aaa', marginTop: 6 }}>Amounts include VAT where the overhead is +VAT ticked on the Cash Schedule.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  {(() => {
                    const sum = (k) => forecast.reduce((a, r) => a + (r[k] || 0), 0)
                    const tIn = sum('invoicesIn'), tRet = sum('retIn'), tVatIn = sum('vatIn')
                    const tBills = sum('bills'), tOh = sum('overheads'), tComm = sum('commitments')
                    const tVatOut = sum('vatOut'), tCis = sum('cisOut'), tNet = sum('net')
                    const tProj = sum('projNet')
                    return (
                      <tr style={{ borderTop: '2px solid #ddd', background: '#faf9f7', fontWeight: 700 }}>
                        <td style={{ ...td, textAlign: 'left' }}>13-week total</td>
                        <td style={{ ...td, color: '#16a34a' }}>{tIn ? gbp(tIn) : '-'}</td>
                        <td style={{ ...td, color: '#16a34a' }}>{tRet ? gbp(tRet) : '-'}</td>
                        <td style={{ ...td, color: '#16a34a' }}>{tVatIn ? gbp(tVatIn) : '-'}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{tBills ? gbp(-tBills) : '-'}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{tOh ? gbp(-tOh) : '-'}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{tComm ? gbp(-tComm) : '-'}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{tVatOut ? gbp(-tVatOut) : '-'}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{tCis ? gbp(-tCis) : '-'}</td>
                        <td style={{ ...td, color: tProj < 0 ? '#dc2626' : '#0f766e' }}>{tProj ? gbp(tProj) : '-'}</td>
                        <td style={{ ...td, color: tNet < 0 ? '#dc2626' : '#16a34a' }}>{gbp(tNet)}</td>
                        <td style={{ ...td }}></td>
                      </tr>
                    )
                  })()}
                </tfoot>
              </table>
            </div>

            {/* Bills to pay - adjust planned payment dates; feeds the forecast above */}
            {(() => {
              const bills = (data.bills || []).filter(b => (b.amountDue || 0) > 0)
                .map(b => ({ ...b, effPay: billOverrides[b.id] || b.payDate || b.dueDate || '' }))
                .sort((a, b) => (a.effPay || '').localeCompare(b.effPay || ''))
              const totalBills = bills.reduce((s, b) => s + (b.amountDue || 0), 0)
              return (
                <div style={{ marginTop: 22 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 2 }}>Bills to pay</div>
                  <div style={{ fontSize: 12, color: '#8a857c', marginBottom: 8 }}>Adjust the planned payment date for any bill and the forecast above updates automatically. Blank payment date uses the Xero due date. CIS labour bills (account 321) auto-tick - untick any gross-status subcontractors. {bills.length} bills, {gbp(totalBills)} total.</div>
                  <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, maxHeight: 340, overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee', position: 'sticky', top: 0, zIndex: 1 }}>
                          <th style={{ ...th, textAlign: 'left' }}>Supplier</th>
                          <th style={{ ...th, textAlign: 'left' }}>Ref</th>
                          <th style={th}>Due date</th>
                          <th style={th}>Amount</th>
                          <th style={{ ...th, textAlign: 'center' }} title="Tick if this is a CIS labour bill. Bill pays its full net amount; an extra 20% CIS goes to HMRC on the 22nd of next month.">CIS</th>
                          <th style={{ ...th, textAlign: 'left' }}>Planned payment date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bills.map((b, i) => {
                          const overridden = !!(billOverrides[b.id] || b.payDate)
                          return (
                            <tr key={b.id || i} style={{ borderBottom: '1px solid #f2f0ec' }}>
                              <td style={{ ...td, textAlign: 'left', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.contact}>{b.contact || '-'}</td>
                              <td style={{ ...td, textAlign: 'left', color: '#777', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.reference || b.number}>{b.reference || b.number || '-'}</td>
                              <td style={{ ...td, color: '#666' }}>{b.dueDate ? new Date(b.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '-'}</td>
                              <td style={{ ...td, fontWeight: 600 }}>{gbp(b.amountDue)}{cisFlags[b.id] && <div style={{ fontSize: 10, color: '#ea580c', fontWeight: 400, lineHeight: 1.35, marginTop: 2 }}>{gbp(b.amountDue * 1.25)} gross =<br />{gbp(b.amountDue)} to sub + {gbp(b.amountDue * 0.25)} CIS</div>}</td>
                              <td style={{ ...td, textAlign: 'center' }}>
                                <input type="checkbox" checked={!!cisFlags[b.id]} onChange={e => setBillCis(b.id, e.target.checked)} title="CIS labour - withhold 20%" />
                              </td>
                              <td style={{ ...td, textAlign: 'left' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <input type="date" value={billOverrides[b.id] || b.payDate || ''} onChange={e => setBillPayDate(b.id, e.target.value)}
                                    style={{ fontSize: 11.5, padding: '3px 5px', border: '1px solid ' + (overridden ? '#fed7aa' : '#e5e5e5'), borderRadius: 5, color: overridden ? '#ea580c' : '#555', background: overridden ? '#fff7ed' : '#fff', fontWeight: overridden ? 600 : 400 }} />
                                  {overridden && <button onClick={() => setBillPayDate(b.id, '')} title="Clear - use due date" style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>&times;</button>}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                        {bills.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#aaa' }}>No outstanding bills. Sync Bills to Pay first.</td></tr>}
                      </tbody>
                      <tfoot>
                        {(() => {
                          const cisTotal = bills.reduce((s, b) => s + (cisFlags[b.id] ? (b.amountDue || 0) * 0.25 : 0), 0)
                          return (
                            <tr style={{ borderTop: '2px solid #ddd', background: '#faf9f7', fontWeight: 700, position: 'sticky', bottom: 0 }}>
                              <td style={{ ...td, textAlign: 'left' }}>Total ({bills.length})</td>
                              <td style={td}></td>
                              <td style={td}></td>
                              <td style={{ ...td, fontWeight: 800 }}>{gbp(totalBills)}{cisTotal ? <div style={{ fontSize: 10, color: '#ea580c', fontWeight: 400 }}>+{gbp(cisTotal)} CIS to HMRC</div> : null}</td>
                              <td style={td}></td>
                              <td style={td}></td>
                            </tr>
                          )
                        })()}
                      </tfoot>
                    </table>
                  </div>
                </div>
              )
            })()}

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

function BalBox({ label, value, sub, color, strong }) {
  return (
    <div style={{ background: strong ? '#f7faf9' : '#fff', border: strong ? '1.5px solid #0f766e' : '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', minWidth: 160 }}>
      <div style={{ fontSize: 11.5, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>{label}</div>
      <div style={{ fontSize: strong ? 22 : 19, fontWeight: 800, color: color || INK, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: '#9a958c', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function FinInput({ label, value, onChange }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: '#999', fontSize: 13 }}>&pound;</span>
        <input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder="0"
          style={{ width: 120, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }} />
      </div>
    </div>
  )
}
const th = { padding: '10px 12px', fontSize: 11, color: '#9a958c', fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap' }
