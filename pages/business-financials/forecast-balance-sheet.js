import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, GOLD, gbp } from '../../components/BizNav'

function fyMonths(endYear) {
  const out = [`${endYear - 1}-12`]
  for (let m = 1; m <= 11; m++) out.push(`${endYear}-${String(m).padStart(2, '0')}`)
  return out
}
const monthShort = (mo) => {
  const [y, m] = String(mo).split('-').map(Number)
  if (!y || !m) return mo
  return `${new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' })} ${String(y).slice(2)}`
}
const projLabel = (fc) => {
  const no = fc.projectNo ? String(fc.projectNo) : ''
  const nm = (fc.projectName || '').trim()
  if (no && nm) return nm.startsWith(no) ? nm : `${no} - ${nm}`
  // A negotiated job is prefixed so it is never mistaken for a live one - it is a deal,
  // not a contract, and the money is far less certain.
  const key = String(fc.projectKey || '')
  if (key.startsWith('N:')) return nm ? `${nm} (negotiated)` : `Deal ${key.slice(2)} (negotiated)`
  return nm || no || key.replace(/^L:/, '') || '(unnamed)'
}

const th = { padding: '7px 8px', fontSize: 10.5, color: '#888', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
const td = { padding: '6px 8px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }
const inp = { padding: '5px 7px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12.5, width: 74, textAlign: 'right' }

export default function ForecastBalanceSheet() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(true)
  const [bs, setBs] = useState(null)
  const [oh, setOh] = useState(null)
  const [mg, setMg] = useState(null)
  const [cf, setCf] = useState(null)
  const [a, setA] = useState({ debtorDays: 45, creditorDays: 45, retentionPct: 3, retentionMonths: 12 })
  const [saved, setSaved] = useState('')

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
      Promise.all([
        fetch('/api/business-financials?view=balance-sheet').then(r => r.json()).catch(() => null),
        fetch('/api/business-financials?view=budgets-overheads').then(r => r.json()).catch(() => null),
        fetch('/api/business-financials?view=margin').then(r => r.json()).catch(() => null),
        fetch('/api/business-financials?view=cashflow').then(r => r.json()).catch(() => null),
      ]).then(([b, o, m, c]) => {
        setBs(b); setOh(o); setMg(m); setCf(c)
        if (b?.assumptions) setA(x => ({ ...x, ...b.assumptions }))
        setLoading(false)
      })
    })
  }, [])

  async function saveAssumptions(next) {
    setA(next); setSaved('saving')
    try {
      const r = await fetch('/api/business-financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'balance-sheet', action: 'save-assumptions', assumptions: next }),
      })
      setSaved(r.ok ? 'saved' : 'NOT SAVED')
      if (r.ok) setTimeout(() => setSaved(''), 1500)
    } catch { setSaved('NOT SAVED') }
  }

  const model = useMemo(() => {
    if (!bs || !oh || !mg || !cf) return null
    const now = new Date()
    const fyEnd = now.getMonth() >= 11 ? now.getFullYear() + 1 : now.getFullYear()
    const months = fyMonths(fyEnd)
    const actualSet = new Set(oh.actualMonths || [])

    // ---- ACTUAL MONTH ENDS, STRAIGHT FROM XERO ---------------------------------------
    //
    // Twelve real month-end positions, with Xero's OWN "Net Assets" total rather than one
    // I have summed. That distinction is the whole fix: Xero returns liabilities as
    // POSITIVE figures under their own headings, so adding every row up gives assets PLUS
    // liabilities. On 31 Jul that put net assets at 991,136 against a real 56,460 - and
    // because the error sat in the opening figures it showed as the SAME 952,337 in every
    // single month, which is what gave it away.
    //
    // Actual months now come from Xero and tie by definition. Only forecast months are
    // rolled forward, and they roll from the LAST ACTUAL rather than from January.
    const cols = bs.columns || []                       // e.g. ["31 Jul 2026","30 Jun 2026",...]
    // Prefer "Net Assets"; fall back to "Total Capital and Reserves", which is the same
    // figure from the other side of the sheet and is what Xero's PDF shows underneath it.
    const tEntries = Object.entries(bs.totals || {})
    const netAssetsRow = tEntries.find(([k]) => /^net assets$/i.test(k.trim()))
      || tEntries.find(([k]) => /net assets/i.test(k))
      || tEntries.find(([k]) => /total capital and reserves/i.test(k))
    const actualNet = {}
    if (netAssetsRow) {
      const vals = netAssetsRow[1] || []
      cols.forEach((c, i) => {
        const d = new Date(c)
        if (!isNaN(d)) actualNet[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = vals[i] || 0
      })
    }
    const accounts = bs.accounts || []
    // Column index for a month, so a component can be read at the right month end.
    const colIdx = {}
    cols.forEach((c, i) => { const d = new Date(c); if (!isNaN(d)) colIdx[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = i })
    // Sum matching accounts AT A GIVEN MONTH. Liabilities come back positive from Xero, so
    // anything on the creditors side is negated here to keep one sign convention.
    // Do the stored accounts carry monthly values at all? A payload fetched before the
    // parser change has `balance` but no `values`, and every lookup then returns zero -
    // which is how the actual months came out with nil bank, nil debtors and the entire
    // balance dumped into Financing. Returning null instead leaves the previous figures
    // alone and lets the page say what is wrong.
    const hasMonthly = accounts.some(x => Array.isArray(x.values) && x.values.length > 1)
    const sumAt = (mo, test, negate) => {
      if (!hasMonthly) return null
      const i = colIdx[mo]
      if (i == null) return null
      const v = accounts.filter(x => test(`${x.section} ${x.name}`.toLowerCase(), String(x.section || '').toLowerCase(), String(x.name || '').toLowerCase()))
        .reduce((t, x) => t + (Array.isArray(x.values) ? (x.values[i] || 0) : 0), 0)
      return negate ? -v : v
    }
    const sum = (test) => accounts.filter(x => test(`${x.section} ${x.name}`.toLowerCase())).reduce((t, x) => t + (x.balance || 0), 0)
    const openBank = sum(s => s.includes('bank') && !/credit card|visa|mastercard|amex/.test(s))
    const openCards = sum(s => /credit card|visa|mastercard|amex/.test(s))
    const openDebtors = sum(s => s.includes('receivable') || s.includes('debtor'))
    const openCreditors = sum(s => s.includes('payable') || s.includes('creditor'))
    const openOther = accounts.reduce((t, x) => t + (x.balance || 0), 0) - openBank - openCards - openDebtors - openCreditors
    const openEquityish = openBank + openCards + openDebtors + openCreditors + openOther

    // ---- P&L, the same composition the Forecast P&L tab uses --------------------------
    const byMonth = {}
    for (const m of (mg.months || [])) byMonth[m.month] = m
    // Same as the P&L: an invoice raised in a forecast month IS revenue that month.
    // Without this the balance sheet builds debtors from forecasts alone and diverges from
    // the P&L, which is exactly what "Out by" exists to catch.
    const invByMonth = {}
    for (const i of (cf.receivables || [])) {
      const d = i.date || i.dueDate || ''
      if (!d) continue
      const k = String(d).slice(0, 7)
      invByMonth[k] = (invByMonth[k] || 0) + (i.total || i.amountDue || 0)
    }
    const fRev = {}, fCos = {}
    for (const fc of (cf.projForecasts || [])) {
      const acc = fc.accrual
      if (!acc) continue
      for (const r of (acc.revenueByMonth || [])) if (r.month && r.amount) fRev[r.month] = (fRev[r.month] || 0) + r.amount
      for (const x of (acc.materials || [])) if (x.date && x.amount) { const k = String(x.date).slice(0, 7); fCos[k] = (fCos[k] || 0) + x.amount }
      for (const x of (acc.labour || [])) if (x.date && x.amount) { const k = String(x.date).slice(0, 7); fCos[k] = (fCos[k] || 0) + x.amount }
    }
    const fOh = {}
    for (const byM of Object.values(oh.predictedByCodeMonth || {})) {
      for (const [mo, v] of Object.entries(byM || {})) fOh[mo] = (fOh[mo] || 0) + (Number(v) || 0)
    }

    // ---- FINANCING, from the tracked balance sheet items ------------------------------
    const finByMonth = {}
    for (const it of (bs.items || [])) {
      if (it.inForecast === false) continue
      const monthly = Number(it.monthly) || 0
      if (!monthly) continue
      let left = Number(it.liability) || 0
      const capped = left > 0
      for (const mo of months) {
        if (it.start && mo < it.start) continue
        if (it.end && mo > it.end) continue
        if (capped && left <= 0) break
        const amt = capped ? Math.min(monthly, left) : monthly
        if (amt <= 0) break
        if (capped) left -= amt
        finByMonth[mo] = (finByMonth[mo] || 0) + amt
      }
    }
    const openFinancing = -(bs.items || []).filter(i => i.inForecast !== false).reduce((t, i) => t + (Number(i.liability) || 0), 0)

    // ---- ROLL FORWARD -----------------------------------------------------------------
    //
    // Cash is DERIVED, not asserted. Profit goes to reserves; the movement in debtors,
    // creditors, retention and financing is what turns that profit into cash. Which is
    // what makes it a three-way rather than three separate statements: if the working
    // capital assumptions are wrong, the bank line goes wrong in a way you can see.
    //
    // The 13-week cash flow stays the detailed near-term view - it schedules real invoice
    // and bill dates. This is the twelve-month shape.
    const dDays = Number(a.debtorDays) || 0
    const cDays = Number(a.creditorDays) || 0
    const retPct = (Number(a.retentionPct) || 0) / 100
    const retMonths = Math.max(1, Number(a.retentionMonths) || 12)

    let bank = openBank, cards = openCards, debtors = openDebtors, creditors = openCreditors
    let financing = openFinancing, retention = 0, reserves = openEquityish
    const rows = []
    // Revenue and cost by month, kept so receipts and payments can lag them.
    const revOf = [], cosOf = [], ohOf = []
    for (const mo of months) {
      const isActual = actualSet.has(mo)
      const m = byMonth[mo] || {}
      // Reverted with the P&L - same reason. Revenue without its cost is not revenue.
      revOf.push(isActual ? (m.income || 0) : (fRev[mo] || 0))
      cosOf.push(isActual ? (m.cos || 0) : (fCos[mo] || 0))
      ohOf.push(isActual ? (m.overheads || 0) : (fOh[mo] || 0))
    }
    // A lag in months, rounded - 45 days is one and a half months, so half of a month's
    // billing is collected in the following month and half the one after.
    const lag = (arr, i, days) => {
      const whole = Math.floor(days / 30), frac = (days % 30) / 30
      const a1 = arr[i - whole] ?? 0
      const a2 = arr[i - whole - 1] ?? 0
      return a1 * (1 - frac) + a2 * frac
    }

    months.forEach((mo, i) => {
      const isActual = actualSet.has(mo)
      const revenue = revOf[i], cos = cosOf[i], overheads = ohOf[i]
      const net = revenue - cos - overheads

      // Retention withheld on this month's billing, released after retMonths.
      const withheld = revenue * retPct
      const released = (revOf[i - retMonths] ?? 0) * retPct

      const receipts = lag(revOf, i, dDays) * (1 - retPct) + released
      const payments = lag(cosOf, i, cDays) + overheads
      const finPaid = finByMonth[mo] || 0

      debtors += revenue * (1 - retPct) - lag(revOf, i, dDays) * (1 - retPct)
      retention += withheld - released
      creditors += -(cos - lag(cosOf, i, cDays))       // liabilities carried negative
      financing += finPaid                              // liability negative, so paying it rises toward 0
      bank += receipts - payments - finPaid
      reserves += net

      const assets = bank + debtors + retention
      const liabs = cards + creditors + financing
      // A CLOSED MONTH USES XERO'S FIGURE, not the model's. It is fact, so there is
      // nothing to forecast and nothing that can disagree - and the roll-forward is
      // re-based onto it so the first forecast month starts from the truth rather than
      // from an accumulated drift.
      const xeroNet = actualNet[mo]
      const useXero = isActual && xeroNet != null
      if (useXero) {
        // RE-BASE THE COMPONENTS TOO, not just the bottom line.
        //
        // Re-basing reserves alone left bank, debtors and creditors still rolling forward
        // from the original wrong opening - so an actual month tied while the first
        // forecast month was out by 833,506. Every line is now set to Xero's real figure
        // at each closed month, and the forecast carries on from THOSE.
        reserves = xeroNet
        // MATCHED ON XERO'S SECTION as well as the account name.
        //
        // Your Amex sits under "Cash at bank and in hand" as an ASSET and again under
        // Creditors as a LIABILITY - same name, opposite meaning. Matching on the name
        // alone put the asset nowhere and the liability in Creditors instead of Cards.
        // The section is what distinguishes them.
        //
        // Anything unmatched - WIP, inventory, prepayments, fixed assets, deferred tax -
        // is deliberately left to the Financing line, which balances the month. Those are
        // real but not separately forecast, and inventing a line for each would be worse
        // than one honest catch-all.
        const isCard = (n) => /credit card|visa|mastercard|amex|american express|capital on tap/.test(n)
        const b = sumAt(mo, (t, sec, nm) => sec.includes('cash at bank') && !isCard(nm))
        const cc = sumAt(mo, (t, sec, nm) => (sec.includes('cash at bank') || sec.includes('creditor')) && isCard(nm), true)
        const rt = sumAt(mo, (t, sec, nm) => nm.includes('retention') && sec.includes('asset'))
        const dr = sumAt(mo, (t, sec, nm) => sec.includes('asset') && (nm.includes('receivable') || nm.includes('debtor')) && !nm.includes('retention'))
        const cr = sumAt(mo, (t, sec, nm) => sec.includes('creditor') && !isCard(nm), true)
        if (b != null) bank = b
        if (dr != null) debtors = dr
        if (rt != null) retention = rt
        if (cr != null) creditors = cr
        if (cc != null) cards = cc
        financing = xeroNet - (bank + debtors + retention + cards + creditors)
      }
      rows.push({
        mo, isActual, fromXero: useXero, revenue, cos, overheads, net,
        bank, debtors, retention, cards, creditors, financing,
        assets, liabs, netAssets: useXero ? xeroNet : (assets + liabs), reserves,
        // The whole point of the third statement. If this is not ~0 the model does not
        // tie, and saying so is more useful than a balance sheet that quietly does not.
        // Only meaningful on FORECAST months. On an actual month both sides are Xero's
        // own figure, so a tie there would prove nothing.
        check: useXero ? 0 : (assets + liabs) - reserves,
      })
    })
    return { fyEnd, months, rows, openBank, openDebtors, openCreditors, openCards, openOther, actualNetKeys: actualNet, hasMonthly, hasOpening: accounts.length > 0 }
  }, [bs, oh, mg, cf, a])

  if (!ok) return null

  return (
    <div style={{ minHeight: '100vh', background: '#f7f6f3' }}>
      <Head><title>Forecast Balance Sheet - Business Financials</title></Head>
      <BizNav />
      <div style={{ padding: '22px 26px' }}>
        <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>Forecast balance sheet{model ? ` - year to Nov ${model.fyEnd}` : ''}</h1>
        <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4, maxWidth: 960 }}>
          The third leg of the three-way. Opening position from Xero, then rolled forward month by month: profit goes to reserves, and the
          movement in debtors, creditors, retention and financing is what turns that profit into cash. <strong>Cash is derived, not
          asserted</strong> - so if the working capital assumptions are wrong, the bank line goes wrong somewhere you can see it.
          Months marked ACTUAL on Budgets use Xero's figures; the rest are forecast.
          <div style={{ marginTop: 6 }}>
            <strong>The four settings below only affect FORECAST months.</strong> Actual months come from Xero and need no assumptions.
            They exist because a P&amp;L does not tell you when cash moves: <em>debtor days</em> decides how much of a month's billing is still
            owed at month end rather than collected, <em>creditor days</em> the same for what you owe, and <em>retention</em> splits off the
            part of a bill you will not see for a year. Without them, profit and cash would be the same thing - which is the one assumption
            no construction business can afford.
          </div>
        </div>

        {/* WHAT XERO ACTUALLY RETURNED. The actual months are still showing my summed
            figure rather than Xero's, so either the monthly columns or the "Net Assets"
            total did not come through - and guessing which costs another round trip. */}
        {!loading && bs && (
          <details style={{ marginBottom: 14 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: (bs.columns || []).length && Object.keys(bs.totals || {}).length ? '#16a34a' : '#b45309' }}>
              Xero balance sheet check - {(bs.columns || []).length} monthly columns, {Object.keys(bs.totals || {}).length} total rows found
            </summary>
            <div style={{ marginTop: 8, background: '#fff', border: '1px solid #eee', borderRadius: 8, padding: 12, fontSize: 11.5 }}>
              <div style={{ marginBottom: 6 }}><strong>Columns:</strong> {(bs.columns || []).join(' | ') || <span style={{ color: '#dc2626' }}>none - the report came back with a single column, so periods=11 did not apply</span>}</div>
              <div><strong>Total rows Xero gave:</strong></div>
              {Object.keys(bs.totals || {}).length === 0
                ? <div style={{ color: '#dc2626' }}>none matched - no row labelled &quot;Net Assets&quot; or &quot;Total ...&quot; was found, so the actual months fall back to my own sum</div>
                : Object.entries(bs.totals).map(([k, v]) => (
                    <div key={k} style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{k}: {(v || []).map(x => Math.round(x).toLocaleString()).join(' | ')}</div>
                  ))}
              <div style={{ marginTop: 6 }}><strong>Matched to months:</strong> {Object.keys(model?.actualNetKeys || {}).join(', ') || <span style={{ color: '#dc2626' }}>none</span>}</div>
            </div>
          </details>
        )}

        {/* The stored payload is from before monthly values were captured, so every
            component reads nil and the whole balance lands in Financing. Says so rather
            than showing a table of zeros that ties. */}
        {!loading && model && model.hasOpening && !model.hasMonthly && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderLeft: '4px solid #b45309', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
            <strong>Press &quot;Read balance sheet from Xero&quot; on the Balance Sheet tab.</strong> The stored figures were fetched before
            the monthly breakdown was added - the totals came through, which is why the months tie, but the individual lines did not. That
            is why Bank, Debtors and Creditors read nil on the actual months and the whole balance sits in Financing &amp; tax. One refresh
            fixes it.
          </div>
        )}

        {loading && <div style={{ color: '#999', padding: 30 }}>Loading...</div>}

        {!loading && model && !model.hasOpening && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 16px', marginTop: 18, fontSize: 13, color: '#92400e' }}>
            No opening balance sheet yet. Go to the <strong>Balance Sheet</strong> tab and press &quot;Read balance sheet from Xero&quot; -
            everything below rolls forward from it, so without it the whole thing starts at zero.
          </div>
        )}

        {model && (
          <>
            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', margin: '16px 0', display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 11, color: '#888', marginBottom: 3 }} title="How long customers take to pay. 45 days means roughly half a month's billing is collected in the following month and half the one after.">Debtor days</div>
                <input type="number" value={a.debtorDays} onChange={e => saveAssumptions({ ...a, debtorDays: e.target.value })} style={inp} /></div>
              <div><div style={{ fontSize: 11, color: '#888', marginBottom: 3 }} title="How long you take to pay suppliers and subcontractors.">Creditor days</div>
                <input type="number" value={a.creditorDays} onChange={e => saveAssumptions({ ...a, creditorDays: e.target.value })} style={inp} /></div>
              <div><div style={{ fontSize: 11, color: '#888', marginBottom: 3 }} title="Retention withheld on billing. It becomes a debtor that is not collected with the rest.">Retention %</div>
                <input type="number" value={a.retentionPct} onChange={e => saveAssumptions({ ...a, retentionPct: e.target.value })} style={inp} /></div>
              <div><div style={{ fontSize: 11, color: '#888', marginBottom: 3 }} title="Months before retention is released. The tracker holds the real dates; this is the shape for the year.">Retention held (months)</div>
                <input type="number" value={a.retentionMonths} onChange={e => saveAssumptions({ ...a, retentionMonths: e.target.value })} style={inp} /></div>
              {saved && <span style={{ fontSize: 11.5, fontWeight: 700, color: saved === 'saved' ? '#16a34a' : saved === 'saving' ? '#b45309' : '#dc2626' }}>{saved}</span>}
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px', overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 1150 }}>
                <thead><tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                  <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: '#faf9f7' }}>Month end</th>
                  {model.rows.map(r => (
                    <th key={r.mo} style={{ ...th, background: r.isActual ? '#f4faf6' : '#fffdf5' }}>
                      {monthShort(r.mo)}
                      <div style={{ fontSize: 9, fontWeight: 700, color: r.isActual ? '#16a34a' : '#b45309' }}>{r.isActual ? 'ACTUAL' : 'forecast'}</div>
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  <Row label="Bank" rows={model.rows} pick={r => r.bank} bold />
                  <Row label="Debtors" rows={model.rows} pick={r => r.debtors} />
                  <Row label="Retention held" rows={model.rows} pick={r => r.retention} />
                  <Row label="Creditors" rows={model.rows} pick={r => r.creditors} colour="#dc2626" />
                  <Row label="Credit cards" rows={model.rows} pick={r => r.cards} colour="#dc2626" />
                  <Row label="Financing &amp; tax" rows={model.rows} pick={r => r.financing} colour="#dc2626" />
                  <Row label="Net assets" rows={model.rows} pick={r => r.netAssets} bold band />
                  <Row label="Reserves (opening + profit)" rows={model.rows} pick={r => r.reserves} />
                  <Row label="Out by" rows={model.rows} pick={r => r.check} check />
                  <tr><td colSpan={model.rows.length + 1} style={{ padding: '6px 8px', fontSize: 10.5, color: '#8a857c' }}>
                    Months marked ACTUAL take Xero&apos;s own <strong>Net Assets</strong> figure, so they are fact and cannot disagree. The forecast is re-based onto the last actual, so it starts from the truth rather than from twelve months of accumulated drift.
                  </td></tr>
                </tbody>
              </table>
              <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 8, lineHeight: 1.45 }}>
                <strong>&quot;Out by&quot; is the point of this page.</strong> Net assets should equal reserves. Where it does not, the three
                statements do not tie - normally because the working capital assumptions above do not match how the business actually
                collects and pays, or because something moves cash without touching the P&amp;L and is not yet on the Balance Sheet tab.
                A balance sheet that quietly did not balance would be worse than useless.
                <br />
                Corporation tax, depreciation, dividends and VAT timing are not modelled. The 13-week cash flow remains the detailed
                near-term view - it schedules real invoice and bill dates, where this is the twelve-month shape.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, rows, pick, colour, bold, band, check }) {
  return (
    <tr style={{ borderBottom: '1px solid #f2f0ec', background: band ? '#f7faf9' : 'transparent' }}>
      <td style={{ padding: '6px 8px', fontSize: 12, textAlign: 'left', whiteSpace: 'nowrap', fontWeight: bold ? 700 : 400,
        position: 'sticky', left: 0, background: band ? '#f7faf9' : '#fff' }}
        dangerouslySetInnerHTML={{ __html: label }} />
      {rows.map(r => {
        const v = pick(r)
        const bad = check && Math.abs(v) > 1
        return (
          <td key={r.mo} style={{ ...td, fontWeight: bold || bad ? 700 : 400,
            color: bad ? '#dc2626' : (check ? '#16a34a' : (v < 0 ? (colour || '#dc2626') : (colour === '#dc2626' ? '#16a34a' : INK))),
            background: r.isActual ? 'transparent' : '#fffdf7' }}>
            {check && !bad ? 'ties' : gbp(v)}
          </td>
        )
      })}
    </tr>
  )
}
