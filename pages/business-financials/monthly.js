import { useState, useEffect, useMemo, Fragment } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, Card } from '../../components/BizNav'
import { pad, normName, mondayOf, isoDay, monthKey, daysInMonth, clampDay, overheadEvents, commitmentEvents, retentionEvents } from '../../lib/cashflowEvents'

const MONTHS = 12
const monthShort = (mk) => { const [y, m] = mk.split('-').map(Number); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${String(y).slice(2)}` }

// Module scope. These were declared INSIDE the page component, so the Drill component -
// which is correctly at module scope so it does not remount on every render - could not
// see `td`. Compiles clean, throws "td is not defined" on render.
const th = { padding: '8px 10px', fontSize: 11, color: '#8a857c', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }
const td = { padding: '8px 10px', fontSize: 12.5, textAlign: 'right', whiteSpace: 'nowrap' }

// One drillable cell. Module scope - a component declared inside another remounts on
// every render and loses focus.
function Drill({ v, open, onClick, colour, neg }) {
  if (!v) return <td style={{ ...td, color: '#ccc' }}>-</td>
  return (
    <td style={{ ...td, color: colour, cursor: 'pointer', textDecoration: 'underline dotted #ddd' }} onClick={onClick}
      title="Click to see what is in this figure">
      {gbp(neg ? -v : v)}
      <span style={{ fontSize: open ? 12 : 9, fontWeight: open ? 700 : 400, color: open ? '#1a1a19' : '#bbb', marginLeft: 3 }}>
        {open ? '\u25B2' : '\u25BC'}
      </span>
    </td>
  )
}

function DrillTable({ which, row }) {
  const cfg = {
    inv:  { title: 'Invoices due', rows: row.invDetail || [], cols: ['Customer', 'Invoice', 'Project', 'Date used', 'Amount'] },
    bill: { title: 'Bills due', rows: row.billDetail || [], cols: ['Supplier', 'Reference', 'Project', 'Date used', 'Amount'] },
    proj: { title: 'Project forecasts', rows: row.projDetail || [], cols: ['Project', 'Sales', 'Materials', 'Labour (net)'] },
  }[which]
  if (!cfg || !cfg.rows.length) return <div style={{ fontSize: 12, color: '#999' }}>Nothing to show.</div>
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{cfg.title} in {row.label}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
        <thead><tr style={{ color: '#888' }}>
          {cfg.cols.map((c, i) => <th key={i} style={{ textAlign: i === 0 ? 'left' : (which === 'proj' ? 'right' : 'left'), padding: '3px 6px' }}>{c}</th>)}
        </tr></thead>
        <tbody>
          {cfg.rows.map((x, i) => (
            <tr key={i} style={{ borderTop: '1px solid #efefec' }}>
              {which === 'proj' ? <>
                <td style={{ padding: '3px 6px' }}>{x.name}</td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: '#0f766e' }}>{x.sales ? gbp(x.sales) : '-'}</td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: x.mat ? '#dc2626' : '#ccc' }}>{x.mat ? gbp(-x.mat) : 'none'}</td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: x.labour ? '#dc2626' : '#ccc' }}>{x.labour ? gbp(-x.labour) : 'none'}</td>
              </> : <>
                <td style={{ padding: '3px 6px' }}>{x.name}</td>
                <td style={{ padding: '3px 6px', color: '#777' }}>{x.ref || '-'}</td>
                <td style={{ padding: '3px 6px', color: '#777' }}>{x.project || '-'}</td>
                {/* Whether the date was set by hand or defaulted from Xero - the same
                    distinction the 13-week makes, and the one that decides how much a
                    month is worth trusting. */}
                <td style={{ padding: '3px 6px', color: x.set ? '#0f766e' : '#999' }}>{x.date || '-'}{x.set ? ' (set)' : ' (Xero)'}</td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: which === 'bill' ? '#dc2626' : '#0f766e' }}>
                  {gbp(which === 'bill' ? -x.amount : x.amount)}
                </td>
              </>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Module scope. Everything it draws comes off the chart datum, so it cannot reach into
// page state by accident - which is the failure this file has hit repeatedly.
function MonthTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const p = payload[0] && payload[0].payload
  if (!p) return null
  const bals = p.cardBalances || {}
  const names = Object.keys(bals).sort()
  const owed = names.reduce((t, n) => t + (bals[n] || 0), 0)
  const line = (k, v, colour, bold) => (
    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 18, fontSize: 12, marginTop: 2 }}>
      <span style={{ color: '#6b6b68' }}>{k}</span>
      <span style={{ color: colour || INK, fontWeight: bold ? 700 : 500 }}>{v}</span>
    </div>
  )
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 8, padding: '9px 12px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)', minWidth: 250 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 4 }}>{label}</div>
      {line('Closing cash', gbp(p.closing || 0), (p.closing || 0) < 0 ? '#dc2626' : INK, true)}
      {line('Money in', gbp(p.moneyIn || 0), '#0f766e')}
      {line('Money out', gbp(p.moneyOut || 0), '#dc2626')}
      {names.length ? (
        <div style={{ borderTop: '1px solid #f0eee9', marginTop: 6, paddingTop: 5 }}>
          <div style={{ fontSize: 10.5, color: '#9a958c', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>Card balances owed</div>
          {names.map(n => line(n, gbp(-(bals[n] || 0)), (bals[n] || 0) > 0 ? '#dc2626' : '#16a34a'))}
          {names.length > 1 ? line('Total owed', gbp(-owed), '#dc2626', true) : null}
          {p.cardOut ? line('paid this month', gbp(-(p.cardOut || 0)), '#b45309') : null}
        </div>
      ) : null}
    </div>
  )
}

export default function MonthlyCashFlow() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [startCash, setStartCash] = useState('')
  const [lumps, setLumps] = useState([])
  const [savingLumps, setSavingLumps] = useState(false)
  const [open, setOpen] = useState(null)   // 'YYYY-MM:inv' | ':bill' | ':proj'
  const [cardPays, setCardPays] = useState([])
  const [savingCards, setSavingCards] = useState(false)

  useEffect(() => { (async () => {
    try {
      const me = await fetch('/api/portal-auth?action=me').then(r => r.json()).catch(() => null)
      if (!me || !me.user) { router.replace('/'); return }
      setOk(true)
      const d = await fetch('/api/business-financials?view=cashflow').then(r => r.json())
      setData(d)
      setLumps(Array.isArray(d.cashflowLumps) ? d.cashflowLumps : [])
      setCardPays(Array.isArray(d.cardPayments) ? d.cardPayments : [])
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

  // CARD BALANCES AND THEIR CLEARANCE SCHEDULE.
  //
  // Cards are deliberately OUT of opening cash (kind !== 'card'), so the bank line has
  // never carried them - they were a liability nothing ever paid, flat forever.
  //
  // Only the OPENING balance is scheduled. Ongoing card spend is already in overheads and
  // in the bills, so treating a payment as a general outflow would take the same cost out
  // of the bank twice. What is modelled here is clearing what is already owed.
  //
  // Manual balances win over Xero's, the same precedence the rest of the page uses.
  const cardModel = useMemo(() => {
    if (!data) return { cards: [], byMonth: {}, payByMonth: {} }
    const manual = (data.manualBalances || []).filter(b => b && b.kind === 'card' && String(b.name || '').trim())
    const src = manual.length
      ? manual.map(b => ({ name: String(b.name).trim(), opening: Math.abs(Number(b.balance) || 0) }))
      : (data?.balances?.accounts || []).filter(a2 => a2.isCard)
          .map(a2 => ({ name: String(a2.name || 'Card').trim(), opening: Math.abs(Number(a2.balance) || 0) }))

    const left = {}
    for (const c of src) left[c.name] = c.opening
    const byMonth = {}     // month -> { cardName: balance owed at month end }
    const payByMonth = {}  // month -> total paid that month
    for (const mk of months) {
      let paid = 0
      for (const p of cardPays) {
        // A row scheduled on the 13-week carries an exact date; the month is derived from
        // it. Reading `month` alone would miss anything entered over there.
        const pm = p.month || String(p.date || '').slice(0, 7)
        if (pm !== mk) continue
        const name = String(p.card || '')
        if (left[name] == null) continue
        // Capped at what is left - you cannot repay more than you owe, and letting the
        // balance go through zero would create cash out of nothing.
        const amt = Math.min(Math.abs(Number(p.amount) || 0), left[name])
        if (amt <= 0) continue
        left[name] -= amt
        paid += amt
      }
      payByMonth[mk] = paid
      byMonth[mk] = { ...left }
    }
    return { cards: src, byMonth, payByMonth }
  }, [data, months, cardPays])

  const forecast = useMemo(() => {
    if (!data) return []
    // OPENING FROM THE MANUAL BALANCES, the same source the 13-week uses.
    //
    // This took data.cashAtBank - the Xero bank summary's closing balance, which is a BOOK
    // balance and can be months stale. The 13-week has used the manual balances you type as
    // its primary source since pkg609 precisely because the book balance is not what is in
    // the account.
    //
    // On a running balance the opening figure never washes out: every one of the twelve
    // months is wrong by the same amount, and the closing position inherits all of it. That
    // is a large part of why this page and the Forecast Balance Sheet disagree on the same
    // month by 430,945.
    const manualBank = (data.manualBalances || [])
      .filter(b => b && b.kind !== 'card')
      .reduce((t, b) => t + (Number(b.balance) || 0), 0)
    const hasManual = (data.manualBalances || []).some(b => b && b.kind !== 'card')
    const openBank = startCash !== '' ? Number(startCash) : (hasManual ? manualBank : (data.cashAtBank || 0))
    const start = new Date(months[0] + '-01T00:00:00')
    const [ly, lm] = months[months.length - 1].split('-').map(Number)
    const end = new Date(ly, lm, 0)  // last day of final month

    const ohCodeSet = new Set(Object.keys(data.overheadNames || {}).map(String))

    const ohEvents = overheadEvents(data.cashflowSchedule, data.ohBudgets, start, end, data.predictedByCodeMonth)
    // BALANCE SHEET ITEMS too - PAYE/CIS arrears, loan and HP capital, corporation tax.
    // The 13-week has carried these since pkg627; this page only ever had the vehicle
    // commitments, so the Financing column read empty while real money was leaving.
    //
    // Same rule: payments stop once the liability is cleared, not at the end month.
    const bsEvents = []
    {
      const monthsList = []
      const cur = new Date(start.getFullYear(), start.getMonth(), 1)
      const last = new Date(end.getFullYear(), end.getMonth(), 1)
      while (cur <= last) { monthsList.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1) }
      for (const it of (data.bsItems || [])) {
        if (it.inForecast === false) continue
        const monthly = Number(it.monthly) || 0
        if (!monthly) continue
        let left = Number(it.liability) || 0
        const capped = left > 0
        for (const d of monthsList) {
          const y = d.getFullYear(), m = d.getMonth()
          const mk2 = `${y}-${pad(m + 1)}`
          if (it.start && mk2 < it.start) continue
          if (it.end && mk2 > it.end) continue
          if (capped && left <= 0) break
          const amt = capped ? Math.min(monthly, left) : monthly
          if (amt <= 0) break
          if (capped) left -= amt
          bsEvents.push({ date: `${mk2}-${pad(clampDay(y, m, Number(it.day || 28)))}`, amount: amt, name: it.name || 'Financing' })
        }
      }
    }
    const commEvents = [...commitmentEvents(data.cashCommitments, start, end), ...bsEvents]
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

    const todayKey = new Date().toISOString().slice(0, 10)
    // Debtor days rounded up to whole months - the same assumption the balance sheet uses,
    // so the two pages stop disagreeing about the same invoices.
    const spreadMonths = Math.max(1, Math.ceil((Number(data.bsAssumptions?.debtorDays) || 45) / 30))

    const rows = []
    // Carried between months so CIS lands the month after the labour it came from.
    let fcLabGrossPrev = 0
    let running = openBank
    for (const mk of months) {
      // Xero's due date is used as-is where you have not changed it - which is what the
      // Invoices Owed page shows and what you expect. I briefly spread undated overdue
      // invoices here on a diagnosis that was wrong: only 3,175 of the ledger is undated
      // AND overdue, not the 355,547 I claimed. Reverted.
      const invDetail = (data.receivables || [])
        .filter(i => (!i.type || i.type === 'ACCREC') && inMonth(i.expectedDate || i.dueDate, mk))
        .map(i => ({ name: i.contact || '(no customer)', ref: i.invoiceNumber || i.number || '', project: i.projectName || '',
          amount: i.amountDue || 0, date: i.expectedDate || i.dueDate || '', set: !!i.expectedDate }))
        .sort((a, b) => b.amount - a.amount)
      const invoicesIn = invDetail.reduce((a, i) => a + i.amount, 0)
      const retIn = retEvents.filter(r => inMonth(r.date, mk)).reduce((a, r) => a + r.amount, 0)
      // FORWARD VAT RECLAIM, as the 13-week does. vatByMonth only ever held filed returns
      // and the current estimate, so every future month showed nothing - on a twelve-month
      // view that is most of the page. Most sales are reverse charge and carry no output
      // VAT while materials and overheads carry input VAT, so the position is a persistent
      // refund and showing nil understates cash in every month past the last return.
      const vatRate = Number((data.financeCfg || {}).vatRate ?? 20) / 100
      // VAT SETTLES A MONTH AFTER THE PERIOD IT RELATES TO.
      //
      // This put month mk's VAT in month mk - no lag, so the whole VAT line sat a month
      // early, the same fault the 13-week had. What moves in September is AUGUST's VAT,
      // so the row reads the previous month on both the filed figure and the estimate.
      const vatMk = (() => {
        const [yy, mm] = mk.split('-').map(Number)
        const d = new Date(yy, mm - 2, 1)   // mm-1 is this month zero-based; one before it
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      })()
      let vatEst = 0
      if (vatByMonth[vatMk] == null && vatRate > 0) {
        const spend = (data.bills || []).filter(b => inMonth(b.payDate || b.dueDate, vatMk)).reduce((a, b) => a + Math.abs(b.amountDue || 0), 0)
          + (data.projForecasts || []).reduce((a, fc) => a + (fc.matItems || []).filter(x => inMonth(x.date, vatMk)).reduce((t, x) => t + Math.abs(x.amount || 0), 0), 0)
        vatEst = (spend * vatRate) / (1 + vatRate)
      }
      const vatRaw = vatByMonth[vatMk] != null ? vatByMonth[vatMk] : vatEst
      const vatIn = vatRaw > 0 ? vatRaw : 0
      const vatOut = vatRaw < 0 ? -vatRaw : 0
      const billDetail = (data.bills || [])
        .filter(i => inMonth(i.payDate || i.dueDate, mk))
        .map(i => ({ name: i.contact || i.supplier || '(no supplier)', ref: i.reference || i.invoiceNumber || '',
          project: i.project || '', amount: Math.abs(i.amountDue || 0), date: i.payDate || i.dueDate || '', set: !!i.payDate }))
        .sort((a, b) => b.amount - a.amount)
      const billsOut = billDetail.reduce((a, i) => a + i.amount, 0)
      // Same as the 13-week: an overhead bill is already in Bills out, so netting stops the
      // same cost leaving the bank twice.
      const ohBillByCode = {}
      for (const b of (data.bills || [])) {
        if (!inMonth(b.payDate || b.dueDate, mk)) continue
        const codes = (b.lineCodes || []).filter(c => ohCodeSet.has(String(c)))
        if (!codes.length) continue
        const per = Math.abs(b.amountDue || 0) / codes.length
        for (const c of codes) ohBillByCode[String(c)] = (ohBillByCode[String(c)] || 0) + per
      }
      const ohOut = ohEvents.filter(x => inMonth(x.date, mk)).reduce((a, x) => {
        const avail = ohBillByCode[String(x.code)] || 0
        const off = Math.min(x.amount, avail)
        if (off > 0) ohBillByCode[String(x.code)] = avail - off
        return a + Math.max(0, x.amount - off)
      }, 0)
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
      const projDetail = []
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

        // COST BEHIND THE VALUATION DATE IS NETTED, NOT DROPPED.
        //
        // `!past(x)` excluded any cost dated on or before the valuation date outright, on
        // the assumption a supplier had already billed it. That is only true to the extent
        // bills EXIST - and they do not:
        //
        //     cost in the forecasts              920,154
        //     cost reaching the 12-month         358,092
        //     difference                         562,062
        //     bills available to net against     298,912
        //     -> 263,150 dropped, not netted
        //
        // The netting below already handles anything a supplier has invoiced. Dropping it
        // first as well removed the cost twice, and it is why the closing balance climbs
        // and never comes back down when the materials are paid.
        const rawLg = (fc.labourSchedule || []).filter(x => inMonth(x.date, mk)).reduce((a, x) => a + (x.amount || 0), 0)
        const rawM = (fc.matItems || []).filter(x => inMonth(x.date, mk)).reduce((a, x) => a + (x.amount || 0), 0)
        const nk = normName(fc.projectName || '')
        const avail = billByProject[nk] || 0
        const rawL = netOfCis(rawLg)
        const offL = Math.min(rawL, avail)
        const offM = Math.min(rawM, Math.max(0, avail - offL))
        billByProject[nk] = Math.max(0, avail - offL - offM)
        fcCostOut += Math.max(0, rawL - offL) + Math.max(0, rawM - offM)
        fcLabNet += Math.max(0, rawL - offL)
        fcMatOut += Math.max(0, rawM - offM)
        const nS = Math.max(0, rawS - offS), nL = Math.max(0, rawL - offL), nM = Math.max(0, rawM - offM)
        if (nS || nL || nM) projDetail.push({ name: fc.projectName || fc.projectKey || '(unnamed)', sales: nS, labour: nL, mat: nM })
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

      const cardOut = cardModel.payByMonth[mk] || 0
      const moneyIn = invoicesIn + retIn + vatIn + fcSalesIn + lumpIn
      const moneyOut = billsOut + ohOut + commOut + vatOut + cisOut + cisOnFc + fcCostOut + lumpOut + cardOut
      const net = moneyIn - moneyOut
      running += net
      rows.push({
        mk, label: monthShort(mk),
        invoicesIn: Math.round(invoicesIn), retIn: Math.round(retIn), vatIn: Math.round(vatIn),
        invDetail, billDetail, projDetail,
        bills: Math.round(billsOut), overheads: Math.round(ohOut), commitments: Math.round(commOut), vatOut: Math.round(vatOut), cisOut: Math.round(cisOut + cisOnFc), cisEstimated: cisOnFc > 0,
        projSalesIn: Math.round(fcSalesIn), projCostOut: Math.round(fcCostOut),
        projMatOut: Math.round(fcMatOut), projLabOut: Math.round(fcLabNet),
        lumpIn: Math.round(lumpIn), lumpOut: Math.round(lumpOut),
        cardOut: Math.round(cardOut), cardBalances: cardModel.byMonth[mk] || {},
        moneyIn: Math.round(moneyIn), moneyOut: Math.round(moneyOut),
        net: Math.round(net), closing: Math.round(running),
      })
    }
    return rows
  }, [data, startCash, months, lumps, cardModel])

  async function saveCardPays(next) {
    setCardPays(next); setSavingCards(true)
    try {
      await fetch('/api/business-financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'cashflow', action: 'save-card-payments', cardPayments: next }),
      })
    } catch {}
    setSavingCards(false)
  }

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

  const lowest = forecast.reduce((min, r) => r.closing < min ? r.closing : min, forecast.length ? forecast[0].closing : 0)
  const chartData = forecast.map(r => ({ mk: r.label, closing: r.closing, moneyIn: r.moneyIn, moneyOut: -r.moneyOut, cardBalances: r.cardBalances, cardOut: r.cardOut }))
  const inpS = { padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 12.5 }

  return (
    <>
      <Head><title>12-Month Cash Flow - Rock Roofing</title></Head>
      <BizNav />
      {/* FULL WIDTH. A sixteen-column table inside a 1300px box meant horizontal
          scrolling on every screen, including ones with room to spare. */}
      <div style={{ padding: '24px 26px 60px' }}>
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
            {data && data.receivablesUntyped ? (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderLeft: '4px solid #b91c1c', borderRadius: 10, padding: '10px 15px', marginBottom: 14, fontSize: 12.5, color: '#991b1b', maxWidth: 940 }}>
                <strong>Re-sync invoices from Xero.</strong> The stored receivables were fetched before sales invoices and
                supplier bills were tagged apart, so nothing here can be verified as a customer invoice. They are being
                counted anyway, because dropping them would empty this forecast - but a supplier bill could be among them.
                One sync fixes it permanently.
              </div>
            ) : null}
            <Card title="Projected cash balance" sub="Monthly closing balance across the next 12 months. Red line = zero.">
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="mk" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => gbpK(v)} tick={{ fontSize: 11 }} />
                    <Tooltip content={<MonthTip />} />
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
{(() => {
                // A NET project figure of a million pounds implies four to five million of
                // turnover at a normal margin. Saying so is more use than leaving it to be
                // inferred from a curve that only ever rises.
                // `forecast`, not `rows` - rows is the local inside the memo and is not in
                // scope out here. It compiles and throws on render.
                // BILLS ARE PROJECT COSTS TOO.
                //
                // The banner compared sales against forecast cost ALONE and called it 26%.
                // But most of the forecast cost has been NETTED against bills already in
                // Xero - Sept shows 263,658 of bills with materials and labour both reading
                // "none". Counting the forecast side only and ignoring the bills that
                // replaced it was never going to give a sensible percentage.
                const sales = forecast.reduce((a, r) => a + (r.projSalesIn || 0), 0)
                const fcCost = forecast.reduce((a, r) => a + (r.projMatOut || 0) + (r.projLabOut || 0), 0)
                const billCost = forecast.reduce((a, r) => a + (r.bills || 0), 0)
                const cost = fcCost + billCost
                if (!(sales > 0)) return null
                const pc = (cost / sales) * 100
                if (pc >= 70) return null
                return (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: '#92400e' }}>
                    <strong>Cost is {pc.toFixed(0)}% of project sales in this window</strong> - {gbp(fcCost)} still forecast plus {gbp(billCost)} already billed by suppliers.
                    <div style={{ marginTop: 4 }}>
                      Some of that gap is real and expected: a twelve-month window collects revenue for work ALREADY DONE, whose cost was paid
                      before the window opened. So the percentage here is always lower than your true margin and cannot be read as one. Worth
                      checking only where a month shows sales with &quot;none&quot; against both materials and labour AND no bills either.
                    </div>
                  </div>
                )
              })()}
{(() => {
                // THE IDENTITY CHECK.
                //
                // Over twelve months: closing cash = opening + profit - the increase in
                // working capital. If cash rises far more than profit, debtors must have
                // FALLEN by the difference. The Forecast Balance Sheet shows debtors
                // rising - so both cannot be true, and saying so is more use than leaving
                // it to be spotted three pages apart.
                const open = forecast.length ? (forecast[0].closing - forecast[0].net) : 0
                const close = forecast.length ? forecast[forecast.length - 1].closing : 0
                const rise = close - open
                const collected = forecast.reduce((a, r) => a + (r.invoicesIn || 0) + (r.retIn || 0), 0)
                if (Math.abs(rise) < 50000) return null
                return (
                  <div style={{ background: '#f4f7fb', border: '1px solid #d8e3ef', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: '#334155' }}>
                    <strong>Cash moves {gbp(rise)} over the twelve months, from {gbp(open)} to {gbp(close)}.</strong>
                    <div style={{ marginTop: 4 }}>
                      {gbp(collected)} of that is collecting invoices and retention that already existed. Cash can only rise far above your
                      profit if working capital FALLS by the difference - debtors collected and not replaced. Check that against the Forecast
                      Balance Sheet: if debtors are rising there while cash rises here, the two pages disagree and one of them is wrong.
                    </div>
                  </div>
                )
              })()}
{(() => {
                // THE FORECAST HORIZON.
                //
                // Over twelve months this collects the whole opening ledger AND every
                // forecast sale, so closing debtors come out at almost nil - which never
                // happens in a real business. The cause is not the arithmetic: the
                // forecasts simply run out. There is no pipeline in the back half, so the
                // model banks everything and bills nothing new.
                //
                // Saying so is more use than letting the closing balance look like a bug.
                const last3 = forecast.slice(-3)
                const tail = last3.reduce((a, r) => a + (r.projSalesIn || 0), 0)
                const early = forecast.slice(0, 3).reduce((a, r) => a + (r.projSalesIn || 0), 0)
                if (!(early > 0) || tail > early * 0.4) return null
                const close = forecast.length ? forecast[forecast.length - 1].closing : 0
                return (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderLeft: '4px solid #b45309', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: '#92400e' }}>
                    <strong>The forecasts run out before the window does.</strong>{' '}
                    The last three months carry {gbp(tail)} of project sales against {gbp(early)} in the first three. So the back half collects
                    the debtor book and bills almost nothing new, and the closing {gbp(close)} is flattered by a pipeline that stops rather
                    than a business that stops.
                    <div style={{ marginTop: 4 }}>
                      Add the work you expect but have not forecast yet as <strong>Manual lumps</strong> below - revenue and its cost - and the
                      back half becomes meaningful. Until then, read the first six months and treat the rest as a floor.
                    </div>
                  </div>
                )
              })()}
{(() => {
                // OVERHEADS AGAINST BUDGETS, over the year rather than per month.
                //
                // A cash flow month can legitimately differ from a budget month - a code
                // scheduled to pay on the 5th of the following month belongs in that month
                // here and this one there. But the TWELVE-MONTH TOTALS must agree, because
                // the same money leaves the bank either way. When they do not, a code is
                // not being paid at all.
                const cfOh = forecast.reduce((a, r) => a + (r.overheads || 0), 0)
                // `data.predictedByCodeMonth` - there is no `oh` on this page. Compiles
                // clean, throws on render.
                const budOh = Object.values(data.predictedByCodeMonth || {})
                  .reduce((t, byM) => t + Object.values(byM || {}).reduce((x, v) => x + (Number(v) || 0), 0), 0)
                if (!(budOh > 0) || Math.abs(cfOh - budOh) < budOh * 0.02) return null
                return (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: '#b91c1c' }}>
                    <strong>Overheads here total {gbp(cfOh)} against {gbp(budOh)} on Budgets - {gbp(Math.abs(budOh - cfOh))} {cfOh < budOh ? 'short' : 'over'}.</strong>{' '}
                    Individual months can differ, because a cost scheduled to pay in the following month belongs there here and here there.
                    The YEAR cannot: the same money leaves the bank either way. A gap this size means a code is not being paid at all.
                  </div>
                )
              })()}
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1500, tableLayout: 'auto' }}>
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
                    <th style={th} title="Scheduled clearance of the OPENING card balances. New card spend is already in Overheads and Bills - only what is already owed is paid here.">Cards</th>
                    <th style={th}>Net</th>
                    <th style={th}>Closing cash</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.map((r) => (
                    <Fragment key={r.mk}>
                    <tr style={{ borderBottom: '1px solid #f4f4f4' }}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 600, position: 'sticky', left: 0, background: '#fff' }}>{r.label}</td>
                      <Drill v={r.invoicesIn} open={open === r.mk + ':inv'} onClick={() => setOpen(open === r.mk + ':inv' ? null : r.mk + ':inv')} colour="#16a34a" />
                      <td style={{ ...td, color: r.retIn ? '#16a34a' : '#ccc' }}>{r.retIn ? gbp(r.retIn) : '-'}</td>
                      <td style={{ ...td, color: r.vatIn ? '#16a34a' : '#ccc' }}>{r.vatIn ? gbp(r.vatIn) : '-'}</td>
                      {/* THREE COLUMNS, not one net figure. Netted together, a month with
                          166,381 of sales and no cost at all looks identical to one with
                          250,000 of sales and 84,000 of cost - and the curve only ever
                          rises. Same fault the 13-week had before it was split. */}
                      <Drill v={r.projSalesIn} open={open === r.mk + ':proj'} onClick={() => setOpen(open === r.mk + ':proj' ? null : r.mk + ':proj')} colour="#0f766e" />
                      <td style={{ ...td, color: r.projMatOut ? '#dc2626' : '#c00' }}>{r.projMatOut ? gbp(-r.projMatOut) : 'none'}</td>
                      <td style={{ ...td, color: r.projLabOut ? '#dc2626' : '#c00' }}>{r.projLabOut ? gbp(-r.projLabOut) : 'none'}</td>
                      <td style={{ ...td, color: r.lumpIn ? '#16a34a' : '#ccc' }}>{r.lumpIn ? gbp(r.lumpIn) : '-'}</td>
                      <Drill v={r.bills} neg open={open === r.mk + ':bill'} onClick={() => setOpen(open === r.mk + ':bill' ? null : r.mk + ':bill')} colour="#dc2626" />
                      <td style={{ ...td, color: r.overheads ? '#dc2626' : '#ccc' }}>{r.overheads ? gbp(-r.overheads) : '-'}</td>
                      <td style={{ ...td, color: r.commitments ? '#dc2626' : '#ccc' }}>{r.commitments ? gbp(-r.commitments) : '-'}</td>
                      <td style={{ ...td, color: r.vatOut ? '#dc2626' : '#ccc' }}>{r.vatOut ? gbp(-r.vatOut) : '-'}</td>
                      <td style={{ ...td, color: r.cisOut ? '#dc2626' : '#ccc' }}>{r.cisOut ? gbp(-r.cisOut) : '-'}</td>
                      <td style={{ ...td, color: r.lumpOut ? '#dc2626' : '#ccc' }}>{r.lumpOut ? gbp(-r.lumpOut) : '-'}</td>
                      <td style={{ ...td, color: r.cardOut ? '#dc2626' : '#ccc' }}>{r.cardOut ? gbp(-r.cardOut) : '-'}</td>
                      <td style={{ ...td, fontWeight: 600, color: r.net < 0 ? '#dc2626' : '#16a34a' }}>{gbp(r.net)}</td>
                      <td style={{ ...td, fontWeight: 700, color: r.closing < 0 ? '#dc2626' : INK }}>{gbp(r.closing)}</td>
                    </tr>
                    {open && open.startsWith(r.mk + ':') && (
                      <tr>
                        <td colSpan={17} style={{ background: '#faf9f7', padding: '10px 14px' }}>
                          <DrillTable which={open.split(':')[1]} row={r} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
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
                        <td style={{ ...td, color: '#dc2626' }}>{gbp(-sum('cardOut'))}</td>
                        <td style={{ ...td, color: sum('net') < 0 ? '#dc2626' : '#16a34a' }}>{gbp(sum('net'))}</td>
                        <td style={{ ...td }}></td>
                      </tr>
                    )
                  })()}
                </tfoot>
              </table>
            </div>

            {/* CARD CLEARANCE. Only the opening balance is scheduled here - ongoing card
                spend is already in overheads and in the bills, and paying it again would
                take the same cost out of the bank twice. */}
            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px', marginTop: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>Credit card clearance</div>
                <span style={{ fontSize: 11.5, color: '#8a857c', maxWidth: 620 }}>
                  Schedule payments against what each card owes today. New spend on the card is already in
                  overheads and bills, so only the opening balance is cleared here. Cards are not in the
                  cash line until you schedule a payment.
                </span>
                {savingCards ? <span style={{ fontSize: 11.5, color: '#16a34a' }}>saving...</span> : null}
              </div>

              {cardModel.cards.length === 0 ? (
                <div style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>
                  No card accounts found. Add them as manual balances with kind &quot;card&quot; on the 13-week Facilities panel.
                </div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  {cardModel.cards.map(c => {
                    const paid = cardPays.filter(x => x.card === c.name).reduce((t, x) => t + Math.abs(Number(x.amount) || 0), 0)
                    const endBal = cardModel.byMonth[months[months.length - 1]] || {}
                    return (
                      <div key={c.name} style={{ borderTop: '1px solid #f2f0ec', padding: '9px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 13, minWidth: 170 }}>{c.name}</strong>
                          <span style={{ fontSize: 12.5, color: '#dc2626' }}>owes {gbp(c.opening)}</span>
                          <span style={{ fontSize: 12, color: '#8a857c' }}>scheduled {gbp(Math.min(paid, c.opening))}</span>
                          <span style={{ fontSize: 12, color: (endBal[c.name] || 0) > 0 ? '#b45309' : '#16a34a' }}>
                            still owing at {monthShort(months[months.length - 1])}: {gbp(endBal[c.name] || 0)}
                          </span>
                          <button onClick={() => saveCardPays([...cardPays, { card: c.name, month: months[0], amount: 0 }])}
                            style={{ background: '#fff', border: '1px solid #ddd9d2', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: '#57534e' }}>
                            + payment
                          </button>
                        </div>
                        {cardPays.map((x, i) => x.card !== c.name ? null : (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, marginLeft: 12 }}>
                            <select value={x.month}
                              onChange={e => saveCardPays(cardPays.map((y, j) => j === i ? { ...y, month: e.target.value } : y))}
                              style={{ padding: '4px 6px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12 }}>
                              {months.map(mk => <option key={mk} value={mk}>{monthShort(mk)}</option>)}
                            </select>
                            <input type="number" value={x.amount}
                              onChange={e => setCardPays(cardPays.map((y, j) => j === i ? { ...y, amount: e.target.value } : y))}
                              onBlur={() => saveCardPays(cardPays.map(y => ({ ...y, amount: Math.abs(Number(y.amount) || 0) })))}
                              style={{ padding: '4px 6px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, width: 110, textAlign: 'right' }} />
                            <button onClick={() => saveCardPays(cardPays.filter((y, j) => j !== i))}
                              style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: 12, cursor: 'pointer' }}>remove</button>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
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
