import { useState, useEffect, useMemo, Fragment } from 'react'
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

// Receivables are keyed by invoice number - the same key invoice:meta uses for expected
// dates, so an exclusion and a date always refer to the same invoice.
const todayISO = new Date().toISOString().slice(0, 10)

// DATE CELL WITH A DRAFT.
//
// The bills list is sorted by planned payment date, and the input committed on every
// change. So scrolling the picker from August to September wrote a September date
// immediately, the list re-sorted, the row jumped somewhere else and the calendar shut -
// before you had chosen a day.
//
// The draft is held locally and only committed on BLUR, so nothing moves while the picker
// is open. Escape abandons the edit, Enter commits it.
//
// Module scope: a component declared inside another remounts on every render, which would
// close the picker just as effectively.
// DROP-DOWN ARROW. Bigger and darker when open, so you can see at a glance which rows are
// expanded - at 9px grey they were nearly invisible either way, and with several open you
// could not tell which was which.
//
// One component, so all seven columns behave identically and cannot drift apart.
function Caret({ open }) {
  return (
    <span style={{
      fontSize: open ? 12 : 9,
      fontWeight: open ? 700 : 400,
      color: open ? '#1a1a19' : '#bbb',
      marginLeft: 3,
    }}>{open ? '\u25B2' : '\u25BC'}</span>
  )
}

function DateCell({ value, fallback, onCommit, onClear, title }) {
  // `value` is what has actually been SET. `fallback` is the due date the forecast uses
  // when nothing is set - shown in the box in light grey so you can see what will happen
  // without it looking like somebody chose it.
  const effective = value || fallback || ''
  const isDefault = !value && !!fallback
  const [draft, setDraft] = useState(effective)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setDraft(effective) }, [effective, editing])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="date"
        value={draft}
        title={title || (isDefault ? 'Using the due date. Pick another to override it.' : '')}
        onFocus={() => setEditing(true)}
        onChange={e => setDraft(e.target.value)}
        // Commits on BLUR, and only when it differs from what the forecast is already
        // using - so simply clicking into the box and out again does not turn a greyed
        // default into a saved override.
        onBlur={() => { setEditing(false); if ((draft || '') !== (effective || '')) onCommit(draft) }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { setDraft(effective); setEditing(false); e.currentTarget.blur() }
        }}
        style={{
          fontSize: 11.5, padding: '3px 5px', borderRadius: 5,
          border: '1px solid ' + (value ? '#fed7aa' : '#e5e5e5'),
          // Light grey while it is only the due date; normal once set.
          color: isDefault ? '#aaa' : '#333',
          background: isDefault ? '#fcfcfc' : '#fff',
        }}
      />
      {onClear && value && (
        <button onClick={onClear} title="Clear - go back to the due date" style={{ background: 'none', border: 'none', color: '#c66', cursor: 'pointer' }}>&times;</button>
      )}
    </div>
  )
}

// "J190 - Russell Hill" where both are known, the number alone if the dashboard cache
// has not named the job, and only then the raw key.
// "Sep 26" from "2026-09".
const monthName = (mk) => {
  const [y, m] = String(mk).split('-').map(Number)
  if (!y || !m) return mk
  return `${new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' })} ${String(y).slice(2)}`
}

const projLabel = (fc) => {
  const no = fc.projectNo ? String(fc.projectNo) : ''
  const nm = (fc.projectName || '').trim()
  // The name sometimes already starts with the number - do not print it twice.
  if (no && nm) return nm.startsWith(no) ? nm : `${no} - ${nm}`
  // A negotiated job is prefixed so it is never mistaken for a live one - it is a deal,
  // not a contract, and the money is far less certain.
  const key = String(fc.projectKey || '')
  if (key.startsWith('N:')) return nm ? `${nm} (negotiated)` : `Deal ${key.slice(2)} (negotiated)`
  return nm || no || key.replace(/^L:/, '') || '(unnamed)'
}

const invKey = (i) => String(i.invoiceNumber || i.number || i.id || '')

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
// BALANCE SHEET ITEMS scheduled into cash events, same shape as commitments so the two
// can share a column. These are payments that reduce a liability and never touch the
// P&L - loan and HP capital, HMRC arrears, corporation tax, dividends.
//
// Stops when the liability is cleared, not just at the end month: paying 5,000 a month
// against 12,000 owed should produce three payments, the last of 2,000, not carry on to
// the horizon.
function balanceSheetEvents(items, start, end) {
  const events = []
  const months = []
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cur <= last) { months.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1) }
  for (const it of (items || [])) {
    if (it.inForecast === false) continue
    const monthly = Number(it.monthly) || 0
    if (!monthly) continue
    let left = Number(it.liability) || 0
    const hasLiability = left > 0
    for (const mDate of months) {
      const y = mDate.getFullYear(), m = mDate.getMonth()
      const mk = `${y}-${pad(m + 1)}`
      if (it.start && mk < it.start) continue
      if (it.end && mk > it.end) continue
      if (hasLiability && left <= 0) break
      const amount = hasLiability ? Math.min(monthly, left) : monthly
      if (amount <= 0) break
      if (hasLiability) left -= amount
      const day = clampDay(y, m, Number(it.day || 28))
      events.push({ date: `${y}-${pad(m + 1)}-${pad(day)}`, amount, label: it.name || 'Financing', kind: 'bs' })
    }
  }
  return events
}

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
    if (r1 && !released1(e)) out.push({ date: e.release1Date || '', amount: r1, name: e.projectName || e.ourRef || '', customer: e.customer || e.client || '' })
    if (r2 && !released2(e)) out.push({ date: e.release2Date || '', amount: r2, name: e.projectName || e.ourRef || '', customer: e.customer || e.client || '' })
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
  const [finance, setFinance] = useState({ ifLimit: '', ifDrawn: '', ccLimit: '', overdraftLimit: '', cardLimits: {}, vatRate: 20, legacyMatDays: 30, cisRate: 20, cisOnForecast: true, riskWeeks: 0, usePaymentPerf: false })
  // [{ name, kind: 'bank'|'card', balance, asAt }]
  const [manualBal, setManualBal] = useState([])
  // { [key]: true }. Bills key on id, receivables on invoice number - the same key the
  // Invoices Owed page uses for its expected dates.
  const [excluded, setExcluded] = useState({})

  // EXPECTED PAYMENT DATE. Posts to the SAME endpoint the Invoices Owed page uses, which
  // writes invoice:meta - so a date set here shows there and vice versa, with no syncing
  // to go wrong. Keyed by invoice number, as that page does.
  async function setExpectedDate(invoiceNumber, expectedDate) {
    setData(d => ({
      ...d,
      receivables: (d.receivables || []).map(r => invKey(r) === invoiceNumber ? { ...r, expectedDate } : r),
    }))
    try {
      await fetch('/api/outstanding-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-expected', invoiceNumber, expectedDate }),
      })
    } catch {}
  }

  const [offsets, setOffsets] = useState({})
  const [offsetMsg, setOffsetMsg] = useState('')

  // Posts to the SAME endpoint the Payment Performance tab uses, so a figure changed here
  // shows there and vice versa - one store, no syncing to drift.
  async function saveOffsets(next) {
    setOffsets(next); setOffsetMsg('saving')
    try {
      const r = await fetch('/api/business-financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'payment-performance', action: 'save-offsets', offsets: next }),
      })
      setOffsetMsg(r.ok ? 'saved' : 'NOT SAVED')
      if (r.ok) { setTimeout(() => setOffsetMsg(''), 1500); setData(d => ({ ...d, custOffsets: next })) }
    } catch { setOffsetMsg('NOT SAVED') }
  }

  async function toggleExcluded(key, next) {
    setExcluded(prev => { const c = { ...prev }; if (next) c[key] = true; else delete c[key]; return c })
    try {
      await fetch('/api/business-financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'cashflow', action: 'save-exclusions', key, excluded: !!next }),
      })
    } catch {}
  }
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
  const [openInvWk, setOpenInvWk] = useState(null)       // which week's invoices are open
  const [openBillWk, setOpenBillWk] = useState(null)     // which week's bills are open
  const [openCisWk, setOpenCisWk] = useState(null)
  const [openFinWk, setOpenFinWk] = useState(null)
  const [openMatWk, setOpenMatWk] = useState(null)
  const [openVatWk, setOpenVatWk] = useState(null)
  const [openArrears, setOpenArrears] = useState(false)  // arrears row broken out by bill
  const [openProj, setOpenProj] = useState(null)          // project row expanded to months
  const [openFcWk, setOpenFcWk] = useState(null)         // which week's project breakdown is open
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
      setExcluded(d.cfExcluded && typeof d.cfExcluded === 'object' ? d.cfExcluded : {})
      setOffsets(d.custOffsets && typeof d.custOffsets === 'object' ? d.custOffsets : {})
      const fc = d.financeCfg || {}
      // Whitelisted on the way in, so anything not named here is dropped on every
      // refresh even though the save writes the whole object. The overdraft limit and the
      // per-card limits have to be listed or they appear to save and vanish on reload.
      setFinance({
        ifLimit: fc.ifLimit ?? '', ifDrawn: fc.ifDrawn ?? '', ccLimit: fc.ccLimit ?? '',
        overdraftLimit: fc.overdraftLimit ?? '',
        vatRate: fc.vatRate ?? 20,
        legacyMatDays: fc.legacyMatDays ?? 30,
        cisRate: fc.cisRate ?? 20,
        cisOnForecast: fc.cisOnForecast !== false,
        riskWeeks: fc.riskWeeks ?? 0,
        usePaymentPerf: fc.usePaymentPerf === true,
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
        legacyMatDays: Number(finance.legacyMatDays ?? 30),
        cisRate: Number(finance.cisRate ?? 20),
        cisOnForecast: finance.cisOnForecast !== false,
        riskWeeks: Number(finance.riskWeeks) || 0,
        usePaymentPerf: finance.usePaymentPerf === true,
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
    // ONE COLUMN. Vehicles and commitments are financing too, so they sit with the
    // balance sheet items rather than in a column of their own.
    const commEvents = [
      ...commitmentEvents(data.cashCommitments, start, end).map(e => ({ ...e, kind: e.kind || 'commitment' })),
      ...balanceSheetEvents(data.bsItems, start, end),
    ]

    // VAT landing at month-end: filed Box 5 if entered, else the estimate.
    // Convention: positive = refund IN, negative = payment OUT.
    const vatByMonth = {}
    // WHERE EACH MONTH'S FIGURE CAME FROM: 'filed' is a real return, everything else is
    // an estimate. Tracked alongside the value so the table can say which is which -
    // a forecast figure and a filed one look identical in a column of numbers.
    const vatSrcByMonth = {}
    const allVatMonths = new Set([...Object.keys(data.vatFiled || {}), ...Object.keys(data.vatEstimateMonths || {})])
    for (const mk of allVatMonths) {
      const f = (data.vatFiled || {})[mk]
      if (f && f.box5 != null) {
        vatByMonth[mk] = f.direction === 'payable' ? -Math.abs(f.box5) : Math.abs(f.box5)
        vatSrcByMonth[mk] = 'filed'
      } else {
        const e = (data.vatEstimateMonths || {})[mk]
        // estimate netVat: negative = refund. Flip so positive = refund in.
        if (e) { vatByMonth[mk] = -(e.netVat || 0); vatSrcByMonth[mk] = 'estimate' }
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
        vatSrcByMonth[mk] = 'reclaim'
      }
    }

    const cisBill = (i) => !!cisFlags[i.id]
    // In Xero the CIS deduction is ALREADY applied - a labour bill's Amount Due is the
    // NET figure paid to the subcontractor (e.g. GBP1,000 on a GBP1,250 gross bill). So the
    // bill pays its full Amount Due; the extra cash event is the 20% CIS to HMRC. From a
    // net figure, gross = net / 0.8, so CIS = gross - net = net * 0.25.
    // A FORECAST PERIOD THAT HAS ALREADY ENDED IS NOT FUTURE CASH.
    //
    // The supersede rule depends on latestAppEnd, which comes from the DASHBOARD CACHE -
    // and that goes cold on a 4-hour TTL and whenever a marker ships. Stale cache meant
    // latestAppEnd was empty, the forecast was NOT dropped, and the real invoice sat in
    // receivables alongside it. Both counted.
    //
    // This does not depend on the cache at all: a period ending before today has either
    // been applied for - in which case its money is a real invoice - or it did not
    // happen. Either way it is not cash still to come. It is the backstop that catches
    // everything the supersede rule misses as time rolls forward.
    // SALES and COSTS are NOT the same here, and pkg638 treated them as if they were.
    //
    // If a period has ended without being applied for, you have not earned the money -
    // dropping the sales is right and conservative. But the WORK still happened, so the
    // subcontractor invoice and the materials bill are still coming. Dropping those too
    // made the forecast look BETTER than reality, which is the one direction a cash flow
    // must never err in.
    // THE VALUATION DATE IS THE BOUNDARY.
    //
    // Everything a project has been valued for is now a real application and real bills;
    // everything after it is still forecast. One line, not a per-week netting rule, which
    // is what makes the hand-over clean as each valuation passes.
    //
    // Falls back to the period end where a project has no application calendar set - it is
    // closer to the truth than a generic month end and it degrades predictably.
    const isApplied = (fc) => !!(fc.to && fc.latestAppEnd && fc.to <= fc.latestAppEnd)

    const cisRate = Math.min(0.99, Math.max(0, Number(finance.cisRate ?? 20) / 100))
    // TWO BASES, and mixing them is the whole problem.
    //
    // XERO BILLS are already NET - Xero deducts CIS when the bill is entered, so Amount
    // Due is what the subcontractor gets. The CIS on top is net x r/(1-r).
    const cisFromNet = (net) => cisRate > 0 ? net * (cisRate / (1 - cisRate)) : 0
    // FORECAST LABOUR is GROSS - it is the value of the work, before the deduction. So
    // the CIS is simply gross x r, and what actually leaves the bank for the
    // subcontractor is gross x (1-r). Treating gross as net inflated BOTH: the labour
    // column showed the full gross as if it were all payable, and the CIS was worked out
    // at 20/80 of a figure that already included the tax. On 224,686 of labour that was
    // 56,172 of cash out that does not exist.
    const cisFromGross = (g) => cisRate > 0 ? g * cisRate : 0
    const netOfCis = (g) => g * (1 - cisRate)

    // COST CERTIFIED BUT NOT YET INVOICED.
    //
    // Dropping forecast cost at the valuation date assumes the subcontractor invoices have
    // arrived. They lag - a valuation on the 25th is invoiced weeks later - so dropping it
    // outright would quietly improve the forecast in the gap, which is the same mistake as
    // dropping elapsed costs along with elapsed sales.
    //
    // So the forecast cost behind a passed valuation is dropped only to the extent real
    // bills have turned up for that project. The shortfall is real money still to pay, and
    // it lands in THE CURRENT WEEK - never left sitting in a month that has gone, because
    // a balance in a past week cannot be paid and only makes you reconcile backwards.
    const awaitingInvoice = (() => {
      const billByProject = {}
      for (const b of (data.bills || [])) {
        if (!b.project || excluded[b.id]) continue
        const k = normName(b.project)
        billByProject[k] = (billByProject[k] || 0) + Math.abs(b.amountDue || 0)
      }
      const out = []
      for (const fc of (data.projForecasts || [])) {
        if (!fc.latestAppEnd) continue
        // Compared against Xero bills, which are NET of CIS - so the labour side has to be
        // netted too or every project would look like it had 20% of labour uninvoiced.
        // Materials carry no CIS.
        const certLabour = netOfCis((fc.labourSchedule || []).filter(x => x.date && x.date <= fc.latestAppEnd).reduce((t, x) => t + (x.amount || 0), 0))
        const certMat = (fc.matItems || []).filter(x => x.date && x.date <= fc.latestAppEnd).reduce((t, x) => t + (x.amount || 0), 0)
        const certified = certLabour + certMat
        if (certified <= 0) continue
        const k = normName(fc.projectName || '')
        const billed = billByProject[k] || 0
        // AN OVERRIDE SET ON THE PROJECT FORECAST WINS.
        //
        // Only a person knows whether a gap is a subcontractor who has not invoiced yet or
        // work that was never done. Where somebody has settled it on the forecast, that is
        // the answer - recomputing it here would quietly overrule them.
        const ovr = (fc.awaitLabour == null && fc.awaitMaterials == null)
          ? null
          : (Number(fc.awaitLabour) || 0) + (Number(fc.awaitMaterials) || 0)
        const short = ovr != null ? Math.max(0, ovr) : Math.max(0, certified - billed)
        // Consume the allowance so two forecast periods on one project cannot both claim
        // the same bills against themselves.
        billByProject[k] = Math.max(0, billed - certified)
        if (short > 0.5) out.push({ name: fc.projectName || fc.projectKey, amount: short, upTo: fc.latestAppEnd })
      }
      return out
    })()
    const awaitingTotal = awaitingInvoice.reduce((t, x) => t + x.amount, 0)

    // APPLIED FOR BUT NOT YET INVOICED - the sales-side mirror of the above.
    //
    // Once a period has been applied for its forecast sales drop, on the assumption the
    // invoice has replaced them. Between raising the application and the invoice appearing
    // in Xero, that money is in NEITHER place - the forecast has let go of it and
    // receivables has not picked it up. On a 20,859 period with only 12,000 invoiced, the
    // week silently lost 8,859.
    //
    // So sales are dropped only to the extent invoices have actually arrived, and the
    // shortfall lands in the current week rather than sitting in a month that has gone.
    const awaitingCash = (() => {
      const invByProject = {}
      for (const i of (data.receivables || [])) {
        if (!i.projectNo || excluded[invKey(i)]) continue
        const k = String(i.projectNo)
        invByProject[k] = (invByProject[k] || 0) + (i.amountDue || 0)
      }
      const out = []
      for (const fc of (data.projForecasts || [])) {
        if (!isApplied(fc)) continue
        const bound = fc.valDate || fc.to || ''
        const certified = (fc.salesSchedule || [])
          .filter(x => (x.appDate || x.date) && (x.appDate || x.date) <= bound)
          .reduce((t, x) => t + (x.amount || 0), 0)
        if (certified <= 0) continue
        const k = String(fc.projectNo || '')
        const invoiced = invByProject[k] || 0
        const short = Math.max(0, certified - invoiced)
        invByProject[k] = Math.max(0, invoiced - certified)   // consume, so two periods cannot both claim it
        if (short > 0.5) out.push({ name: projLabel(fc), amount: short, upTo: bound })
      }
      return out
    })()
    const awaitingCashTotal = awaitingCash.reduce((t, x) => t + x.amount, 0)


    // THE VALUATION DATE IS THE BOUNDARY, not the period end you typed.
    //
    // fc.to is the end of the period - 13/11 on a period running to the 13th. What decides
    // whether revenue is still forecast is when the work is CERTIFIED, which can be days
    // or weeks apart. Using the period end meant a period whose valuation had passed
    // without an application kept its forecast sales.
    //
    // It DROPS rather than rolling into the next month, which is what you asked for and is
    // the conservative treatment: a period valued without being applied for has not been
    // earned, so it is not cash to come. The work carries into the next application, and
    // that period's own forecast is where it should appear.
    const salesSpent = (fc) => {
      if (isApplied(fc)) return true
      const bound = fc.valDate || fc.to || ''
      return !!(bound && bound < todayISO)
    }

    // CARRY THE VARIANCE FORWARD, PER PROJECT.
    //
    // A period certified for LESS than forecast has not lost that work - it slipped, and
    // it will be certified next period. Dropping the remainder understated every future
    // month. Certify MORE than forecast and the opposite is true: you are ahead, so the
    // next period has less left in it.
    //
    // One rule, both directions: carry (forecast - certified) into the next period. Only
    // the REMAINDER moves, so nothing is counted twice - the certified part has already
    // become a real invoice.
    //
    // Certified is measured by what has been INVOICED for that project. The application
    // decides WHEN a period closes; the invoice decides how much of it was real.
    // COST CARRY, on the SAME project-period rule as sales.
    //
    // An application is labour + materials in a project period, valued at the valuation
    // date - the remainder is the margin at that date. So cost has to be attributed to the
    // PROJECT PERIOD, not the calendar month: materials landing inside a valuation period
    // are part of that application, and netting them over a month put them against the
    // wrong period whenever the two did not line up.
    //
    // Cash dates are unaffected - a bill still pays on eom+X. This is about which period
    // the cost BELONGS to, not when it leaves the bank.
    const costCarryIn = {}
    {
      const byProject = {}
      for (const fc of (data.projForecasts || [])) {
        const k = String(fc.projectKey || fc.projectNo || '')
        ;(byProject[k] = byProject[k] || []).push(fc)
      }
      const billLeft = {}
      for (const b of (data.bills || [])) {
        if (!b.project || excluded[b.id]) continue
        const k = normName(b.project)
        billLeft[k] = (billLeft[k] || 0) + Math.abs(b.amountDue || 0)
      }
      for (const [, list] of Object.entries(byProject)) {
        const ordered = list.slice().sort((a, b) => String(a.valDate || a.to || '').localeCompare(String(b.valDate || b.to || '')))
        let carry = 0
        for (const fc of ordered) {
          costCarryIn[fc.id || `${fc.projectKey}|${fc.from}|${fc.to}`] = carry
          if (!salesSpent(fc)) { carry = 0; break }
          const ownL = netOfCis((fc.labourSchedule || []).reduce((t, x) => t + (x.amount || 0), 0))
          const ownM = (fc.matItems || []).reduce((t, x) => t + (x.amount || 0), 0)
          const own = ownL + ownM
          const k = normName(fc.projectName || '')
          const avail = billLeft[k] || 0
          const actual = Math.min(own + carry, avail)
          billLeft[k] = Math.max(0, avail - actual)
          carry = (own + carry) - actual
        }
      }
    }

    const carryIn = {}
    {
      const byProject = {}
      for (const fc of (data.projForecasts || [])) {
        const k = String(fc.projectKey || fc.projectNo || '')
        ;(byProject[k] = byProject[k] || []).push(fc)
      }
      const invLeft = {}
      for (const i of (data.receivables || [])) {
        if (!i.projectNo || excluded[invKey(i)]) continue
        const k = String(i.projectNo)
        invLeft[k] = (invLeft[k] || 0) + (i.amountDue || 0)
      }
      for (const [, list] of Object.entries(byProject)) {
        // Oldest valuation first, so the carry walks forward in the order the periods
        // were actually certified.
        const ordered = list.slice().sort((a, b) => String(a.valDate || a.to || '').localeCompare(String(b.valDate || b.to || '')))
        let carry = 0
        for (const fc of ordered) {
          carryIn[fc.id || `${fc.projectKey}|${fc.from}|${fc.to}`] = carry
          if (!salesSpent(fc)) { carry = 0; break }   // reached the open periods - stop
          const own = (fc.salesSchedule || []).reduce((t, x) => t + (x.amount || 0), 0)
          const k = String(fc.projectNo || '')
          const avail = invLeft[k] || 0
          const certified = Math.min(own + carry, avail)
          invLeft[k] = Math.max(0, avail - certified)
          carry = (own + carry) - certified
        }
      }
    }
    // Costs drop ONLY when a real application has replaced them. An elapsed period keeps
    // its costs until the real bill turns up, at which point the month netting removes
    // them - so nothing is double counted and nothing silently disappears.
    const costsSpent = (fc) => isApplied(fc)

    // Rate is a setting - not every trade is on 20%, and a gross-status subcontractor is
    // on nil. From a NET figure, gross = net / (1 - r), so CIS = net * r / (1 - r).


    // CIS withheld on labour bills is paid to HMRC on the 22nd of the FOLLOWING month.
    // Group by the month the bill is paid, then schedule the HMRC payment.
    const cisByPayMonth = {}
    // Where each month's CIS came from - a real ticked bill, or predicted off forecast
    // labour. Predicted CIS is an estimate and must say so, the same as VAT does.
    const cisSrcByMonth = {}
    // Every contributing line, so the column can show its own workings.
    const cisLines = {}
    for (const i of (data.bills || [])) {
      if (!cisBill(i)) continue
      const pd = billOverrides[i.id] || i.payDate || i.dueDate || ''
      if (!pd) continue
      const mk = pd.slice(0, 7)
      cisByPayMonth[mk] = (cisByPayMonth[mk] || 0) + cisFromNet(i.amountDue || 0)
      cisSrcByMonth[mk] = cisSrcByMonth[mk] || {}
      cisSrcByMonth[mk].bill = true
      ;(cisLines[mk] = cisLines[mk] || []).push({
        who: i.contact || i.supplier || '(no supplier)', project: i.project || '',
        base: i.amountDue || 0, basis: 'bill, net', cis: cisFromNet(i.amountDue || 0),
      })
    }
    // CIS ON FORECAST LABOUR.
    //
    // The bills above only cover invoices already IN Xero and individually ticked, so the
    // column showed 1,031 across thirteen weeks against six figures of labour. All
    // subcontract labour carries CIS unless the subcontractor holds gross status, so the
    // forecast has to predict it too or the HMRC outflow is missing from the whole
    // forward half of the plan.
    //
    // NO DOUBLE COUNT, two ways:
    //   - forecast labour is already NET of any real bill on that project that week
    //     (see the billByProjectThisWk netting), so a bill and its forecast cannot both
    //     produce CIS on the same money;
    //   - PAYE wages in the Budgets overheads are NOT touched. They are employees, not
    //     subcontractors, and their PAYE is a different liability - the one being paid
    //     down on the Balance Sheet tab.
    const cisOnForecast = finance.cisOnForecast !== false
    if (cisOnForecast && cisRate > 0) {
      for (const fc of (data.projForecasts || [])) {
        if (costsSpent(fc)) continue
        for (const l of (fc.labourSchedule || [])) {
          if (!l.date) continue
          const mk = String(l.date).slice(0, 7)
          cisByPayMonth[mk] = (cisByPayMonth[mk] || 0) + cisFromGross(l.amount || 0)
          ;(cisLines[mk] = cisLines[mk] || []).push({
            who: projLabel(fc), project: '', base: l.amount || 0,
            basis: 'forecast labour, gross', cis: cisFromGross(l.amount || 0),
          })
          cisSrcByMonth[mk] = cisSrcByMonth[mk] || {}
          cisSrcByMonth[mk].forecast = true
        }
      }
    }

    // Map to actual HMRC payment dates: 22nd of the month after the pay month.
    const cisPayments = Object.entries(cisByPayMonth).map(([mk, amt]) => {
      const [yy, mm] = mk.split('-').map(Number)   // mm is 1-based
      const payMonth = new Date(yy, mm, 22)         // mm (0-based next month), day 22
      return { date: isoDay(payMonth), amount: amt, src: cisSrcByMonth[mk] || {}, mk, lines: (cisLines[mk] || []).slice().sort((a, b) => b.cis - a.cis) }
    })

    // Weeks to delay every receipt by. 0 = the plan as entered.
    const riskDays = (Number(finance.riskWeeks) || 0) * 7
    const usePerf = finance.usePaymentPerf === true
    const rows = []
    // Bill allowance already consumed, per month per project - prevents one bill netting
    // against the same forecast money in more than one week.
    const billUsed = {}
    // Same for invoices - one invoice cannot net against two different weeks.
    const invUsed = {}
    let running = openBank
    for (let w = 0; w < WEEKS; w++) {
      const wkStart = new Date(start.getTime() + w * 7 * 86400000)
      const wkEnd = new Date(wkStart.getTime() + 6 * 86400000)
      const s = isoDay(wkStart), e = isoDay(wkEnd)
      const inWk = (dstr) => dstr >= s && dstr <= e
      // RISK SHIFT - push money IN back by N weeks, leaving money OUT where it is.
      //
      // That asymmetry is the point: customers paying late does not make your suppliers,
      // your labour or HMRC wait. Shifting both would just slide the whole picture and
      // show nothing. Applied by testing an EARLIER date against this week, which moves
      // the receipt later without touching the stored dates.
      // PER-CUSTOMER OFFSET on top of the global risk shift.
      //
      // Measured on the Payment Performance tab: how many days that customer actually
      // takes beyond the due date. Scheduling everyone on their stated terms is an
      // assumption nobody has tested - a customer who is reliably 20 days late should sit
      // 20 days later in the forecast, not on a date they have never once hit.
      //
      // Only applies where a date has NOT been set by hand: an expected date is a
      // judgement somebody has already made, and shifting it would overrule them.
      const inWkIn = (dstr, extraDays = 0) => {
        if (!dstr) return false
        const add = riskDays + (Number(extraDays) || 0)
        if (!add) return inWk(dstr)
        const d = new Date(dstr); d.setDate(d.getDate() + add)
        const shifted = isoDay(d)
        return shifted >= s && shifted <= e
      }
      // OFF BY DEFAULT. Shifting every receipt by a measured average changes the whole
      // forecast, so it has to be a deliberate choice rather than something that happens
      // the moment the data is imported.
      //
      // A typed override wins over the measured figure; the measured figure is used where
      // nothing has been typed. Either way an expected date set by hand is untouched.
      const offsetFor = (i) => {
        if (i.expectedDate || !usePerf) return 0
        const typed = (data.custOffsets || {})[i.contact]
        if (typed != null && typed !== '') return Number(typed) || 0
        return Number((data.custPerf || {})[i.contact]?.medLate) || 0
      }
      // OVERDUE LANDS IN WEEK 1, for money out as well as money in.
      //
      // A date before the horizon is not "never" - it is late, and late money out is the
      // most certain spend there is. Dropping it flattered the forecast twice: the debt
      // vanished from Invoices in AND the bill vanished from Bills out.
      // (inWkOrOverdue removed - arrears are now split out explicitly above, so a single
      // predicate that quietly folded them into week 1 would hide the very thing the
      // arrears row exists to show.)

      // OVERDUE DEBT LANDS IN WEEK 1, it does not vanish.
      //
      // This used inWk() alone, which requires the date to fall INSIDE the 13 weeks. Any
      // invoice already past its due date sits BEFORE week 1 and was dropped entirely -
      // so 555k of debt showed as 100,885 of cash coming in, and the money you are most
      // likely to collect was the money the forecast ignored.
      //
      // Overdue does not mean never paid; it means late. It belongs in the first week,
      // which is also the honest place for it - if it does not arrive you see the hole.
      // Split into what is genuinely due THIS WEEK and what is arrears swept into week 1,
      // so the two can be shown as separate rows. A week 1 carrying months of late money
      // looks like an ordinary week otherwise.
      const isArrears = (d) => w === 0 && d && d < s
      let invoicesIn = 0, arrInvoices = 0
      const invDetail = []
      const arrInvDetail = []
      for (const i of (data.receivables || [])) {
        if (excluded[invKey(i)]) continue
        const d = i.expectedDate || i.dueDate || ''
        if (isArrears(d)) {
          arrInvoices += (i.amountDue || 0)
          // Recorded in the SAME shape as a normal week, so the arrears row's drill-down
          // works like every other. It was showing "Total (0)" against 434,338 - the
          // figure was right and the list behind it was never built.
          arrInvDetail.push({ name: i.contact || '(no customer)', ref: i.invoiceNumber || i.number || '',
            project: i.projectName || '', amount: i.amountDue || 0, due: d, expected: !!i.expectedDate,
            offset: 0, total: i.total || 0 })
        }
        else if (inWkIn(d, offsetFor(i))) {
          invoicesIn += (i.amountDue || 0)
          // Kept so the week can say WHICH invoices, the same way Overheads out does.
          invDetail.push({ name: i.contact || '(no customer)', ref: i.invoiceNumber || i.number || '',
            project: i.projectName || '', amount: i.amountDue || 0, due: d, expected: !!i.expectedDate,
            offset: offsetFor(i),
            // The full invoice, so a part-paid one is obvious - the column only ever
            // showed what is still outstanding.
            total: i.total || 0 })
        }
      }
      const overdueIn = w === 0
        ? (data.receivables || []).filter(i => { const d = i.expectedDate || i.dueDate || ''; return d && d < s }).reduce((a, i) => a + (i.amountDue || 0), 0)
        : 0
      // Overdue releases land in week 1, same rule as invoices.
      let retIn = 0, arrRet = 0
      for (const r of retEvents) {
        if (!r.date) continue
        if (isArrears(r.date)) arrRet += r.amount
        else if (inWkIn(r.date)) retIn += r.amount
      }
      // VAT: any month whose month-end falls in this week.
      let vatIn = 0
      const vatSrcs = []
      for (const mk of Object.keys(vatByMonth)) {
        const [yy, mm] = mk.split('-').map(Number)
        const monthEnd = isoDay(new Date(yy, mm, 0))
        if (inWk(monthEnd)) { vatIn += vatByMonth[mk]; vatSrcs.push({ mk, src: vatSrcByMonth[mk] || 'estimate', amount: vatByMonth[mk] }) }
      }
      // Any contributor that is not a filed return makes the week's figure an estimate.
      const vatEstimated = vatSrcs.some(x => x.src !== 'filed')
      const vatInPos = vatIn > 0 ? vatIn : 0
      const vatOut = vatIn < 0 ? -vatIn : 0

      // Bills out: pay the full Amount Due (Xero already nets CIS off labour bills).
      // The 20% CIS to HMRC is scheduled separately below.
      // Keep the LIST, not just the total. "Overdue - brought forward £4,836" with no way
      // to see what it is made of means going to the table below and matching by eye.
      const arrBillList = (data.bills || [])
        .filter(i => !excluded[i.id] && isArrears((billOverrides[i.id] || i.payDate || i.dueDate) || ''))
        .map(i => ({ name: i.contact || i.supplier || '(no supplier)', project: i.project || '', ref: i.reference || i.invoiceNumber || '',
          amount: i.amountDue || 0, due: (billOverrides[i.id] || i.payDate || i.dueDate) || '' }))
        .sort((a, b) => b.amount - a.amount)
      const arrBills = arrBillList.reduce((a, i) => a + i.amount, 0)
      const arrInvList = (data.receivables || [])
        .filter(i => !excluded[invKey(i)] && isArrears(i.expectedDate || i.dueDate || ''))
        .map(i => ({ name: i.contact || '(no customer)', ref: i.invoiceNumber || i.number || '', project: i.projectName || '',
          amount: i.amountDue || 0, due: i.expectedDate || i.dueDate || '' }))
        .sort((a, b) => b.amount - a.amount)
      // (Certified-but-uninvoiced cost is carried by the ARREARS row, not added to week 1's
      // bills as well - adding it in both places would count it twice.)
      const billDetail = (data.bills || [])
        .filter(i => !excluded[i.id] && inWk((billOverrides[i.id] || i.payDate || i.dueDate) || ''))
        .map(i => ({
          name: i.contact || i.supplier || '(no supplier)',
          project: i.project || '',
          ref: i.reference || i.invoiceNumber || '',
          amount: i.amountDue || 0,
          total: i.total || 0,
          date: (billOverrides[i.id] || i.payDate || i.dueDate) || '',
          // Which of the three dates put it in this week - a planned date is a decision,
          // a due date is just Xero's assumption that you pay on terms.
          basis: billOverrides[i.id] ? 'planned' : (i.payDate ? 'planned' : 'due date'),
          cis: !!cisFlags[i.id],
        }))
        .sort((a, b) => b.amount - a.amount)
      const billsOut = billDetail.reduce((a, i) => a + i.amount, 0)
      const ohOut = ohEvents.filter(x => inWk(x.date)).reduce((a, x) => a + x.amount, 0)
      // Per-week overhead breakdown by code (for the click-to-expand detail).
      const ohDetailMap = {}
      for (const x of ohEvents.filter(x => inWk(x.date))) {
        ohDetailMap[x.code] = (ohDetailMap[x.code] || 0) + x.amount
      }
      const ohDetail = Object.entries(ohDetailMap)
        .map(([code, amount]) => ({ code, name: (data.overheadNames || {})[code] || code, amount: Math.round(amount) }))
        .sort((a, b) => b.amount - a.amount)
      const commDetail = commEvents.filter(x => inWk(x.date)).sort((a, b) => b.amount - a.amount)
      const commOut = commDetail.reduce((a, x) => a + x.amount, 0)
      const inWkCis = cisPayments.filter(c => inWk(c.date))
      const cisOut = inWkCis.reduce((a, c) => a + c.amount, 0)
      // Any forecast-derived contribution makes the week's figure an estimate.
      const cisEstimated = inWkCis.some(c => c.src && c.src.forecast)

      // Project cash flow forecast for this week, with GAP-FILL overlap: a project's
      // forecast SALES are suppressed in any week it has a real invoice; its forecast
      // COSTS (labour + materials) are suppressed in any week it has a real bill. This
      // means as actuals arrive the forecast drops off, leaving only future periods.
      // Declared ABOVE both netting blocks - a const is not hoisted, and the invoice
      // netting below reads it.
      const wkMonth = s.slice(0, 7)

      // AMOUNTS per project, not a set of job numbers.
      //
      // This was all-or-nothing: ONE unpaid invoice on a project in a week wiped out that
      // project's ENTIRE forecast sales for the week. Six projects were showing labour and
      // materials with no sales against them at all - which is why the table read as if
      // half the jobs were pure cost.
      //
      // Exactly the fault fixed for BILLS in pkg618 and never applied to invoices. The
      // invoice is real money and is already in Invoices in, so only the part of the
      // forecast it covers should come out; anything above it is still to be billed.
      const invByProjectThisWk = {}
      for (const i of (data.receivables || [])) {
        if (!i.projectNo || excluded[invKey(i)]) continue
        if (!inWkIn(i.expectedDate || i.dueDate || '')) continue
        const k = String(i.projectNo)
        invByProjectThisWk[k] = (invByProjectThisWk[k] || 0) + (i.amountDue || 0)
      }
      for (const k of Object.keys(invByProjectThisWk)) {
        const used = (invUsed[wkMonth] && invUsed[wkMonth][k]) || 0
        invByProjectThisWk[k] = Math.max(0, invByProjectThisWk[k] - used)
      }
      // AMOUNTS per project, not just a set of names - the forecast now nets the bill off
      // rather than discarding the whole thing, so it needs to know how much.
      // NETTED OVER THE MONTH, not the week.
      //
      // A real bill and the forecast line it replaces almost never fall in the same week -
      // the bill is paid on the supplier's terms, the forecast on its own schedule. Netting
      // week by week meant a bill paid in week 3 left the week 5 forecast untouched and
      // both counted. The month is the smallest window that reliably contains both.
      //
      // Each bill is used ONCE across the whole forecast: a running tally is kept so the
      // same bill cannot net against two different weeks.
      const billByProjectThisWk = {}
      for (const b of (data.bills || [])) {
        if (!b.project || excluded[b.id]) continue
        const d = (billOverrides[b.id] || b.payDate || b.dueDate) || ''
        if (!d || d.slice(0, 7) !== wkMonth) continue
        const k = normName(b.project)
        billByProjectThisWk[k] = (billByProjectThisWk[k] || 0) + Math.abs(b.amountDue || 0)
      }
      // What has already been netted against this project's bills in earlier weeks of the
      // same month, so the allowance is not spent twice.
      for (const k of Object.keys(billByProjectThisWk)) {
        const used = (billUsed[wkMonth] && billUsed[wkMonth][k]) || 0
        billByProjectThisWk[k] = Math.max(0, billByProjectThisWk[k] - used)
      }
      // Labour and materials kept SEPARATE, not rolled into one cost figure. Netted into
      // a single "Project forecast" column they are invisible - and if the cost schedules
      // are empty the column shows pure income with nothing to say the costs are missing.
      let fcSalesIn = 0, fcLabourOut = 0, fcMatOut = 0
      // WHICH PROJECTS make up the week, so the figure can be checked rather than trusted.
      const fcBreak = []
      for (const fc of (data.projForecasts || [])) {
        // SUPERSEDED - the period has already been applied for, so the money is now a
        // real invoice sitting in `receivables`. Counting the forecast as well is the
        // double-count you were worried about.
        //
        // The old guard only suppressed a forecast when an invoice landed in the SAME
        // WEEK. An application invoiced in week 2 whose forecast scheduled cash in week 6
        // was counted twice - which is most of why money in reads high.
        // Applied for -> everything drops, the real invoice and bills replace it.
        // Period merely ELAPSED -> sales drop, costs stay. The work happened, so the
        // spend is still coming; only the earning did not.
        if (costsSpent(fc)) continue

        const invThisWk = fc.projectNo ? (invByProjectThisWk[String(fc.projectNo)] || 0) : 0
        // The carry from earlier periods rides on the FIRST dated sales line of this
        // period, so it lands in the week that period's money was already due rather than
        // being spread or dumped in week 1.
        const lines = salesSpent(fc) ? [] : (fc.salesSchedule || []).filter(x => x.date)
        const firstDate = lines.map(x => x.date).sort()[0] || ''
        const carry = carryIn[fc.id || `${fc.projectKey}|${fc.from}|${fc.to}`] || 0
        const rawS = lines.filter(x => inWkIn(x.date)).reduce((a, x) => a + (x.amount || 0), 0)
          + ((carry && firstDate && inWkIn(firstDate)) ? carry : 0)
        const offS = Math.min(rawS, invThisWk)
        const sIn = Math.max(0, rawS - offS)
        if (offS > 0 && fc.projectNo) {
          if (!invUsed[wkMonth]) invUsed[wkMonth] = {}
          invUsed[wkMonth][String(fc.projectNo)] = (invUsed[wkMonth][String(fc.projectNo)] || 0) + offS
        }
        // NET THE BILL OFF, do not throw the whole forecast away.
        //
        // hasBill was all-or-nothing: ONE real bill on a project killed every forecast
        // cost for that project that week - labour and materials both, whatever the
        // amounts. A 600 bill suppressed a 65,000 materials payment, and the forecast
        // showed the income with none of the spend.
        //
        // The bill is real cash and is already counted in Bills out, so only the part of
        // the forecast it covers should be removed. Anything above it is spend still to
        // come and belongs in the forecast.
        const billThisWk = fc.projectName ? (billByProjectThisWk[normName(fc.projectName)] || 0) : 0
        // Behind the valuation date it is no longer forecast - it is a real bill, or it is
        // in the awaiting-invoice figure that has already been swept into week 1.
        // Behind THIS PERIOD'S valuation date, not a calendar month end. Cost inside the
        // valuation window belongs to that application; the carry above handles whatever
        // was not covered by real bills.
        const bound = fc.valDate || fc.latestAppEnd || ''
        const past = (x) => bound && x.date && x.date <= bound
        const cCarry = costCarryIn[fc.id || `${fc.projectKey}|${fc.from}|${fc.to}`] || 0
        // What actually leaves the bank for the subcontractor. The withheld 20% is a
        // separate payment to HMRC in the CIS column, on the 22nd of the following month.
        const rawL = netOfCis((fc.labourSchedule || []).filter(x => inWk(x.date) && !past(x)).reduce((a, x) => a + (x.amount || 0), 0))
        const rawM = (fc.matItems || []).filter(x => inWk(x.date) && !past(x)).reduce((a, x) => a + (x.amount || 0), 0)
        // Applied to labour first, then materials - a project bill is far more often
        // subcontract labour than a materials invoice.
        const offL = Math.min(rawL, billThisWk)
        const offM = Math.min(rawM, Math.max(0, billThisWk - offL))
        // The cost carry rides on the first dated cost line of the period, same as the
        // sales carry - so it lands in the week that spend was already expected.
        const costDates = [...(fc.labourSchedule || []), ...(fc.matItems || [])].map(x => x.date).filter(Boolean).sort()
        const firstCost = costDates[0] || ''
        const carryHere = (cCarry && firstCost && inWk(firstCost)) ? cCarry : 0
        const lOut = Math.max(0, rawL - offL) + carryHere
        const mOut = Math.max(0, rawM - offM)
        if (offL + offM > 0) {
          const k = normName(fc.projectName || '')
          if (!billUsed[wkMonth]) billUsed[wkMonth] = {}
          billUsed[wkMonth][k] = (billUsed[wkMonth][k] || 0) + offL + offM
        }
        // "J190 - Russell Hill", not "L:190". projectName is blank whenever the
        // dashboard cache has not named that job, and the key was the fallback - which
        // is the raw Redis key and means nothing to read.
        // Line-level materials, so the column can name the supplier and delivery date
        // rather than only the project total.
        const matLines = (fc.matItems || []).filter(x => inWk(x.date) && !past(x))
          .map(x => ({ project: projLabel(fc), amount: x.amount || 0, date: x.date, deliver: x.deliverDay || '', est: !!x.estimatedTerm }))
        if (sIn || lOut || mOut) fcBreak.push({ name: projLabel(fc), no: fc.projectNo, sales: sIn, labour: lOut, mat: mOut, matLines, from: fc.from, to: fc.to, month: s.slice(0, 7),
          // Carried in from an earlier period that was certified for less than forecast.
          carry: (carry && firstDate && inWkIn(firstDate)) ? carry : 0,
          matEstimated: (fc.matItems || []).some(m => m.estimatedTerm) })
        // Use the figures already worked out above, net of any real bill. Recomputing them
        // here is how the two got out of step - and `hasBill` no longer exists.
        fcSalesIn += sIn
        fcLabourOut += lOut
        fcMatOut += mOut
      }
      const fcCostOut = fcLabourOut + fcMatOut
      const projNet = fcSalesIn - fcCostOut

      const moneyIn = invoicesIn + retIn + vatInPos + fcSalesIn
      const moneyOut = billsOut + ohOut + commOut + vatOut + cisOut + fcCostOut
      const net = moneyIn - moneyOut
      // ARREARS ROW, before week 1 only. Everything already past its date, swept forward
      // - the money that is late rather than due. Shown separately so week 1 reads as the
      // week it actually is, and so the size of the arrears is impossible to miss.
      if (w === 0 && (arrInvoices || arrBills || arrRet || awaitingTotal || awaitingCashTotal)) {
        const arrNet = arrInvoices + awaitingCashTotal + arrRet - arrBills - awaitingTotal
        running += arrNet
        rows.push({
          wk: 'Overdue - brought forward', arrears: true, weekStart: s,
          invoicesIn: Math.round(arrInvoices + awaitingCashTotal),
          awaitingCash: Math.round(awaitingCashTotal), awaitingCashList: awaitingCash,
          retIn: Math.round(arrRet), vatIn: 0,
          // Shown alongside the real overdue invoices, marked so the two are not confused.
          invDetail: [...arrInvDetail, ...awaitingCash.map(x => ({
            name: x.name, ref: 'applied for, not yet invoiced', project: '',
            amount: x.amount, due: x.upTo, expected: false, offset: 0, total: 0, pending: true,
          }))].sort((a, b) => b.amount - a.amount),
          vatEstimated: false, vatSrcs: [],
          bills: Math.round(arrBills + awaitingTotal), awaiting: Math.round(awaitingTotal), awaitingList: awaitingInvoice,
          arrBillList, arrInvList,
          overheads: 0, ohDetail: [], commitments: 0, vatOut: 0, cisOut: 0,
          projSalesIn: 0, projCostOut: 0, projNet: 0, projLabourOut: 0, projMatOut: 0, fcBreak: [],
          moneyIn: Math.round(arrInvoices + awaitingCashTotal + arrRet), moneyOut: Math.round(arrBills + awaitingTotal),
          net: Math.round(arrNet), closing: Math.round(running),
        })
      }

      running += net
      rows.push({
        wk: `w/c ${wkStart.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`,
        weekStart: s,
        invoicesIn: Math.round(invoicesIn), invDetail: invDetail.sort((a, b) => b.amount - a.amount),
        retIn: Math.round(retIn), vatIn: Math.round(vatInPos),
        vatEstimated, vatSrcs, cisEstimated,
        cisDetail: inWkCis,
        bills: Math.round(billsOut), billDetail, overheads: Math.round(ohOut), ohDetail, commitments: Math.round(commOut), commDetail, vatOut: Math.round(vatOut), cisOut: Math.round(cisOut),
        projSalesIn: Math.round(fcSalesIn), projCostOut: Math.round(fcCostOut), projNet: Math.round(projNet),
        projLabourOut: Math.round(fcLabourOut), projMatOut: Math.round(fcMatOut),
        fcBreak: fcBreak.sort((a, b) => b.sales - a.sales),
        moneyIn: Math.round(moneyIn), moneyOut: Math.round(moneyOut),
        net: Math.round(net), closing: Math.round(running),
      })
    }
    return rows
  // finance is in the deps because the VAT reclaim estimate reads finance.vatRate -
  // without it the forecast would keep a stale rate until something else changed.
  }, [data, startCash, billOverrides, cisFlags, finance, manualBal, excluded])

  if (!ok) return null
  const lowest = forecast.reduce((min, r) => r.closing < min ? r.closing : min, forecast.length ? forecast[0].closing : 0)
  const lowestWk = forecast.find(r => r.closing === lowest)
  // The arrears row is not a week, so it is folded into week 1 for the CHART - plotted as
  // its own point it would read as a fourteenth week and stretch the axis. The table keeps
  // them separate, which is where the distinction matters.
  const chartData = (() => {
    const out = []
    for (const r of forecast) {
      if (r.arrears) { out.push({ wk: r.wk, closing: r.closing, moneyIn: r.moneyIn, moneyOut: -r.moneyOut, _arr: true }); continue }
      const prev = out[out.length - 1]
      if (prev && prev._arr) {
        out[out.length - 1] = { wk: r.wk, closing: r.closing, moneyIn: prev.moneyIn + r.moneyIn, moneyOut: prev.moneyOut - r.moneyOut }
        continue
      }
      out.push({ wk: r.wk, closing: r.closing, moneyIn: r.moneyIn, moneyOut: -r.moneyOut })
    }
    return out
  })()

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
                    // MATERIALS THAT CANNOT REACH A WEEK.
                    //
                    // No payment date (which comes from delivery date + terms, so a line
                    // with no delivery date gets none), or a percentage-of-budget line
                    // whose amount was never resolved at save time. Either way the money
                    // is absent from the forecast, not late.
                    const matBad = []
                    for (const fc of (data.projForecasts || [])) {
                      for (const m of (fc.matItems || [])) {
                        if (m.undated || m.unresolved) matBad.push({ name: fc.projectName || fc.projectKey, amount: m.raw || 0, why: m.unresolved ? '% of budget, never resolved' : 'no delivery date' })
                      }
                    }
                    const mSum = matBad.reduce((a, x) => a + x.amount, 0)
                    if (rSum < 1 && iSum < 1 && mSum < 1 && !matBad.length) return null
                    return (
                      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '9px 14px', marginBottom: 14, fontSize: 12, color: '#92400e' }}>
                        <strong>Not in the forecast - no date to schedule it against.</strong>{' '}
                        {rSum >= 1 && <>{gbp(rSum)} of retention across {undatedRet.length} release{undatedRet.length === 1 ? '' : 's'} - set the release dates on the Retention Tracker. </>}
                        {iSum >= 1 && <>{gbp(iSum)} of invoices across {undatedInv.length} - no due date in Xero. </>}
                        {matBad.length > 0 && (
                          <><br /><strong>{gbp(mSum)} of materials</strong> across {matBad.length} line{matBad.length === 1 ? '' : 's'} cannot be scheduled:{' '}
                            {[...new Set(matBad.map(x => `${x.name || '(unnamed)'} - ${x.why}`))].slice(0, 6).join('; ')}
                            {matBad.length > 6 ? ' and more' : ''}. Materials pay on delivery date plus terms, so a line with no delivery date never lands in a week.</>
                        )}
                      </div>
                    )
                  })()}

                  {/* DIAGNOSTIC. Sales come through and costs do not; rather than guess
                      at field names again, this shows what the saved forecasts actually
                      contain. Remove once the cost columns are right. */}
                  <details style={{ marginBottom: 14 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#b45309' }}>
                      Forecast data check - what the saved records contain ({(data.projForecasts || []).length} forecasts)
                    </summary>
                    <div style={{ marginTop: 8, maxHeight: 320, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead><tr style={{ background: '#faf9f7', color: '#888' }}>
                          <th style={{ textAlign: 'left', padding: '4px 6px' }}>Project</th>
                          <th style={{ textAlign: 'left', padding: '4px 6px' }}>Period</th>
                          <th style={{ textAlign: 'right', padding: '4px 6px' }}>matItems</th>
                          <th style={{ textAlign: 'left', padding: '4px 6px' }}>1st mat line</th>
                          <th style={{ textAlign: 'left', padding: '4px 6px' }}>matDeliverDay</th>
                          <th style={{ textAlign: 'right', padding: '4px 6px' }}>materialsThisPeriod</th>
                          <th style={{ textAlign: 'right', padding: '4px 6px' }}>labourSched</th>
                          <th style={{ textAlign: 'left', padding: '4px 6px' }}>cost-ish keys</th>
                        </tr></thead>
                        <tbody>
                          {(data.projForecasts || []).slice(0, 40).map((f, k) => (
                            <tr key={k} style={{ borderTop: '1px solid #f2f2f2' }}>
                              <td style={{ padding: '3px 6px' }}>{f.projectName || f.projectKey}</td>
                              <td style={{ padding: '3px 6px', color: '#999' }}>{f.from ? `${fmtDMY(f.from)}-${fmtDMY(f.to)}` : '-'}</td>
                              <td style={{ padding: '3px 6px', textAlign: 'right', color: f.diag?.matItems ? '#16a34a' : '#dc2626' }}>{f.diag?.matItems ?? 'absent'}</td>
                              <td style={{ padding: '3px 6px', fontFamily: 'monospace', fontSize: 10 }}>
                                {f.diag?.matItemFirst ? `pay:${f.diag.matItemFirst.payDate || 'NONE'} amt:${f.diag.matItemFirst.amount ?? 'null'} val:${f.diag.matItemFirst.value ?? 'null'} mode:${f.diag.matItemFirst.mode || '-'} del:${f.diag.matItemFirst.deliverDay || 'NONE'}` : '-'}
                              </td>
                              <td style={{ padding: '3px 6px' }}>{f.diag?.matDeliverDay || '-'}</td>
                              <td style={{ padding: '3px 6px', textAlign: 'right' }}>{f.diag?.materialsThisPeriod ?? '-'}</td>
                              <td style={{ padding: '3px 6px', textAlign: 'right' }}>{f.diag?.labourSchedule ?? 'absent'}</td>
                              <td style={{ padding: '3px 6px', fontFamily: 'monospace', fontSize: 9.5, color: '#888' }}>{(f.diag?.keys || []).join(' ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 5 }}>
                      Open this, screenshot a few rows and send them over. "pay:NONE" means the line has no payment date, so it can never land in a week. "matItems absent" with a matDeliverDay means it is a legacy record. The last column lists every cost-related field actually saved.
                    </div>
                  </details>

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
                    <div><div style={{ fontSize: 11, color: '#888', marginBottom: 3 }} title="Schedule receipts on how each customer ACTUALLY pays instead of the invoice due date. Off means every invoice is assumed to be paid exactly on terms - which is what the due date represents, not what happens.">Use payment performance</div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, paddingTop: 4 }}>
                        <input type="checkbox" checked={finance.usePaymentPerf === true} onChange={e => setFinance(f => ({ ...f, usePaymentPerf: e.target.checked }))} />
                        <span style={{ color: finance.usePaymentPerf ? '#b45309' : '#8a857c', fontWeight: finance.usePaymentPerf ? 700 : 400 }}>
                          {finance.usePaymentPerf ? 'measured' : 'due dates'}
                        </span>
                      </label></div>
                    <div><div style={{ fontSize: 11, color: '#888', marginBottom: 3 }} title="RISK TEST. Delays every receipt - invoices, retention and forecast sales - by this many weeks, leaving money OUT where it is. Customers paying late does not make your suppliers, your labour or HMRC wait, which is the whole point of the test.">Risk: pay me later (weeks)</div>
                      <input type="number" min={0} max={13} value={finance.riskWeeks} onChange={e => setFinance(f => ({ ...f, riskWeeks: e.target.value }))}
                        style={{ ...inpS, width: 70, borderColor: (Number(finance.riskWeeks) || 0) > 0 ? '#dc2626' : undefined }} /></div>
                    <div><div style={{ fontSize: 11, color: '#888', marginBottom: 3 }} title="Deduction rate applied to subcontract labour. Set to 0 if everyone you use holds gross status.">CIS rate %</div>
                      <input type="number" value={finance.cisRate} onChange={e => setFinance(f => ({ ...f, cisRate: e.target.value }))} style={{ ...inpS, width: 70 }} /></div>
                    <div><div style={{ fontSize: 11, color: '#888', marginBottom: 3 }} title="Predict CIS on FORECAST labour as well as on ticked bills. Forecast labour is already net of any real bill on that project, so nothing is counted twice. PAYE wages in the Budgets overheads are never included - they are employees, not subcontractors.">CIS on forecast labour</div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, paddingTop: 4 }}>
                        <input type="checkbox" checked={finance.cisOnForecast !== false} onChange={e => setFinance(f => ({ ...f, cisOnForecast: e.target.checked }))} />
                        <span style={{ color: '#8a857c' }}>{finance.cisOnForecast !== false ? 'on' : 'off'}</span>
                      </label></div>
                    <div><div style={{ fontSize: 11, color: '#888', marginBottom: 3 }} title="Older project forecasts stored only a materials DELIVERY date - the line items carrying the payment terms were never saved. This is the number of days after end of month those legacy materials are assumed to pay. Newer forecasts use each line's own term and ignore this.">Legacy materials, eom + days</div>
                      <input type="number" value={finance.legacyMatDays} onChange={e => setFinance(f => ({ ...f, legacyMatDays: e.target.value }))} style={{ ...inpS, width: 70 }} /></div>
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
                    <th style={th} title="VAT refunds landing at month end. A figure marked \u201cest\u201d is not a filed return - either the current VAT estimate, or a reclaim estimated from forecast materials and bills. Hover the figure to see which months and which source.">VAT in</th>
                    <th style={th}>Bills out</th>
                    <th style={th}>Overheads out</th>
                    <th style={th} title="Cash that never touches the P&L: loan and HP CAPITAL repayments, HMRC arrears, corporation tax, dividends, plus vehicle and other recurring commitments. Set up on the Balance Sheet tab. The cost was recognised when it arose, so these reduce a liability rather than being an overhead.">Financing &amp; tax</th>
                    <th style={th} title="VAT payments at month end. A figure marked \u201cest\u201d is not a filed return. Hover the figure to see which months and which source.">VAT out</th>
                    <th style={th} title="20% withheld from subcontract labour, paid to HMRC on the 22nd of the month after the labour is paid. Covers bills ticked as CIS AND forecast labour - the forecast labour is already net of any real bill on that project, so nothing is counted twice. PAYE wages in overheads are excluded: employees are not subcontractors.">CIS to HMRC</th>
                    <th style={th} title="Sales from the Commercial project cash flow forecasts, excluding any period already applied for and any project with a real invoice that week.">Project sales</th>
                    <th style={th} title="Materials payments from the same forecasts. If this is empty while Project sales is not, the forecasts have no materials scheduled - the cash flow is then showing income with no cost against it.">Materials out</th>
                    <th style={th} title="What actually reaches the subcontractor - forecast labour LESS the CIS deduction. The forecast holds gross; the withheld 20% is a separate payment in the CIS to HMRC column on the 22nd of the following month. Empty while Project sales is not means the forecasts have no labour scheduled.">Labour out (net of CIS)</th>
                    <th style={th}>Net</th>
                    <th style={th}>Closing cash</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.map((r, i) => (
                    <tr key={i} style={{ borderBottom: r.arrears ? '2px solid #fde68a' : '1px solid #f2f0ec', background: r.arrears ? '#fffbeb' : 'transparent' }}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: r.arrears ? '#92400e' : undefined }}
                        title={r.arrears ? 'Everything already past its due date, swept into today. It is late money, not money due this week - shown separately so week 1 reads as the week it actually is.' : ''}>
                        {r.wk}{r.arrears ? <div style={{ fontSize: 9.5, fontWeight: 600, color: '#b45309' }}>late - confirm dates below</div> : null}
                        {r.awaiting > 0 && (
                          <div title={(r.awaitingList || []).map(x => `${x.name} - ${gbp(x.amount)} certified to ${fmtDMY(x.upTo)}, not yet invoiced`).join('\n')}
                            style={{ fontSize: 9.5, fontWeight: 700, color: '#7c3aed', cursor: 'help' }}>
                            incl {gbp(r.awaiting)} certified, awaiting invoice
                          </div>
                        )}</td>
                      {/* Same treatment as Overheads out - a week's total is not much use
                          without knowing which customers it is waiting on. */}
                      <td style={{ ...td, color: r.invoicesIn ? '#16a34a' : '#ccc', cursor: r.invoicesIn ? 'pointer' : 'default' }}
                        onClick={() => r.invoicesIn && setOpenInvWk(openInvWk === i ? null : i)}
                        title={r.invoicesIn ? 'Click to see which invoices' : ''}>
                        {r.invoicesIn ? gbp(r.invoicesIn) : '-'}
                        {r.invoicesIn ? <Caret open={openInvWk === i} /> : null}
                      </td>
                      <td style={{ ...td, color: r.retIn ? '#16a34a' : '#ccc' }}>{r.retIn ? gbp(r.retIn) : '-'}</td>
                      {/* An estimate and a filed return look identical in a column of
                          numbers. Anything not from a filed return is labelled. */}
                      <td style={{ ...td, color: r.vatIn ? '#16a34a' : '#ccc', cursor: r.vatIn ? 'pointer' : 'default' }}
                        onClick={() => r.vatIn && setOpenVatWk(openVatWk === i ? null : i)}
                        title={r.vatSrcs && r.vatSrcs.length ? r.vatSrcs.map(x => `${x.mk}: ${x.src === 'filed' ? 'filed return' : x.src === 'reclaim' ? 'estimated reclaim on forecast materials and bills' : 'VAT estimate'}`).join('; ') : ''}>
                        {r.vatIn ? gbp(r.vatIn) : '-'}
                        {r.vatIn && r.vatEstimated ? <span style={{ fontSize: 9, color: '#b45309', fontWeight: 700 }}> est</span> : null}
                        {r.vatIn ? <Caret open={openVatWk === i} /> : null}
                      </td>
                      {/* On the arrears row this is a mix of overdue bills and certified-
                          but-uninvoiced cost. Clicking opens exactly what it is made of,
                          rather than sending you to the table below to match by eye. */}
                      <td style={{ ...td, color: r.bills ? '#dc2626' : '#ccc', cursor: (r.arrears && r.bills) ? 'pointer' : 'default',
                        textDecoration: r.bills ? 'underline dotted #e5b4b4' : 'none' }}
                        onClick={() => { if (!r.bills) return; if (r.arrears) setOpenArrears(v => !v); else setOpenBillWk(openBillWk === i ? null : i) }}
                        title={r.bills ? 'Click to see which bills' : ''}>
                        {r.bills ? gbp(-r.bills) : '-'}
                        {r.bills ? <Caret open={(r.arrears ? openArrears : openBillWk === i)} /> : null}
                      </td>
                      <td style={{ ...td, color: r.overheads ? '#dc2626' : '#ccc', cursor: r.overheads ? 'pointer' : 'default', textDecoration: r.overheads ? 'underline dotted' : 'none' }}
                        onClick={() => r.overheads && setOpenOhWk(openOhWk === i ? null : i)}
                        title={r.overheads ? 'Click to see the breakdown' : ''}>
                        {r.overheads ? gbp(-r.overheads) : '-'}{r.overheads ? <Caret open={openOhWk === i} /> : null}
                      </td>
                      <td style={{ ...td, color: r.commitments ? '#dc2626' : '#ccc', cursor: r.commitments ? 'pointer' : 'default' }}
                        onClick={() => r.commitments && setOpenFinWk(openFinWk === i ? null : i)}
                        title={r.commitments ? 'Click to see which items' : ''}>
                        {r.commitments ? gbp(-r.commitments) : '-'}
                        {r.commitments ? <Caret open={openFinWk === i} /> : null}
                      </td>
                      {/* Same treatment - VAT out comes from the same months, so a
                          payment can be an estimate too. */}
                      <td style={{ ...td, color: r.vatOut ? '#dc2626' : '#ccc' }}
                        title={r.vatSrcs && r.vatSrcs.length ? r.vatSrcs.map(x => `${x.mk}: ${x.src === 'filed' ? 'filed return' : x.src === 'reclaim' ? 'estimated from forecast materials and bills' : 'VAT estimate'}`).join('; ') : ''}>
                        {r.vatOut ? gbp(-r.vatOut) : '-'}
                        {r.vatOut && r.vatEstimated ? <span style={{ fontSize: 9, color: '#b45309', fontWeight: 700 }}> est</span> : null}
                      </td>
                      {/* Marked "est" where any part came from FORECAST labour rather
                          than a real ticked bill - same treatment as VAT. */}
                      <td style={{ ...td, color: r.cisOut ? '#dc2626' : '#ccc', cursor: r.cisOut ? 'pointer' : 'default' }}
                        onClick={() => r.cisOut && setOpenCisWk(openCisWk === i ? null : i)}
                        title={r.cisEstimated ? 'Includes CIS predicted from forecast labour, not just from bills already in Xero.' : (r.cisOut ? 'From bills ticked as CIS labour.' : '')}>
                        {r.cisOut ? gbp(-r.cisOut) : '-'}
                        {r.cisOut && r.cisEstimated ? <span style={{ fontSize: 9, color: '#b45309', fontWeight: 700 }}> est</span> : null}
                        {r.cisOut ? <Caret open={openCisWk === i} /> : null}
                      </td>
                      {/* Three columns, not one net figure. If Materials out and Labour
                          out sit at nil while Project sales runs high, the cost side of
                          the forecast is missing - which a netted column hides completely. */}
                      <td style={{ ...td, color: r.projSalesIn ? '#0f766e' : '#ccc', cursor: r.projSalesIn ? 'pointer' : 'default', textDecoration: r.projSalesIn ? 'underline dotted #bbb' : 'none' }}
                        onClick={() => r.projSalesIn && setOpenFcWk(openFcWk === i ? null : i)}
                        title={r.projSalesIn ? 'Click to see which projects this is' : ''}>
                        {r.projSalesIn ? gbp(r.projSalesIn) : '-'}{r.projSalesIn ? <Caret open={openFcWk === i} /> : null}
                      </td>
                      {/* Opens the same per-project breakdown the sales figure does - it
                          already carries all three, so a separate table would be the same
                          numbers twice and one more thing to keep in step. */}
                      <td style={{ ...td, color: r.projMatOut ? '#dc2626' : '#ccc', cursor: r.projMatOut ? 'pointer' : 'default' }}
                        onClick={() => r.projMatOut && setOpenMatWk(openMatWk === i ? null : i)}
                        title={r.projMatOut ? 'Click to see the supplier lines' : ''}>
                        {r.projMatOut ? gbp(-r.projMatOut) : '-'}
                        {r.projMatOut ? <Caret open={openMatWk === i} /> : null}
                      </td>
                      <td style={{ ...td, color: r.projLabourOut ? '#dc2626' : '#ccc', cursor: r.projLabourOut ? 'pointer' : 'default' }}
                        onClick={() => r.projLabourOut && setOpenFcWk(openFcWk === i ? null : i)}
                        title={r.projLabourOut ? 'Click to see it by project. Net of CIS - the 20% is in the CIS to HMRC column.' : ''}>
                        {r.projLabourOut ? gbp(-r.projLabourOut) : '-'}
                        {r.projLabourOut ? <Caret open={openFcWk === i} /> : null}
                      </td>
                      <td style={{ ...td, fontWeight: 600, color: r.net < 0 ? '#dc2626' : '#16a34a' }}>{gbp(r.net)}</td>
                      <td style={{ ...td, fontWeight: 800, color: r.closing < 0 ? '#dc2626' : INK, background: r.closing < 0 ? '#fef2f2' : 'transparent' }}>{gbp(r.closing)}</td>
                    </tr>
                  ))}
                  {openInvWk != null && forecast[openInvWk] && (
                    <tr>
                      <td colSpan={14} style={{ background: '#f4faf6', padding: '10px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Invoices due in {forecast[openInvWk].wk}</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                          <thead><tr style={{ color: '#888' }}>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Customer</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Invoice</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Project</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Date used</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px' }}>Invoice value</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px' }}>Still due</th>
                          </tr></thead>
                          <tbody>
                            {(forecast[openInvWk].invDetail || []).map((x, k) => (
                              <tr key={k} style={{ borderTop: '1px solid #e8f0ea' }}>
                                <td style={{ padding: '3px 6px' }}>{x.name}</td>
                                <td style={{ padding: '3px 6px', color: '#777' }}>{x.ref || '-'}</td>
                                <td style={{ padding: '3px 6px', color: '#777' }}>{x.project || '-'}</td>
                                {/* Whether this is a date you set or Xero's due date - the
                                    difference matters when a week looks optimistic. */}
                                <td style={{ padding: '3px 6px', color: x.expected ? '#0f766e' : '#999' }}>
                                  {x.due ? fmtDMY(x.due) : '-'}{x.expected ? ' (expected)' : ' (due date)'}
                                  {/* On the arrears row every date has passed, so say how
                                      long by - "12/06 (due date)" does not convey that it
                                      is eleven weeks late. */}
                                  {x.pending && (
                                    <div style={{ fontSize: 9.5, color: '#7c3aed', fontWeight: 700 }}>certified, invoice not yet in Xero</div>
                                  )}
                                  {!x.pending && x.due && x.due < todayISO && (
                                    <div style={{ fontSize: 9.5, color: '#dc2626', fontWeight: 700 }}>
                                      {Math.round((Date.parse(todayISO) - Date.parse(x.due)) / 86400000)} days overdue
                                    </div>
                                  )}
                                  {x.offset ? <div style={{ fontSize: 9.5, color: '#b45309' }}>+{x.offset}d - this customer pays late</div> : null}
                                </td>
                                {/* Amber where part of it has already been paid - the two
                                    figures differing is the only sign of that. */}
                                <td style={{ padding: '3px 6px', textAlign: 'right', color: (x.total && Math.abs(x.total - x.amount) > 0.5) ? '#b45309' : '#777' }}>
                                  {x.total ? gbp(x.total) : '-'}
                                  {x.total && Math.abs(x.total - x.amount) > 0.5
                                    ? <div style={{ fontSize: 9.5 }}>{gbp(x.total - x.amount)} already paid</div> : null}
                                </td>
                                <td style={{ padding: '3px 6px', textAlign: 'right', color: '#0f766e' }}>{gbp(x.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot><tr style={{ borderTop: '1px solid #cfe3d6', fontWeight: 700 }}>
                            <td style={{ padding: '3px 6px' }}>Total ({(forecast[openInvWk].invDetail || []).length})</td>
                            <td colSpan={3}></td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: '#777' }}>{gbp((forecast[openInvWk].invDetail || []).reduce((a, x) => a + (x.total || 0), 0))}</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: '#0f766e' }}>{gbp(forecast[openInvWk].invoicesIn)}</td>
                          </tr></tfoot>
                        </table>
                        <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 6 }}>
                          &quot;(due date)&quot; means Xero&apos;s date is being used because no expected date has been set. Set one in the Invoices owed table below and it moves to the week you actually expect it.
                        </div>
                      </td>
                    </tr>
                  )}

                  {openFinWk != null && forecast[openFinWk] && (
                    <tr>
                      <td colSpan={14} style={{ background: '#fdf6f0', padding: '10px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Financing &amp; tax in {forecast[openFinWk].wk}</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                          <thead><tr style={{ color: '#888' }}>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Item</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Type</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Date</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px' }}>Amount</th>
                          </tr></thead>
                          <tbody>
                            {(forecast[openFinWk].commDetail || []).map((x, k) => (
                              <tr key={k} style={{ borderTop: '1px solid #f4e9e0' }}>
                                {/* Balance sheet items use `label`, commitments use `name` -
                                    two shapes in one column, so both are read. */}
                                <td style={{ padding: '3px 6px' }}>{x.label || x.name || '(unnamed)'}</td>
                                {/* Balance sheet items reduce a liability; commitments are
                                    operating spend. Different things in one column. */}
                                <td style={{ padding: '3px 6px', color: x.kind === 'bs' ? '#7c3aed' : '#8a857c' }}>
                                  {x.kind === 'bs' ? 'liability repayment' : 'recurring commitment'}
                                </td>
                                <td style={{ padding: '3px 6px', color: '#999' }}>{x.date ? fmtDMY(x.date) : '-'}</td>
                                <td style={{ padding: '3px 6px', textAlign: 'right', color: '#dc2626' }}>{gbp(-x.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot><tr style={{ borderTop: '1px solid #eddcd0', fontWeight: 700 }}>
                            <td colSpan={3} style={{ padding: '3px 6px' }}>Total ({(forecast[openFinWk].commDetail || []).length})</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: '#dc2626' }}>{gbp(-forecast[openFinWk].commitments)}</td>
                          </tr></tfoot>
                        </table>
                        <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 6 }}>
                          Set up on the Balance Sheet tab. A liability repayment reduces what you owe and never touches the P&amp;L; a recurring commitment is ordinary spend.
                        </div>
                      </td>
                    </tr>
                  )}

                  {openMatWk != null && forecast[openMatWk] && (
                    <tr>
                      <td colSpan={14} style={{ background: '#faf7fd', padding: '10px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Materials in {forecast[openMatWk].wk}</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                          <thead><tr style={{ color: '#888' }}>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Project</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Delivered</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Pays</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px' }}>Amount</th>
                          </tr></thead>
                          <tbody>
                            {(forecast[openMatWk].fcBreak || []).flatMap(b => (b.matLines || [])).sort((a, b) => b.amount - a.amount).map((x, k) => (
                              <tr key={k} style={{ borderTop: '1px solid #efe9f6' }}>
                                <td style={{ padding: '3px 6px' }}>{x.project}</td>
                                {/* Delivery is the P&L date, payment the cash date - the two
                                    are weeks apart and the column only ever showed one. */}
                                <td style={{ padding: '3px 6px', color: '#999' }}>{x.deliver ? fmtDMY(x.deliver) : '-'}</td>
                                <td style={{ padding: '3px 6px', color: '#999' }}>
                                  {x.date ? fmtDMY(x.date) : '-'}{x.est ? <span style={{ color: '#b45309', fontSize: 9.5 }}> est</span> : null}
                                </td>
                                <td style={{ padding: '3px 6px', textAlign: 'right', color: '#dc2626' }}>{gbp(-x.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot><tr style={{ borderTop: '1px solid #e6dcf2', fontWeight: 700 }}>
                            <td colSpan={3} style={{ padding: '3px 6px' }}>Total</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: '#dc2626' }}>{gbp(-forecast[openMatWk].projMatOut)}</td>
                          </tr></tfoot>
                        </table>
                        <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 6 }}>
                          Delivered is when the cost is INCURRED - that is the date the P&amp;L and the application use. Pays is delivery plus that supplier&apos;s terms, which is what this column schedules. &quot;est&quot; means the payment date was assumed because the line carried no term.
                        </div>
                      </td>
                    </tr>
                  )}

                  {openCisWk != null && forecast[openCisWk] && (
                    <tr>
                      <td colSpan={14} style={{ background: '#fef6f2', padding: '10px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>CIS to HMRC in {forecast[openCisWk].wk}</div>
                        {/* The two bases are the thing to understand here, so they are
                            named on every line rather than explained once at the bottom. */}
                        <div style={{ fontSize: 10.5, color: '#8a857c', marginBottom: 6 }}>
                          Paid on the 22nd of the month after the labour is paid. A Xero bill is already NET of CIS, so its deduction is value x 20/80. Forecast labour is GROSS, so its deduction is value x 20% - and that same 20% is what has been taken OFF the Labour out column.
                        </div>
                        {(forecast[openCisWk].cisDetail || []).map((c, ci) => (
                          <div key={ci} style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#9a3412' }}>Labour paid in {monthName(c.mk)} &rarr; HMRC {fmtDMY(c.date)}</div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                              <thead><tr style={{ color: '#888' }}>
                                <th style={{ textAlign: 'left', padding: '3px 6px' }}>Supplier / project</th>
                                <th style={{ textAlign: 'left', padding: '3px 6px' }}>Basis</th>
                                <th style={{ textAlign: 'right', padding: '3px 6px' }}>Labour value</th>
                                <th style={{ textAlign: 'right', padding: '3px 6px' }}>CIS</th>
                              </tr></thead>
                              <tbody>
                                {(c.lines || []).map((l, k) => (
                                  <tr key={k} style={{ borderTop: '1px solid #f6e6dc' }}>
                                    <td style={{ padding: '3px 6px' }}>{l.who}{l.project ? <span style={{ color: '#999' }}> &middot; {l.project}</span> : null}</td>
                                    <td style={{ padding: '3px 6px', color: l.basis.startsWith('forecast') ? '#b45309' : '#777' }}>{l.basis}</td>
                                    <td style={{ padding: '3px 6px', textAlign: 'right', color: '#777' }}>{gbp(l.base)}</td>
                                    <td style={{ padding: '3px 6px', textAlign: 'right', color: '#dc2626' }}>{gbp(-l.cis)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot><tr style={{ borderTop: '1px solid #eddcd0', fontWeight: 700 }}>
                                <td colSpan={3} style={{ padding: '3px 6px' }}>Paid {fmtDMY(c.date)}</td>
                                <td style={{ padding: '3px 6px', textAlign: 'right', color: '#dc2626' }}>{gbp(-c.amount)}</td>
                              </tr></tfoot>
                            </table>
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}

                  {openVatWk != null && forecast[openVatWk] && (
                    <tr>
                      <td colSpan={14} style={{ background: '#f4faf6', padding: '10px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>VAT in {forecast[openVatWk].wk}</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                          <thead><tr style={{ color: '#888' }}>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>VAT month</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Where it came from</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px' }}>Amount</th>
                          </tr></thead>
                          <tbody>
                            {(forecast[openVatWk].vatSrcs || []).map((x, k) => (
                              <tr key={k} style={{ borderTop: '1px solid #e8f0ea' }}>
                                <td style={{ padding: '3px 6px' }}>{monthName(x.mk)}</td>
                                <td style={{ padding: '3px 6px', color: x.src === 'filed' ? '#16a34a' : '#b45309' }}>
                                  {x.src === 'filed' ? 'Filed return - Box 5 as submitted'
                                    : x.src === 'reclaim' ? `Estimated reclaim: forecast materials and bills that month x ${finance.vatRate}/${100 + Number(finance.vatRate || 0)}`
                                    : 'Current VAT estimate'}
                                </td>
                                <td style={{ padding: '3px 6px', textAlign: 'right', color: x.amount < 0 ? '#dc2626' : '#0f766e' }}>{gbp(x.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 6 }}>
                          VAT lands on the last day of the month it relates to. A FILED return is fact; anything else is an estimate and is marked &quot;est&quot; on the column. The reclaim estimate exists because most of your sales are reverse charge and carry no output VAT, while materials and overheads carry input VAT - so the position is a persistent refund.
                        </div>
                      </td>
                    </tr>
                  )}

                  {openBillWk != null && forecast[openBillWk] && (
                    <tr>
                      <td colSpan={14} style={{ background: '#fdf7f2', padding: '10px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Bills due in {forecast[openBillWk].wk}</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                          <thead><tr style={{ color: '#888' }}>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Supplier</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Project</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Reference</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Date used</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px' }}>Bill value</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px' }}>Still due</th>
                          </tr></thead>
                          <tbody>
                            {(forecast[openBillWk].billDetail || []).map((x, k) => (
                              <tr key={k} style={{ borderTop: '1px solid #f2e8e0' }}>
                                <td style={{ padding: '3px 6px' }}>{x.name}{x.cis ? <span style={{ color: '#ea580c', fontSize: 9.5, fontWeight: 700 }}> CIS</span> : null}</td>
                                <td style={{ padding: '3px 6px', color: '#777' }}>{x.project || '-'}</td>
                                <td style={{ padding: '3px 6px', color: '#777' }}>{x.ref || '-'}</td>
                                <td style={{ padding: '3px 6px', color: x.basis === 'planned' ? '#0f766e' : '#999' }}>
                                  {x.date ? fmtDMY(x.date) : '-'} ({x.basis})
                                </td>
                                <td style={{ padding: '3px 6px', textAlign: 'right', color: (x.total && Math.abs(x.total - x.amount) > 0.5) ? '#b45309' : '#777' }}>
                                  {x.total ? gbp(x.total) : '-'}
                                  {x.total && Math.abs(x.total - x.amount) > 0.5
                                    ? <div style={{ fontSize: 9.5 }}>{gbp(x.total - x.amount)} already paid</div> : null}
                                </td>
                                <td style={{ padding: '3px 6px', textAlign: 'right', color: '#dc2626' }}>{gbp(-x.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot><tr style={{ borderTop: '1px solid #eddcd0', fontWeight: 700 }}>
                            <td style={{ padding: '3px 6px' }}>Total ({(forecast[openBillWk].billDetail || []).length})</td>
                            <td colSpan={3}></td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: '#777' }}>{gbp((forecast[openBillWk].billDetail || []).reduce((a, x) => a + (x.total || 0), 0))}</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: '#dc2626' }}>{gbp(-forecast[openBillWk].bills)}</td>
                          </tr></tfoot>
                        </table>
                        <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 6 }}>
                          &quot;(due date)&quot; means Xero&apos;s date is being used because no planned payment date has been set - it assumes you pay exactly on terms. Set one in the Bills to pay table below to move it to the week you intend. CIS marks a bill carrying a deduction; the 20% goes out separately in the CIS to HMRC column.
                        </div>
                      </td>
                    </tr>
                  )}

                  {openArrears && forecast[0] && forecast[0].arrears && (
                    <tr>
                      <td colSpan={14} style={{ background: '#fffbeb', padding: '10px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: '#92400e' }}>What is in the overdue row</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                          <thead><tr style={{ color: '#888' }}>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Supplier / project</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Reference</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Was due</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px' }}>Amount</th>
                          </tr></thead>
                          <tbody>
                            {(forecast[0].arrBillList || []).map((b, i) => (
                              <tr key={'b' + i} style={{ borderTop: '1px solid #f5eddd' }}>
                                <td style={{ padding: '3px 6px' }}>{b.name}{b.project ? <span style={{ color: '#999' }}> &middot; {b.project}</span> : null}</td>
                                <td style={{ padding: '3px 6px', color: '#999' }}>{b.ref || '-'}</td>
                                <td style={{ padding: '3px 6px', color: '#b45309' }}>{b.due ? fmtDMY(b.due) : '-'}</td>
                                <td style={{ padding: '3px 6px', textAlign: 'right', color: '#dc2626' }}>{gbp(-b.amount)}</td>
                              </tr>
                            ))}
                            {(forecast[0].awaitingList || []).map((x, i) => (
                              <tr key={'a' + i} style={{ borderTop: '1px solid #f5eddd', background: '#faf5ff' }}>
                                <td style={{ padding: '3px 6px' }}>{x.name}</td>
                                <td style={{ padding: '3px 6px', color: '#7c3aed' }}>certified, awaiting invoice</td>
                                <td style={{ padding: '3px 6px', color: '#999' }}>to {x.upTo ? fmtDMY(x.upTo) : '-'}</td>
                                <td style={{ padding: '3px 6px', textAlign: 'right', color: '#7c3aed' }}>{gbp(-x.amount)}</td>
                              </tr>
                            ))}
                            {(forecast[0].arrInvList || []).length > 0 && (forecast[0].arrInvList || []).map((x, i) => (
                              <tr key={'i' + i} style={{ borderTop: '1px solid #f5eddd', background: '#f4faf6' }}>
                                <td style={{ padding: '3px 6px' }}>{x.name}{x.project ? <span style={{ color: '#999' }}> &middot; {x.project}</span> : null}</td>
                                <td style={{ padding: '3px 6px', color: '#999' }}>{x.ref || '-'} (owed to us)</td>
                                <td style={{ padding: '3px 6px', color: '#b45309' }}>{x.due ? fmtDMY(x.due) : '-'}</td>
                                <td style={{ padding: '3px 6px', textAlign: 'right', color: '#0f766e' }}>{gbp(x.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 6 }}>
                          Everything past its date, swept into week 1. Red is owed by you, green is owed to you, purple is cost certified on a project whose invoice has not arrived. Set a date in the tables below and the item moves to the week you expect it.
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* WHICH PROJECTS make up the week's forecast sales, with the cost
                      beside each. A project showing sales and no labour or materials has
                      no cost schedule against it - that is the thing to look for. */}
                  {openFcWk != null && forecast[openFcWk] && (
                    <tr>
                      <td colSpan={14} style={{ background: '#f7faf9', padding: '10px 14px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Project forecasts in {forecast[openFcWk].wk}</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                          <thead><tr style={{ color: '#888' }}>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Project</th>
                            <th style={{ textAlign: 'left', padding: '3px 6px' }}>Period</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px' }}>Sales</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px' }}>Materials</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px' }}>Labour</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px' }}>Cost %</th>
                          </tr></thead>
                          <tbody>
                            {(forecast[openFcWk].fcBreak || []).map((b, k) => {
                              const cost = (b.mat || 0) + (b.labour || 0)
                              const pc = b.sales > 0 ? (cost / b.sales) * 100 : null
                              return (
                                <tr key={k} style={{ borderTop: '1px solid #eee' }}>
                                  <td style={{ padding: '3px 6px' }}>{b.name || b.no || '(unnamed)'}</td>
                                  <td style={{ padding: '3px 6px', color: '#999' }}>{b.from ? `${fmtDMY(b.from)} - ${fmtDMY(b.to)}` : '-'}</td>
                                  <td style={{ padding: '3px 6px', textAlign: 'right', color: '#0f766e' }}>
                                    {b.sales ? gbp(b.sales) : '-'}
                                    {b.carry ? <div style={{ fontSize: 9.5, color: b.carry > 0 ? '#b45309' : '#16a34a' }}>
                                      {b.carry > 0 ? `incl ${gbp(b.carry)} carried forward` : `less ${gbp(-b.carry)} certified ahead`}
                                    </div> : null}
                                  </td>
                                  <td style={{ padding: '3px 6px', textAlign: 'right', color: b.mat ? '#dc2626' : '#c00' }}
                                    title={b.matEstimated ? 'Legacy forecast - only a delivery date was saved, so the payment date is estimated from the "legacy materials" setting rather than the line\u2019s own term.' : ''}>
                                    {b.mat ? gbp(-b.mat) : 'none'}{b.matEstimated ? <span style={{ color: '#b45309', fontSize: 9 }}> est</span> : null}</td>
                                  <td style={{ padding: '3px 6px', textAlign: 'right', color: b.labour ? '#dc2626' : '#c00' }}>{b.labour ? gbp(-b.labour) : 'none'}</td>
                                  <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 700, color: pc == null ? '#999' : pc < 50 ? '#dc2626' : '#16a34a' }}>{pc == null ? '-' : `${pc.toFixed(0)}%`}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                        <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 6 }}>
                          Cost % is materials plus labour over sales. A roofing period should run 75-85%. Anything far below that, or showing &quot;none&quot;, has no cost scheduled against it in the Commercial forecast - so the cash flow counts the income and not the spend.
                        </div>
                      </td>
                    </tr>
                  )}

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
                    const tProjSales = sum('projSalesIn')
                    const tProjMat = sum('projMatOut')
                    const tProjLab = sum('projLabourOut')
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
                        <td style={{ ...td, color: '#0f766e' }}>{tProjSales ? gbp(tProjSales) : '-'}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{tProjMat ? gbp(-tProjMat) : '-'}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{tProjLab ? gbp(-tProjLab) : '-'}</td>
                        <td style={{ ...td, color: tNet < 0 ? '#dc2626' : '#16a34a' }}>{gbp(tNet)}</td>
                        <td style={{ ...td }}></td>
                      </tr>
                    )
                  })()}
                </tfoot>
              </table>
            </div>

            {/* FORECASTS WITH NO VALUATION DATE.
                appDate is written on SAVE, so a forecast saved before the project was
                switched to application dates has none - and the boundary silently falls
                back to the period END, which can be weeks out. You cannot tell by looking
                at the forecast, so the page has to say. */}
            {(() => {
              const noVal = (data.projForecasts || []).filter(fc =>
                !(fc.salesSchedule || []).some(x => x.appDate))
              if (!noVal.length) return null
              return (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderLeft: '4px solid #dc2626', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#b91c1c' }}>
                  <strong>{noVal.length} forecast{noVal.length === 1 ? '' : 's'} have no valuation date - open each one and press Save.</strong>
                  <div style={{ marginTop: 4, color: '#7f1d1d' }}>
                    {[...new Set(noVal.map(f => projLabel(f)))].slice(0, 8).join(', ')}
                    {noVal.length > 8 ? ' and more' : ''}
                  </div>
                  <div style={{ marginTop: 5, fontSize: 11, color: '#991b1b' }}>
                    The valuation date is written when a forecast is SAVED. These were saved before the project was switched to application
                    dates, so sales and costs are being cut off at the PERIOD END instead - which can be weeks later, and puts the money in
                    the wrong period. Nothing needs re-entering: open the forecast and press Save, and it picks up the project&apos;s own
                    application calendar.
                  </div>
                </div>
              )
            })()}

            {/* WHY A FORECAST IS NOT SHOWING.
                Three gates can drop one and all of them were silent, so a forecast you
                had just saved could vanish with nothing to say why. */}
            {(() => {
              const all = data.projForecasts || []
              const shown = new Set()
              for (const r of forecast) for (const b of (r.fcBreak || [])) shown.add(b.name)
              const hidden = []
              for (const fc of all) {
                const nm = projLabel(fc)
                if (shown.has(nm)) continue
                // ONLY GENUINE FAULTS.
                //
                // This used to list every forecast that was not in the figures, including
                // the three that are simply normal: already applied for, period ended, and
                // cash falling outside the window. Those are the model working, and
                // putting them in an amber box made routine timing look like a problem.
                //
                // What remains is the two that are actually wrong - a forecast with no
                // accrual data means the API is not deployed, and one with no sales
                // schedule will never contribute anything to anything.
                let why = ''
                if (!fc.accrual) why = 'no accrual data - the API file in this package has not been deployed'
                else if (!(fc.salesSchedule || []).length && ((Number(fc.revenueThisPeriod) || 0) > 0)) why = 'has revenue but no sales schedule - it can never land in a week'
                // `continue`, not `return` - this is a for...of inside an IIFE, so a
                // return would abandon the whole loop and silently drop every forecast
                // after the first normal one.
                else continue
                hidden.push({ nm, why, to: fc.to })
              }
              if (!hidden.length) return null
              return (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#92400e' }}>
                  <strong>{hidden.length} forecast{hidden.length === 1 ? '' : 's'} cannot contribute anything - this needs fixing.</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {hidden.slice(0, 8).map((h, i) => <li key={i} style={{ marginBottom: 2 }}>{h.nm} - {h.why}</li>)}
                  </ul>
                  {hidden.length > 8 && <div style={{ marginTop: 4 }}>and {hidden.length - 8} more.</div>}
                </div>
              )
            })()}

            {/* PROJECT CASH FLOWS - what the Project sales / Materials / Labour columns
                are made of, across the whole 13 weeks rather than one week at a time.
                Built from the same forecast rows, so it always agrees with the table
                above. */}
            {(() => {
              const byProj = {}
              for (const r of forecast) {
                for (const b of (r.fcBreak || [])) {
                  const k = b.name || b.no || '(unnamed)'
                  const e = byProj[k] || (byProj[k] = { name: k, sales: 0, labour: 0, mat: 0, weeks: 0, months: {} })
                  e.sales += b.sales || 0; e.labour += b.labour || 0; e.mat += b.mat || 0
                  if ((b.sales || 0) || (b.labour || 0) || (b.mat || 0)) e.weeks += 1
                  // Kept by month so each project can be opened up without another pass.
                  const mk = b.month || (r.weekStart || '').slice(0, 7)
                  if (mk) {
                    const m = e.months[mk] || (e.months[mk] = { sales: 0, labour: 0, mat: 0 })
                    m.sales += b.sales || 0; m.labour += b.labour || 0; m.mat += b.mat || 0
                  }
                }
              }
              const list = Object.values(byProj).sort((a, b) => b.sales - a.sales)
              if (!list.length) return null
              const t = list.reduce((a, x) => ({ sales: a.sales + x.sales, labour: a.labour + x.labour, mat: a.mat + x.mat }), { sales: 0, labour: 0, mat: 0 })
              return (
                <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 2 }}>Project cash flows in these 13 weeks</div>
                  <div style={{ fontSize: 11.5, color: '#8a857c', marginBottom: 10 }}>
                    From the Commercial project forecasts, net of any real invoice or bill. Cost % is materials plus labour over sales - a roofing period should run 75-85%, and anything far below that has cost missing from its forecast.
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead><tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                      <th style={{ ...th, textAlign: 'left' }}>Project</th>
                      <th style={th}>Weeks</th>
                      <th style={th}>Sales in</th>
                      <th style={th}>Materials out</th>
                      <th style={th}>Labour out</th>
                      <th style={th}>Net</th>
                      <th style={th}>Cost %</th>
                    </tr></thead>
                    <tbody>
                      {list.map((x, i) => {
                        const cost = x.mat + x.labour
                        const pc = x.sales > 0 ? (cost / x.sales) * 100 : null
                        return (
                          <Fragment key={i}>
                          <tr onClick={() => setOpenProj(openProj === x.name ? null : x.name)}
                            title="Click to see it month by month"
                            style={{ borderBottom: '1px solid #f2f0ec', cursor: 'pointer', background: openProj === x.name ? '#f7faf9' : 'transparent' }}>
                            <td style={{ ...td, textAlign: 'left' }}>
                              <span style={{ fontSize: openProj === x.name ? 12 : 9, fontWeight: openProj === x.name ? 700 : 400,
                                color: openProj === x.name ? '#1a1a19' : '#bbb', marginRight: 4 }}>{openProj === x.name ? '\u25BC' : '\u25B6'}</span>
                              {x.name}
                            </td>
                            <td style={{ ...td, color: '#999' }}>{x.weeks}</td>
                            <td style={{ ...td, color: '#0f766e' }}>{x.sales ? gbp(x.sales) : '-'}</td>
                            <td style={{ ...td, color: x.mat ? '#dc2626' : '#c00' }}>{x.mat ? gbp(-x.mat) : 'none'}</td>
                            <td style={{ ...td, color: x.labour ? '#dc2626' : '#c00' }}>{x.labour ? gbp(-x.labour) : 'none'}</td>
                            <td style={{ ...td, fontWeight: 600, color: (x.sales - cost) < 0 ? '#dc2626' : INK }}>{gbp(x.sales - cost)}</td>
                            <td style={{ ...td, fontWeight: 700, color: pc == null ? '#999' : pc < 50 ? '#dc2626' : '#16a34a' }}>{pc == null ? '-' : `${pc.toFixed(0)}%`}</td>
                          </tr>
                          {openProj === x.name && Object.keys(x.months).sort().map(mk => {
                            const m = x.months[mk]
                            const c = m.mat + m.labour
                            const mp = m.sales > 0 ? (c / m.sales) * 100 : null
                            return (
                              <tr key={`${i}-${mk}`} style={{ background: '#fbfdfc', borderBottom: '1px solid #f5f4f1' }}>
                                <td style={{ ...td, textAlign: 'left', paddingLeft: 26, color: '#5b7085' }}>{monthName(mk)}</td>
                                <td style={td}></td>
                                <td style={{ ...td, color: '#0f766e' }}>{m.sales ? gbp(m.sales) : '-'}</td>
                                <td style={{ ...td, color: m.mat ? '#dc2626' : '#ccc' }}>{m.mat ? gbp(-m.mat) : '-'}</td>
                                <td style={{ ...td, color: m.labour ? '#dc2626' : '#ccc' }}>{m.labour ? gbp(-m.labour) : '-'}</td>
                                <td style={{ ...td, color: (m.sales - c) < 0 ? '#dc2626' : '#555' }}>{gbp(m.sales - c)}</td>
                                <td style={{ ...td, color: mp == null ? '#ccc' : mp < 50 ? '#dc2626' : '#16a34a' }}>{mp == null ? '-' : `${mp.toFixed(0)}%`}</td>
                              </tr>
                            )
                          })}
                          </Fragment>
                        )
                      })}
                    </tbody>
                    <tfoot><tr style={{ borderTop: '2px solid #ddd', background: '#faf9f7', fontWeight: 700 }}>
                      <td style={{ ...td, textAlign: 'left' }}>Total ({list.length})</td>
                      <td style={td}></td>
                      <td style={{ ...td, color: '#0f766e' }}>{gbp(t.sales)}</td>
                      <td style={{ ...td, color: '#dc2626' }}>{gbp(-t.mat)}</td>
                      <td style={{ ...td, color: '#dc2626' }}>{gbp(-t.labour)}</td>
                      <td style={td}>{gbp(t.sales - t.mat - t.labour)}</td>
                      <td style={td}>{t.sales > 0 ? `${(((t.mat + t.labour) / t.sales) * 100).toFixed(0)}%` : '-'}</td>
                    </tr></tfoot>
                  </table>
                </div>
              )
            })()}

            {/* CUSTOMER PAYMENT BEHAVIOUR - everyone you are owed money by, in one place.
                Invoices, retention and forecast sales, with what the data says about how
                they pay and what the forecast is using. */}
            {(() => {
              const perf = data.custPerf || {}
              const by = {}
              const add = (name, k, v) => {
                if (!name || !v) return
                const e = by[name] || (by[name] = { name, invoices: 0, retention: 0, forecast: 0 })
                e[k] += v
              }
              for (const i of (data.receivables || [])) if (!excluded[invKey(i)]) add(i.contact, 'invoices', i.amountDue || 0)
              for (const r of retEvents) add(r.customer || r.name, 'retention', r.amount || 0)
              for (const fc of (data.projForecasts || [])) {
                const fut = (fc.salesSchedule || []).filter(x => x.date && x.date >= todayISO).reduce((a, x) => a + (x.amount || 0), 0)
                add(fc.customer || fc.projectName, 'forecast', fut)
              }
              const list = Object.values(by)
                .map(x => ({ ...x, total: x.invoices + x.retention + x.forecast, perf: perf[x.name] || null }))
                .filter(x => x.total > 0.5).sort((a, b) => b.total - a.total)
              if (!list.length) return null
              const usingPerf = finance.usePaymentPerf === true
              return (
                <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>Customer payment behaviour</div>
                    <div style={{ fontSize: 12, color: usingPerf ? '#b45309' : '#8a857c' }}>
                      {usingPerf
                        ? <>Forecast is using <strong>measured behaviour</strong> - switch to due dates in Facilities above</>
                        : <>Forecast is using <strong>invoice due dates</strong> - tick &quot;Use payment performance&quot; in Facilities above to apply these</>}
                      {offsetMsg && <span style={{ marginLeft: 8, fontWeight: 700, color: offsetMsg === 'saved' ? '#16a34a' : offsetMsg === 'saving' ? '#b45309' : '#dc2626' }}>{offsetMsg}</span>}
                    </div>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 8 }}>
                    <thead><tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                      <th style={{ ...th, textAlign: 'left' }}>Customer</th>
                      <th style={th}>Invoices</th>
                      <th style={th}>Retention</th>
                      <th style={th}>Forecast sales</th>
                      <th style={th}>Total owed</th>
                      <th style={th} title="Median days beyond the due date, measured from paid invoices on the Payment Perf tab.">Measured</th>
                      <th style={th} title="Spread between their fastest and slowest payment. A wide spread means the median is not much of a guide.">Spread</th>
                      <th style={th} title="Days the forecast shifts this customer by. Blank uses the measured figure; type to override it.">Days used</th>
                    </tr></thead>
                    <tbody>
                      {list.map((x, i) => {
                        const typed = offsets[x.name]
                        const measured = x.perf ? x.perf.medLate : null
                        const effective = typed != null && typed !== '' ? Number(typed) : (measured || 0)
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #f2f0ec', opacity: usingPerf ? 1 : 0.65 }}>
                            <td style={{ ...td, textAlign: 'left' }}>{x.name}</td>
                            <td style={{ ...td, color: x.invoices ? '#0f766e' : '#ccc' }}>{x.invoices ? gbp(x.invoices) : '-'}</td>
                            <td style={{ ...td, color: x.retention ? '#15803d' : '#ccc' }}>{x.retention ? gbp(x.retention) : '-'}</td>
                            <td style={{ ...td, color: x.forecast ? '#5b7085' : '#ccc' }}>{x.forecast ? gbp(x.forecast) : '-'}</td>
                            <td style={{ ...td, fontWeight: 700 }}>{gbp(x.total)}</td>
                            <td style={{ ...td, color: measured == null ? '#ccc' : measured > 14 ? '#dc2626' : measured > 0 ? '#b45309' : '#16a34a' }}
                              title={x.perf ? `${x.perf.n} paid invoices` : 'No paid invoices on record - read them in on the Payment Perf tab'}>
                              {measured == null ? 'no data' : `${measured}d`}
                            </td>
                            <td style={{ ...td, color: x.perf && x.perf.spread > 45 ? '#dc2626' : '#999' }}>{x.perf ? `${x.perf.spread}d` : '-'}</td>
                            <td style={td}>
                              <input type="number" value={typed == null ? '' : typed} placeholder={measured == null ? '0' : String(measured)}
                                onChange={e => {
                                  const next = { ...offsets }
                                  if (e.target.value === '') delete next[x.name]; else next[x.name] = Number(e.target.value)
                                  saveOffsets(next)
                                }}
                                style={{ width: 74, padding: '3px 6px', textAlign: 'right', fontSize: 12,
                                  border: '1px solid ' + (typed != null ? '#fed7aa' : '#e5e5e5'), borderRadius: 6 }} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 8, lineHeight: 1.45 }}>
                    Blank uses the MEASURED figure; type a number to override it. Shared with the Payment Perf tab - change it in either place.
                    An expected date set by hand on an invoice always wins over both: that is a judgement somebody has already made about a
                    specific invoice, and a customer average should not overrule it.
                    &quot;No data&quot; means no paid invoices on record for that customer, so there is nothing to measure - press Read paid
                    invoices on the Payment Perf tab.
                  </div>
                </div>
              )
            })()}

            {/* INVOICES OWED - mirrors the Invoices Owed page. The expected date posts to
                the SAME endpoint that page uses (invoice:meta), so setting it here shows
                there and vice versa. No syncing to drift. */}
            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 2 }}>Invoices owed</div>
              <div style={{ fontSize: 11.5, color: '#8a857c', marginBottom: 10 }}>
                Expected payment dates are shared with the Invoices Owed page - change one and the other follows. Anything past its due date is paid into week 1 of the forecast until you set a date you actually expect.
              </div>
              <div style={{ maxHeight: 380, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th style={{ ...th, textAlign: 'left' }}>Customer</th>
                      <th style={{ ...th, textAlign: 'left' }}>Invoice</th>
                      <th style={{ ...th, textAlign: 'left' }} title="The reference on the Xero invoice - usually the application or project it relates to.">Reference</th>
                      <th style={th}>Due date</th>
                      <th style={th}>Amount due</th>
                      <th style={{ ...th, textAlign: 'left' }}>Expected payment date</th>
                      <th style={{ ...th, textAlign: 'center' }} title="Untick to leave this invoice out of the forecast - a disputed invoice, or one you do not expect in this window.">In forecast</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.receivables || []).slice().sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).map((r, i) => {
                      const k = invKey(r)
                      const off = !!excluded[k]
                      const eff = r.expectedDate || r.dueDate || ''
                      // Overdue with NO expected date - it lands in week 1 whether or not
                      // that is realistic, so it needs one.
                      const isOverdue = eff && eff < todayISO && !r.expectedDate
                      return (
                        <tr key={k || i} style={{ borderBottom: '1px solid #f2f0ec', background: off ? '#fafafa' : (isOverdue ? '#fffbeb' : 'transparent'), opacity: off ? 0.55 : 1 }}>
                          <td style={{ ...td, textAlign: 'left', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.contact || ''}>{r.contact || '-'}</td>
                          <td style={{ ...td, textAlign: 'left', color: '#777' }}>{r.invoiceNumber || r.number || '-'}</td>
                          {/* Reference was already on the payload, just never shown - it is
                              usually the application or project, which is what makes a row
                              recognisable. */}
                          <td style={{ ...td, textAlign: 'left', color: '#777', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.reference || ''}>{r.reference || '-'}</td>
                          <td style={{ ...td, color: '#666' }}>{r.dueDate ? fmtDMY(r.dueDate) : '-'}</td>
                          <td style={{ ...td, fontWeight: 600 }}>{gbp(r.amountDue)}</td>
                          <td style={{ ...td, textAlign: 'left' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {/* Same treatment - commits on blur so the picker survives
                                  the edit, and a date typed here still writes straight to
                                  invoice:meta, so the Invoices Owed page follows. */}
                              <DateCell
                                value={r.expectedDate || ''}
                                fallback={r.dueDate || ''}
                                title="Expected payment date. Grey means the forecast is using the due date; pick another to override it. Shared with the Invoices Owed page."
                                onCommit={v => setExpectedDate(k, v)}
                                onClear={r.expectedDate ? () => setExpectedDate(k, '') : null}
                              />
                              {isOverdue && (
                                <span title="Past its due date with no expected date, so the forecast collects it in week 1. Set a date you actually expect."
                                  style={{ fontSize: 9.5, fontWeight: 700, color: '#b45309', whiteSpace: 'nowrap', cursor: 'help' }}>OVERDUE - confirm date</span>
                              )}

                            </div>
                          </td>
                          <td style={{ ...td, textAlign: 'center' }}>
                            <input type="checkbox" checked={!off} onChange={e => toggleExcluded(k, !e.target.checked)} />
                          </td>
                        </tr>
                      )
                    })}
                    {(data.receivables || []).length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#aaa' }}>No outstanding invoices.</td></tr>}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #ddd', background: '#faf9f7', fontWeight: 700 }}>
                      <td style={{ ...td, textAlign: 'left' }}>Total ({(data.receivables || []).filter(r => !excluded[invKey(r)]).length} in forecast)</td>
                      <td style={td}></td>
                      <td style={td}></td>
                      {/* Matches the new Reference column. */}
                      <td style={td}></td>
                      <td style={{ ...td, fontWeight: 800 }}>{gbp((data.receivables || []).filter(r => !excluded[invKey(r)]).reduce((a, r) => a + (r.amountDue || 0), 0))}</td>
                      <td style={td}></td>
                      <td style={td}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
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
                          <th style={{ ...th, textAlign: 'center' }} title="Untick to leave this bill out of the forecast entirely - a disputed bill, or one you will not be paying in this window.">In forecast</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bills.map((b, i) => {
                          const overridden = !!(billOverrides[b.id] || b.payDate)
                          // OVERDUE - the planned date is in the past, so this bill is
                          // being paid in week 1 whether or not that is realistic. It
                          // needs a date confirming rather than sitting there.
                          const effDate = billOverrides[b.id] || b.payDate || b.dueDate || ''
                          const isOverdue = effDate && effDate < todayISO && !overridden
                          const off = !!excluded[b.id]
                          return (
                            <tr key={b.id || i} style={{ borderBottom: '1px solid #f2f0ec', background: off ? '#fafafa' : (isOverdue ? '#fffbeb' : 'transparent'), opacity: off ? 0.55 : 1 }}>
                              <td style={{ ...td, textAlign: 'left', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.contact}>{b.contact || '-'}</td>
                              <td style={{ ...td, textAlign: 'left', color: '#777', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.reference || b.number}>{b.reference || b.number || '-'}</td>
                              <td style={{ ...td, color: '#666' }}>{b.dueDate ? new Date(b.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '-'}</td>
                              <td style={{ ...td, fontWeight: 600 }}>{gbp(b.amountDue)}{cisFlags[b.id] && <div style={{ fontSize: 10, color: '#ea580c', fontWeight: 400, lineHeight: 1.35, marginTop: 2 }}>{gbp(b.amountDue * 1.25)} gross =<br />{gbp(b.amountDue)} to sub + {gbp(b.amountDue * 0.25)} CIS</div>}</td>
                              <td style={{ ...td, textAlign: 'center' }}>
                                <input type="checkbox" checked={!!cisFlags[b.id]} onChange={e => setBillCis(b.id, e.target.checked)} title="CIS labour - withhold 20%" />
                              </td>
                              <td style={{ ...td, textAlign: 'left' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {/* Commits on blur, not on every change - the list is
                                      sorted by this date, so committing mid-edit re-sorted
                                      the table, moved the row and shut the picker before a
                                      day had been picked. */}
                                  <DateCell
                                    value={billOverrides[b.id] || b.payDate || ''}
                                    fallback={b.dueDate || ''}
                                    title="Planned payment date. Grey means the forecast is using the due date; pick another to override it. Click away to save - the list re-sorts by this date."
                                    onCommit={v => setBillPayDate(b.id, v)}
                                    onClear={overridden ? () => setBillPayDate(b.id, '') : null}
                                  />
                                  {isOverdue && (
                                    <span title="Past its due date, so it lands in week 1 of the forecast. Set a planned payment date you actually intend to pay on."
                                      style={{ fontSize: 9.5, fontWeight: 700, color: '#b45309', whiteSpace: 'nowrap', cursor: 'help' }}>OVERDUE - confirm date</span>
                                  )}
                                </div>
                              </td>
                              <td style={{ ...td, textAlign: 'center' }}>
                                <input type="checkbox" checked={!off} onChange={e => toggleExcluded(b.id, !e.target.checked)} title={off ? 'Excluded from the forecast' : 'Included in the forecast'} />
                              </td>
                            </tr>
                          )
                        })}
                        {bills.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#aaa' }}>No outstanding bills. Sync Bills to Pay first.</td></tr>}
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
                              {/* Matches the new "In forecast" column. */}
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
