import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, GOLD, gbp } from '../../components/BizNav'
import { normName } from '../../lib/cashflowEvents'

const monthShort = (mk) => { const [y, m] = mk.split('-').map(Number); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sept','Oct','Nov','Dec'][m - 1]} ${String(y).slice(2)}` }
const th = { padding: '7px 9px', fontSize: 11, color: '#888', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
const td = { padding: '6px 9px', fontSize: 12.5, textAlign: 'right', whiteSpace: 'nowrap' }
const num = (v) => Number(v) || 0

function csv(rows) {
  return rows.map(r => r.map(c => {
    const v = c == null ? '' : String(c)
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }).join(',')).join('\n')
}
function download(name, text) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  a.download = name; a.click(); URL.revokeObjectURL(a.href)
}

export default function Reconciliation() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [cf, setCf] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(async d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
      try { setCf(await fetch('/api/business-financials?view=cashflow').then(r => r.json())) } catch {}
      setLoading(false)
    })
  }, [])

  // THE SOURCES OF TRUTH, counted once and compared with what each page derives from them.
  const model = useMemo(() => {
    if (!cf) return null
    const recs = cf.receivables || []
    const bills = cf.bills || []
    const fcs = cf.projForecasts || []

    // 1. INVOICES OWED - the ledger, straight off Xero.
    const invTotal = recs.reduce((t, i) => t + num(i.amountDue), 0)
    const invNoProject = recs.filter(i => !i.projectNo && !i.projectName)
    const invNoExpected = recs.filter(i => !i.expectedDate)
    const today = new Date().toISOString().slice(0, 10)
    const invOverdue = recs.filter(i => (i.expectedDate || i.dueDate || '') < today)

    // 2. BILLS TO PAY
    const billTotal = bills.reduce((t, b) => t + Math.abs(num(b.amountDue)), 0)
    const billNoProject = bills.filter(b => !b.project)

    // 3. PROJECT CASH FLOWS - what the forecasts themselves say, before any page reads them.
    let fcSales = 0, fcMat = 0, fcLabGross = 0, noDates = 0, noVal = 0, spreadOff = []
    const byProject = []
    for (const fc of fcs) {
      const sales = (fc.salesSchedule || []).reduce((t, x) => t + num(x.amount), 0)
      const mat = (fc.matItems || []).reduce((t, x) => t + num(x.amount), 0)
      const lab = (fc.labourSchedule || []).reduce((t, x) => t + num(x.amount), 0)
      fcSales += sales; fcMat += mat; fcLabGross += lab
      if (!(fc.salesSchedule || []).some(x => x.date)) noDates += 1
      if (!(fc.salesSchedule || []).some(x => x.appDate)) noVal += 1
      const rev = num(fc.revenueThisPeriod) || num(fc.thisCertTotal)
      // A schedule that does not add back to the period's revenue is losing money silently.
      if (rev > 0 && Math.abs(sales - rev) > 1) spreadOff.push({ name: fc.projectName || fc.projectKey, rev, sales })
      byProject.push({
        name: fc.projectName || fc.projectKey || '(unnamed)', no: fc.projectNo || '',
        from: fc.from, to: fc.to, val: fc.valDate || '', rev, sales, mat, lab,
        cost: mat + lab, pc: sales > 0 ? ((mat + lab) / sales) * 100 : null,
        applied: !!(fc.latestAppEnd && fc.to && fc.to <= fc.latestAppEnd),
      })
    }
    byProject.sort((a, b) => b.sales - a.sales)

    // Can the forecasts be matched to invoices at all? This is what broke the
    // applied-for guard - a lookup that silently found nothing.
    const invKeys = new Set()
    for (const i of recs) { if (i.projectNo) invKeys.add('no:' + String(i.projectNo)); if (i.projectName) invKeys.add('nm:' + normName(i.projectName)) }
    const unmatchable = byProject.filter(p => !invKeys.has('no:' + String(p.no)) && !invKeys.has('nm:' + normName(p.name)))

    const openBank = (cf.manualBalances || []).filter(b => b.kind !== 'card').reduce((t, b) => t + num(b.balance), 0)

    return {
      invTotal, invNoProject, invNoExpected, invOverdue,
      billTotal, billNoProject,
      fcSales, fcMat, fcLabGross, fcCost: fcMat + fcLabGross,
      costPc: fcSales > 0 ? ((fcMat + fcLabGross) / fcSales) * 100 : null,
      noDates, noVal, spreadOff, byProject, unmatchable, openBank,
      count: fcs.length,
    }
  }, [cf])

  if (!ok) return null

  const Flag = ({ bad, children, detail }) => (
    <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 6, fontSize: 12.5,
      background: bad ? '#fef2f2' : '#f4faf6', border: `1px solid ${bad ? '#fecaca' : '#cfe3d6'}`,
      color: bad ? '#b91c1c' : '#166534' }}>
      <strong>{bad ? '\u2717' : '\u2713'}</strong> {children}
      {detail ? <div style={{ fontSize: 11, marginTop: 3, opacity: 0.85 }}>{detail}</div> : null}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f7f6f3' }}>
      <Head><title>Reconciliation - Business Financials</title></Head>
      <BizNav />
      <div style={{ padding: '22px 26px' }}>
        <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>Reconciliation</h1>
        <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4, maxWidth: 900 }}>
          Counts the three sources of truth once - project cash flows, invoices owed, bills to pay - and checks the things that have to be
          true before any forecast built on them can be. Every check below is arithmetic, not opinion: if one fails, that is where the money
          is going astray.
        </div>

        {loading && <div style={{ color: '#999', padding: 30 }}>Loading...</div>}

        {model && (
          <>
            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px', margin: '16px 0' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 8 }}>The three sources, as they stand</div>
              <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  <tr><td style={{ padding: '4px 12px 4px 0' }}>Invoices owed to you</td><td style={{ ...td, fontWeight: 700 }}>{gbp(model.invTotal)}</td></tr>
                  <tr><td style={{ padding: '4px 12px 4px 0' }}>Bills you owe</td><td style={{ ...td, fontWeight: 700 }}>{gbp(-model.billTotal)}</td></tr>
                  <tr><td style={{ padding: '4px 12px 4px 0' }}>Forecast sales still to bill ({model.count} forecasts)</td><td style={{ ...td, fontWeight: 700 }}>{gbp(model.fcSales)}</td></tr>
                  <tr><td style={{ padding: '4px 12px 4px 0' }}>Forecast cost against it</td><td style={{ ...td, fontWeight: 700 }}>{gbp(-model.fcCost)}</td></tr>
                  <tr><td style={{ padding: '4px 12px 4px 0' }}>Bank now</td><td style={{ ...td, fontWeight: 700 }}>{gbp(model.openBank)}</td></tr>
                </tbody>
              </table>
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 8 }}>Checks</div>

              <Flag bad={model.costPc != null && model.costPc < 70}
                detail={model.costPc != null ? `Cost is ${model.costPc.toFixed(0)}% of forecast sales. At 80% it would be ${gbp(model.fcSales * 0.8)}, against ${gbp(model.fcCost)} - about ${gbp(model.fcSales * 0.8 - model.fcCost)} missing.` : 'No forecast sales.'}>
                Cost as a share of forecast sales
              </Flag>

              <Flag bad={model.spreadOff.length > 0}
                detail={model.spreadOff.length
                  ? model.spreadOff.map(x => `${x.name}: revenue ${gbp(x.rev)} but schedule totals ${gbp(x.sales)}`).join('; ')
                  : 'Every forecast schedule adds back to its own revenue.'}>
                Sales schedules add up to the period revenue
              </Flag>

              <Flag bad={model.unmatchable.length > 0}
                detail={model.unmatchable.length
                  ? `${model.unmatchable.length} forecast${model.unmatchable.length === 1 ? '' : 's'} cannot be matched to any invoice by number or name: ${model.unmatchable.slice(0, 6).map(p => p.name).join(', ')}. Anything comparing certified against invoiced is guessing for these.`
                  : 'Every forecast can be matched to invoices by number or name.'}>
                Forecasts can be matched to the invoice ledger
              </Flag>

              <Flag bad={model.noVal > 0}
                detail={model.noVal ? `${model.noVal} forecast(s) have no valuation date, so sales and costs are cut off at the period end instead.` : 'All forecasts carry valuation dates.'}>
                Forecasts carry valuation dates
              </Flag>

              <Flag bad={model.noDates > 0}
                detail={model.noDates ? `${model.noDates} forecast(s) have no dated sales lines and contribute nothing to any cash flow.` : 'All forecasts have dated sales lines.'}>
                Forecasts have dated sales lines
              </Flag>

              <Flag bad={model.invNoExpected.length > 0}
                detail={`${model.invNoExpected.length} of ${(cf.receivables || []).length} invoices have no expected date, so they sit on Xero's due date. ${model.invOverdue.length} are already past their date, worth ${gbp(model.invOverdue.reduce((t, i) => t + num(i.amountDue), 0))}.`}>
                Invoices have expected payment dates
              </Flag>

              <Flag bad={model.invNoProject.length > 0}
                detail={`${model.invNoProject.length} invoice(s) carry neither a project number nor a project name. These cannot be netted against any forecast, so that work may be counted twice.`}>
                Invoices carry a project reference
              </Flag>

              <Flag bad={model.billNoProject.length > 0}
                detail={`${model.billNoProject.length} bill(s) carry no project, so they cannot be netted against forecast cost.`}>
                Bills carry a project reference
              </Flag>
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>Every forecast, as stored</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => download('forecasts.csv', csv([
                    ['Project', 'No', 'From', 'To', 'Valuation', 'Applied for', 'Revenue', 'Sales scheduled', 'Materials', 'Labour (gross)', 'Cost %'],
                    ...model.byProject.map(p => [p.name, p.no, p.from, p.to, p.val, p.applied ? 'yes' : 'no',
                      p.rev.toFixed(2), p.sales.toFixed(2), p.mat.toFixed(2), p.lab.toFixed(2), p.pc == null ? '' : p.pc.toFixed(1)]),
                  ]))} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Forecasts CSV</button>
                  <button onClick={() => download('invoices-owed.csv', csv([
                    ['Invoice', 'Customer', 'Project', 'Date', 'Due', 'Expected', 'Total', 'Still due'],
                    ...(cf.receivables || []).map(i => [i.invoiceNumber || i.number || '', i.contact || '', i.projectName || i.projectNo || '',
                      i.date || '', i.dueDate || '', i.expectedDate || '', num(i.total).toFixed(2), num(i.amountDue).toFixed(2)]),
                  ]))} style={{ background: '#f2f2f0', border: '1px solid #e2e2de', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, cursor: 'pointer' }}>Invoices CSV</button>
                  <button onClick={() => download('bills-to-pay.csv', csv([
                    ['Reference', 'Supplier', 'Project', 'Due', 'Planned', 'CIS', 'Total', 'Still due'],
                    ...(cf.bills || []).map(b => [b.reference || b.invoiceNumber || '', b.contact || b.supplier || '', b.project || '',
                      b.dueDate || '', b.payDate || '', b.cis ? 'yes' : 'no', num(b.total).toFixed(2), Math.abs(num(b.amountDue)).toFixed(2)]),
                  ]))} style={{ background: '#f2f2f0', border: '1px solid #e2e2de', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, cursor: 'pointer' }}>Bills CSV</button>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                    <th style={{ ...th, textAlign: 'left' }}>Project</th>
                    <th style={{ ...th, textAlign: 'left' }}>Period</th>
                    <th style={{ ...th, textAlign: 'left' }}>Valued</th>
                    <th style={th}>Revenue</th>
                    <th style={th}>Scheduled</th>
                    <th style={th}>Materials</th>
                    <th style={th}>Labour</th>
                    <th style={th}>Cost %</th>
                  </tr></thead>
                  <tbody>
                    {model.byProject.map((p, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f2f0ec', opacity: p.applied ? 0.55 : 1 }}>
                        <td style={{ ...td, textAlign: 'left' }}>{p.name}{p.applied ? <span style={{ color: '#999', fontSize: 10 }}> applied for</span> : null}</td>
                        <td style={{ ...td, textAlign: 'left', color: '#999', fontSize: 11 }}>{p.from} to {p.to}</td>
                        <td style={{ ...td, textAlign: 'left', color: p.val ? '#5b7085' : '#dc2626', fontSize: 11 }}>{p.val || 'none'}</td>
                        <td style={td}>{gbp(p.rev)}</td>
                        <td style={{ ...td, color: Math.abs(p.sales - p.rev) > 1 ? '#dc2626' : '#666' }}>{gbp(p.sales)}</td>
                        <td style={{ ...td, color: p.mat ? '#666' : '#dc2626' }}>{p.mat ? gbp(p.mat) : 'none'}</td>
                        <td style={{ ...td, color: p.lab ? '#666' : '#dc2626' }}>{p.lab ? gbp(p.lab) : 'none'}</td>
                        <td style={{ ...td, fontWeight: 700, color: p.pc == null ? '#ccc' : p.pc < 70 ? '#dc2626' : '#16a34a' }}>{p.pc == null ? '-' : `${p.pc.toFixed(0)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
