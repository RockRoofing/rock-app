import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, gbp } from '../../components/BizNav'
import { buildForecastMonths, monthShort } from '../../lib/forecastMonths'

const th = { padding: '7px 8px', fontSize: 10.5, color: '#888', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
const td = { padding: '6px 8px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }
const lbl = { ...td, textAlign: 'left', whiteSpace: 'nowrap' }
const inp = { padding: '5px 7px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12.5, width: 100, textAlign: 'right' }
const btn = { background: '#fff', border: '1px solid #ddd9d2', borderRadius: 6, padding: '5px 11px', fontSize: 12, cursor: 'pointer', color: '#57534e' }

export default function ForecastPL() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(true)
  const [oh, setOh] = useState(null)      // budgets-overheads
  const [mg, setMg] = useState(null)      // margin (actual P&L by month)
  const [cf, setCf] = useState(null)      // cashflow (project forecasts, accrual dates)
  const [manual, setManual] = useState({})
  const [openMonth, setOpenMonth] = useState(null)
  const [openYeWip, setOpenYeWip] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftMo, setDraftMo] = useState('')
  const [draft, setDraft] = useState({ revenue: '', cos: '', materials: '', labour: '' })
  const [saved, setSaved] = useState('')
  const [wipInclude, setWipInclude] = useState(undefined)   // undefined = follow what the API stored
  const [yeWip, setYeWip] = useState({ enabled: true, override: null })

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
      // COMPOSED FROM THE EXISTING ENDPOINTS, not rebuilt server-side. Overheads come
      // from the same source the Budgets tab uses, actuals from the same source the
      // Margin tab uses, forecasts from the same source the Cash Flow uses - so the
      // pages agree by construction rather than by being kept in step by hand.
      Promise.all([
        fetch('/api/business-financials?view=budgets-overheads').then(r => r.json()).catch(() => null),
        fetch('/api/business-financials?view=margin').then(r => r.json()).catch(() => null),
        fetch('/api/business-financials?view=cashflow').then(r => r.json()).catch(() => null),
      ]).then(([a, b, c]) => {
        setOh(a); setMg(b); setCf(c)
        setManual((a && a.plManualMonths) || {})
        setWipInclude(a ? a.plWipInclude : null)
        setYeWip((a && a.plYeWip) || { enabled: true, override: null })
        setLoading(false)
      })
    })
  }, [])

  const model = useMemo(
    () => buildForecastMonths({ oh, mg, cf, manual, wipLocks: (oh && oh.wipLocks) || {}, wipInclude,
      yeWipEnabled: yeWip.enabled !== false, yeWipOverride: yeWip.override }),
    [oh, mg, cf, manual, wipInclude, yeWip])

  async function saveManual(next) {
    setManual(next); setSaved('saving')
    try {
      const r = await fetch('/api/business-financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'budgets-overheads', action: 'save-pl-manual', plManualMonths: next }),
      })
      setSaved(r.ok ? 'saved' : 'NOT SAVED')
      if (r.ok) setTimeout(() => setSaved(''), 1600)
    } catch { setSaved('NOT SAVED') }
  }

  async function saveWipInclude(next) {
    setWipInclude(next); setSaved('saving')
    try {
      const r = await fetch('/api/business-financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'budgets-overheads', action: 'save-wip-include', wipInclude: next === undefined ? null : next }),
      })
      setSaved(r.ok ? 'saved' : 'NOT SAVED')
      if (r.ok) setTimeout(() => setSaved(''), 1600)
    } catch { setSaved('NOT SAVED') }
  }

  async function saveYeWip(next) {
    setYeWip(next); setSaved('saving')
    try {
      const r = await fetch('/api/business-financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'budgets-overheads', action: 'save-ye-wip', yeWipEnabled: next.enabled, yeWipOverride: next.override }),
      })
      setSaved(r.ok ? 'saved' : 'NOT SAVED')
      if (r.ok) setTimeout(() => setSaved(''), 1600)
    } catch { setSaved('NOT SAVED') }
  }

  function openEditor(mo) {
    const e = manual[mo] || {}
    setDraftMo(mo)
    setDraft({
      revenue: e.revenue == null ? '' : String(e.revenue),
      cos: e.cos == null ? '' : String(e.cos),
      materials: e.materials == null ? '' : String(e.materials),
      labour: e.labour == null ? '' : String(e.labour),
    })
    setEditing(true)
  }

  function applyDraft() {
    const clean = {}
    for (const k of ['revenue', 'cos', 'materials', 'labour']) {
      const v = String(draft[k]).trim()
      if (v !== '') clean[k] = Number(v) || 0
    }
    const next = { ...manual }
    if (Object.keys(clean).length === 0) delete next[draftMo]
    else next[draftMo] = clean
    saveManual(next)
    setEditing(false)
  }

  function clearMonth(mo) {
    const next = { ...manual }
    delete next[mo]
    saveManual(next)
  }

  if (!ok) return null

  const manualRows = model ? model.rows.filter(r => r.isManual) : []
  const openRow = model && openMonth ? model.rows.find(r => r.mo === openMonth) : null
  const openList = (openRow && openRow.projects)
    ? Object.keys(openRow.projects).map(nm => ({ name: nm, ...openRow.projects[nm] })).sort((x, y) => y.revenue - x.revenue)
    : []

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
          on the Budgets tab. Actual months take income, cost of sales and overheads from Xero; forecast months take revenue and cost of sale
          from the project forecasts on an accrual basis, and overheads from the Budgets grid. A month can also be set
          to <strong>MANUAL</strong> below, where you know the figures but the forecasts do not cover them.
        </div>

        {loading && <div style={{ color: '#999', padding: 30 }}>Loading...</div>}

        {!loading && !model && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginTop: 18, fontSize: 13, color: '#b91c1c' }}>
            Could not load one of the three sources this page composes - Budgets, Margin or Cash Flow. Open each and check it works, then come back.
          </div>
        )}

        {model && (
          <>
            <div style={{ display: 'flex', gap: 12, margin: '18px 0', flexWrap: 'wrap' }}>
              <Box label="Revenue (FY)" value={gbp(model.adjTotals.revenue)} sub={`${gbp(model.adjTotals.aRev)} actual/manual + ${gbp(model.adjTotals.fRev)} forecast`} />
              <Box label="Cost of sale" value={gbp(-model.totals.cos)} colour="#dc2626" />
              <Box label="Gross profit" value={gbp(model.adjTotals.gross)} colour={model.adjTotals.gross < 0 ? '#dc2626' : '#0f766e'}
                sub={model.adjTotals.revenue > 0 ? `${((model.adjTotals.gross / model.adjTotals.revenue) * 100).toFixed(1)}%` : ''} />
              <Box label="Overheads" value={gbp(-model.totals.overheads)} colour="#b45309" />
              <Box label="Net profit (FY)" value={gbp(model.adjTotals.net)} colour={model.adjTotals.net < 0 ? '#dc2626' : '#16a34a'} strong
                sub={`${model.actualCount} actual, ${model.manualCount} manual of 12`} />
            </div>

            {/* MANUAL FIGURES, listed rather than buried in the grid. A typed number that
                outlives the reason it was typed is worse than no number, so anything
                overridden says so here with a one-click way back to the forecast. */}
            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13, color: INK }}>Manual month figures</strong>
                <span style={{ fontSize: 11.5, color: '#8a857c' }}>
                  Revenue, cost of sale, materials and labour. Overheads always come from Budgets.
                </span>
                <select value="" onChange={e => { if (e.target.value) openEditor(e.target.value) }}
                  style={{ ...inp, width: 140, textAlign: 'left' }}>
                  <option value="">Set a month...</option>
                  {model.rows.map(r => <option key={r.mo} value={r.mo}>{monthShort(r.mo)}</option>)}
                </select>
                {saved ? <span style={{ fontSize: 11.5, color: saved === 'NOT SAVED' ? '#dc2626' : '#16a34a' }}>{saved}</span> : null}
              </div>

              {manualRows.length === 0 && (
                <div style={{ fontSize: 11.5, color: '#a8a49c', marginTop: 8 }}>
                  None set. Every month is on Xero actuals or the project forecasts.
                </div>
              )}
              {manualRows.map(r => (
                <div key={r.mo} style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
                  <strong style={{ color: '#1d4ed8', minWidth: 60 }}>{monthShort(r.mo)}</strong>
                  <span>Revenue {gbp(r.revenue)}</span>
                  <span style={{ color: '#dc2626' }}>Cost of sale {gbp(-r.cos)}</span>
                  {r.materials == null ? null : <span style={{ color: '#999' }}>materials {gbp(-r.materials)}</span>}
                  {r.labour == null ? null : <span style={{ color: '#999' }}>labour {gbp(-r.labour)}</span>}
                  <button onClick={() => openEditor(r.mo)} style={btn}>Edit</button>
                  <button onClick={() => clearMonth(r.mo)} style={{ ...btn, color: '#b91c1c' }}>Back to forecast</button>
                  {r.cosDisagrees ? (
                    <span style={{ color: '#b45309', fontSize: 11.5 }}>
                      cost of sale does not equal materials plus labour - the typed total is being used
                    </span>
                  ) : null}
                  {r.alsoActual ? (
                    <span style={{ color: '#b45309', fontSize: 11.5 }}>
                      also switched to Actual on Budgets - these typed figures are being used instead of Xero
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            {/* YEAR-END WIP ACCRUAL panel, with the per-project working shown. On a
                figure this soft the arithmetic is a starting point, not an answer. */}
            {model.yeWip.applies || model.yeWip.reason ? (
              <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13, color: INK }}>Year-end WIP accrual</strong>
                  {model.yeWip.applies ? (
                    <>
                      <span style={{ fontSize: 12.5 }}>
                        revenue <strong style={{ color: '#0f766e' }}>{gbp(model.yeWip.revenue)}</strong>
                        {' '}on {gbp(model.yeWip.accrued)} of work at {(model.yeWip.margin * 100).toFixed(1)}%
                      </span>
                      <label style={{ fontSize: 12.5, color: '#57534e', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={yeWip.enabled !== false}
                          onChange={e => saveYeWip({ ...yeWip, enabled: e.target.checked })} />
                        include
                      </label>
                      <span style={{ fontSize: 12, color: '#8a857c' }}>or type a figure</span>
                      <input type="number" value={yeWip.override == null ? '' : yeWip.override} placeholder="auto"
                        onChange={e => setYeWip({ ...yeWip, override: e.target.value === '' ? null : e.target.value })}
                        onBlur={() => saveYeWip({ ...yeWip, override: yeWip.override === '' || yeWip.override == null ? null : Number(yeWip.override) || 0 })}
                        style={{ ...inp, width: 110 }} />
                      {model.yeWip.overridden ? <span style={{ fontSize: 11.5, color: '#1d4ed8' }}>typed figure in use</span> : null}
                    </>
                  ) : (
                    <span style={{ fontSize: 12.5, color: '#8a857c' }}>Not applied - {model.yeWip.reason}.</span>
                  )}
                </div>
                {model.yeWip.applies ? (
                  <div style={{ fontSize: 11.5, color: '#8a857c', marginTop: 6, lineHeight: 1.45, maxWidth: 940 }}>
                      Work done between each project&apos;s LAST APPLICATION on or before 30 November and the 30th itself -
                      the part not claimed until December. A project applying ON the 30th has no unclaimed window and
                      does not appear. Nothing past the 30th is taken: December&apos;s cost belongs to December. Materials are taken on their delivery date and are ALREADY in
                      November&apos;s cost, so only the revenue is missing; labour is pro-rated on WORKING DAYS and is added
                      as cost too, because it sits at the end of its instalment window in December. The margin excludes
                    that orphaned cost, otherwise it would drag itself down. Open the arrow on the
                    year-end WIP rows in the table for the project-by-project working.
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* WIP. Stated plainly, because a figure being taken off the year without
                anything saying so is exactly the kind of silent adjustment that gets
                mistrusted the first time somebody checks the arithmetic. */}
            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13, color: INK }}>Work in progress</strong>
                {model.wip.available ? (
                  <>
                    <span style={{ fontSize: 12.5 }}>
                      {monthShort(model.wip.month)} signed-off WIP <strong>{gbp(model.wip.amount)}</strong>
                    </span>
                    <label style={{ fontSize: 12.5, color: '#57534e', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="checkbox" checked={!!model.wip.include}
                        onChange={e => saveWipInclude(e.target.checked)} />
                      include in the FY total
                    </label>
                    {wipInclude === true || wipInclude === false ? (
                      <button onClick={() => saveWipInclude(undefined)} style={btn}>back to automatic</button>
                    ) : (
                      <span style={{ fontSize: 11.5, color: '#8a857c' }}>
                        automatic - {model.wip.isFyEnd ? 'included, because the last actual month is the year end' : 'excluded'}
                      </span>
                    )}
                  </>
                ) : (
                  <span style={{ fontSize: 12.5, color: '#8a857c' }}>Nothing to adjust - {model.wip.reason}.</span>
                )}
              </div>
              {model.wip.available ? (
                <div style={{ fontSize: 11.5, color: '#8a857c', marginTop: 6, lineHeight: 1.45, maxWidth: 900 }}>
                  The journal is inside Xero&apos;s income for {monthShort(model.wip.month)} and reverses on the 1st.
                  Between two closed months that cancels out, but the reversal after the last actual month falls in a
                  FORECAST month, which never sees it - and the forecast then earns the same work again when it is
                  certified. So it comes off the year once, not off any month.
                  {model.wip.exact ? null : (
                    <strong style={{ color: '#b45309' }}>
                      {' '}{monthShort(model.wip.lastActual)} has no signed-off WIP, so {monthShort(model.wip.month)} is being used instead.
                      Sign off {monthShort(model.wip.lastActual)} in Commercial for the right figure.
                    </strong>
                  )}
                  {model.wip.include ? null : (
                    <span> The FY total is therefore {gbp(model.wip.amount)} below the sum of the monthly columns, by design.</span>
                  )}
                </div>
              ) : null}
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
                <thead>
                  <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                    <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: '#faf9f7' }}>Month</th>
                    {model.rows.map(r => (
                      <th key={r.mo} onClick={() => { if (r.projects) setOpenMonth(openMonth === r.mo ? null : r.mo) }}
                        title={r.projects ? 'Click to see the projects behind this month' : 'No breakdown - Xero gives one cost-of-sales total for a closed month'}
                        style={{ ...th, cursor: r.projects ? 'pointer' : 'default',
                          background: r.isManual ? '#eff6ff' : (r.isActual ? '#f4faf6' : '#fffdf5'),
                          outline: openMonth === r.mo ? '2px solid #cbd5e1' : 'none' }}>
                        {monthShort(r.mo)}
                        <div style={{ fontSize: 9, fontWeight: 700, color: r.isManual ? '#1d4ed8' : (r.isActual ? '#16a34a' : '#b45309') }}>
                          {r.isManual ? 'MANUAL' : r.isActual ? 'ACTUAL' : 'forecast'}
                          {r.projects ? <span style={{ color: '#999' }}> {openMonth === r.mo ? '\u25BC' : '\u25B6'}</span> : null}
                        </div>
                      </th>
                    ))}
                    <th style={{ ...th, background: '#eef3fb' }}>FY total</th>
                  </tr>
                </thead>
                <tbody>
                  {/* GROSS of retention. Retention is a debtor, not a reduction in
                      revenue - earned at the valuation date, just not yet received. The
                      cash flow uses the net figure, which is right there and wrong here. */}
                  <Line label="Revenue (gross of retention)" rows={model.rows} pick={r => r.revenue} colour="#0f766e" total={model.totals.revenue} />
                  <Line label="Cost of sale" rows={model.rows} pick={r => -r.cos} colour="#dc2626" total={-model.totals.cos} />
                  {/* Materials and labour only exist separately on FORECAST months, or
                      where they have been typed - Xero gives one cost-of-sales total for
                      a closed month, not the split. */}
                  <Line label="   materials" rows={model.rows} pick={r => r.materials == null ? null : -r.materials} colour="#a1a1aa" small total={null} />
                  <Line label="   labour" rows={model.rows} pick={r => r.labour == null ? null : -r.labour} colour="#a1a1aa" small total={null} />
                  <Line label="Gross profit" rows={model.rows} pick={r => r.gross} colour={INK} bold total={model.totals.gross} />
                  <Line label="Overheads" rows={model.rows} pick={r => -r.overheads} colour="#b45309" total={-model.totals.overheads} />
                  <Line label="Net profit" rows={model.rows} pick={r => r.net} colour={INK} bold band total={model.totals.net} />
                  <Line label="Gross margin %" rows={model.rows} pick={r => r.revenue > 0 ? (r.gross / r.revenue) * 100 : null} pct
                    total={model.totals.revenue > 0 ? (model.totals.gross / model.totals.revenue) * 100 : null} />
                  <Line label="Net margin %" rows={model.rows} pick={r => r.revenue > 0 ? (r.net / r.revenue) * 100 : null} pct
                    total={model.adjTotals.revenue > 0 ? (model.adjTotals.net / model.adjTotals.revenue) * 100 : null} />
                  {/* WIP COMES OFF THE YEAR, NOT OFF A MONTH. Every monthly column above
                      is left exactly as Xero reports it; this single row carries the
                      adjustment in the FY column, which is why the total no longer sums
                      the columns. */}
                  {model.wip.available && !model.wip.include ? (
                    <WipLine rows={model.rows} amount={model.wip.amount} month={model.wip.month} />
                  ) : null}
                  {/* YEAR-END WIP ACCRUAL. Cost after the November valuation date is
                      already in November for materials, so only the labour shortfall is
                      added; the revenue against the whole accrual is what was missing. */}
                  {model.yeWip.applies ? (
                    <YeWipLine rows={model.rows} label="plus year-end WIP cost (labour to 30 Nov)"
                      amount={-model.yeWip.costTopUp} colour="#dc2626"
                      open={openYeWip} onToggle={() => setOpenYeWip(!openYeWip)} />
                  ) : null}
                  {model.yeWip.applies ? (
                    <YeWipLine rows={model.rows} label="plus year-end WIP revenue"
                      amount={model.yeWip.revenue} colour="#0f766e"
                      open={openYeWip} onToggle={() => setOpenYeWip(!openYeWip)} />
                  ) : null}
                  {(model.wip.available && !model.wip.include) || model.yeWip.applies ? (
                    <Line label="Net profit after adjustments" rows={model.rows} pick={() => null} colour={INK} bold band total={model.adjTotals.net} />
                  ) : null}
                </tbody>
              </table>

              {/* WHAT MAKES UP THE MONTH. Only forecast months have this - a closed month
                  is one cost-of-sales total from Xero, and a manual month is a figure
                  somebody typed, so neither has projects behind it. */}
              {openRow && openRow.projects ? (
                <div style={{ marginTop: 16, borderTop: '2px solid #eee', paddingTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 6 }}>
                    What makes up {monthShort(openRow.mo)}
                    <button onClick={() => setOpenMonth(null)} style={{ ...btn, marginLeft: 10, fontSize: 11, padding: '3px 8px' }}>close</button>
                  </div>
                  {openList.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: '#8a857c' }}>Nothing forecast in {monthShort(openRow.mo)}.</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr style={{ background: '#faf9f7', borderBottom: '1px solid #eee' }}>
                        <th style={{ ...th, textAlign: 'left' }}>Project</th>
                        <th style={th}>Revenue</th><th style={th}>Materials</th><th style={th}>Labour</th>
                        <th style={th}>Gross</th><th style={th}>Margin %</th>
                      </tr></thead>
                      <tbody>
                        {openList.map(p => {
                          const cost = p.materials + p.labour
                          const gm = p.revenue - cost
                          const pc = p.revenue > 0 ? (gm / p.revenue) * 100 : null
                          return (
                            <tr key={p.name} style={{ borderBottom: '1px solid #f5f4f1' }}>
                              <td style={{ ...td, textAlign: 'left', color: '#5b7085' }}>{p.name}</td>
                              <td style={{ ...td, color: '#0f766e' }}>{p.revenue ? gbp(p.revenue) : '-'}</td>
                              {/* "none" rather than a dash: a project with revenue and no
                                  cost is missing its forecast, not costing nothing. */}
                              <td style={{ ...td, color: p.materials ? '#dc2626' : '#c00' }}>{p.materials ? gbp(-p.materials) : 'none'}</td>
                              <td style={{ ...td, color: p.labour ? '#dc2626' : '#c00' }}>{p.labour ? gbp(-p.labour) : 'none'}</td>
                              <td style={{ ...td, color: gm < 0 ? '#dc2626' : '#555' }}>{gbp(gm)}</td>
                              <td style={{ ...td, fontWeight: 600, color: pc == null ? '#ccc' : (pc < 0 ? '#dc2626' : '#16a34a') }}>
                                {pc == null ? '-' : `${pc.toFixed(0)}%`}
                              </td>
                            </tr>
                          )
                        })}
                        <tr style={{ background: '#f7faf9', borderTop: '2px solid #eee' }}>
                          <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>Total</td>
                          <td style={{ ...td, fontWeight: 700, color: '#0f766e' }}>{gbp(openRow.revenue)}</td>
                          <td style={{ ...td, fontWeight: 700, color: '#dc2626' }}>{gbp(-(openRow.materials || 0))}</td>
                          <td style={{ ...td, fontWeight: 700, color: '#dc2626' }}>{gbp(-(openRow.labour || 0))}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{gbp(openRow.gross)}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{openRow.revenue > 0 ? `${((openRow.gross / openRow.revenue) * 100).toFixed(0)}%` : '-'}</td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
              ) : null}

              {/* Year-end WIP working, opened from either of the two rows above. */}
              {openYeWip && model.yeWip.applies ? (
                <div style={{ marginTop: 16, borderTop: '2px solid #eee', paddingTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 6 }}>
                    Year-end WIP - work after each valuation date to 30 Nov
                    <button onClick={() => setOpenYeWip(false)} style={{ ...btn, marginLeft: 10, fontSize: 11, padding: '3px 8px' }}>close</button>
                  </div>
                    <div style={{ overflowX: 'auto', marginTop: 8 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr style={{ background: '#faf9f7', borderBottom: '1px solid #eee' }}>
                          <th style={{ ...th, textAlign: 'left' }}>Project</th>
                          <th style={{ ...th, textAlign: 'left' }}>Period</th>
                          <th style={th}>Materials</th><th style={th}>Labour (wd)</th>
                          <th style={th}>Accrued cost</th><th style={th}>Already in Nov</th>
                          <th style={th}>Cost added</th><th style={th}>Revenue</th>
                        </tr></thead>
                        <tbody>
                          {model.yeWip.projects.map(p2 => (
                            <tr key={p2.name} style={{ borderBottom: '1px solid #f5f4f1' }}>
                              <td style={{ ...td, textAlign: 'left', color: '#5b7085' }}>{p2.name}</td>
                              <td style={{ ...td, textAlign: 'left', color: '#999', fontSize: 11 }}>{p2.from} to {p2.to}</td>
                              <td style={td}>{gbp(p2.materials)}</td>
                              <td style={td}>
                                {gbp(p2.labour)}
                                {p2.labourPart ? <span style={{ color: '#bbb', fontSize: 10 }}> {p2.wdBefore}/{p2.wdAll} pro-rata</span> : null}
                              </td>
                              <td style={td}>{gbp(p2.accrued)}</td>
                              <td style={{ ...td, color: '#999' }}>{gbp(p2.alreadyIn)}</td>
                              <td style={{ ...td, color: p2.costTopUp ? '#dc2626' : '#ccc' }}>{p2.costTopUp ? gbp(p2.costTopUp) : '-'}</td>
                              <td style={{ ...td, color: '#0f766e', fontWeight: 600 }}>{gbp(p2.revenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                  </div>
                </div>
              ) : null}

              <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 8, lineHeight: 1.45 }}>
                Click a forecast month heading to see the projects behind it. Xero gives ONE cost-of-sales total for a closed month, so
                actual months have no breakdown. Forecast revenue is spread across the months each period&apos;s sales schedule says, materials
                are taken when DELIVERED and labour when the work was DONE. Depreciation, accruals and corporation tax are not modelled,
                so net profit here is before those.
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modals never close on backdrop click - the cross or Escape only. */}
      {editing ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '18px 20px', width: 380, maxWidth: '92vw' }}
            onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <strong style={{ fontSize: 15, color: INK }}>{monthShort(draftMo)} - manual figures</strong>
              <button onClick={() => setEditing(false)} style={{ ...btn, border: 'none', fontSize: 18, padding: '0 6px' }}>&times;</button>
            </div>
            <div style={{ fontSize: 11.5, color: '#8a857c', marginBottom: 12 }}>
              Leave a box empty to leave that figure alone. Empty them all and the month goes back to the forecast.
              Cost of sale is taken as materials plus labour unless you type it.
            </div>
            <DraftField label="Revenue (gross of retention)" k="revenue" draft={draft} setDraft={setDraft} />
            <DraftField label="Materials" k="materials" draft={draft} setDraft={setDraft} />
            <DraftField label="Labour" k="labour" draft={draft} setDraft={setDraft} />
            <DraftField label="Cost of sale (optional)" k="cos" draft={draft} setDraft={setDraft} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => setEditing(false)} style={btn}>Cancel</button>
              <button onClick={applyDraft} style={{ ...btn, background: '#1d4ed8', color: '#fff', border: '1px solid #1d4ed8' }}>Save</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// Module scope, not defined inside the page - a component declared inside another
// remounts on every render and the input loses focus after one character.
function DraftField({ label, k, draft, setDraft }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: 12.5, color: '#57534e' }}>{label}</span>
      <input type="number" value={draft[k]} placeholder="-"
        onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} style={inp} />
    </div>
  )
}

// One row, one figure, in the FY column only. The monthly cells are deliberately blank -
// nothing has been taken off any month, and putting a number in a month would say it had.
function YeWipLine({ rows, label, amount, colour, open, onToggle }) {
  return (
    <tr style={{ borderBottom: '1px solid #f2f0ec', background: '#fffdf5', cursor: onToggle ? 'pointer' : 'default' }}
      onClick={onToggle} title={onToggle ? 'Click to see the projects behind this' : ''}>
      <td style={{ ...lbl, fontSize: 11.5, color: colour, position: 'sticky', left: 0, background: '#fffdf5' }}>
        {onToggle ? <span style={{ color: '#999', marginRight: 4 }}>{open ? '\u25BC' : '\u25B6'}</span> : null}
        {label}
      </td>
      {rows.map(r => <td key={r.mo} style={{ ...td, color: '#e5e1d8' }}>-</td>)}
      <td style={{ ...td, fontWeight: 700, background: '#eef3fb', color: colour }}>{gbp(amount)}</td>
    </tr>
  )
}

function WipLine({ rows, amount, month }) {
  return (
    <tr style={{ borderBottom: '1px solid #f2f0ec', background: '#fffdf5' }}>
      <td style={{ ...lbl, fontSize: 11.5, color: '#b45309', position: 'sticky', left: 0, background: '#fffdf5' }}>
        less WIP in {monthShort(month)}
      </td>
      {rows.map(r => <td key={r.mo} style={{ ...td, color: '#e5e1d8' }}>-</td>)}
      <td style={{ ...td, fontWeight: 700, background: '#eef3fb', color: '#b45309' }}>{gbp(-Math.abs(amount || 0))}</td>
    </tr>
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
            background: r.isManual ? '#f8fbff' : (r.isActual ? 'transparent' : '#fffdf7') }}>
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
