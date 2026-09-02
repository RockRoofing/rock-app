import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, gbp } from '../../components/BizNav'

// Financial year runs DECEMBER to NOVEMBER, same as the Budgets tab.
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
const lbl = { ...td, textAlign: 'left', whiteSpace: 'nowrap' }

export default function ForecastPL() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(true)
  const [oh, setOh] = useState(null)      // budgets-overheads
  const [mg, setMg] = useState(null)      // margin (actual P&L by month)
  const [cf, setCf] = useState(null)      // cashflow (project forecasts, accrual dates)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
      // COMPOSED FROM THE EXISTING ENDPOINTS, not rebuilt server-side. Overheads come
      // from the same source the Budgets tab uses, actuals from the same source the
      // Margin tab uses, forecasts from the same source the Cash Flow uses - so all four
      // pages agree by construction rather than by being kept in step by hand.
      Promise.all([
        fetch('/api/business-financials?view=budgets-overheads').then(r => r.json()).catch(() => null),
        fetch('/api/business-financials?view=margin').then(r => r.json()).catch(() => null),
        fetch('/api/business-financials?view=cashflow').then(r => r.json()).catch(() => null),
      ]).then(([a, b, c]) => { setOh(a); setMg(b); setCf(c); setLoading(false) })
    })
  }, [])

  const model = useMemo(() => {
    if (!oh || !mg || !cf) return null
    const now = new Date()
    const fyEnd = now.getMonth() >= 11 ? now.getFullYear() + 1 : now.getFullYear()
    const months = fyMonths(fyEnd)

    // A month is ACTUAL when it has been switched to actual on Budgets. That switch is
    // already the single decision about which months are closed - inventing a second rule
    // here would give two tabs that disagree about the same month.
    const actualSet = new Set(oh.actualMonths || [])

    const byMonth = {}
    for (const m of (mg.months || [])) byMonth[m.month] = m

    // Forecast revenue and cost of sale on the ACCRUAL dates - the same basis as the
    // Forecast Margin tab.
    // Invoices by the month they were RAISED - that is the P&L date, not the due date.
    const invByMonth = {}
    for (const i of (cf.receivables || [])) {
      const d = i.date || i.dueDate || ''
      if (!d) continue
      const k = String(d).slice(0, 7)
      invByMonth[k] = (invByMonth[k] || 0) + (i.total || i.amountDue || 0)
    }
    const fRev = {}, fMat = {}, fLab = {}, fProj = {}
    for (const fc of (cf.projForecasts || [])) {
      const a = fc.accrual
      if (!a) continue
      // SUPERSEDED BY A REAL APPLICATION - skip it.
      //
      // The project cash flow has always done this; the P&L counted every forecast,
      // including periods already overtaken by an application whose income is in Xero.
      // So the same work was in both the actual months and the forecast months, and
      // November read about 40,000 above the project page.
      //
      // Same test the project page uses: the period ends on or before the latest
      // application, so the application has replaced it.
      if (fc.latestAppEnd && fc.to && fc.to <= fc.latestAppEnd) continue
      const nm = projLabel(fc)
      for (const r of (a.revenueByMonth || [])) {
        if (!r.month || !r.amount) continue
        fRev[r.month] = (fRev[r.month] || 0) + r.amount
        ;(fProj[r.month] = fProj[r.month] || {})[nm] = (fProj[r.month][nm] || 0) + r.amount
      }
      // COST FOLLOWS THE REVENUE IT SUPPORTS.
      //
      // Revenue is bucketed by the sales schedule's month; cost was bucketed by DELIVERY
      // date and labour window end. On a period valued in November with materials
      // delivered in December, the revenue landed in this financial year and the cost in
      // the next - same work, two years, and a gross margin ten points too high.
      //
      // Costs are now held against the month of the PERIOD they belong to, capped at the
      // valuation date. An undated line falls to the period end rather than being dropped
      // silently, which is how it was disappearing altogether.
      const bound = (fc.valDate || fc.to || '').slice(0, 7)
      const put = (bucket, x) => {
        const own = x.date ? String(x.date).slice(0, 7) : bound
        const k = (bound && own > bound) ? bound : own
        if (k && x.amount) bucket[k] = (bucket[k] || 0) + x.amount
      }
      for (const x of (a.materials || [])) put(fMat, x)
      for (const x of (a.labour || [])) put(fLab, x)
    }

    // Forecast overheads per month, from the Budgets predicted grid.
    const fOh = {}
    for (const byM of Object.values(oh.predictedByCodeMonth || {})) {
      for (const [mo, v] of Object.entries(byM || {})) fOh[mo] = (fOh[mo] || 0) + (Number(v) || 0)
    }

    const rows = months.map(mo => {
      const isActual = actualSet.has(mo)
      const a = byMonth[mo] || {}
      // REAL INVOICES COUNT IN A FORECAST MONTH TOO.
      //
      // A forecast month took revenue only from the project forecasts, so August showed
      // NIL despite roughly 270,000 of invoices sitting in Xero - raised, real, and simply
      // in a month nobody had switched to actual yet. An invoice is revenue on the date it
      // is raised whether or not the month has been closed.
      //
      // Netted, not added: where a project has both an invoice and a forecast in the same
      // month the invoice has replaced the forecast, so only the excess of forecast over
      // invoiced is still to come.
      // REVERTED. Adding real invoices to a forecast month's revenue was wrong: there is
      // no matching COST, because those periods have been applied for and their forecast
      // costs correctly dropped. August came out at 412,604 of revenue against 5,446 of
      // cost - a 99% margin - and put 380,000 of imaginary profit on the year.
      //
      // A half-actual month cannot be fixed by patching one side of it. The mechanism
      // already exists: switch the month to ACTUAL on Budgets and Xero supplies both.
      // The warning below says so rather than the page guessing.
      const invoiced = invByMonth[mo] || 0
      const revenue = isActual ? (a.income || 0) : (fRev[mo] || 0)
      const cos = isActual ? (a.cos || 0) : ((fMat[mo] || 0) + (fLab[mo] || 0))
      // A MONTH NOT SWITCHED TO ACTUAL MUST USE THE BUDGET, not actuals-to-date.
      //
      // predictedByCodeMonth treats any past month with Xero data as COMPLETE and returns
      // what has posted so far. For a cash flow that is right - it is what is left to pay.
      // For a P&L it is badly wrong: August showed 12,198 of overheads against a budget of
      // 54,370, because only a fortnight of invoices had been entered.
      //
      // So where the month is still forecast, take the larger of the predicted figure and
      // the budget. Part-posted actuals never exceed the budget, and once you switch the
      // month to actual it uses Xero properly.
      // Fixed at source instead: predictedByCodeMonth now only treats a month as complete
      // once it has been SWITCHED to actual, so a forecast month returns its budget rather
      // than a fortnight of posted invoices.
      const overheads = isActual ? (a.overheads || 0) : (fOh[mo] || 0)
      return {
        mo, isActual, revenue, cos, overheads, invoiced,
        materials: isActual ? null : (fMat[mo] || 0),
        labour: isActual ? null : (fLab[mo] || 0),
        gross: revenue - cos,
        net: revenue - cos - overheads,
        projects: isActual ? null : (fProj[mo] || {}),
      }
    })
    const t = rows.reduce((s, r) => ({
      revenue: s.revenue + r.revenue, cos: s.cos + r.cos, overheads: s.overheads + r.overheads,
      gross: s.gross + r.gross, net: s.net + r.net,
      aRev: s.aRev + (r.isActual ? r.revenue : 0), fRev: s.fRev + (r.isActual ? 0 : r.revenue),
    }), { revenue: 0, cos: 0, overheads: 0, gross: 0, net: 0, aRev: 0, fRev: 0 })
    return { fyEnd, rows, t, actualCount: rows.filter(r => r.isActual).length }
  }, [oh, mg, cf])

  if (!ok) return null

  return (
    <div style={{ minHeight: '100vh', background: '#f7f6f3' }}>
      <Head><title>Forecast P&amp;L - Business Financials</title></Head>
      <BizNav />
      <div style={{ padding: '22px 26px' }}>
        <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>
          Forecast P&amp;L{model ? ` - year to Nov ${model.fyEnd}` : ''}
        </h1>
        <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4, maxWidth: 940 }}>
          December to November, the same financial year as Budgets. A month is <strong>ACTUAL</strong> once it has been switched to actual
          on the Budgets tab - that switch is the single decision about which months are closed, so this follows it rather than having a
          rule of its own. Actual months take income, cost of sales and overheads from Xero; forecast months take revenue and cost of sale
          from the project forecasts on an accrual basis, and overheads from the Budgets grid.
        </div>

        {/* A FORECAST MONTH WITH REAL INVOICES IN IT is half closed, and neither half is
            right: the forecast has let go of the period but Xero's figures are not being
            used yet. Switching the month to ACTUAL takes revenue AND cost from Xero
            together, which is the only way it ties. */}
        {!loading && model && (() => {
          const half = model.rows.filter(r => !r.isActual && (r.invoiced || 0) > 1000 && r.mo <= new Date().toISOString().slice(0, 7))
          if (!half.length) return null
          return (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderLeft: '4px solid #b45309', borderRadius: 10, padding: '11px 15px', marginBottom: 16, fontSize: 12.5, color: '#92400e', maxWidth: 900 }}>
              <strong>Switch {half.map(r => monthShort(r.mo)).join(', ')} to Actual on the Budgets tab.</strong>
              <div style={{ marginTop: 4 }}>
                {half.map(r => `${monthShort(r.mo)} has ${gbp(r.invoiced)} of invoices raised in Xero`).join('; ')} - but the month is still marked
                forecast, so this page uses the project forecasts instead. Those periods have already been applied for, so their revenue has
                gone while the real invoices are not being counted. The month reads low until you switch it, and switching takes revenue AND
                cost from Xero together - which is the only way the two sides tie.
              </div>
            </div>
          )
        })()}

        {loading && <div style={{ color: '#999', padding: 30 }}>Loading...</div>}

        {!loading && !model && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginTop: 18, fontSize: 13, color: '#b91c1c' }}>
            Could not load one of the three sources this page composes - Budgets, Margin or Cash Flow. Open each and check it works, then come back.
          </div>
        )}

        {model && (
          <>
            <div style={{ display: 'flex', gap: 12, margin: '18px 0', flexWrap: 'wrap' }}>
              <Box label="Revenue (FY)" value={gbp(model.t.revenue)} sub={`${gbp(model.t.aRev)} actual + ${gbp(model.t.fRev)} forecast`} />
              <Box label="Cost of sale" value={gbp(-model.t.cos)} colour="#dc2626" />
              <Box label="Gross profit" value={gbp(model.t.gross)} colour={model.t.gross < 0 ? '#dc2626' : '#0f766e'}
                sub={model.t.revenue > 0 ? `${((model.t.gross / model.t.revenue) * 100).toFixed(1)}%` : ''} />
              <Box label="Overheads" value={gbp(-model.t.overheads)} colour="#b45309" />
              <Box label="Net profit (FY)" value={gbp(model.t.net)} colour={model.t.net < 0 ? '#dc2626' : '#16a34a'} strong
                sub={`${model.actualCount} of 12 months actual`} />
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px', overflowX: 'auto' }}>
              {/* width 100% so it fills the page - it was sized to its content and left
                  a third of the screen empty on a wide monitor. */}
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
                <thead>
                  <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                    <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: '#faf9f7' }}>Month</th>
                    {model.rows.map(r => (
                      <th key={r.mo} style={{ ...th, background: r.isActual ? '#f4faf6' : '#fffdf5' }}>
                        {monthShort(r.mo)}
                        <div style={{ fontSize: 9, fontWeight: 700, color: r.isActual ? '#16a34a' : '#b45309' }}>{r.isActual ? 'ACTUAL' : 'forecast'}</div>
                      </th>
                    ))}
                    <th style={{ ...th, background: '#eef3fb' }}>FY total</th>
                  </tr>
                </thead>
                <tbody>
                  {/* GROSS of retention. Retention is a debtor, not a reduction in
                      revenue - earned at the valuation date, just not yet received. The
                      cash flow uses the net figure, which is right there and wrong here. */}
                  <Line label="Revenue (gross of retention)" rows={model.rows} pick={r => r.revenue} colour="#0f766e" total={model.t.revenue} />
                  <Line label="Cost of sale" rows={model.rows} pick={r => -r.cos} colour="#dc2626" total={-model.t.cos} />
                  {/* Materials and labour only exist separately on FORECAST months - Xero
                      gives one cost-of-sales total for a closed month, not the split. */}
                  <Line label="   materials (forecast)" rows={model.rows} pick={r => r.materials == null ? null : -r.materials} colour="#a1a1aa" small total={null} />
                  <Line label="   labour (forecast)" rows={model.rows} pick={r => r.labour == null ? null : -r.labour} colour="#a1a1aa" small total={null} />
                  <Line label="Gross profit" rows={model.rows} pick={r => r.gross} colour={INK} bold total={model.t.gross} />
                  <Line label="Overheads" rows={model.rows} pick={r => -r.overheads} colour="#b45309" total={-model.t.overheads} />
                  <Line label="Net profit" rows={model.rows} pick={r => r.net} colour={INK} bold band total={model.t.net} />
                  <Line label="Gross margin %" rows={model.rows} pick={r => r.revenue > 0 ? (r.gross / r.revenue) * 100 : null} pct
                    total={model.t.revenue > 0 ? (model.t.gross / model.t.revenue) * 100 : null} />
                  <Line label="Net margin %" rows={model.rows} pick={r => r.revenue > 0 ? (r.net / r.revenue) * 100 : null} pct
                    total={model.t.revenue > 0 ? (model.t.net / model.t.revenue) * 100 : null} />
                </tbody>
              </table>
              <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 8, lineHeight: 1.45 }}>
                Xero gives ONE cost-of-sales total for a closed month, so materials and labour are only split on forecast months.
                Forecast revenue is spread across the months each period's sales schedule says, materials are taken when DELIVERED and
                labour when the work was DONE - the same accrual basis as the Forecast Margin tab, so the two agree.
                Depreciation, accruals and corporation tax are not modelled, so net profit here is before those.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Line({ label, rows, pick, colour, total, bold, small, pct, band }) {
  return (
    <tr style={{ borderBottom: '1px solid #f2f0ec', background: band ? '#f7faf9' : 'transparent' }}>
      <td style={{ ...lbl, fontWeight: bold ? 700 : 400, fontSize: small ? 11 : 12, color: small ? '#999' : INK, position: 'sticky', left: 0, background: band ? '#f7faf9' : '#fff' }}>{label}</td>
      {rows.map(r => {
        const v = pick(r)
        return (
          <td key={r.mo} style={{ ...td, fontSize: small ? 11 : 12, fontWeight: bold ? 700 : 400,
            color: v == null ? '#ddd' : (pct ? (v < 0 ? '#dc2626' : '#16a34a') : (colour || INK)),
            background: r.isActual ? 'transparent' : '#fffdf7' }}>
            {v == null ? '-' : pct ? `${v.toFixed(0)}%` : gbp(v)}
          </td>
        )
      })}
      <td style={{ ...td, fontWeight: 700, background: '#eef3fb', color: total == null ? '#ddd' : (pct ? (total < 0 ? '#dc2626' : '#16a34a') : (colour || INK)) }}>
        {total == null ? '-' : pct ? `${total.toFixed(0)}%` : gbp(total)}
      </td>
    </tr>
  )
}

function Box({ label, value, sub, colour, strong }) {
  return (
    <div style={{ background: '#fff', border: strong ? '1.5px solid #0f766e' : '1px solid #e6e3dc', borderRadius: 10, padding: '10px 14px', minWidth: 170 }}>
      <div style={{ fontSize: 11.5, color: '#888' }}>{label}</div>
      <div style={{ fontSize: strong ? 22 : 19, fontWeight: 800, color: colour || INK, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: '#9a958c', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
