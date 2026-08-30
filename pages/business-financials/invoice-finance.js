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
const fmtD = (iso) => { if (!iso) return '-'; const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${String(y).slice(2)}` }

const fmtDateTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const fmtShort = (n) => `\u00a3${Math.round(Number(n) || 0).toLocaleString('en-GB')}`

// BIBBY ELIGIBILITY for one project. Returns the fundable figure and WHY it was reduced.
//
// Each cap is measured on the CUMULATIVE position at the latest unpaid application -
// "materials on site funded to 25% of contract value" is a position, not an increment.
// The excess over each cap is then taken off the unpaid total.
//
// Deliberately NOT stacked as three independent deductions of the same money: the 90%
// overall ceiling is applied LAST, to the figure already reduced by the materials and
// variations caps. Applying all three to the raw total would double-count an excess that
// is both a variation AND above 90%.
function eligibleFor(project, evidenceApps, settings, debt) {
  // `debt` is the invoice total - what Bibby actually assign. The applications are only
  // read for COMPOSITION, to work out how much of that debt the caps disallow.
  const raw = Number(debt) || 0
  const unpaidApps = evidenceApps
  const cv = Number(project.contractValue) || 0
  const reasons = []
  if (!cv || !unpaidApps.length) return { eligible: Math.max(0, raw), reasons, excluded: 0 }

  // Cumulative position at the LAST unpaid application - the furthest the account has got.
  const last = unpaidApps[unpaidApps.length - 1] || {}
  const mos = Number(last.materialsOnSite) || 0
  const vars = Number(last.variationsToDate) || 0
  const gross = Number(last.grossToDate) || 0

  const mosCapPct = Number(settings.mosCapPct ?? 25)
  const varCapPct = Number(settings.varCapPct ?? 25)
  const ceilPct = Number(settings.certCeilingPct ?? 90)

  let excess = 0
  const mosCap = cv * (mosCapPct / 100)
  if (mos > mosCap) { const over = mos - mosCap; excess += over; reasons.push(`Materials on site ${fmtShort(mos)} over the ${mosCapPct}% cap (${fmtShort(mosCap)}) - ${fmtShort(over)} not funded`) }

  const varCap = cv * (varCapPct / 100)
  if (vars > varCap) { const over = vars - varCap; excess += over; reasons.push(`Variations ${fmtShort(vars)} over the ${varCapPct}% cap (${fmtShort(varCap)}) - ${fmtShort(over)} needs written instruction to fund`) }

  // The 90% ceiling, applied to what is left after the two caps above.
  const ceiling = cv * (ceilPct / 100)
  const grossAfter = Math.max(0, gross - excess)
  if (grossAfter > ceiling) { const over = grossAfter - ceiling; excess += over; reasons.push(`Certified ${fmtShort(grossAfter)} over ${ceilPct}% of contract (${fmtShort(ceiling)}) - ${fmtShort(over)} needs further certification`) }

  // Never remove more than is actually outstanding: the excess may sit in an application
  // that has already been paid, in which case it is not in `raw` to be removed.
  const excluded = Math.min(excess, raw)
  return { eligible: Math.max(0, raw - excluded), reasons, excluded }
}


export default function InvoiceFinance() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState({ advanceRate: 60, drawn: 0, facilityCap: 500000, mosCapPct: 25, varCapPct: 25, certCeilingPct: 90, highInvolvement: 0 })
  const [limits, setLimits] = useState({})            // { customerName: { insuredLimit } }
  const [limitsMeta, setLimitsMeta] = useState(null)  // { importedAt, count, matched, unmatched, fileName }
  const [apiVersion, setApiVersion] = useState(null)
  const [drawnHistory, setDrawnHistory] = useState([])
  const [drawnDate, setDrawnDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [drawnAmt, setDrawnAmt] = useState('')
  const limitsRef = useRef(limits)
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
        highInvolvement: d.settings?.highInvolvement ?? 0,
      })
      setLimits(d.debtorLimits || {})
      setLimitsMeta(d.limitsMeta || null)
      setApiVersion(d.apiVersion || null)
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
      // THE DEBT IS THE INVOICE. The application is the evidence of what it consists of.
      const invs = Array.isArray(p.invoices) ? p.invoices : []
      const retentionInvs = invs.filter(i => i.isRetention)
      const fundingInvs = invs.filter(i => !i.isRetention)
      const invoiceDebt = fundingInvs.reduce((s, i) => s + (i.amountDue || 0), 0)
      const retentionDebt = retentionInvs.reduce((s, i) => s + (i.amountDue || 0), 0)
      const unmatched = fundingInvs.filter(i => i.appNumber == null)
      const unmatchedDebt = unmatched.reduce((s, i) => s + (i.amountDue || 0), 0)

      // Composition for the caps comes from the applications the unpaid invoices point
      // at - falling back to the unpaid applications where nothing matched, so a project
      // whose invoices carry no "App N" is still capped rather than funded blind.
      const invAppNos = new Set(fundingInvs.map(i => i.appNumber).filter(n => n != null))
      const evidenceApps = invAppNos.size
        ? p.applications.filter(a => invAppNos.has(a.appNumber))
        : p.applications.filter(a => !isPaid(a))

      // Applied for but not yet invoiced. Not debt, so not funded - but shown, because
      // silently dropping it looks like the work vanished.
      const notInvoiced = Math.max(0, p.applications.filter(a => !isPaid(a)).reduce((s, a) => s + (a.thisCertNet || 0), 0) - invoiceDebt)

      const elig = eligibleFor(p, evidenceApps, settings, invoiceDebt)
      byCust[cust].projects.push({
        ...p, unpaidCount: fundingInvs.length, rawProject: invoiceDebt,
        retentionDebt, retentionCount: retentionInvs.length,
        unmatchedDebt, unmatchedCount: unmatched.length, notInvoiced,
        ...elig, fundableProject: elig.eligible,
      })
    }
    return Object.values(byCust).map(c => {
      const lim = limits[c.customer] || {}
      const insured = Number(lim.insuredLimit) || 0
      const fundable = c.projects.reduce((s, p) => s + p.fundableProject, 0)
      const rawAdvance = fundable * rate
      const hasLimit = insured > 0
      const advance = hasLimit ? Math.min(rawAdvance, insured) : 0
      return { ...c, insured, hasLimit, fundable, rawAdvance, advance, cappedByLimit: hasLimit && rawAdvance > insured }
    }).sort((a, b) => b.advance - a.advance || b.fundable - a.fundable)
  }, [data, limits, settings.advanceRate, paidOverrides])

  const totals = useMemo(() => {
    const fundable = customers.reduce((s, c) => s + c.fundable, 0)
    // HIGH INVOLVEMENT - a concentration deduction Bibby take off APPROVED DEBT before
    // applying the advance rate. Reverse-engineered from their own summary:
    //   (Approved Debt - High Involvement) x 60% = Approved Funding
    //   (323,029.46 - 35,069.31) x 60% = 172,776.09   exactly.
    // It is not derivable from anything we hold - it depends on their view of debtor
    // concentration - so it is entered from their screen rather than calculated.
    const highInv = Number(settings.highInvolvement) || 0
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
    return { fundable, grossAdvance, totalAdvance, cap, cappedByFacility, drawn, drawnAsAt, availability, highInv,
      noLimitCount: noLimit.length, noLimitValue: noLimit.reduce((s, c) => s + c.fundable, 0) }
  }, [customers, settings.drawn, settings.facilityCap, settings.highInvolvement, settings.advanceRate, drawnHistory])

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
    const rawAdv = customers.reduce((t, c) => t + (c.rawAdvance || 0), 0)
    const actualAdv = customers.reduce((t, c) => t + (c.advance || 0), 0)
    const limitCutDebt = rate > 0 ? (rawAdv - actualAdv) / rate : 0
    const noLimitDebt = customers.filter(c => !c.hasLimit).reduce((t, c) => t + (c.fundable || 0), 0)
    const overLimitDebt = Math.max(0, limitCutDebt - noLimitDebt)

    rows.push(['SUMMARY - compare against Bibby Finance Agreement Summary'])
    rows.push(['Sales Ledger (all unpaid sales invoices incl retention)', money(salesLedger)])
    rows.push(['  less retention invoices', money(retention)])
    rows.push(['  less eligibility caps (materials / variations / ceiling)', money(capped)])
    rows.push(['= Approved Debt (before insured limits)', money(totals.fundable)])
    rows.push(['  less debt with NO insured limit set - funded at zero', money(noLimitDebt)])
    rows.push(['  less debt over the insured limit', money(overLimitDebt)])
    rows.push(['= Insurable Approved Debt', money(Math.max(0, totals.fundable - noLimitDebt - overLimitDebt))])
    rows.push(['High involvement (entered from Bibby)', money(totals.highInv)])
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
      const notFunded = rate > 0 ? ((c.rawAdvance || 0) - (c.advance || 0)) / rate : 0
      rows.push([c.customer, money(c.fundable), money(c.insured), c.hasLimit ? 'yes' : 'NO LIMIT SET', money(c.advance), money(notFunded)])
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

  function setLimit(name, value) {
    setLimits(prev => ({ ...prev, [name]: { ...(prev[name] || {}), insuredLimit: value } }))
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
              <div><div style={lbl} title="Bibby's concentration deduction, taken off approved debt BEFORE the advance rate. Read it off their Finance Agreement Summary - it cannot be derived from anything we hold.">High involvement</div><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: '#999' }}>&pound;</span><input type="number" value={settings.highInvolvement} onChange={e => setSettings(s => ({ ...s, highInvolvement: e.target.value }))} style={{ ...inp, width: 110 }} /></div></div>
              <div><div style={lbl} title="Approved materials on site are funded up to this share of contract value.">Materials cap %</div><input type="number" value={settings.mosCapPct} onChange={e => setSettings(s => ({ ...s, mosCapPct: e.target.value }))} style={{ ...inp, width: 70 }} /></div>
              <div><div style={lbl} title="Variations are funded up to this share of contract value. Beyond it, Bibby need written instruction.">Variations cap %</div><input type="number" value={settings.varCapPct} onChange={e => setSettings(s => ({ ...s, varCapPct: e.target.value }))} style={{ ...inp, width: 70 }} /></div>
              <div><div style={lbl} title="Bibby approve this share of contract value initially. Going past it needs further certification as the final account approaches.">Certified ceiling %</div><input type="number" value={settings.certCeilingPct} onChange={e => setSettings(s => ({ ...s, certCeilingPct: e.target.value }))} style={{ ...inp, width: 70 }} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="file" accept=".csv" ref={fileRef} onChange={onFile} style={{ display: 'none' }} id="bibbyfile" />
                <span title={apiVersion === 'pkg597'
                  ? 'The API file carrying the save fix IS deployed.'
                  : 'The API file is NOT the pkg597 one. pages/api/business-financials.js has not been deployed - saves will silently do nothing.'}
                  style={{ fontSize: 11, fontWeight: 700, cursor: 'help', whiteSpace: 'nowrap', color: apiVersion === 'pkg597' ? '#16a34a' : '#dc2626' }}>
                  {apiVersion === 'pkg597' ? 'API pkg597' : 'API OLD - not deployed'}
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
                  {customers.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#aaa' }}>No applications found. Make sure projects have submitted applications and are synced.</td></tr>}
                  {customers.map((c) => (
                    <CustomerBlock key={c.customer} c={c} expanded={expanded} setExpanded={setExpanded}
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

function CustomerBlock({ c, expanded, setExpanded, limits, setLimit, isPaid, setPaid }) {
  return (
    <>
      <tr style={{ borderBottom: '1px solid #eee', background: !c.hasLimit && c.fundable > 0 ? '#fffdf5' : '#fcfbf9' }}>
        <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{c.customer}</td>
        <td style={{ ...td, padding: '4px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
            <span style={{ color: '#bbb', fontSize: 12 }}>&pound;</span>
            <input type="number" value={(limits[c.customer]?.insuredLimit) ?? ''} placeholder="0"
              onChange={e => setLimit(c.customer, e.target.value)}
              // Saves on blur, so a typed limit persists without pressing anything. The
              // import saves itself too - nothing about the limits depends on a button.
              onBlur={() => saveLimitsNow()}
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
                  {p.unmatchedCount > 0 && (
                    <span title={`${p.unmatchedCount} invoice(s) totalling ${gbp(p.unmatchedDebt)} carry no "App N" reference, so no application could be matched to evidence what they consist of. They ARE counted as debt - the caps were applied using this project's unpaid applications instead.`}
                      style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', border: '1px solid #bae6fd', background: '#f0f9ff', borderRadius: 5, padding: '1px 6px', cursor: 'help' }}>
                      {p.unmatchedCount} unmatched
                    </span>
                  )}
                  {p.notInvoiced > 0.005 && (
                    <span title={`${gbp(p.notInvoiced)} has been applied for but not yet invoiced. Bibby assign the INVOICE, so this is not debt yet and is not funded. Raise the invoice and it becomes fundable.`}
                      style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', border: '1px solid #e5e7eb', background: '#f9fafb', borderRadius: 5, padding: '1px 6px', cursor: 'help' }}>
                      {gbp(p.notInvoiced)} not invoiced
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
