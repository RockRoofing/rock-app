import { useState, useEffect, useMemo, Component } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, GOLD, gbp } from '../../components/BizNav'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

// Error boundary so a bad data shape shows the actual error on-screen instead of the
// generic "Application error: a client-side exception has occurred" white screen.
class Boundary extends Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { console.error('Budgets page error:', err, info) }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 24 }}>
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: 16, color: '#7f1d1d', fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Something went wrong rendering this page.</div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>{String(this.state.err && this.state.err.message || this.state.err)}</div>
            <div style={{ marginTop: 10 }}><button onClick={() => location.reload()} style={{ border: '1px solid #fca5a5', background: '#fff', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>Reload</button></div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function BudgetsPage() {
  return <Boundary><Budgets /></Boundary>
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fyMonths(endYear) {
  const out = [`${endYear - 1}-12`]
  for (let m = 1; m <= 11; m++) out.push(`${endYear}-${String(m).padStart(2, '0')}`)
  return out
}
function monthShort(mo) {
  const [y, m] = mo.split('-').map(Number)
  return `${MONTH_ABBR[m - 1]} ${String(y).slice(2)}`
}
function fyOf(mo) {
  const [y, m] = mo.split('-').map(Number)
  return m === 12 ? y + 1 : y
}
const nowMonthKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Colour for a completed month's actual vs the monthly budget.
//   over budget                 -> red
//   0-15% under budget          -> black
//   more than 15% under budget  -> green
function cellColour(actual, budget) {
  if (budget == null || budget <= 0) return '#333'
  if (actual > budget) return '#b91c1c'            // red - over
  if (actual < budget * 0.85) return '#16a34a'     // green - >15% under
  return '#111'                                     // black - within 15% under
}

function Budgets() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [gearOpen, setGearOpen] = useState(false)
  const [drill, setDrill] = useState(null)   // { code, name, month, loading, lines, total }

  const [budgets, setBudgets] = useState({})                 // { code: amount }  manual monthly budget
  const [forecastMethods, setForecastMethods] = useState({}) // { code: 1|2|3 }
  const [forecastOverrides, setForecastOverrides] = useState({}) // { code: { 'YYYY-MM': amount } }
  const [hiddenRows, setHiddenRows] = useState([])           // [ code, ... ]
  const [forecastLocks, setForecastLocks] = useState([])     // [ {lockedAt, fyEnd, total, note} ]
  const [showLockHistory, setShowLockHistory] = useState(false)
  const [reconcile, setReconcile] = useState(false)          // reconciliation checkbox
  const [card3moCodes, setCard3moCodes] = useState(null)     // [code] included in the custom 3-mo card; null = all
  const [card3moGear, setCard3moGear] = useState(false)

  const [fyEnd, setFyEnd] = useState(() => fyOf(nowMonthKey()))

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
      const d = await fetch('/api/business-financials?view=budgets-overheads').then(r => r.json())
      setData(d)
      setBudgets(d.budgets || {})
      setForecastMethods(d.forecastMethods || {})
      setForecastOverrides(d.forecastOverrides || {})
      setHiddenRows(d.hiddenRows || [])
      setForecastLocks(d.forecastLocks || [])
      setCard3moCodes(d.card3moCodes ?? null)
    } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  async function save(extra) {
    setSaving(true); setSaved(false)
    const payload = { view: 'budgets-overheads', budgets, forecastMethods, forecastOverrides, hiddenRows, ...(extra || {}) }
    try {
      await fetch('/api/business-financials?view=budgets-overheads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch {}
    setSaving(false)
  }

  async function openDrill(code, name, mo) {
    setDrill({ code, name, month: mo, loading: true, lines: [], total: 0 })
    try {
      const d = await fetch(`/api/business-financials?view=overhead-transactions&code=${encodeURIComponent(code)}&month=${encodeURIComponent(mo)}`).then(r => r.json())
      setDrill({ code, name, month: mo, loading: false, lines: d.lines || [], total: d.total || 0, ledgerUpdatedAt: d.ledgerUpdatedAt })
    } catch {
      setDrill({ code, name, month: mo, loading: false, lines: [], total: 0, error: true })
    }
  }

  const accounts = data?.overheadAccounts || []
  const actualsByCode = data?.actualsByCode || {}
  const months = useMemo(() => fyMonths(fyEnd), [fyEnd])
  const thisMonth = nowMonthKey()

  const fyOptions = useMemo(() => {
    const avail = data?.availableMonths || []
    const years = new Set([fyOf(thisMonth)])
    for (const mo of avail) years.add(fyOf(mo))
    return [...years].sort((a, b) => b - a)
  }, [data, thisMonth])

  const availableSet = useMemo(() => new Set(data?.availableMonths || []), [data])
  const hiddenSet = useMemo(() => new Set((hiddenRows || []).map(String)), [hiddenRows])
  const isComplete = (mo) => mo < thisMonth && availableSet.has(mo)

  const actualOf = (code, mo) => {
    const m = actualsByCode[code] || {}
    if (mo in m) return m[mo]
    return availableSet.has(mo) ? 0 : null
  }

  // The most recent completed month's actual for a code (for method 3 + budget hint).
  function lastFullMonthValue(code) {
    const m = actualsByCode[code] || {}
    const completed = Object.keys(m).filter(k => isComplete(k)).sort()
    if (!completed.length) return null
    return m[completed[completed.length - 1]]
  }

  // Forecast for a code (per its method). Used for future cells AND as the budget hint.
  function baseForecast(code) {
    const method = Number(forecastMethods[code] || 1)
    const m = actualsByCode[code] || {}
    if (method === 3) return lastFullMonthValue(code)      // last FULL month
    if (method === 2) {                                     // trailing 3 completed
      const completed = Object.keys(m).filter(k => isComplete(k)).sort().slice(-3)
      if (!completed.length) return null
      return completed.reduce((s, k) => s + m[k], 0) / completed.length
    }
    // method 1: avg of completed months in THIS FY
    const fyCompleted = months.filter(k => isComplete(k)).map(k => (k in m ? m[k] : 0))
    if (!fyCompleted.length) return null
    return fyCompleted.reduce((s, v) => s + v, 0) / fyCompleted.length
  }

  function forecastOf(code, mo) {
    const ov = forecastOverrides[code]?.[mo]
    if (ov != null && ov !== '') return { value: Number(ov), override: true }
    return { value: baseForecast(code), override: false }
  }

  // Effective monthly budget = manual budget if set, else the forecast base.
  function effectiveBudget(code) {
    const v = budgets[code]
    if (v !== '' && v != null) return Number(v)
    return baseForecast(code)   // forecast drives the budget column when not set manually
  }

  function setBudget(code, raw) {
    setBudgets(prev => ({ ...prev, [code]: raw === '' ? '' : Number(raw) }))
  }
  function setForecastMethod(code, method) {
    setForecastMethods(prev => ({ ...prev, [code]: Number(method) }))
  }
  function setOverride(code, mo, raw) {
    const val = raw === '' ? '' : Number(raw)
    setForecastOverrides(prev => {
      const next = { ...prev, [code]: { ...(prev[code] || {}) } }
      if (val === '') delete next[code][mo]; else next[code][mo] = val
      return next
    })
  }
  function clearOverride(code, mo) {
    setForecastOverrides(prev => {
      const next = { ...prev, [code]: { ...(prev[code] || {}) } }
      delete next[code][mo]
      return next
    })
  }
  function persistHidden(next) {
    setHiddenRows(next)
    // Save immediately with the fresh value so a refresh keeps the selection
    // (avoids the stale-closure problem of relying on state in save()).
    save({ hiddenRows: next })
  }
  function toggleRow(code) {
    const s = new Set((hiddenRows || []).map(String))
    if (s.has(String(code))) s.delete(String(code)); else s.add(String(code))
    persistHidden([...s])
  }

  // NOTE: all hooks (incl. this useMemo) MUST be above the early return below,
  // or React throws error #310 (rendered more hooks than previous render).
  const visibleAccounts = accounts.filter(a => !hiddenSet.has(String(a.code)))
  // How many months of THIS FY are complete (for the to-date summary columns).
  const completedFyMonths = months.filter(isComplete)
  const nCompleted = completedFyMonths.length

  // Column totals across visible accounts (for the frozen totals row).
  const totals = useMemo(() => {
    const t = { budget: 0, months: {}, budgetToDate: 0, actualToDate: 0, fullYr: 0, projectedYear: 0 }
    for (const mo of months) t.months[mo] = { value: 0, complete: isComplete(mo) }
    for (const { code } of visibleAccounts) {
      const budget = effectiveBudget(code)
      if (budget != null) { t.budget += budget; t.budgetToDate += budget * nCompleted; t.fullYr += budget * 12 }
      let projected = 0
      for (const mo of months) {
        if (isComplete(mo)) {
          const a = actualOf(code, mo) || 0
          t.months[mo].value += a
          projected += a
        } else {
          const fc = forecastOf(code, mo)
          const v = fc.value != null ? fc.value : (budget || 0)
          t.months[mo].value += v
          projected += v
        }
      }
      t.actualToDate += completedFyMonths.reduce((s, mo) => s + (actualOf(code, mo) || 0), 0)
      t.projectedYear += projected
    }
    t.trackDiff = t.projectedYear - t.fullYr
    return t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAccounts, months, budgets, forecastMethods, forecastOverrides, actualsByCode, availableSet])

  // Bar-chart data per month: actual (blue) + forecast-beside (grey) on completed
  // months; future forecast (light blue) on future months.
  const chartData = useMemo(() => {
    return months.map(mo => {
      const complete = isComplete(mo)
      let actual = 0, forecastBeside = 0, futureForecast = 0
      for (const { code } of visibleAccounts) {
        if (complete) {
          actual += actualOf(code, mo) || 0
          const fc = forecastOf(code, mo)
          forecastBeside += fc.value != null ? fc.value : (effectiveBudget(code) || 0)
        } else {
          const fc = forecastOf(code, mo)
          futureForecast += fc.value != null ? fc.value : (effectiveBudget(code) || 0)
        }
      }
      return {
        month: monthShort(mo),
        Actual: complete ? Math.round(actual) : null,
        Forecast: complete ? Math.round(forecastBeside) : null,
        'Forecast (future)': complete ? null : Math.round(futureForecast),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAccounts, months, budgets, forecastMethods, forecastOverrides, actualsByCode, availableSet])

  // Reconciliation: total across ALL overhead accounts vs the visible ones, for the
  // current FY (actual to date + forecast for the rest = projected year).
  const reconTotals = useMemo(() => {
    const projFor = (accts) => {
      let sum = 0
      for (const { code } of accts) {
        for (const mo of months) {
          if (isComplete(mo)) sum += actualOf(code, mo) || 0
          else { const fc = forecastOf(code, mo); sum += fc.value != null ? fc.value : (effectiveBudget(code) || 0) }
        }
      }
      return sum
    }
    const all = projFor(accounts)
    const vis = projFor(visibleAccounts)
    return { all, vis, match: Math.abs(all - vis) < 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, visibleAccounts, months, budgets, forecastMethods, forecastOverrides, actualsByCode, availableSet])

  // Last 3 completed months' total overhead spend (visible accounts) and its average.
  const last3 = useMemo(() => {
    const completedAll = [...availableSet].filter(mo => mo < thisMonth).sort()
    const last3mo = completedAll.slice(-3)
    let sum = 0
    for (const mo of last3mo) for (const { code } of visibleAccounts) sum += actualOf(code, mo) || 0
    return { months: last3mo, sum, avg: last3mo.length ? sum / last3mo.length : 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAccounts, availableSet, actualsByCode, thisMonth])

  // Custom 3-month average card: same window, but only the account codes selected for
  // THIS card (card3moCodes === null means all overhead accounts).
  const last3Custom = useMemo(() => {
    const completedAll = [...availableSet].filter(mo => mo < thisMonth).sort()
    const last3mo = completedAll.slice(-3)
    const includeSet = card3moCodes == null ? null : new Set(card3moCodes.map(String))
    const accts = includeSet ? accounts.filter(a => includeSet.has(String(a.code))) : accounts
    let sum = 0
    for (const mo of last3mo) for (const { code } of accts) sum += actualOf(code, mo) || 0
    return { months: last3mo, sum, avg: last3mo.length ? sum / last3mo.length : 0, nAccts: accts.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, card3moCodes, availableSet, actualsByCode, thisMonth])

  if (!ok) return null

  function persistCard3mo(next) {
    setCard3moCodes(next)
    save({ card3moCodes: next })
  }
  function toggleCard3mo(code) {
    // Work from an explicit list; null means "all", so start from all codes.
    const base = card3moCodes == null ? accounts.map(a => String(a.code)) : card3moCodes.map(String)
    const s = new Set(base)
    if (s.has(String(code))) s.delete(String(code)); else s.add(String(code))
    persistCard3mo([...s])
  }

  async function lockInForecast() {
    if (typeof window !== 'undefined' && !window.confirm(`Lock in this year's forecast of ${gbp(totals.projectedYear)} for FY${fyEnd}?`)) return
    await save({ lockForecast: { fyEnd, total: totals.projectedYear } })
    load()
  }
  const lastLock = forecastLocks[0] || null

  return (
    <>
      <Head><title>Overhead Budgets - Business Financials</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <BizNav />
        <div style={{ padding: '24px 16px', maxWidth: '100%', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 22, color: INK, margin: '0 0 4px' }}>Overhead Budgets</h1>
              <p style={{ fontSize: 13, color: '#777', margin: 0 }}>
                Mirror of the Overheads P&amp;L. Click any month cell to see its transactions. Financial year: 1 Dec - 30 Nov.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ fontSize: 12, color: '#888' }}>Financial year</label>
              <select value={fyEnd} onChange={e => setFyEnd(Number(e.target.value))}
                style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, background: '#fff' }}>
                {fyOptions.map(y => <option key={y} value={y}>Dec {y - 1} - Nov {y} (FY{y})</option>)}
              </select>
              <button onClick={() => save()} disabled={saving}
                style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              {saved && <span style={{ color: '#16a34a', fontSize: 13, fontWeight: 600 }}>Saved</span>}
            </div>
          </div>

          {/* Colour key */}
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginTop: 10, fontSize: 12, color: '#666', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>Key:</span>
            <span><b style={{ color: '#111' }}>Black</b> = within 15% under budget</span>
            <span><b style={{ color: '#16a34a' }}>Green</b> = more than 15% under budget</span>
            <span><b style={{ color: '#b91c1c' }}>Red</b> = over budget</span>
            <span style={{ color: '#b8b8b8' }}>Grey = forecast (future month)</span>
          </div>

          {!loading && (
            <>
              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 14 }}>
                {/* Locked-in forecast */}
                <div style={cardBox}>
                  <div style={cardLabel}>Locked-in forecast (FY{fyEnd})</div>
                  <div style={cardValue}>{lastLock ? gbp(lastLock.total) : '-'}</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                    {lastLock ? `Locked ${new Date(lastLock.lockedAt).toLocaleDateString('en-GB')}` : 'No forecast locked yet'}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={lockInForecast} style={{ fontSize: 11, border: 'none', background: GOLD, color: '#fff', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>Lock in current ({gbp(totals.projectedYear)})</button>
                    {forecastLocks.length > 0 && <button onClick={() => setShowLockHistory(h => !h)} style={{ fontSize: 11, border: '1px solid #e2e0da', background: '#fff', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>{showLockHistory ? 'Hide' : 'History'}</button>}
                  </div>
                  {showLockHistory && forecastLocks.length > 0 && (
                    <div style={{ marginTop: 8, borderTop: '1px solid #f0efec', paddingTop: 6, maxHeight: 130, overflowY: 'auto' }}>
                      {forecastLocks.map((l, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#666', padding: '2px 0' }}>
                          <span>{new Date(l.lockedAt).toLocaleDateString('en-GB')}{l.fyEnd ? ` (FY${l.fyEnd})` : ''}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{gbp(l.total)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Last 3 months average */}
                <div style={cardBox}>
                  <div style={cardLabel}>Last 3 months avg overheads</div>
                  <div style={cardValue}>{gbp(last3.avg)}</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                    {last3.months.length ? `${last3.months.map(monthShort).join(', ')} - total ${gbp(last3.sum)}` : 'No completed months yet'}
                  </div>
                </div>

                {/* Custom 3 months average (own account selection) */}
                <div style={{ ...cardBox, position: 'relative' }}>
                  <button onClick={() => setCard3moGear(o => !o)} title="Choose accounts for this card"
                    style={{ position: 'absolute', top: 10, right: 10, border: '1px solid #e2e0da', background: card3moGear ? '#f3f1ea' : '#fff', borderRadius: 7, padding: '3px 7px', cursor: 'pointer', fontSize: 13 }}>&#9881;</button>
                  <div style={cardLabel}>3-month avg (selected)</div>
                  <div style={cardValue}>{gbp(last3Custom.avg)}</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                    {card3moCodes == null ? 'All overhead accounts' : `${last3Custom.nAccts} of ${accounts.length} accounts`}
                    {last3Custom.months.length ? ` - total ${gbp(last3Custom.sum)}` : ' - no completed months'}
                  </div>
                  {card3moGear && (
                    <div style={{ position: 'absolute', top: 40, right: 10, zIndex: 25, background: '#fff', border: '1px solid #e2e0da', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,0.14)', width: 280, maxHeight: 360, overflowY: 'auto', padding: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: INK }}>Accounts in this average</span>
                        <button onClick={() => setCard3moGear(false)} style={{ fontSize: 11, border: 'none', background: GOLD, color: '#fff', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>Done</button>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <button onClick={() => persistCard3mo(null)} style={miniBtn}>All</button>
                        <button onClick={() => persistCard3mo([])} style={miniBtn}>None</button>
                      </div>
                      {accounts.map(a => {
                        const included = card3moCodes == null || card3moCodes.map(String).includes(String(a.code))
                        return (
                          <label key={a.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 12, cursor: 'pointer' }}>
                            <input type="checkbox" checked={included} onChange={() => toggleCard3mo(a.code)} />
                            <span style={{ color: '#999', width: 34, fontVariantNumeric: 'tabular-nums' }}>{a.code}</span>
                            <span>{a.name || '(unnamed)'}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Forecast overheads for the year */}
                <div style={cardBox}>
                  <div style={cardLabel}>Forecast overheads (FY{fyEnd})</div>
                  <div style={cardValue}>{gbp(totals.projectedYear)}</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Actual to date {gbp(totals.actualToDate)} + forecast for remaining months</div>
                </div>
              </div>

              {/* Reconciliation checkbox */}
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: reconcile ? (reconTotals.match ? '#f0fdf4' : '#fef2f2') : '#fff', border: `1px solid ${reconcile ? (reconTotals.match ? '#86efac' : '#fca5a5') : '#e2e0da'}`, color: reconcile ? (reconTotals.match ? '#166534' : '#b91c1c') : '#555' }}>
                <input type="checkbox" checked={reconcile} onChange={e => setReconcile(e.target.checked)} />
                Reconcile: all accounts vs shown
                {reconcile && (
                  <span style={{ fontWeight: 400 }}>
                    &nbsp;- All: <b style={{ fontVariantNumeric: 'tabular-nums' }}>{gbp(reconTotals.all)}</b> &nbsp;|&nbsp; Shown: <b style={{ fontVariantNumeric: 'tabular-nums' }}>{gbp(reconTotals.vis)}</b>
                    {reconTotals.match ? ' - matches' : ` - differs by ${gbp(Math.abs(reconTotals.all - reconTotals.vis))} (unhide accounts via the gear)`}
                  </span>
                )}
              </label>

              {/* Actual vs forecast bar chart */}
              <div style={{ marginTop: 14, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, padding: '14px 12px 4px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: INK, margin: '0 0 8px 6px' }}>Actual vs forecast by month (FY{fyEnd})</div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartData} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : v} width={44} />
                    <Tooltip formatter={v => v == null ? '-' : gbp(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Actual" fill="#2563eb" />
                    <Bar dataKey="Forecast" fill="#9ca3af" />
                    <Bar dataKey="Forecast (future)" fill="#93c5fd" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : (
            <div style={{ marginTop: 12, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'visible' }}>
              {/* Toolbar with gear */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid #f0efec', position: 'relative' }}>
                {hiddenSet.size > 0 && <span style={{ fontSize: 11, color: '#aaa', marginRight: 10 }}>{hiddenSet.size} account{hiddenSet.size === 1 ? '' : 's'} hidden</span>}
                <button onClick={() => setGearOpen(o => !o)} title="Show / hide accounts"
                  style={{ border: '1px solid #e2e0da', background: gearOpen ? '#f3f1ea' : '#fff', borderRadius: 8, padding: '5px 9px', cursor: 'pointer', fontSize: 14 }}>&#9881;</button>
                {gearOpen && (
                  <div style={{ position: 'absolute', top: 42, right: 10, zIndex: 20, background: '#fff', border: '1px solid #e2e0da', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,0.14)', width: 300, maxHeight: 420, overflowY: 'auto', padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: INK }}>Show / hide accounts</span>
                      <button onClick={() => { setGearOpen(false) }} style={{ fontSize: 11, border: 'none', background: GOLD, color: '#fff', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>Done</button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <button onClick={() => persistHidden([])} style={miniBtn}>Show all</button>
                      <button onClick={() => persistHidden(accounts.map(a => String(a.code)))} style={miniBtn}>Hide all</button>
                    </div>
                    {accounts.map(a => (
                      <label key={a.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!hiddenSet.has(String(a.code))} onChange={() => toggleRow(a.code)} />
                        <span style={{ color: '#999', width: 34, fontVariantNumeric: 'tabular-nums' }}>{a.code}</span>
                        <span>{a.name || '(unnamed)'}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap', width: '100%' }}>
                  <thead>
                    <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                      <th style={{ ...th, ...stickyTop, textAlign: 'left', left: 0, zIndex: 5, background: '#faf9f7' }}>Code</th>
                      <th style={{ ...th, ...stickyTop, textAlign: 'left', left: 52, zIndex: 5, minWidth: 180, background: '#faf9f7' }}>Account</th>
                      <th style={{ ...th, ...stickyTop, background: '#f4f1e8', zIndex: 4 }}>Budget / mo</th>
                      <th style={{ ...th, ...stickyTop, textAlign: 'left', background: '#faf9f7', zIndex: 4 }}>Forecast</th>
                      {months.map(mo => (
                        <th key={mo} style={{ ...th, ...stickyTop, background: mo === thisMonth ? '#fff8e6' : '#faf9f7', zIndex: 4 }}>{monthShort(mo)}</th>
                      ))}
                      <th style={{ ...th, ...stickyTop, background: '#eef3fb', zIndex: 4 }}>Budget to date</th>
                      <th style={{ ...th, ...stickyTop, background: '#eef3fb', zIndex: 4 }}>Actual to date</th>
                      <th style={{ ...th, ...stickyTop, background: '#eef3fb', zIndex: 4 }}>Full-yr budget</th>
                      <th style={{ ...th, ...stickyTop, background: '#eef3fb', zIndex: 4 }}>Tracking (yr)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAccounts.length > 0 && (
                      <tr style={{ borderBottom: '2px solid #e6e3dc', fontWeight: 700 }}>
                        <td style={{ ...tdL, ...stickyTotals, left: 0, zIndex: 5, background: '#f7f5ee' }}></td>
                        <td style={{ ...tdL, ...stickyTotals, left: 52, zIndex: 5, background: '#f7f5ee', minWidth: 180 }}>TOTAL ({visibleAccounts.length})</td>
                        <td style={{ ...tdCell, ...stickyTotals, background: '#f4f1e8', zIndex: 4, fontVariantNumeric: 'tabular-nums' }}>{gbp(totals.budget)}</td>
                        <td style={{ ...tdCell, ...stickyTotals, background: '#f7f5ee', zIndex: 4 }}></td>
                        {months.map(mo => (
                          <td key={mo} style={{ ...tdCell, ...stickyTotals, background: totals.months[mo].complete ? '#f7f5ee' : '#fbfbf8', zIndex: 4, color: totals.months[mo].complete ? '#111' : '#999', fontVariantNumeric: 'tabular-nums' }}>{gbp(totals.months[mo].value)}</td>
                        ))}
                        <td style={{ ...tdCell, ...stickyTotals, background: '#eef3fb', zIndex: 4, fontVariantNumeric: 'tabular-nums' }}>{gbp(totals.budgetToDate)}</td>
                        <td style={{ ...tdCell, ...stickyTotals, background: '#eef3fb', zIndex: 4, fontVariantNumeric: 'tabular-nums' }}>{gbp(totals.actualToDate)}</td>
                        <td style={{ ...tdCell, ...stickyTotals, background: '#eef3fb', zIndex: 4, fontVariantNumeric: 'tabular-nums' }}>{gbp(totals.fullYr)}</td>
                        <td style={{ ...tdCell, ...stickyTotals, background: '#eef3fb', zIndex: 4, fontVariantNumeric: 'tabular-nums', color: totals.trackDiff > 0 ? '#b91c1c' : '#166534' }}>{`${totals.trackDiff > 0 ? '+' : ''}${gbp(totals.trackDiff)}`}</td>
                      </tr>
                    )}
                    {visibleAccounts.length === 0 && (
                      <tr><td colSpan={months.length + 8} style={{ padding: 24, textAlign: 'center', color: '#aaa' }}>
                        {accounts.length === 0 ? 'No overhead accounts found. Sync Xero figures and check Account Categorisation.' : 'All accounts hidden. Use the gear to show some.'}
                      </td></tr>
                    )}
                    {visibleAccounts.map(({ code, name }) => {
                      const budget = effectiveBudget(code)
                      const fcHint = baseForecast(code)
                      // Summary columns.
                      const budgetToDate = budget != null ? budget * nCompleted : null
                      const actualToDate = completedFyMonths.reduce((s, mo) => s + (actualOf(code, mo) || 0), 0)
                      const fullYrBudget = budget != null ? budget * 12 : null
                      // Tracking (yr) = actual to date + forecast (or budget) for remaining months.
                      let projectedYear = actualToDate
                      for (const mo of months) {
                        if (isComplete(mo)) continue
                        const fc = forecastOf(code, mo)
                        projectedYear += (fc.value != null ? fc.value : (budget || 0))
                      }
                      const trackDiff = fullYrBudget != null ? projectedYear - fullYrBudget : null
                      return (
                        <tr key={code} style={{ borderBottom: '1px solid #f2f0ec' }}>
                          <td style={{ ...tdL, position: 'sticky', left: 0, background: '#fff', color: '#999', fontVariantNumeric: 'tabular-nums' }}>{code}</td>
                          <td style={{ ...tdL, position: 'sticky', left: 52, background: '#fff', fontWeight: 600, minWidth: 180 }}>{name || '(unnamed)'}</td>
                          <td style={{ ...tdCell, background: '#fcfbf6' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
                              <span style={{ color: '#bbb', fontSize: 11 }}>&pound;</span>
                              <input type="number" value={budgets[code] ?? ''} onChange={e => setBudget(code, e.target.value)}
                                placeholder={fcHint != null ? Math.round(fcHint).toLocaleString('en-GB') : '0'}
                                title={fcHint != null ? `Forecast suggests ${gbp(fcHint)} - type to set a budget` : 'Set a monthly budget'}
                                style={{ width: 82, padding: '4px 6px', border: '1px solid #e2ddc9', borderRadius: 6, fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (budgets[code] ?? '') === '' ? '#b8860b' : '#333' }} />
                            </div>
                          </td>
                          <td style={tdL}>
                            <select value={forecastMethods[code] || 1} onChange={e => setForecastMethod(code, e.target.value)}
                              style={{ padding: '4px 6px', border: '1px solid #e2e0da', borderRadius: 6, fontSize: 11, background: '#fff' }}>
                              <option value={1}>1 - Avg this FY</option>
                              <option value={2}>2 - Last 3 mo</option>
                              <option value={3}>3 - Last full month</option>
                            </select>
                          </td>
                          {months.map(mo => {
                            const complete = isComplete(mo)
                            if (complete) {
                              const actual = actualOf(code, mo) || 0
                              const col = cellColour(actual, budget)
                              return (
                                <td key={mo} style={{ ...tdCell, cursor: 'pointer' }} onClick={() => openDrill(code, name, mo)} title="Click for transactions">
                                  <span style={{ color: col, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textDecoration: 'underline dotted #ddd' }}>{gbp(actual)}</span>
                                </td>
                              )
                            }
                            const fc = forecastOf(code, mo)
                            const hasOverride = forecastOverrides[code]?.[mo] != null && forecastOverrides[code]?.[mo] !== ''
                            return (
                              <td key={mo} style={{ ...tdCell, background: mo === thisMonth ? '#fffdf5' : 'transparent' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
                                  <input type="number" value={forecastOverrides[code]?.[mo] ?? ''} onChange={e => setOverride(code, mo, e.target.value)}
                                    placeholder={fc.value != null ? Math.round(fc.value).toLocaleString('en-GB') : '-'}
                                    title={fc.value != null ? `Forecast: ${gbp(fc.value)} (type to override)` : 'No basis to forecast yet'}
                                    style={{ width: 76, padding: '3px 5px', border: `1px ${hasOverride ? 'solid #cfc9b4' : 'dashed #dcdad3'}`, borderRadius: 5, fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: hasOverride ? '#333' : '#b8b8b8', background: 'transparent' }} />
                                  {hasOverride && (
                                    <button onClick={() => clearOverride(code, mo)} title="Clear override (revert to forecast)" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 13, lineHeight: 1, padding: 0 }}>&times;</button>
                                  )}
                                </div>
                              </td>
                            )
                          })}
                          {/* Summary columns */}
                          <td style={{ ...tdCell, background: '#f6f9fe', fontVariantNumeric: 'tabular-nums' }}>{budgetToDate != null ? gbp(budgetToDate) : '-'}</td>
                          <td style={{ ...tdCell, background: '#f6f9fe', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{gbp(actualToDate)}</td>
                          <td style={{ ...tdCell, background: '#f6f9fe', fontVariantNumeric: 'tabular-nums' }}>{fullYrBudget != null ? gbp(fullYrBudget) : '-'}</td>
                          <td style={{ ...tdCell, background: '#f6f9fe', fontVariantNumeric: 'tabular-nums', color: trackDiff == null ? '#333' : trackDiff > 0 ? '#b91c1c' : '#166534', fontWeight: 600 }}
                            title="Projected full-year (actual to date + forecast for remaining months) vs full-year budget">
                            {trackDiff == null ? '-' : `${trackDiff > 0 ? '+' : ''}${gbp(trackDiff)}`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
            Actuals from the P&amp;L benchmark ({data?.benchmarkUpdatedAt ? new Date(data.benchmarkUpdatedAt).toLocaleDateString('en-GB') : 'not synced'}).
            Budget/mo defaults to the forecast (amber text) until you type a figure. Summary columns: Budget to date = budget x completed months;
            Actual to date = sum of completed months; Full-yr budget = budget x 12; Tracking = projected full year (actual + forecast) minus full-yr budget.
          </div>
        </div>
      </div>

      {/* Transaction drill-down */}
      {drill && (
        <div onClick={() => setDrill(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 780, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{drill.code} - {drill.name}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{monthShort(drill.month)} transactions</div>
              </div>
              <button onClick={() => setDrill(null)} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>&times;</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {drill.loading ? <div style={{ padding: 30, color: '#999' }}>Loading transactions...</div> : (
                drill.lines.length === 0 ? (
                  <div style={{ padding: 30, color: '#999' }}>
                    No stored transactions for this month.{' '}
                    {drill.error ? 'There was an error loading them.' : 'Click "Sync Xero figures" to pull the transaction ledger.'}
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#faf9f7', position: 'sticky', top: 0 }}>
                        <th style={{ ...thL, padding: '8px 12px' }}>Date</th>
                        <th style={{ ...thL, padding: '8px 12px' }}>Description</th>
                        <th style={{ ...thL, padding: '8px 12px' }}>Reference</th>
                        <th style={{ ...th, padding: '8px 12px' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drill.lines.map((l, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f4f2ee' }}>
                          <td style={{ padding: '7px 12px' }}>{l.date ? new Date(l.date).toLocaleDateString('en-GB') : '-'}</td>
                          <td style={{ padding: '7px 12px' }}>{l.description || '-'}</td>
                          <td style={{ padding: '7px 12px', color: '#888' }}>{l.reference || '-'}</td>
                          <td style={{ padding: '7px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{gbp(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid #eee', fontWeight: 700 }}>
                        <td colSpan={3} style={{ padding: '8px 12px', textAlign: 'right' }}>Total</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{gbp(drill.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )
              )}
            </div>
            {drill.ledgerUpdatedAt && <div style={{ padding: '8px 18px', fontSize: 10, color: '#bbb', borderTop: '1px solid #f2f0ec' }}>Ledger synced {new Date(drill.ledgerUpdatedAt).toLocaleString('en-GB')}</div>}
          </div>
        </div>
      )}
    </>
  )
}

const th = { padding: '8px 10px', fontSize: 11, color: '#777', fontWeight: 600, textAlign: 'right' }
const thL = { padding: '8px 10px', fontSize: 11, color: '#777', fontWeight: 600, textAlign: 'left' }
const tdL = { padding: '6px 10px', textAlign: 'left' }
const tdCell = { padding: '5px 8px', textAlign: 'right', borderLeft: '1px solid #f6f5f2' }
const miniBtn = { flex: 1, fontSize: 11, border: '1px solid #e2e0da', background: '#fff', borderRadius: 6, padding: '4px 6px', cursor: 'pointer' }
// Sticky header row at top:0; frozen totals row directly beneath it.
const stickyTop = { position: 'sticky', top: 0 }
const stickyTotals = { position: 'sticky', top: 34 }
const cardBox = { background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 14px' }
const cardLabel = { fontSize: 11, color: '#888', fontWeight: 600, marginBottom: 4 }
const cardValue = { fontSize: 24, fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }
