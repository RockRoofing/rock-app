import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, GOLD, gbp, SyncButton } from '../../components/BizNav'

const norm = (s) => String(s || '').toLowerCase()
  .replace(/&/g, 'and')
  .replace(/\b(ltd|limited|plc|llp|uk|co|company|the)\b/g, '')
  .replace(/[^a-z0-9]/g, '')
  .trim()
const monthLabel = (mk) => {
  if (!mk) return '-'
  const [y, m] = String(mk).split('-').map(Number)
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${names[(m || 1) - 1]} ${String(y).slice(2)}`
}

// Parse a Bibby "Limit List" CSV: two-row preamble + blank, then a header starting
// with "Buyer Name". Reads Buyer Name + Approved Amount, summing duplicate buyers.
function parseBibbyCsv(text) {
  const lines = text.split(/\r?\n/)
  const headerIdx = lines.findIndex(l => /^"?buyer name"?,/i.test(l))
  if (headerIdx < 0) return { limits: {}, error: 'Could not find the "Buyer Name" header row.' }
  const header = splitCsvLine(lines[headerIdx]).map(h => h.trim().toLowerCase())
  const iName = header.findIndex(h => h === 'buyer name')
  const iApproved = header.findIndex(h => h === 'approved amount')
  if (iName < 0 || iApproved < 0) return { limits: {}, error: 'CSV missing Buyer Name or Approved Amount column.' }
  const limits = {}
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cells = splitCsvLine(lines[i])
    const name = (cells[iName] || '').trim()
    if (!name) continue
    const approved = parseFloat((cells[iApproved] || '0').replace(/[",]/g, '')) || 0
    limits[name] = (limits[name] || 0) + approved
  }
  return { limits, error: null }
}
function splitCsvLine(line) {
  const out = []; let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ }
    else if (c === ',' && !inQ) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

// Declared ABOVE eligibleFor, which uses it. Safe either way here (the function only
// runs during render, long after the module evaluates) but a const used above its own
// declaration reads like a bug and invites one.
// Module scope, and defined here rather than borrowed - this file has no date formatter
// and reaching for one that lives on another page compiles cleanly then throws on render.
// Date only. This file has fmtDateTime but no fmtD, and fmtD lives on OTHER pages -
// reaching for it here compiles cleanly then throws ReferenceError on render.
// Must match the apiVersion returned by pages/api/business-financials.js.
const EXPECTED_API = 'pkg607'

const fmtD = (iso) => { if (!iso) return '-'; const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${String(y).slice(2)}` }

const fmtDateTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const fmtShort = (n) => `\u00a3${Math.round(Number(n) || 0).toLocaleString('en-GB')}`

// BIBBY ELIGIBILITY for one project, rebuilt on their actual Disapproved Breakdown
// rather than on Holly's summary of the terms. Their three categories, totalling exactly
// the Non-Funded Debt of 145,297.40:
//
//   Contract Funding Disapproval   39,264.32   the caps below
//   Credit Limit exceeded          88,583.46   handled PER CUSTOMER, not here
//   Age disapproval                17,449.62   past-due items
//
// Two corrections their export forced:
//
//   THE DEBT IS THE APPLICATION. Every row reads Document Type: Application, with
//   application references ("Russell Hill-12", "J229-10"). Bibby assign applications.
//   pkg592 switched this to invoices on a wrong steer; it is switched back.
//
//   DISAPPROVAL IS PARTIAL. They flag a SLICE of an application - 7.5% of one, 3.8% of
//   another, 35.8% of a third - never all-or-nothing.
function eligibleFor(project, evidenceApps, settings, debt, invoices) {
  // `debt` is the unpaid INVOICE total - what is actually outstanding. evidenceApps are
  // read only for COMPOSITION, to work out how much of that debt the caps disallow.
  const raw = Number(debt) || 0
  const unpaidApps = evidenceApps || []
  const cv = Number(project.contractValue) || 0
  const reasons = []
  let excess = 0

  // AGE DISAPPROVAL. Applied first and on the item itself, because it disallows the whole
  // application regardless of what it consists of.
  const ageDays = Number(settings.ageDays ?? 90)
  const today = new Date().toISOString().slice(0, 10)
  // Aged on the INVOICE, not the application - the invoice carries the real due date and
  // the real outstanding amount, and it is the invoice that is or is not paid.
  let aged = 0
  for (const inv of (invoices || [])) {
    const due = inv.dueDate || inv.date
    if (!due) continue
    const days = Math.floor((new Date(today) - new Date(due)) / 86400000)
    if (days > ageDays) aged += (inv.amountDue || 0)
  }
  if (aged > 0) { excess += aged; reasons.push(`${fmtShort(aged)} more than ${ageDays} days past due - age disapproval`) }

  if (cv && unpaidApps.length) {
    const last = unpaidApps[unpaidApps.length - 1] || {}
    const mos = Number(last.materialsOnSite) || 0
    const vars = Number(last.variationsToDate) || 0
    const gross = Number(last.grossToDate) || 0
    const mosCapPct = Number(settings.mosCapPct ?? 25)
    const varCapPct = Number(settings.varCapPct ?? 25)
    const ceilPct = Number(settings.certCeilingPct ?? 90)

    const mosCap = cv * (mosCapPct / 100)
    if (mos > mosCap) { const o = mos - mosCap; excess += o; reasons.push(`Materials on site ${fmtShort(mos)} over the ${mosCapPct}% cap - ${fmtShort(o)} not funded`) }

    const varCap = cv * (varCapPct / 100)
    if (vars > varCap) { const o = vars - varCap; excess += o; reasons.push(`Variations ${fmtShort(vars)} over the ${varCapPct}% cap - ${fmtShort(o)} needs written instruction`) }

    // Applied LAST, to the figure already reduced, so money that is both a variation and
    // above the ceiling is not counted twice.
    const ceiling = cv * (ceilPct / 100)
    const grossAfter = Math.max(0, gross - excess)
    if (grossAfter > ceiling) { const o = grossAfter - ceiling; excess += o; reasons.push(`Certified ${fmtShort(grossAfter)} over ${ceilPct}% of contract - ${fmtShort(o)} needs further certification`) }
  }

  // A gross-entered application missing its previously-certified figure is a data fault
  // that would otherwise present its whole account as this period's debt.
  const suspect = unpaidApps.filter(a => a.prevCertBlank)
  const excluded = Math.min(excess, raw)
  return { eligible: Math.max(0, raw - excluded), reasons, excluded, agedExcluded: Math.min(aged, raw), suspectCount: suspect.length }
}

export default function InvoiceFinance() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState({ advanceRate: 60, drawn: 0, facilityCap: 500000, mosCapPct: 25, varCapPct: 25, certCeilingPct: 90, highInvolvement: '', highInvolvementPct: 35, ageDays: 90 })
  const [limits, setLimits] = useState({})            // { customerName: { insuredLimit } }
  const [limitsMeta, setLimitsMeta] = useState(null)  // { importedAt, count, matched, unmatched, fileName }
  const [apiVersion, setApiVersion] = useState(null)
  const [dashEmpty, setDashEmpty] = useState(false)
  const [drawnHistory, setDrawnHistory] = useState([])
  const [drawnDate, setDrawnDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [drawnAmt, setDrawnAmt] = useState('')
  const limitsRef = useRef(limits)
  const limitTimer = useRef(null)
  const [limitSaved, setLimitSaved] = useState({})   // { [customer]: 'saving'|'saved'|'failed' }
  useEffect(() => { limitsRef.current = limits }, [limits])
  const [paidOverrides, setPaidOverrides] = useState({}) // { appId: true/false }
  const [expanded, setExpanded] = useState({})        // { xeroId: true }
  const [saving, setSaving] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const fileRef = useRef(null)

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
      const d = await fetch('/api/business-financials?view=invoice-finance').then(r => r.json())
      setData(d)
      setSettings({
        advanceRate: d.settings?.advanceRate ?? 60,
        drawn: d.settings?.drawn ?? 0,
        facilityCap: d.settings?.facilityCap ?? 500000,
        // Bibby's eligibility caps. Editable rather than hard-coded - they are facility
        // terms and will change at review.
        mosCapPct: d.settings?.mosCapPct ?? 25,
        varCapPct: d.settings?.varCapPct ?? 25,
        certCeilingPct: d.settings?.certCeilingPct ?? 90,
        // '' = follow the calculation. A number is a deliberate override.
        highInvolvement: d.settings?.highInvolvement ?? '',
        highInvolvementPct: d.settings?.highInvolvementPct ?? 35,
        ageDays: d.settings?.ageDays ?? 90,
      })
      setLimits(d.debtorLimits || {})
      setLimitsMeta(d.limitsMeta || null)
      setApiVersion(d.apiVersion || null)
      setDashEmpty(!!d.dashboardCacheEmpty)
      setDrawnHistory(Array.isArray(d.drawnHistory) ? d.drawnHistory : [])
      const po = {}
      for (const p of (d.projects || [])) for (const a of p.applications) if (a.paidOverride != null) po[a.id] = a.paidOverride
      setPaidOverrides(po)
    } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  // Effective paid state = manual override if set, else the auto value from the API.
  const isPaid = (a) => (paidOverrides[a.id] != null ? paidOverrides[a.id] : a.paid)

  // BIBBY ELIGIBILITY, applied per project BEFORE the advance rate.
  //
  // Confirmed with Bibby (Holly), and every one of these is a cap on what counts as
  // approved debt - not on the advance:
  //
  //   1. Materials on site fundable to 25% of contract value.
  //   2. 90% of contract value approved initially - the last 10% needs further
  //      certification as the final account approaches.
  //   3. Variations fundable to 25% of contract value; more needs written instruction.
  //   4. Only up to the customer's insured limit (already handled, per customer).
  //   5. 60% of whatever survives the above.
  //   6. Facility limit - the account can reach GBP 500k before being capped.
  //
  // The caps are measured on the CUMULATIVE position at the latest unpaid application,
  // because "materials to 25% of contract" is a position rather than an increment. The
  // excess is then removed from the unpaid total, so a project already paid up to the
  // caps is not penalised twice.
  // Group projects by customer, compute fundable (unpaid this-cert) and advance.
  const customers = useMemo(() => {
    if (!data?.projects) return []
    const rate = (Number(settings.advanceRate) || 0) / 100
    const byCust = {}
    for (const p of data.projects) {
      const cust = p.customer || '(no customer)'
      if (!byCust[cust]) byCust[cust] = { customer: cust, key: norm(cust), projects: [] }
      // THE DEBT IS THE UNPAID INVOICE. The application is the evidence of what it
      // consists of - which is exactly how you put it, and how Bibby work: they fund
      // applications, and need the application to show what the invoice is made of.
      //
      // I had this on APPLICATIONS in pkg599, reasoning that their export says
      // "Document Type: Application". That produced 1,375,463 of fundable debt against
      // a real figure of about 421,033, because of this in the API:
      //
      //     autoPaid = matchInv ? (amountDue <= 0.005) : null   // null = unmatched
      //     paid     = override != null ? !!override : (autoPaid === true)
      //
      // `null === true` is false, so EVERY application that cannot be matched to an
      // invoice by "App N" counts as unpaid. On any project whose invoice references do
      // not carry that, the entire application history is summed as outstanding.
      //
      // An invoice cannot do that: it has a real amountDue. The invoice basis reconciled
      // to within 2,249 of Bibby's own Sales Ledger; the application basis is out by a
      // factor of three.
      const invs = Array.isArray(p.invoices) ? p.invoices : []
      const retentionInvs = invs.filter(i => i.isRetention)
      const fundingInvs = invs.filter(i => !i.isRetention)
      const retentionDebt = retentionInvs.reduce((s, i) => s + (i.amountDue || 0), 0)
      const invoiceDebt = fundingInvs.reduce((s, i) => s + (i.amountDue || 0), 0)

      // Composition for the caps comes from the applications those invoices point at,
      // falling back to unpaid applications where nothing matched.
      const invAppNos = new Set(fundingInvs.map(i => i.appNumber).filter(n => n != null))
      const unpaid = invAppNos.size
        ? p.applications.filter(a => invAppNos.has(a.appNumber))
        : p.applications.filter(a => !isPaid(a))

      // Applied for but not yet invoiced - not debt, but shown so it does not vanish.
      const notInvoiced = Math.max(0, p.applications.filter(a => !isPaid(a)).reduce((s, a) => s + (a.thisCertNet || 0), 0) - invoiceDebt)

      const elig = eligibleFor(p, unpaid, settings, invoiceDebt, fundingInvs)
      byCust[cust].projects.push({
        ...p, unpaidCount: fundingInvs.length, rawProject: invoiceDebt,
        retentionDebt, retentionCount: retentionInvs.length, notInvoiced,
        ...elig, fundableProject: elig.eligible,
      })
    }
    return Object.values(byCust).map(c => {
      const lim = limits[c.customer] || {}
      const insured = Number(lim.insuredLimit) || 0
      const fundable = c.projects.reduce((s, p) => s + p.fundableProject, 0)
      // CREDIT LIMIT EXCEEDED. Bibby apply the limit to the DEBT and disapprove only the
      // excess - "Credit Limit exceeded 88,583.46" against Torsion, who they still fund
      // up to the limit. This capped the ADVANCE instead, and zeroed a customer entirely
      // when no limit was recorded, which is why the app disapproved 160,832 where Bibby
      // disapproved 88,583.
      const hasLimit = insured > 0
      const overLimitDebt = hasLimit ? Math.max(0, fundable - insured) : fundable
      const insurable = Math.max(0, fundable - overLimitDebt)
      const rawAdvance = fundable * rate
      const advance = insurable * rate
      return { ...c, insured, hasLimit, fundable, insurable, overLimitDebt, rawAdvance, advance, cappedByLimit: hasLimit && overLimitDebt > 0 }
    }).sort((a, b) => b.advance - a.advance || b.fundable - a.fundable)
  }, [data, limits, settings.advanceRate, paidOverrides])

  const totals = useMemo(() => {
    const fundable = customers.reduce((s, c) => s + c.fundable, 0)
    // HIGH INVOLVEMENT - a concentration deduction Bibby take off APPROVED DEBT before
    // HIGH INVOLVEMENT - now CALCULATED, not typed.
    //
    // Their guide, page 12: "your debtors will be funded up to a high involvement
    // percentage of the approved sales ledger". So each debtor is capped at a share of
    // the APPROVED ledger, and anything above that is deducted before the advance rate.
    //
    // Solved from their own figures at 35%:
    //   approved debt 323,029.46 x 35% = 113,060.31 cap per debtor
    //   Wates          148,129.62 - 113,060.31 =  35,069.31   their High Involvement,
    //                                                          to the penny.
    //
    // Everything needed is already here, so it recalculates itself instead of going
    // stale between statements. The override below is for when their view differs.
    const hiPct = Number(settings.highInvolvementPct ?? 35)
    // THE BASE IS THE APPROVED LEDGER - the debt AFTER the caps AND after credit limits.
    //
    // Bibby's Approved Debt is Sales Ledger less Non-Funded Debt, and Non-Funded INCLUDES
    // Credit Limit exceeded. So their "approved sales ledger" is the post-limit figure.
    // Taking the percentage of `fundable` - which is before limits - gives the wrong cap
    // and, on your numbers, almost nothing over it:
    //
    //   base 421,033 (before limits)  cap 147,361.55  Wates over by     768.07
    //   base 323,029 (after limits)   cap 113,060.31  Wates over by  35,069.31   correct
    const approvedLedger = customers.reduce((t, c) => t + (c.insurable != null ? c.insurable : c.fundable), 0)
    const hiCap = approvedLedger * (hiPct / 100)
    const hiCalc = hiPct > 0
      ? customers.reduce((t, c) => t + Math.max(0, (c.insurable != null ? c.insurable : c.fundable) - hiCap), 0)
      : 0
    // BLANK OR ZERO means "use the calculation".
    //
    // Zero has to count as blank, not as a deliberate override. The earlier version of
    // this field saved with `Number(s.highInvolvement) || 0`, so Redis already holds a
    // literal 0 for it - and treating that as an override forces High Involvement to
    // nil and the calculation never runs. Which is exactly what "it doesn't seem to be
    // adding" looks like.
    //
    // Nothing is lost by it: an override of zero and the calculation returning zero give
    // the same answer, and to switch the deduction off deliberately you set the % to 0.
    const hiOverride = settings.highInvolvement
    const hiOverridden = !(hiOverride === '' || hiOverride == null || Number(hiOverride) === 0)
    const highInv = hiOverridden ? (Number(hiOverride) || 0) : hiCalc
    // Who is over, so the figure is traceable rather than a number with nowhere to go.
    const hiWho = hiPct > 0
      ? customers.filter(c => ((c.insurable != null ? c.insurable : c.fundable) - hiCap) > 1)
          .map(c => ({ name: c.customer, debt: (c.insurable != null ? c.insurable : c.fundable), over: (c.insurable != null ? c.insurable : c.fundable) - hiCap }))
      : []
    const grossAdvance = Math.max(0, customers.reduce((s, c) => s + c.advance, 0) - highInv * ((Number(settings.advanceRate) || 0) / 100))
    const cap = Number(settings.facilityCap) || 0
    const totalAdvance = cap > 0 ? Math.min(grossAdvance, cap) : grossAdvance
    const cappedByFacility = cap > 0 && grossAdvance > cap
    // The most recent DATED reading wins. Falls back to the old single `drawn` setting so
    // anything entered before this existed is not lost.
    const latest = drawnHistory.length ? drawnHistory[drawnHistory.length - 1] : null
    const drawn = latest ? (Number(latest.amount) || 0) : (Number(settings.drawn) || 0)
    const drawnAsAt = latest ? latest.date : null
    const availability = totalAdvance - drawn
    const noLimit = customers.filter(c => !c.hasLimit && c.fundable > 0)
    return { fundable, grossAdvance, totalAdvance, cap, cappedByFacility, drawn, drawnAsAt, availability, highInv, hiCalc, hiCap, hiPct, hiWho, hiOverridden, approvedLedger,
      noLimitCount: noLimit.length, noLimitValue: noLimit.reduce((s, c) => s + c.fundable, 0) }
  }, [customers, settings.drawn, settings.facilityCap, settings.highInvolvement, settings.highInvolvementPct, settings.advanceRate, drawnHistory])

  // RECONCILIATION EXPORT, laid out in BIBBY'S OWN ORDER so the two can be read side by
  // side rather than eyeballed. Their Finance Agreement Summary goes:
  //
  //   Sales Ledger - Non-Funded Debt = Approved Debt
  //   (Approved Debt - High Involvement) x rate = Approved Funding
  //   Approved Funding - Funds in Use = Availability
  //
  // Reverse-engineered from their figures and confirmed exactly:
  //   (323,029.46 - 35,069.31) x 60% = 172,776.09
  function exportReconciliation() {
    const rows = []
    // `rate` is scoped inside the customers memo, not here - reading it would be a
    // ReferenceError at click time, which no build catches.
    const rate = (Number(settings.advanceRate) || 0) / 100
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`
    const money = (n) => (Number(n) || 0).toFixed(2)

    const salesLedger = customers.reduce((t, c) => t + c.projects.reduce((s, p) => s + (p.rawProject || 0) + (p.retentionDebt || 0), 0), 0)
    const retention = customers.reduce((t, c) => t + c.projects.reduce((s, p) => s + (p.retentionDebt || 0), 0), 0)
    const capped = customers.reduce((t, c) => t + c.projects.reduce((s, p) => s + (p.excluded || 0), 0), 0)

    // ONE SET OF UNITS. The first version listed "over insured limit" in ADVANCE terms
    // and "no insured limit set" in DEBT terms - the same exclusion twice, since a
    // customer with no limit gets advance 0 and therefore appears in full in the
    // over-limit figure. 160,831.50 of debt and 96,498.90 of advance were the same
    // money, and the summary could not be made to add up.
    //
    // Everything is now in DEBT terms down to Approved Debt, then the rate is applied
    // once, matching how Bibby lay it out.
    const noLimitDebt = customers.filter(c => !c.hasLimit).reduce((t, c) => t + (c.fundable || 0), 0)
    const aged = customers.reduce((t, c) => t + c.projects.reduce((s, p) => s + (p.agedExcluded || 0), 0), 0)
    const overLimitDebt = customers.reduce((t, c) => t + (c.overLimitDebt || 0), 0)

    rows.push(['SUMMARY - compare against Bibby Finance Agreement Summary'])
    rows.push(['Sales Ledger (all unpaid sales invoices incl retention)', money(salesLedger)])
    rows.push(['  less retention invoices', money(retention)])
    rows.push(['  less age disapproval (past due)', money(aged)])
    rows.push(['  less eligibility caps (materials / variations / ceiling)', money(Math.max(0, capped - aged))])
    rows.push(['= Approved Debt (before insured limits)', money(totals.fundable)])
    rows.push(['  less credit limit exceeded (incl customers with no limit set)', money(overLimitDebt)])
    rows.push(['    of which customers with NO limit recorded', money(noLimitDebt)])
    rows.push(['= Approved Debt (Bibby basis - after limits)', money(totals.approvedLedger)])
    rows.push([`High involvement @ ${totals.hiPct}% of approved ledger (cap ${money(totals.hiCap)} per debtor)${totals.hiOverridden ? ' - OVERRIDDEN' : ''}`, money(totals.highInv)])
    for (const w of (totals.hiWho || [])) rows.push([`    ${w.name} - debt ${money(w.debt)}, over by`, money(w.over)])
    rows.push([`Advance rate`, `${settings.advanceRate}%`])
    rows.push(['= Approved Funding', money(totals.grossAdvance)])
    rows.push(['Funds in use / drawn', money(totals.drawn)])
    rows.push(['= Availability', money(totals.availability)])
    rows.push([])
    // Per customer, so a missing insured limit is traceable to a name rather than being
    // a single large number with nowhere to go.
    rows.push(['BY CUSTOMER'])
    rows.push(['Customer', 'Fundable debt', 'Insured limit', 'Limit set?', 'Advance', 'Debt not funded'])
    for (const c of [...customers].sort((a, b) => (b.hasLimit ? 0 : b.fundable) - (a.hasLimit ? 0 : a.fundable) || b.fundable - a.fundable)) {
      rows.push([c.customer, money(c.fundable), money(c.insured), c.hasLimit ? 'yes' : 'NO LIMIT SET', money(c.advance), money(c.overLimitDebt)])
    }
    rows.push([])
    rows.push(['INVOICE DETAIL'])
    rows.push(['Customer', 'Project', 'Invoice', 'Reference', 'Date', 'Amount due', 'Retention?', 'App matched', 'Contract value', 'Project excluded by caps', 'Reasons'])
    for (const c of customers) {
      for (const p of c.projects) {
        for (const inv of (p.invoices || [])) {
          rows.push([
            c.customer, p.name || '', inv.invoiceNumber || '', inv.reference || '', inv.date || '',
            money(inv.amountDue), inv.isRetention ? 'YES' : '', inv.appNumber == null ? 'UNMATCHED' : `App ${inv.appNumber}`,
            money(p.contractValue), money(p.excluded), (p.reasons || []).join(' | '),
          ])
        }
      }
    }
    const csv = rows.map(r => r.map(q).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url; a.download = `if-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  // Limits save on their own - on import, and on leaving a cell. Reads limitsRef rather
  // than the state variable: onBlur can fire in the same tick as the change, and the
  // state closure would still hold the PREVIOUS value.
  // Publish the computed position so the Cash Flow uses THESE figures rather than its
  // own simpler model. Fires whenever the numbers settle, not on a button - the Cash Flow
  // must not depend on somebody remembering to press something here.
  const publishedRef = useRef('')
  useEffect(() => {
    if (!ok || loading) return
    if (!totals || !(totals.totalAdvance > 0 || totals.drawn > 0)) return
    const sig = `${Math.round(totals.totalAdvance)}|${Math.round(totals.drawn)}|${totals.drawnAsAt || ''}`
    if (publishedRef.current === sig) return       // only when something actually moved
    publishedRef.current = sig
    fetch('/api/business-financials', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        view: 'invoice-finance', action: 'publish-position',
        position: {
          totalAdvance: totals.totalAdvance, drawn: totals.drawn, drawnAsAt: totals.drawnAsAt,
          approvedLedger: totals.approvedLedger, highInvolvement: totals.highInv,
        },
      }),
    }).catch(() => {})
  }, [ok, loading, totals])

  async function saveDrawn(remove) {
    const body = remove
      ? { view: 'invoice-finance', action: 'save-drawn', remove }
      : { view: 'invoice-finance', action: 'save-drawn', date: drawnDate, amount: Number(drawnAmt) || 0 }
    if (!remove && !drawnDate) { setImportMsg('Pick the date the balance applies to.'); return }
    try {
      const res = await fetch('/api/business-financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) { setImportMsg(d.error || 'Drawn balance did NOT save.'); return }
      setDrawnHistory(Array.isArray(d.drawnHistory) ? d.drawnHistory : [])
      if (!remove) setDrawnAmt('')
      setImportMsg('')
    } catch { setImportMsg('Drawn balance did NOT save.') }
  }

  async function saveLimitsNow(next) {
    const payload = next || limitsRef.current
    try {
      const res = await fetch('/api/business-financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'invoice-finance', action: 'save-limits', debtorLimits: payload }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) { setImportMsg('Limit did NOT save - check your connection and retype it.'); return false }
      return true
    } catch { setImportMsg('Limit did NOT save - check your connection and retype it.'); return false }
  }

  async function saveAll() {
    setSaving(true)
    try {
      await fetch('/api/business-financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'invoice-finance', action: 'save-settings', settings }) })
      await fetch('/api/business-financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'invoice-finance', action: 'save-limits', debtorLimits: limits }) })
    } catch {}
    setSaving(false)
  }

  function setPaid(appId, paid) {
    setPaidOverrides(prev => ({ ...prev, [appId]: paid }))
    fetch('/api/business-financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'invoice-finance', action: 'save-app-paid', appId, paid }) }).catch(() => {})
  }

  // AUTO-SAVES AS YOU TYPE, debounced.
  //
  // It used to save on BLUR only, so a figure typed and then navigated away from - or
  // committed with Enter - was lost, with nothing on screen either way. The blur handler
  // stays as an immediate flush for when you tab straight out.
  //
  // The map is written whole each time. It is small, and a partial write of one key
  // would race with another person editing a different customer.
  function setLimit(name, value) {
    const next = { ...limits, [name]: { ...(limits[name] || {}), insuredLimit: value } }
    setLimits(next)
    setLimitSaved(s => ({ ...s, [name]: 'saving' }))
    if (limitTimer.current) clearTimeout(limitTimer.current)
    // Passed explicitly rather than read from state or the ref - both would still hold
    // the PREVIOUS value when this fires.
    limitTimer.current = setTimeout(async () => {
      const ok = await saveLimitsNow(next)
      setLimitSaved(s => ({ ...s, [name]: ok ? 'saved' : 'failed' }))
      if (ok) setTimeout(() => setLimitSaved(s => { const c = { ...s }; delete c[name]; return c }), 1800)
    }, 700)
  }

  // SAVES ON UPLOAD. It used to only stage the parsed limits into local state - close
  // the tab, or navigate away, before pressing Save and the entire imported list was
  // gone with nothing to say so. The import is the slow bit; losing it is expensive.
  //
  // Editing and Save still work afterwards, so the review step is not lost - it just no
  // longer gates whether the data survives.
  function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const fileName = file.name || ''
    const reader = new FileReader()
    reader.onload = async () => {
      const { limits: parsed, error } = parseBibbyCsv(String(reader.result))
      if (error) { setImportMsg('Import failed: ' + error); return }
      const custNames = (data?.projects || []).map(p => p.customer).filter(Boolean)
      const byKey = {}
      for (const n of custNames) byKey[norm(n)] = n
      let matched = 0, unmatched = 0
      const next = { ...limits }
      const unmatchedNames = []
      for (const [bibbyName, amount] of Object.entries(parsed)) {
        const cn = byKey[norm(bibbyName)]
        if (cn) { next[cn] = { ...(next[cn] || {}), insuredLimit: amount }; matched++ }
        else { next[bibbyName] = { ...(next[bibbyName] || {}), insuredLimit: amount }; unmatched++; unmatchedNames.push(bibbyName) }
      }
      setLimits(next)
      try {
        const res = await fetch('/api/business-financials', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            view: 'invoice-finance', action: 'save-limits', debtorLimits: next,
            importMeta: { count: Object.keys(parsed).length, matched, unmatched, fileName },
          }),
        })
        const d = await res.json().catch(() => ({}))
        if (d && d.limitsMeta) setLimitsMeta(d.limitsMeta)
        if (!res.ok || d.ok === false) { setImportMsg('Parsed, but SAVING FAILED - press Save to retry.'); return }
      } catch {
        setImportMsg('Parsed, but SAVING FAILED - press Save to retry.'); return
      }
      setImportMsg(`Imported and saved ${Object.keys(parsed).length} limits. ${matched} matched a customer, ${unmatched} did not${unmatchedNames.length ? ': ' + unmatchedNames.slice(0, 6).join(', ') + (unmatchedNames.length > 6 ? '...' : '') : ''}. Review, then Save.`)
    }
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  if (!ok) return null

  return (
    <>
      <Head><title>Invoice Finance - Rock Roofing</title></Head>
      <BizNav />
      <div style={{ maxWidth: '100%', padding: '24px 32px 80px' }}>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <h1 style={{ margin: 0, color: INK, fontSize: 26 }}>Invoice Finance (Bibby) availability</h1>
            <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4 }}>The DEBT is the unpaid sales invoice; the matched application is the evidence of what it consists of, which is what the eligibility caps need. Retention invoices are excluded. Caps: materials on site {settings.mosCapPct}% of contract, variations {settings.varCapPct}%, certified ceiling {settings.certCeilingPct}%. Advance = {settings.advanceRate}% of what survives, capped at the customer&apos;s insured limit, total capped at the facility maximum ({gbp(Number(settings.facilityCap) || 0)}).</div>
          </div>
          <SyncButton endpoint="/api/sync-invoices" label="Sync invoices from Xero" onDone={load}
            buildMsg={(d) => 'Synced - paid status refreshed.'} />
        </div>

        {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : !data ? <div style={{ color: '#b91c1c', padding: 40 }}>Could not load.</div> : (
          <>
            {/* Top figures */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <Box label="Fundable (unpaid this-cert)" value={gbp(totals.fundable)} sub="net of retention, incl. materials" />
              <Box label={`Advance @ ${settings.advanceRate}%`} value={gbp(totals.grossAdvance)} color="#0f766e" sub="capped at insured limits" />
              <Box label="Facility cap" value={gbp(totals.cap)} sub={totals.cappedByFacility ? 'reached - funding capped' : 'headroom available'} color={totals.cappedByFacility ? '#dc2626' : '#888'} />
              <Box label="Currently drawn" value={gbp(totals.drawn)} color="#b45309" />
              <Box label="Availability now" value={gbp(totals.availability)} color={totals.availability < 0 ? '#dc2626' : '#0f766e'} strong sub="funded (capped) minus drawn" />
            </div>

            {totals.noLimitCount > 0 && (
              <div style={{ fontSize: 12.5, color: '#b45309', marginBottom: 14, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>
                {totals.noLimitCount} customer(s) with fundable applications have no insured limit set ({gbp(totals.noLimitValue)} not funded). Set their limit below or import the Bibby list.
              </div>
            )}

            {/* Controls */}
            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', marginBottom: 18, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div><div style={lbl}>Advance rate %</div><input type="number" value={settings.advanceRate} onChange={e => setSettings(s => ({ ...s, advanceRate: e.target.value }))} style={{ ...inp, width: 90 }} /></div>
              <div><div style={lbl}>Facility cap (max funded)</div><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: '#999' }}>&pound;</span><input type="number" value={settings.facilityCap} onChange={e => setSettings(s => ({ ...s, facilityCap: e.target.value }))} style={{ ...inp, width: 130 }} /></div></div>
              {/* DRAWN, DATED. Was a single number you overwrote - which went stale
                  silently, and a figure typed in March looked identical to one typed
                  this morning. Now every reading is kept with the date it applies to and
                  the most recent one is used. */}
              <div>
                <div style={lbl}>Drawn balance (from Bibby statement)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="date" value={drawnDate} onChange={e => setDrawnDate(e.target.value)} style={{ ...inp, width: 132 }} />
                  <span style={{ color: '#999' }}>&pound;</span>
                  {/* Empty rather than a literal 0, so the box can actually be typed into
                      instead of leaving you appending digits after a zero. */}
                  <input type="number" value={drawnAmt} placeholder="0.00" onChange={e => setDrawnAmt(e.target.value)} style={{ ...inp, width: 120 }} />
                  <button onClick={() => saveDrawn()} style={{ background: INK, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Add</button>
                </div>
                {drawnHistory.length > 0 && (
                  <div style={{ marginTop: 4, fontSize: 11, color: '#8a857c' }}>
                    Using {gbp(totals.drawn)} as at {fmtD(totals.drawnAsAt)}
                    {drawnHistory.length > 1 ? ` - ${drawnHistory.length} readings` : ''}
                    <span style={{ marginLeft: 6 }}>
                      {[...drawnHistory].slice(-4).reverse().map(e => (
                        <span key={e.date} title={`Recorded ${e.at ? String(e.at).slice(0, 10) : ''}`} style={{ marginRight: 6, whiteSpace: 'nowrap' }}>
                          {fmtD(e.date)} {gbp(e.amount)}
                          <button onClick={() => saveDrawn(e.date)} title="Remove this reading" style={{ border: 'none', background: 'none', color: '#c66', cursor: 'pointer', padding: '0 2px' }}>&times;</button>
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>
              {/* HIGH INVOLVEMENT. The % is the facility term; the value beside it is
                  calculated from it and only needs typing over when Bibby's view
                  differs. Blank = use the calculation. */}
              <div>
                <div style={lbl} title="Each debtor is funded up to this share of the APPROVED sales ledger; anything above is deducted before the advance rate. Their guide illustrates 50%; yours solves to 35% exactly against their own figures.">High involvement %</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="number" value={settings.highInvolvementPct} onChange={e => setSettings(s => ({ ...s, highInvolvementPct: e.target.value }))} style={{ ...inp, width: 62 }} />
                  <span style={{ color: '#bbb', fontSize: 11 }}>=</span>
                  <input type="number" value={settings.highInvolvement} placeholder={Math.round(totals.hiCalc).toString()}
                    title="Leave blank to use the calculated figure. Type a value only to override it."
                    onChange={e => setSettings(s => ({ ...s, highInvolvement: e.target.value }))}
                    style={{ ...inp, width: 110, borderColor: totals.hiOverridden ? '#b45309' : undefined }} />
                </div>
                <div style={{ fontSize: 10.5, color: totals.hiOverridden ? '#b45309' : '#8a857c', marginTop: 3, maxWidth: 300 }}>
                  {totals.hiOverridden
                    ? `Overridden - calculated is ${gbp(totals.hiCalc)}. Clear the box to go back.`
                    : (totals.hiWho.length
                        ? `${gbp(totals.hiCalc)} - ${totals.hiWho.map(w => `${w.name.split(' ')[0]} over by ${gbp(w.over)}`).join(', ')}. Cap ${gbp(totals.hiCap)} = ${totals.hiPct}% of the ${gbp(totals.approvedLedger)} approved ledger.`
                        : `Nothing over the ${gbp(totals.hiCap)} per-debtor cap (${totals.hiPct}% of the ${gbp(totals.approvedLedger)} approved ledger).`)}
                </div>
              </div>
              <div><div style={lbl} title="Bibby disapprove an application once it is this many days past its due date. Three of theirs were 99, 118 and 153 days past due - confirm the exact threshold in the agreement.">Age disapproval (days)</div><input type="number" value={settings.ageDays} onChange={e => setSettings(s => ({ ...s, ageDays: e.target.value }))} style={{ ...inp, width: 70 }} /></div>
              <div><div style={lbl} title="Approved materials on site are funded up to this share of contract value.">Materials cap %</div><input type="number" value={settings.mosCapPct} onChange={e => setSettings(s => ({ ...s, mosCapPct: e.target.value }))} style={{ ...inp, width: 70 }} /></div>
              <div><div style={lbl} title="Variations are funded up to this share of contract value. Beyond it, Bibby need written instruction.">Variations cap %</div><input type="number" value={settings.varCapPct} onChange={e => setSettings(s => ({ ...s, varCapPct: e.target.value }))} style={{ ...inp, width: 70 }} /></div>
              <div><div style={lbl} title="Bibby approve this share of contract value initially. Going past it needs further certification as the final account approaches.">Certified ceiling %</div><input type="number" value={settings.certCeilingPct} onChange={e => setSettings(s => ({ ...s, certCeilingPct: e.target.value }))} style={{ ...inp, width: 70 }} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="file" accept=".csv" ref={fileRef} onChange={onFile} style={{ display: 'none' }} id="bibbyfile" />
                {/* Compared against ONE constant that the API also returns. The first
                    version hard-coded 'pkg597' on this side and then the API moved on to
                    pkg599 - so it read "OLD" even when correctly deployed, which is worse
                    than having no marker at all. */}
                <span title={apiVersion === EXPECTED_API
                  ? `API ${EXPECTED_API} is live.`
                  : `The API is reporting "${apiVersion || 'nothing'}" but this page expects ${EXPECTED_API}. pages/api/business-financials.js has not been deployed - projects will have no invoice data, so fundable debt reads zero and the table is empty.`}
                  style={{ fontSize: 11, fontWeight: 700, cursor: 'help', whiteSpace: 'nowrap', color: apiVersion === EXPECTED_API ? '#16a34a' : '#dc2626' }}>
                  {apiVersion === EXPECTED_API ? `API ${EXPECTED_API}` : `API ${apiVersion || 'old'} - deploy the API file`}
                </span>
                {limitsMeta && limitsMeta.importedAt && (
                  <span title={`${limitsMeta.count || 0} limits imported${limitsMeta.matched != null ? `, ${limitsMeta.matched} matched a customer, ${limitsMeta.unmatched} did not` : ''}${limitsMeta.fileName ? ` - ${limitsMeta.fileName}` : ''}`}
                    style={{ fontSize: 11, color: '#8a857c', cursor: 'help', whiteSpace: 'nowrap' }}>
                    List imported {fmtDateTime(limitsMeta.importedAt)}
                  </span>
                )}
                <label htmlFor="bibbyfile" style={{ background: GOLD, border: '1px solid ' + GOLD, borderRadius: 8, padding: '8px 14px', fontSize: 12.5, cursor: 'pointer', color: '#fff', fontWeight: 600 }}>Import Bibby limit list (CSV)</label>
              </div>
              <button onClick={exportReconciliation} title="CSV laid out in Bibby's own order - Sales Ledger, deductions, Approved Debt, High Involvement, Approved Funding, Availability - with every invoice underneath."
                style={{ background: '#fff', color: INK, border: '1px solid #e2e0da', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Export reconciliation</button>
              <button onClick={saveAll} disabled={saving} style={{ background: INK, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving...' : 'Save settings'}</button>
              {importMsg && <div style={{ fontSize: 11.5, color: '#555', flexBasis: '100%' }}>{importMsg}</div>}
            </div>

            {/* Customer -> projects -> applications */}
            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 900 }}>
                <thead>
                  <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                    <th style={{ ...th, textAlign: 'left' }}>Customer / project</th>
                    <th style={th}>Insured limit</th>
                    <th style={th}>Fundable (unpaid this-cert)</th>
                    <th style={th}>Raw advance</th>
                    <th style={th}>Eligible advance</th>
                    <th style={{ ...th, textAlign: 'left' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Say WHICH failure it is. "No applications found" sent me looking at
                      projects and syncing when the real cause was the API file not being
                      deployed, so every project came back with no invoice data. */}
                  {customers.length === 0 && (
                    <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: apiVersion === EXPECTED_API ? '#aaa' : '#dc2626' }}>
                      {apiVersion !== EXPECTED_API
                        ? `Nothing to show because the API file has not been deployed - it is reporting "${apiVersion || 'nothing'}", this page expects ${EXPECTED_API}. Deploy pages/api/business-financials.js.`
                        : dashEmpty
                        ? 'The dashboard cache is EMPTY, and every project on this page comes from it. Open the Commercial dashboard once to rebuild it, then come back. Nothing is lost - the cache has a 4-hour life and is cleared whenever the dashboard changes.'
                        : (data?.projects?.length
                            ? 'Projects found, but none has an unpaid sales invoice. Press "Sync invoices from Xero".'
                            : 'No projects with applications found. Check the projects are synced.')}
                    </td></tr>
                  )}
                  {customers.map((c) => (
                    <CustomerBlock key={c.customer} c={c} expanded={expanded} setExpanded={setExpanded} savedState={limitSaved[c.customer]}
                      limits={limits} setLimit={setLimit} isPaid={isPaid} setPaid={setPaid} />
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
              Only UNPAID applications count toward funding. Paid status is auto-matched to invoices by &quot;App N&quot; in the invoice reference; where it can&apos;t be matched it&apos;s flagged and treated as unpaid - use the paid toggle to correct. &quot;This cert (net)&quot; comes from each project&apos;s application table (already after retention). Insured limit = Bibby &quot;Approved Amount&quot; per customer (import via CSV or type). Availability = funded (after the facility cap) minus what you&apos;ve currently drawn.
            </div>
          </>
        )}
      </div>
    </>
  )
}

function CustomerBlock({ c, expanded, setExpanded, limits, setLimit, isPaid, setPaid, savedState }) {
  return (
    <>
      <tr style={{ borderBottom: '1px solid #eee', background: !c.hasLimit && c.fundable > 0 ? '#fffdf5' : '#fcfbf9' }}>
        <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{c.customer}</td>
        <td style={{ ...td, padding: '4px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
            <span style={{ color: '#bbb', fontSize: 12 }}>&pound;</span>
            {/* Says whether the typed figure actually reached the server. Without it
                there is no way to tell an auto-save from a lost keystroke. */}
            {savedState && (
              <span style={{ fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
                color: savedState === 'saved' ? '#16a34a' : savedState === 'failed' ? '#dc2626' : '#b45309' }}>
                {savedState === 'saved' ? 'saved' : savedState === 'failed' ? 'NOT SAVED' : 'saving'}
              </span>
            )}
            <input type="number" value={(limits[c.customer]?.insuredLimit) ?? ''} placeholder="0"
              onChange={e => setLimit(c.customer, e.target.value)}
              // Saves on blur, so a typed limit persists without pressing anything. The
              // import saves itself too - nothing about the limits depends on a button.
              // Immediate flush - do not wait out the debounce when the field is left.
              onBlur={() => { if (limitTimer.current) { clearTimeout(limitTimer.current); limitTimer.current = null } saveLimitsNow(limitsRef.current).then(ok => setLimitSaved(s => ({ ...s, [c.customer]: ok ? 'saved' : 'failed' }))) }}
              style={{ width: 100, padding: '5px 6px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12.5, textAlign: 'right' }} />
          </div>
        </td>
        <td style={{ ...td, fontWeight: 600 }}>{gbp(c.fundable)}</td>
        <td style={{ ...td, color: '#999' }}>{gbp(c.rawAdvance)}</td>
        <td style={{ ...td, fontWeight: 700, color: c.advance > 0 ? '#0f766e' : '#ccc' }}>{gbp(c.advance)}</td>
        <td style={{ ...td, textAlign: 'left', fontSize: 11.5 }}>
          {!c.hasLimit ? <span style={{ color: '#b45309' }}>No insured limit</span>
            : c.cappedByLimit ? <span style={{ color: '#2563eb' }}>Capped at limit</span>
            : c.fundable <= 0 ? <span style={{ color: '#999' }}>Nothing unpaid</span>
            : <span style={{ color: '#16a34a' }}>Full advance</span>}
        </td>
      </tr>
      {c.projects.map((p) => {
        const isOpen = !!expanded[p.xeroId]
        return (
          <tr key={p.xeroId} style={{ borderBottom: '1px solid #f4f2ee' }}>
            <td colSpan={6} style={{ padding: 0 }}>
              <div
                onClick={() => setExpanded(prev => ({ ...prev, [p.xeroId]: !prev[p.xeroId] }))}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 12px 7px 28px', cursor: 'pointer', background: '#fff' }}>
                <span style={{ color: '#333' }}>{isOpen ? '\u25BC' : '\u25B6'} {p.name || '(unnamed project)'} <span style={{ color: '#aaa', fontSize: 11 }}>({p.unpaidCount} unpaid)</span></span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  {/* Show the reduction where there is one. A figure that has been cut by
                      an eligibility cap must say so on the row - otherwise it reads as a
                      smaller application rather than money Bibby will not fund. */}
                  {p.retentionDebt > 0 && (
                    <span title={`${p.retentionCount} retention invoice(s) totalling ${gbp(p.retentionDebt)}. Retention is not fundable debt under the facility, so it is excluded. Detected by "retention" in the reference - one raised without that note will NOT be caught.`}
                      style={{ fontSize: 11, fontWeight: 700, color: '#5b21b6', border: '1px solid #ddd6fe', background: '#f5f3ff', borderRadius: 5, padding: '1px 6px', cursor: 'help' }}>
                      {gbp(p.retentionDebt)} retention
                    </span>
                  )}
                  {p.notInvoiced > 0.005 && (
                    <span title={`${gbp(p.notInvoiced)} has been applied for but not yet invoiced. Bibby assign the INVOICE, so this is not debt yet and is not funded. Raise the invoice and it becomes fundable.`}
                      style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', border: '1px solid #e5e7eb', background: '#f9fafb', borderRadius: 5, padding: '1px 6px', cursor: 'help' }}>
                      {gbp(p.notInvoiced)} not invoiced
                    </span>
                  )}
                  {p.suspectCount > 0 && (
                    <span title={`${p.suspectCount} application(s) have "Previously certified (gross)" BLANK. That makes this-cert compute as the FULL cumulative value, so the debt shown here is overstated. Fix it on the Applications page.`}
                      style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 5, padding: '1px 6px', cursor: 'help' }}>
                      {p.suspectCount} app(s) missing prev cert
                    </span>
                  )}
                  {p.excluded > 0 && (
                    <span title={(p.reasons || []).join('\n')}
                      style={{ fontSize: 11, fontWeight: 700, color: '#b45309', border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 5, padding: '1px 6px', cursor: 'help' }}>
                      -{gbp(p.excluded)} not eligible
                    </span>
                  )}
                  <span style={{ fontWeight: 600, color: p.fundableProject > 0 ? INK : '#bbb' }}>{gbp(p.fundableProject)}</span>
                </span>
              </div>
              {isOpen && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fbfaf7' }}>
                  <tbody>
                    {p.applications.map((a) => {
                      const paid = isPaid(a)
                      return (
                        <tr key={a.id} style={{ borderTop: '1px solid #f0eee9' }}>
                          <td style={{ padding: '6px 12px 6px 44px', textAlign: 'left', width: '40%' }}>
                            App {a.appNumber ?? '-'} <span style={{ color: '#aaa' }}>{monthLabel(a.monthKey)}</span>
                            {!a.matched && <span title="Could not auto-match to an invoice - treated as unpaid" style={{ marginLeft: 6, fontSize: 10, color: '#b45309' }}>&#9888; unmatched</span>}
                            {a.matched && <span style={{ marginLeft: 6, fontSize: 10, color: '#aaa' }}>{a.matchedInvoice}</span>}
                          </td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', color: '#666' }}>This cert (net)</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 600, width: 120 }}>{gbp(a.thisCertNet)}</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', width: 140 }}>
                            <button onClick={() => setPaid(a.id, !paid)}
                              title={paid ? 'Marked paid - excluded from funding' : 'Unpaid - included in funding'}
                              style={{ border: '1px solid ' + (paid ? '#86efac' : '#fed7aa'), background: paid ? '#dcfce7' : '#fff7ed', color: paid ? '#16a34a' : '#ea580c', borderRadius: 12, padding: '3px 10px', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              {paid ? '\u2713 Paid' : 'Unpaid'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}

function Box({ label, value, sub, color, strong }) {
  return (
    <div style={{ background: strong ? '#f7faf9' : '#fff', border: strong ? '1.5px solid #0f766e' : '1px solid #e6e3dc', borderRadius: 12, padding: '13px 18px', minWidth: 190 }}>
      <div style={{ fontSize: 12, color: '#888' }}>{label}</div>
      <div style={{ fontSize: strong ? 24 : 21, fontWeight: 800, color: color || INK, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9a958c', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
const lbl = { fontSize: 11, color: '#888', marginBottom: 3 }
const inp = { padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }
const th = { padding: '10px 12px', fontSize: 11, color: '#9a958c', fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap' }
