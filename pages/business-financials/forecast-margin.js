import { useState, useEffect, useMemo, Fragment } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, gbp } from '../../components/BizNav'

const pad = (n) => String(n).padStart(2, '0')
const monthName = (mk) => {
  const [y, m] = String(mk).split('-').map(Number)
  if (!y || !m) return mk
  return `${new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' })} ${String(y).slice(2)}`
}

// "J190 - Russell Hill", never the raw Redis key.
const projLabel = (fc) => {
  const no = fc.projectNo ? String(fc.projectNo) : ''
  const nm = (fc.projectName || '').trim()
  if (no && nm) return nm.startsWith(no) ? nm : `${no} - ${nm}`
  return nm || no || String(fc.projectKey || '').replace(/^[LN]:/, '') || '(unnamed)'
}

const th = { padding: '8px 10px', fontSize: 11, color: '#888', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
const td = { padding: '7px 10px', fontSize: 12.5, textAlign: 'right', whiteSpace: 'nowrap' }

export default function ForecastMarginPage() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [openMonth, setOpenMonth] = useState(null)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
      fetch('/api/business-financials?view=cashflow')
        .then(r => r.json()).then(x => { setData(x); setLoading(false) })
        .catch(() => setLoading(false))
    })
  }, [])

  // GROSS MARGIN ON AN ACCRUAL BASIS.
  //
  // Not the cash flow with different labels. Revenue is taken when the work is VALUED,
  // materials when DELIVERED and labour when the work was DONE - all three already
  // stored on the forecast, just under different fields from the ones the cash flow
  // reads. A period paid in December for work valued in September belongs to September
  // here and to December there, and both are right.
  const months = useMemo(() => {
    if (!data) return []
    const m = {}
    const bucket = (mk) => (m[mk] = m[mk] || { mk, revenue: 0, materials: 0, labour: 0, projects: {} })
    const proj = (b, name) => (b.projects[name] = b.projects[name] || { revenue: 0, materials: 0, labour: 0 })

    for (const fc of (data.projForecasts || [])) {
      const a = fc.accrual
      if (!a) continue
      const name = projLabel(fc)

      // Spread across the period's months where the forecast has that detail. Putting a
      // whole period's revenue on its end date while costs spread across three months
      // produced 90% one month and negative the next - arithmetically true, commercially
      // meaningless.
      for (const r of (a.revenueByMonth || [])) {
        if (!r.month || !r.amount) continue
        const b = bucket(r.month)
        b.revenue += r.amount
        proj(b, name).revenue += r.amount
      }
      for (const x of (a.materials || [])) {
        if (!x.date || !x.amount) continue
        const b = bucket(String(x.date).slice(0, 7))
        b.materials += x.amount
        proj(b, name).materials += x.amount
      }
      for (const x of (a.labour || [])) {
        if (!x.date || !x.amount) continue
        const b = bucket(String(x.date).slice(0, 7))
        b.labour += x.amount
        proj(b, name).labour += x.amount
      }
    }
    return Object.values(m).sort((x, y) => x.mk.localeCompare(y.mk))
  }, [data])

  const totals = months.reduce((a, x) => ({
    revenue: a.revenue + x.revenue, materials: a.materials + x.materials, labour: a.labour + x.labour,
  }), { revenue: 0, materials: 0, labour: 0 })
  const tCost = totals.materials + totals.labour
  const tMargin = totals.revenue - tCost

  if (!ok) return null

  return (
    <div style={{ minHeight: '100vh', background: '#f7f6f3' }}>
      <Head><title>Forecast Margin - Business Financials</title></Head>
      <BizNav />
      <div style={{ padding: '22px 26px' }}>
        <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>Forecast gross margin</h1>
        <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4, maxWidth: 920 }}>
          An ACCRUAL view of the project forecasts, not the cash flow relabelled. Revenue is taken when the work is <strong>valued</strong>,
          materials when <strong>delivered</strong>, labour when the work was <strong>done</strong>. A period paid in December for work
          valued in September sits in September here and in December on the cash flow - both are right, they answer different questions.
          Overheads are not included, so this is GROSS margin, not profit.
        </div>

        {loading && <div style={{ color: '#999', padding: 30 }}>Loading...</div>}

        {!loading && months.length === 0 && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 16px', marginTop: 18, fontSize: 13, color: '#92400e' }}>
            No project forecasts with accrual dates yet. If the Cash Flow page is showing project figures but this is empty, the API file
            in this package has not been deployed.
          </div>
        )}

        {!loading && months.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 12, margin: '18px 0', flexWrap: 'wrap' }}>
              <Box label="Forecast revenue" value={gbp(totals.revenue)} />
              <Box label="Materials" value={gbp(-totals.materials)} colour="#dc2626" />
              <Box label="Labour" value={gbp(-totals.labour)} colour="#dc2626" />
              <Box label="Gross margin" value={gbp(tMargin)} colour={tMargin < 0 ? '#dc2626' : '#16a34a'} strong
                sub={totals.revenue > 0 ? `${((tMargin / totals.revenue) * 100).toFixed(1)}% of revenue` : ''} />
            </div>

            {/* A margin far above what the trade earns means COST IS MISSING from the
                forecasts, not that the job is exceptional. Said plainly, because a
                margin figure looks authoritative in a way a cash figure does not. */}
            {totals.revenue > 0 && (tMargin / totals.revenue) > 0.35 && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#b91c1c' }}>
                <strong>{((tMargin / totals.revenue) * 100).toFixed(1)}% gross margin is not credible for roofing</strong> - a subcontract
                period normally runs 15-25%. This says cost is MISSING from the forecasts, not that the work is unusually profitable.
                At 20% the cost on {gbp(totals.revenue)} would be {gbp(totals.revenue * 0.8)}, against {gbp(tCost)} forecast -
                roughly {gbp(totals.revenue * 0.8 - tCost)} unaccounted for. Open a month below to see which projects.
              </div>
            )}

            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                  <th style={{ ...th, textAlign: 'left' }}>Month</th>
                  <th style={th}>Revenue</th>
                  <th style={th}>Materials</th>
                  <th style={th}>Labour</th>
                  <th style={th}>Gross margin</th>
                  <th style={th}>Margin %</th>
                </tr></thead>
                <tbody>
                  {months.map(x => {
                    const cost = x.materials + x.labour
                    const margin = x.revenue - cost
                    const pc = x.revenue > 0 ? (margin / x.revenue) * 100 : null
                    const open = openMonth === x.mk
                    return (
                      <Fragment key={x.mk}>
                        <tr onClick={() => setOpenMonth(open ? null : x.mk)}
                          title="Click to see the projects in this month"
                          style={{ borderBottom: '1px solid #f2f0ec', cursor: 'pointer', background: open ? '#f7faf9' : 'transparent' }}>
                          <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>
                            <span style={{ fontSize: 9, color: '#999', marginRight: 4 }}>{open ? '\u25BC' : '\u25B6'}</span>{monthName(x.mk)}
                          </td>
                          <td style={{ ...td, color: '#0f766e' }}>{x.revenue ? gbp(x.revenue) : '-'}</td>
                          <td style={{ ...td, color: x.materials ? '#dc2626' : '#ccc' }}>{x.materials ? gbp(-x.materials) : '-'}</td>
                          <td style={{ ...td, color: x.labour ? '#dc2626' : '#ccc' }}>{x.labour ? gbp(-x.labour) : '-'}</td>
                          <td style={{ ...td, fontWeight: 600, color: margin < 0 ? '#dc2626' : INK }}>{gbp(margin)}</td>
                          <td style={{ ...td, fontWeight: 700, color: pc == null ? '#999' : (pc > 35 || pc < 0) ? '#dc2626' : '#16a34a' }}>
                            {pc == null ? '-' : `${pc.toFixed(0)}%`}
                          </td>
                        </tr>
                        {open && Object.entries(x.projects).sort((a, b) => b[1].revenue - a[1].revenue).map(([nm, p]) => {
                          const c = p.materials + p.labour
                          const mg = p.revenue - c
                          const mp = p.revenue > 0 ? (mg / p.revenue) * 100 : null
                          return (
                            <tr key={nm} style={{ background: '#fbfdfc', borderBottom: '1px solid #f5f4f1' }}>
                              <td style={{ ...td, textAlign: 'left', paddingLeft: 30, color: '#5b7085' }}>{nm}</td>
                              <td style={{ ...td, color: '#0f766e' }}>{p.revenue ? gbp(p.revenue) : '-'}</td>
                              <td style={{ ...td, color: p.materials ? '#dc2626' : '#c00' }}>{p.materials ? gbp(-p.materials) : 'none'}</td>
                              <td style={{ ...td, color: p.labour ? '#dc2626' : '#c00' }}>{p.labour ? gbp(-p.labour) : 'none'}</td>
                              <td style={{ ...td, color: mg < 0 ? '#dc2626' : '#555' }}>{gbp(mg)}</td>
                              <td style={{ ...td, color: mp == null ? '#ccc' : (mp > 35 || mp < 0) ? '#dc2626' : '#16a34a' }}>{mp == null ? '-' : `${mp.toFixed(0)}%`}</td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot><tr style={{ borderTop: '2px solid #ddd', background: '#faf9f7', fontWeight: 700 }}>
                  <td style={{ ...td, textAlign: 'left' }}>Total ({months.length} months)</td>
                  <td style={{ ...td, color: '#0f766e' }}>{gbp(totals.revenue)}</td>
                  <td style={{ ...td, color: '#dc2626' }}>{gbp(-totals.materials)}</td>
                  <td style={{ ...td, color: '#dc2626' }}>{gbp(-totals.labour)}</td>
                  <td style={{ ...td, color: tMargin < 0 ? '#dc2626' : INK }}>{gbp(tMargin)}</td>
                  <td style={td}>{totals.revenue > 0 ? `${((tMargin / totals.revenue) * 100).toFixed(0)}%` : '-'}</td>
                </tr></tfoot>
              </table>
              <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 8, lineHeight: 1.4 }}>
                MONTHLY MARGIN IS LUMPY BY NATURE and the TOTAL is the figure to judge. Materials are taken when delivered, so one
                delivery lands wholly in one month - a period spread 25% a month across four can show 19%, 59%, -103% and 100% while
                totalling a perfectly ordinary 18%. That is accrual accounting doing what it does, not an error.
                Forecast periods only - a period already applied for is a real application and belongs in the actual P&amp;L, not here.
                Overheads, depreciation and accruals are not included, so this is gross margin rather than operating profit.
                Legacy forecasts that stored only a delivery date are MORE accurate here than on the cash flow, because the accrual
                date is the stored fact while the payment date had to be rebuilt from an assumed term.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
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
