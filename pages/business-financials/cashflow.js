import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, Card } from '../../components/BizNav'

const pad = (n) => String(n).padStart(2, '0')
const normName = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\b(ltd|limited|plc|llp|uk|co|company|the)\b/g, '').replace(/[^a-z0-9]/g, '').trim()
const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; return new Date(x.getTime() - wd * 86400000) }
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
// Module scope, beside the other helpers. This file has no date formatter and the ones
// on other pages are not in scope here - reaching for one compiles and then throws.
// Shared input style. Defined here rather than borrowed from another page - this file
// had no `inpS`, and a style name that does not exist compiles fine and then throws.
const inpS = { padding: '5px 7px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12.5, fontFamily: 'inherit' }

const fmtDMY = (iso) => { if (!iso) return '-'; const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${String(y).slice(2)}` }
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
        // TWO BASES.
        //
        // 'percent' - each split is a share of THIS MONTH'S figure, so the splits always
        // add up to the month's budget/forecast/actual. Budgets change month to month;
        // fixed amounts cannot track that and the schedule silently stops balancing.
        //
        // 'amount' (the default when basis is absent) - the typed figures are paid as
        // typed, whatever the month says. Right for a genuinely fixed direct debit,
        // wrong for anything that follows the budget. This was the ONLY behaviour, and
        // it ignored monthlyBudget entirely - so a month forecasting 4,300 still paid
        // out the 4,000 that had been typed, and switching a month to Actual changed
        // nothing at all.
        const vatMult = sc.vat ? 1.20 : 1
        const byPct = sc.basis === 'percent'
        const splits = (sc.days || []).filter(d => byPct
          ? (Number(d.pct) || d.pct === 0)
          : (Number(d.amount) || d.amount === 0))
        const base = splits.reduce((s, d) => s + (Number(byPct ? d.pct : d.amount) || 0), 0)
        for (const d of splits) {
          const raw = Number(byPct ? d.pct : d.amount) || 0
          const share = base ? raw / base : 1 / (splits.length || 1)
          // In percent mode monthlyBudget already carries the VAT gross-up from
          // amountFor(), so vatMult must NOT be applied again.
          const amount = byPct
            ? (monthlyBudget * (raw / 100)) + adj * share
            : (raw * vatMult) + adj * share
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
// RETENTION RELEASES DUE IN. Must match the Retention Tracker exactly or the two
// disagree about the same money.
//
// This read `release1Received` - a field NOTHING EVER SETS. It is left over from the
// tracker's old design, where the released state was inferred at render time and never
// stored. So every half counted as still to come, and a half you had confirmed released
// on the tracker still showed here as future cash.
//
// It also required a release DATE, silently dropping any half without one - which is
// most of the register. That is why the column was blank.
function released1(e) {
  if (e.release1Manual === true) return true
  if (e.release1Manual === false) return false
  return !!e.appRelease1
}
function released2(e) {
  if (e.release2Manual === true) return true
  if (e.release2Manual === false) return false
  return !!e.appRelease2
}
function retentionEvents(entries) {
  const out = []
  for (const e of (entries || [])) {
    if ((e.retStatus || '') === 'complete') continue     // closed job, not being chased
    const r1 = parseFloat(e.release1Value || 0) || 0
    const r2 = parseFloat(e.release2Value || 0) || 0
    // undated halves are returned WITHOUT a date so the page can report them rather than
    // pretend they do not exist.
    if (r1 && !released1(e)) out.push({ date: e.release1Date || '', amount: r1, name: e.projectName || e.ourRef || '' })
    if (r2 && !released2(e)) out.push({ date: e.release2Date || '', amount: r2, name: e.projectName || e.ourRef || '' })
  }
  return out
}

export default function CashFlow() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [startCash, setStartCash] = useState('')   // optional manual override
  // cardLimits is keyed by account name, so each card carries its own limit rather than
  // one pooled figure - a card at its limit and a card with headroom net out otherwise,
  // and you cannot see which one is full.
  const [finance, setFinance] = useState({ ifLimit: '', ifDrawn: '', ccLimit: '', overdraftLimit: '', cardLimits: {}, vatRate: 20 })
  // [{ name, kind: 'bank'|'card', balance, asAt }]
  const [manualBal, setManualBal] = useState([])
  const [balMsg, setBalMsg] = useState('')

  async function saveManualBalances(next) {
    setManualBal(next)
    setBalMsg('saving')
    try {
      const res = await fetch('/api/business-financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'cashflow', action: 'save-manual-balances', balances: next }),
      })
      const d = await res.json().catch(() => ({}))
      setBalMsg(res.ok && d.ok !== false ? 'saved' : 'NOT SAVED')
      if (res.ok && d.ok !== false) setTimeout(() => setBalMsg(''), 1800)
    } catch { setBalMsg('NOT SAVED') }
  }
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
      setManualBal(Array.isArray(d.manualBalances) ? d.manualBalances : [])
      const fc = d.financeCfg || {}
      // Whitelisted on the way in, so anything not named here is dropped on every
      // refresh even though the save writes the whole object. The overdraft limit and the
      // per-card limits have to be listed or they appear to save and vanish on reload.
      setFinance({
        ifLimit: fc.ifLimit ?? '', ifDrawn: fc.ifDrawn ?? '', ccLimit: fc.ccLimit ?? '',
        overdraftLimit: fc.overdraftLimit ?? '',
        vatRate: fc.vatRate ?? 20,
        cardLimits: (fc.cardLimits && typeof fc.cardLimits === 'object') ? fc.cardLimits : {},
      })
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

  // refreshBalances() removed with its button. Xero's Balance Sheet gives the BOOK
  // balance - only what has been reconciled - so it runs behind the real bank position
  // silently. Balances are typed in the panel below with the date they were read, which
  // is both more accurate and auditable. The API handler is left in place in case the
  // cross-check is wanted back later.

  async function saveFinance() {
    setSavingFin(true)
    try {
      // The SAVE whitelists too, so the overdraft and per-card limits have to be listed
      // here as well as on the load - otherwise they are accepted on screen and never
      // reach Redis. ifLimit/ifDrawn are kept only as a fallback for anything saved
      // before the figures started coming from the Invoice Finance page.
      const cfg = {
        ifLimit: Number(finance.ifLimit) || 0,
        ifDrawn: Number(finance.ifDrawn) || 0,
        ccLimit: Number(finance.ccLimit) || 0,
        overdraftLimit: Number(finance.overdraftLimit) || 0,
        vatRate: Number(finance.vatRate ?? 20),
        cardLimits: Object.fromEntries(Object.entries(finance.cardLimits || {}).map(([k, v]) => [k, Number(v) || 0])),
      }
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
  // COMPONENT SCOPE, not inside the memo. The banner below reads retEvents to report
  // releases with no date, and a const declared inside a useMemo is invisible to the JSX -
  // it compiles cleanly and throws ReferenceError on render.
  const retEvents = useMemo(() => retentionEvents(data?.retentionEntries), [data])

  const forecast = useMemo(() => {
    if (!data) return []
    const openBank = startCash !== '' ? Number(startCash) : (data.cashAtBank || 0)
    const start = mondayOf(new Date())
    const end = new Date(start.getTime() + (WEEKS * 7 - 1) * 86400000)

    const ohEvents = overheadEvents(data.cashflowSchedule, data.ohBudgets, start, end, data.predictedByCodeMonth)
    const commEvents = commitmentEvents(data.cashCommitments, start, end)

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

    // FORWARD VAT RECLAIM.
    //
    // vatByMonth only ever held FILED returns and the current estimate - nothing for
    // months still to come. So the forecast showed one reclaim and then nothing, when in
    // practice a reclaim arrives every period.
    //
    // As a subcontractor most sales fall under the domestic reverse charge and carry no
    // output VAT, while materials and overheads carry input VAT - which is why the
    // position is a persistent RECLAIM rather than a payment. Estimated here as the VAT
    // on forecast materials and overhead spend in each month with nothing filed.
    //
    // Clearly an estimate: it is only used where no filed return and no existing estimate
    // exists, so a real figure always wins.
    const vatRate = Number(finance.vatRate ?? 20) / 100
    if (vatRate > 0) {
      const spendByMonth = {}
      for (const b of (data.bills || [])) {
        const d = billOverrides[b.id] || b.payDate || b.dueDate || ''
        if (!d) continue
        const mk = d.slice(0, 7)
        spendByMonth[mk] = (spendByMonth[mk] || 0) + Math.abs(b.amountDue || 0)
      }
      for (const fc of (data.projForecasts || [])) {
        for (const m of (fc.matItems || [])) {
          if (!m.date) continue
          const mk = String(m.date).slice(0, 7)
          spendByMonth[mk] = (spendByMonth[mk] || 0) + Math.abs(m.amount || 0)
        }
      }
      for (const [mk, spend] of Object.entries(spendByMonth)) {
        if (vatByMonth[mk] != null) continue          // a filed or estimated figure wins
        // spend is VAT-inclusive, so the VAT within it is spend x r/(1+r).
        vatByMonth[mk] = (spend * vatRate) / (1 + vatRate)
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

      // OVERDUE DEBT LANDS IN WEEK 1, it does not vanish.
      //
      // This used inWk() alone, which requires the date to fall INSIDE the 13 weeks. Any
      // invoice already past its due date sits BEFORE week 1 and was dropped entirely -
      // so 555k of debt showed as 100,885 of cash coming in, and the money you are most
      // likely to collect was the money the forecast ignored.
      //
      // Overdue does not mean never paid; it means late. It belongs in the first week,
      // which is also the honest place for it - if it does not arrive you see the hole.
      const invoicesIn = (data.receivables || []).reduce((a, i) => {
        const d = i.expectedDate || i.dueDate || ''
        if (!d) return a                                  // undated, cannot be scheduled
        const due = (w === 0 && d < s) ? true : inWk(d)    // before the horizon -> week 1
        return due ? a + (i.amountDue || 0) : a
      }, 0)
      const overdueIn = w === 0
        ? (data.receivables || []).filter(i => { const d = i.expectedDate || i.dueDate || ''; return d && d < s }).reduce((a, i) => a + (i.amountDue || 0), 0)
        : 0
      // Overdue releases land in week 1, same rule as invoices.
      const retIn = retEvents.reduce((a, r) => {
        if (!r.date) return a
        const hit = (w === 0 && r.date < s) ? true : inWk(r.date)
        return hit ? a + r.amount : a
      }, 0)
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
        // SUPERSEDED - the period has already been applied for, so the money is now a
        // real invoice sitting in `receivables`. Counting the forecast as well is the
        // double-count you were worried about.
        //
        // The old guard only suppressed a forecast when an invoice landed in the SAME
        // WEEK. An application invoiced in week 2 whose forecast scheduled cash in week 6
        // was counted twice - which is most of why money in reads high.
        if (fc.to && fc.latestAppEnd && fc.to <= fc.latestAppEnd) continue

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
  // finance is in the deps because the VAT reclaim estimate reads finance.vatRate -
  // without it the forecast would keep a stale rate until something else changed.
  }, [data, startCash, billOverrides, cisFlags, finance, manualBal])

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
              // MANUAL BALANCES ARE THE SOURCE OF TRUTH.
              //
              // Xero's Balance Sheet gives the BOOK balance - only what has been entered
              // and reconciled. The bank's real position is the STATEMENT balance, which
              // the API does not expose. A figure read off online banking, dated, beats an
              // automated one that is quietly a week behind reconciliation - and the
              // automated one is wrong SILENTLY, which is worse.
              //
              // Xero is kept as a cross-check: where both exist, the gap is shown, and
              // that gap is itself useful - it is how far behind reconciliation is.
              const xbal = data.balances
              // FROM LOCAL STATE, not data.manualBalances. The editor writes to manualBal
              // and saves, but `data` is not refetched - so reading the server copy here
              // meant the totals ignored everything just typed until a full page reload.
              // Opening cash sat at 0 with a balance visibly on screen above it.
              const manual = manualBal
              const useManual = manual.length > 0
              // BALANCES ARE TAKEN LITERALLY, cards included: NEGATIVE means owed.
              //
              // That is Xero's convention - a card is a liability and its Balance Sheet
              // figure is negative - and the cross-check below compares the two directly.
              // An earlier version took cards as a positive "amount owed" and flipped the
              // sign internally, which made the cross-check nonsense: 77,156.42 typed
              // against Xero's -77,156.42 showed a gap of 154,312 on an account that
              // actually agreed.
              //
              // Flipping silently was also the wrong instinct. A card entered positive is
              // now taken at face value and FLAGGED, rather than quietly reinterpreted.
              const bal = useManual
                ? { ok: true,
                    accounts: manual.map(m => ({
                      name: m.name,
                      balance: Number(m.balance) || 0,
                      isCard: m.kind === 'card', asAt: m.asAt,
                    })),
                    bankTotal: manual.filter(m => m.kind !== 'card').reduce((t, m) => t + (Number(m.balance) || 0), 0),
                    cardTotal: manual.filter(m => m.kind === 'card').reduce((t, m) => t + (Number(m.balance) || 0), 0),
                    // Latest date across the accounts, so the "as at" line has something to
                    // show instead of "no balance date".
                    updatedAt: manual.map(m => m.asAt).filter(Boolean).sort().pop() || null,
                    manual: true }
                : xbal
              const bankAccts = (bal?.accounts || []).filter(a => !a.isCard)
              const cardAccts = (bal?.accounts || []).filter(a => a.isCard)
              const bankTotal = bal?.ok ? (bal.bankTotal || 0) : (data.cashAtBank || 0)
              const cardTotal = bal?.ok ? (bal.cardTotal || 0) : 0   // negative = owed
              const cardDebt = Math.abs(Math.min(0, cardTotal))
              // CARD HEADROOM, per card where a limit is set for it.
              //
              // Falls back to the single pooled ccLimit so nothing already entered is
              // lost. Per card is the better measure: one card at its limit and another
              // with room net out under a pooled figure, and the full one is invisible.
              const cardLimits = finance.cardLimits || {}
              const anyPerCard = cardAccts.some(a => (Number(cardLimits[a.name]) || 0) > 0)
              const ccHeadroom = anyPerCard
                ? cardAccts.reduce((t, a) => {
                    const lim = Number(cardLimits[a.name]) || 0
                    const owed = Math.abs(Math.min(0, a.balance || 0))
                    return t + Math.max(0, lim - owed)
                  }, 0)
                : Math.max(0, (Number(finance.ccLimit) || 0) - cardDebt)

              // OVERDRAFT. Anything already drawn shows as a NEGATIVE bank balance and is
              // therefore already inside bankTotal - so the headroom is the limit less
              // what has been used, not the whole limit on top. Adding the full limit
              // would count the drawn part twice.
              const odLimit = Number(finance.overdraftLimit) || 0
              const odDrawn = Math.max(0, -bankTotal)
              const odHeadroom = Math.max(0, odLimit - odDrawn)
              // Invoice-finance headroom: prefer the calculated availability from the
              // Invoice Finance page; fall back to the manual limit-minus-drawn entry.
              const ifCalc = data.ifAvailability
              const ifHeadroom = ifCalc ? Math.max(0, ifCalc.availability) : Math.max(0, (Number(finance.ifLimit) || 0) - (Number(finance.ifDrawn) || 0))
              const maxCash = bankTotal + ifHeadroom + ccHeadroom + odHeadroom
              return (
                <>
                  {/* Balance boxes: each account, then combined + max available */}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14, alignItems: 'stretch' }}>
                    {/* Every balance carries the date it was read, so a stale figure is
                        obvious rather than being taken as today's cash. */}
                    {bankAccts.map((a, i) => <BalBox key={'b' + i} label={a.name} value={gbp(a.balance)} color={a.balance < 0 ? '#dc2626' : INK}
                      sub={bal?.updatedAt ? `as at ${fmtDMY(String(bal.updatedAt).slice(0, 10))}` : undefined} />)}
                    {cardAccts.map((a, i) => <BalBox key={'c' + i} label={a.name} value={gbp(a.balance)} sub={bal?.updatedAt ? `credit card - as at ${fmtDMY(String(bal.updatedAt).slice(0, 10))}` : 'credit card'} color={a.balance < 0 ? '#dc2626' : '#16a34a'} />)}
                    <BalBox label="Opening cash (all bank combined)" value={gbp(bankTotal)} color={bankTotal < 0 ? '#dc2626' : INK} strong
                      sub={bal?.updatedAt ? `as at ${fmtDMY(String(bal.updatedAt).slice(0, 10))}` : 'no balance date - press Refresh balances'} />
                    {cardDebt > 0 && <BalBox label="Credit card debt" value={gbp(-cardDebt)} sub="owed" color="#dc2626" />}
                    {ifCalc && <BalBox label="Invoice finance available" value={gbp(Math.max(0, ifCalc.availability))} sub={`${gbp(ifCalc.totalAdvance)} advance - ${gbp(ifCalc.drawn)} drawn`} color="#0f766e" />}
                    {odLimit > 0 && <BalBox label="Overdraft available" value={gbp(odHeadroom)} sub={odDrawn > 0 ? `${gbp(odDrawn)} of ${gbp(odLimit)} used` : `${gbp(odLimit)} limit`} color={odHeadroom > 0 ? INK : '#dc2626'} />}
                    <BalBox label="Max cash available" value={gbp(maxCash)} sub="bank + invoice finance + cards + overdraft - all borrowable, not owned" color="#0f766e" strong />
                    <NetPositionBox bankCash={bankTotal} cardDebt={cardDebt} odDrawn={odDrawn} ifDrawn={ifCalc ? (ifCalc.drawn || 0) : 0} />
                  </div>
                  {bal && !bal.ok && <div style={{ fontSize: 12, color: '#b45309', marginBottom: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>Could not read balances from Xero (Balance Sheet): {bal.error || 'unknown'}. Opening cash is falling back to the bank-summary figure. If this is a permissions error, the Xero connection may need reconnecting with report access.</div>}
                  {bal?.updatedAt && <div style={{ fontSize: 11, color: '#9a958c', marginBottom: 12 }}>Balances from Xero as at {new Date(bal.updatedAt).toLocaleString('en-GB')}.</div>}

                  {/* WHAT COULD NOT BE SCHEDULED. Money with no date cannot go in a week,
                      so it is absent from the forecast entirely - and absent silently is
                      how 555k of debt showed as 100,885 of cash in. */}
                  {(() => {
                    const undatedRet = retEvents.filter(r => !r.date)
                    const undatedInv = (data.receivables || []).filter(i => !(i.expectedDate || i.dueDate))
                    const rSum = undatedRet.reduce((a, r) => a + r.amount, 0)
                    const iSum = undatedInv.reduce((a, i) => a + (i.amountDue || 0), 0)
                    if (rSum < 1 && iSum < 1) return null
                    return (
                      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '9px 14px', marginBottom: 14, fontSize: 12, color: '#92400e' }}>
                        <strong>Not in the forecast - no date to schedule it against.</strong>{' '}
                        {rSum >= 1 && <>{gbp(rSum)} of retention across {undatedRet.length} release{undatedRet.length === 1 ? '' : 's'} - set the release dates on the Retention Tracker. </>}
                        {iSum >= 1 && <>{gbp(iSum)} of invoices across {undatedInv.length} - no due date in Xero.</>}
                      </div>
                    )
                  })()}

                  {/* MANUAL BALANCES - the primary source. Each carries its own as-at
                      date, because a balance without one cannot be judged. */}
                  <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', marginBottom: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Balances</div>
                      <span style={{ fontSize: 11, color: '#8a857c' }}>
                        Type what is actually in the account. Cards are NEGATIVE when money is owed, same as Xero. Xero gives its BOOK balance - only what has been reconciled - so it runs behind, silently.
                      </span>
                      {balMsg && <span style={{ fontSize: 11, fontWeight: 700, color: balMsg === 'saved' ? '#16a34a' : balMsg === 'saving' ? '#b45309' : '#dc2626' }}>{balMsg}</span>}
                    </div>
                    {manualBal.map((m, i) => {
                      const upd = (patch) => saveManualBalances(manualBal.map((x, j) => j === i ? { ...x, ...patch } : x))
                      // Cross-check against Xero where the same name exists.
                      const x = (xbal?.accounts || []).find(a => a.name === m.name)
                      const gap = x ? (Number(m.balance) || 0) - (x.balance || 0) : null
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
                          <select value={m.kind} onChange={e => upd({ kind: e.target.value })} style={{ ...inpS, width: 74 }}>
                            <option value="bank">Bank</option>
                            <option value="card">Card</option>
                          </select>
                          <input value={m.name} placeholder="Account name" onChange={e => upd({ name: e.target.value })} style={{ ...inpS, width: 210 }} />
                          <span style={{ color: '#bbb' }}>&pound;</span>
                          <input type="number" value={m.balance} placeholder="0.00" onChange={e => upd({ balance: e.target.value })}
                            title={m.kind === 'card' ? 'NEGATIVE = owed on the card, matching Xero. A positive figure means the card is in credit.' : 'Cash in the account. Negative if overdrawn.'}
                            style={{ ...inpS, width: 120, textAlign: 'right', color: (Number(m.balance) || 0) < 0 ? '#dc2626' : undefined }} />
                          {/* Flagged, not silently flipped. A card typed positive is far
                              more likely to be the amount owed entered without the minus
                              than a genuine credit balance - but guessing which is how the
                              cross-check ended up comparing a positive against Xero's
                              negative. */}
                          {m.kind === 'card' && (Number(m.balance) || 0) > 0 && (
                            <span title="Cards are held negative, like Xero. Did you mean to type this as a minus?"
                              style={{ fontSize: 10.5, fontWeight: 700, color: '#b45309', cursor: 'help' }}>in credit?</span>
                          )}
                          <span style={{ fontSize: 10.5, color: '#999', width: 52 }}>{m.kind === 'card' ? '- = owed' : 'in acc'}</span>
                          <span style={{ fontSize: 11, color: '#999' }}>as at</span>
                          <input type="date" value={m.asAt || ''} onChange={e => upd({ asAt: e.target.value })} style={{ ...inpS, width: 140 }} />
                          {gap != null && Math.abs(gap) > 0.5 && (
                            <span title={`Xero's book balance for this account is ${gbp(x.balance)}. The difference is unreconciled items - not necessarily an error.`}
                              style={{ fontSize: 10.5, color: '#b45309', cursor: 'help' }}>Xero {gbp(x.balance)} ({gap > 0 ? '+' : ''}{gbp(gap)})</span>
                          )}
                          <button onClick={() => saveManualBalances(manualBal.filter((_, j) => j !== i))}
                            style={{ border: 'none', background: 'none', color: '#c66', cursor: 'pointer', fontSize: 16 }}>&times;</button>
                        </div>
                      )
                    })}
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button onClick={() => saveManualBalances([...manualBal, { name: '', kind: 'bank', balance: '', asAt: new Date().toISOString().slice(0, 10) }])}
                        style={{ background: '#f2f2f0', border: '1px solid #e2e2de', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}>+ Add account</button>
                      {(xbal?.accounts || []).length > 0 && manualBal.length === 0 && (
                        <button onClick={() => saveManualBalances((xbal.accounts || []).map(a => ({ name: a.name, kind: a.isCard ? 'card' : 'bank', balance: a.balance, asAt: new Date().toISOString().slice(0, 10) })))}
                          style={{ background: '#f2f2f0', border: '1px solid #e2e2de', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}>Start from Xero&apos;s accounts</button>
                      )}
                    </div>
                    {manualBal.length === 0 && <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 6 }}>No manual balances set - the figures above are Xero&apos;s book balances and may be behind reconciliation.</div>}
                  </div>

                  {/* Facility settings */}
                  <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', marginBottom: 18, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: INK, alignSelf: 'center' }}>Facilities (for &quot;max cash available&quot;)</div>
                    {/* NOT typed here any more. Both come from the Invoice Finance page,
                        which holds the eligibility caps, credit limits, High Involvement
                        and the dated drawn balance. Two editable copies of the same
                        facility on two pages is how they end up disagreeing. */}
                    <div style={{ minWidth: 250, background: '#f7f9fc', border: '1px dashed #cfd8e3', borderRadius: 8, padding: '6px 10px' }}>
                      <div style={{ fontSize: 11, color: '#5b7085', fontWeight: 700 }}>Invoice finance - from the Invoice Finance page</div>
                      {ifCalc ? (
                        <div style={{ fontSize: 11.5, color: '#5b7085', lineHeight: 1.5 }}>
                          Funded {gbp(ifCalc.totalAdvance)} &middot; drawn {gbp(ifCalc.drawn)}{ifCalc.drawnAsAt ? ` as at ${fmtDMY(ifCalc.drawnAsAt)}` : ''}<br />
                          Available {gbp(Math.max(0, ifCalc.availability))}{ifCalc.asAt ? ` - updated ${fmtDMY(String(ifCalc.asAt).slice(0, 10))}` : ''}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11.5, color: '#b45309' }}>No figures yet - open the Invoice Finance page once and they will come through.</div>
                      )}
                    </div>
                    <FinInput label="Overdraft limit" value={finance.overdraftLimit} onChange={v => setFinance(f => ({ ...f, overdraftLimit: v }))} />
                    <div><div style={{ fontSize: 11, color: '#888', marginBottom: 3 }} title="Used to estimate the VAT reclaim on future materials and overhead spend, for months with no filed return. Set to 0 to turn the estimate off.">VAT rate % (reclaim estimate)</div>
                      <input type="number" value={finance.vatRate} onChange={e => setFinance(f => ({ ...f, vatRate: e.target.value }))} style={{ ...inpS, width: 70 }} /></div>
                    {/* One limit per card, from the accounts Xero returns. The pooled box
                        below stays for anything without its own limit. */}
                    {cardAccts.map(a => (
                      <FinInput key={a.name} label={`${a.name} limit`}
                        value={(finance.cardLimits || {})[a.name] ?? ''}
                        onChange={v => setFinance(f => ({ ...f, cardLimits: { ...(f.cardLimits || {}), [a.name]: v } }))} />
                    ))}
                    <FinInput label={anyPerCard ? 'Card limit (pooled - unused)' : 'Credit card limit (total)'} value={finance.ccLimit} onChange={v => setFinance(f => ({ ...f, ccLimit: v }))} />
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
                      <div style={{ fontSize: 11, color: '#999', marginTop: 3, lineHeight: 1.5 }}>
                        {/* What the opening figure is MADE OF, with the date each part was
                            read. Facilities are listed but NOT added in - opening balance
                            is cash. Fold headroom into it and the 13-week line can never
                            go negative, which is the one thing it exists to show. */}
                        Defaults to combined bank cash {gbp(bankTotal)}{bal?.updatedAt ? ` as at ${fmtDMY(String(bal.updatedAt).slice(0, 10))}` : ''}. Override to model a different starting point.
                        <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px dashed #eee', color: '#8a857c' }}>
                          <div>Bank cash{'\u00a0'}<strong>{gbp(bankTotal)}</strong></div>
                          {cardDebt > 0 && <div>Card debt{'\u00a0'}<strong style={{ color: '#dc2626' }}>{gbp(-cardDebt)}</strong> - already owed, not cash</div>}
                          <div style={{ marginTop: 3, color: '#aaa' }}>Available on top, not counted as opening cash:</div>
                          <div>Invoice finance{'\u00a0'}<strong>{gbp(ifHeadroom)}</strong>{ifCalc?.drawnAsAt ? ` (drawn as at ${fmtDMY(ifCalc.drawnAsAt)})` : ''}</div>
                          <div>Card headroom{'\u00a0'}<strong>{gbp(ccHeadroom)}</strong></div>
                          {odLimit > 0 && <div>Overdraft{'\u00a0'}<strong>{gbp(odHeadroom)}</strong></div>}
                          <div style={{ marginTop: 3 }}>Max cash available{'\u00a0'}<strong>{gbp(maxCash)}</strong></div>
                        </div>
                      </div>
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

// NET CASH POSITION.
//
// One box, not two. Two headline numbers measuring the same thing at different scopes
// invites "which is the real one" and neither gets trusted - so both figures live here
// with the arithmetic between them visible.
//
// The invoice finance line is kept SEPARATE because it is different in kind: card debt
// and overdraft are money owed with nothing behind them, whereas IF is advanced against
// invoices customers will pay and self-liquidates as the ledger collects. Netting it in
// silently would overstate the problem; leaving it out entirely would flatter it.
//
// Module scope - a component declared inside another remounts on every render.
function NetPositionBox({ bankCash, cardDebt, odDrawn, ifDrawn }) {
  const netCash = bankCash - cardDebt - odDrawn
  const netAll = netCash - ifDrawn
  const Row = ({ k, v, strong, top }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline',
      borderTop: top ? '1px solid #e6e3dc' : 'none', marginTop: top ? 3 : 0, paddingTop: top ? 3 : 0 }}>
      <span style={{ fontSize: 10.5, color: strong ? INK : '#8a857c', fontWeight: strong ? 700 : 400 }}>{k}</span>
      <span style={{ fontSize: strong ? 12.5 : 11, fontWeight: strong ? 800 : 600, whiteSpace: 'nowrap',
        color: strong ? (v < 0 ? '#dc2626' : '#16a34a') : (v < 0 ? '#b45309' : INK) }}>{gbp(v)}</span>
    </div>
  )
  return (
    <div style={{ background: '#fff', border: '1.5px solid #b45309', borderRadius: 10, padding: '8px 12px', minWidth: 250 }}>
      <div style={{ fontSize: 11.5, color: '#888' }}>Net cash position</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: netCash < 0 ? '#dc2626' : '#16a34a', marginTop: 1 }}>{gbp(netCash)}</div>
      <div style={{ marginTop: 4 }}>
        <Row k="Bank cash" v={bankCash} />
        <Row k="less card debt" v={-cardDebt} />
        {odDrawn > 0 && <Row k="less overdraft drawn" v={-odDrawn} />}
        <Row k="= Net cash" v={netCash} strong top />
        <Row k="less invoice finance drawn" v={-ifDrawn} />
        <Row k="= Net of all facilities" v={netAll} strong top />
      </div>
      {/* The single most useful line on the box. "Max cash available" sits alongside and
          reads like strength - but drawing headroom raises cash and debt by the same
          amount, so this figure does not move at all. */}
      <div style={{ fontSize: 9.5, color: '#b45309', marginTop: 5, lineHeight: 1.35 }}>
        Drawing headroom does not change this - cash and debt rise together.
      </div>
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
