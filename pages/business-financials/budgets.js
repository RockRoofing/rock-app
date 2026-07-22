import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, GOLD, gbp } from '../../components/BizNav'

// Financial year runs 1 Dec -> 30 Nov. A FY is labelled by the calendar year it
// ENDS in (e.g. FY2026 = Dec 2025 .. Nov 2026).
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The 12 month keys (YYYY-MM) for a financial year ending in `endYear`.
function fyMonths(endYear) {
  const out = []
  // Dec of the previous calendar year:
  out.push(`${endYear - 1}-12`)
  // Jan..Nov of endYear:
  for (let m = 1; m <= 11; m++) out.push(`${endYear}-${String(m).padStart(2, '0')}`)
  return out
}
function monthShort(mo) {
  const [y, m] = mo.split('-').map(Number)
  return `${MONTH_ABBR[m - 1]} ${String(y).slice(2)}`
}
// Which FY does a given YYYY-MM fall in (returns the ending year)?
function fyOf(mo) {
  const [y, m] = mo.split('-').map(Number)
  return m === 12 ? y + 1 : y
}
const nowMonthKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Budgets() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Editable state
  const [budgetCells, setBudgetCells] = useState({})          // { code: { 'YYYY-MM': amount } }
  const [forecastMethods, setForecastMethods] = useState({})  // { code: 1|2|3 }
  const [forecastOverrides, setForecastOverrides] = useState({}) // { code: { 'YYYY-MM': amount } }

  // Default FY = the FY the current month falls in.
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
      setBudgetCells(d.budgetCells || {})
      setForecastMethods(d.forecastMethods || {})
      setForecastOverrides(d.forecastOverrides || {})
    } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  async function save() {
    setSaving(true); setSaved(false)
    try {
      await fetch('/api/business-financials?view=budgets-overheads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'budgets-overheads', budgetCells, forecastMethods, forecastOverrides }),
      })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch {}
    setSaving(false)
  }

  const accounts = data?.overheadAccounts || []
  const actualsByCode = data?.actualsByCode || {}
  const months = useMemo(() => fyMonths(fyEnd), [fyEnd])
  const thisMonth = nowMonthKey()

  // Available FY range for the switcher: from the earliest benchmark month to the
  // current FY (plus we always include the current FY).
  const fyOptions = useMemo(() => {
    const avail = data?.availableMonths || []
    const years = new Set([fyOf(thisMonth)])
    for (const mo of avail) years.add(fyOf(mo))
    return [...years].sort((a, b) => b - a)
  }, [data, thisMonth])

  // Is a month "complete" (has an actual we should show)? Complete = strictly before
  // the current month AND present in the benchmark for at least one overhead code.
  const availableSet = useMemo(() => new Set(data?.availableMonths || []), [data])
  const isComplete = (mo) => mo < thisMonth && availableSet.has(mo)

  // Actual for a code in a month (0 if the month is present but this code had none).
  const actualOf = (code, mo) => {
    const m = actualsByCode[code] || {}
    if (mo in m) return m[mo]
    return availableSet.has(mo) ? 0 : null
  }

  // Forecast for a future month for a given code, per its method.
  // 1 = average of completed months in THIS FY; 2 = trailing 3 completed months
  // (any FY); 3 = same month last FY.
  function forecastOf(code, mo) {
    // Manual override wins.
    const ov = forecastOverrides[code]?.[mo]
    if (ov != null && ov !== '') return { value: Number(ov), override: true }

    const method = Number(forecastMethods[code] || 1)
    const m = actualsByCode[code] || {}

    if (method === 3) {
      // same month last FY = same YYYY-MM shifted back 12 months
      const [y, mm] = mo.split('-').map(Number)
      const prev = `${y - 1}-${String(mm).padStart(2, '0')}`
      return { value: (prev in m) ? m[prev] : (availableSet.has(prev) ? 0 : null), override: false }
    }

    if (method === 2) {
      // trailing 3 completed months before `mo`
      const completed = Object.keys(m).filter(k => k < mo && isComplete(k)).sort()
      const last3 = completed.slice(-3)
      if (!last3.length) return { value: null, override: false }
      return { value: last3.reduce((s, k) => s + m[k], 0) / last3.length, override: false }
    }

    // method 1: average of completed months in THIS FY (months in this FY view that are complete)
    const fyCompleted = months.filter(k => k < mo && isComplete(k)).map(k => (k in m ? m[k] : 0))
    if (!fyCompleted.length) return { value: null, override: false }
    return { value: fyCompleted.reduce((s, v) => s + v, 0) / fyCompleted.length, override: false }
  }

  const budgetOf = (code, mo) => {
    const v = budgetCells[code]?.[mo]
    return (v === '' || v == null) ? null : Number(v)
  }

  // Set a budget for one cell; then optionally apply to following months in this FY.
  function setBudget(code, mo, raw) {
    const val = raw === '' ? '' : Number(raw)
    setBudgetCells(prev => {
      const next = { ...prev, [code]: { ...(prev[code] || {}) } }
      next[code][mo] = val
      return next
    })
  }
  function applyForward(code, mo) {
    const val = budgetCells[code]?.[mo]
    if (val == null) return
    const idx = months.indexOf(mo)
    if (idx < 0) return
    setBudgetCells(prev => {
      const next = { ...prev, [code]: { ...(prev[code] || {}) } }
      for (let i = idx + 1; i < months.length; i++) next[code][months[i]] = val
      return next
    })
  }

  function setForecastMethod(code, method) {
    setForecastMethods(prev => ({ ...prev, [code]: Number(method) }))
  }
  function setOverride(code, mo, raw) {
    const val = raw === '' ? '' : Number(raw)
    setForecastOverrides(prev => {
      const next = { ...prev, [code]: { ...(prev[code] || {}) } }
      if (val === '') delete next[code][mo]
      else next[code][mo] = val
      return next
    })
  }

  if (!ok) return null

  return (
    <>
      <Head><title>Overhead Budgets - Business Financials</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <BizNav />
        <div style={{ padding: 24, maxWidth: 1500, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 22, color: INK, margin: '0 0 4px' }}>Overhead Budgets</h1>
              <p style={{ fontSize: 13, color: '#777', margin: 0 }}>
                Mirror of the Overheads P&amp;L. Completed months show actuals (green under budget, red over).
                Future months show a forecast (grey) you can override. Financial year: 1 Dec - 30 Nov.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ fontSize: 12, color: '#888' }}>Financial year</label>
              <select value={fyEnd} onChange={e => setFyEnd(Number(e.target.value))}
                style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, background: '#fff' }}>
                {fyOptions.map(y => <option key={y} value={y}>Dec {y - 1} - Nov {y} (FY{y})</option>)}
              </select>
              <button onClick={save} disabled={saving}
                style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              {saved && <span style={{ color: '#16a34a', fontSize: 13, fontWeight: 600 }}>Saved</span>}
            </div>
          </div>

          {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : (
            <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
                <thead>
                  <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                    <th style={{ ...thL, position: 'sticky', left: 0, background: '#faf9f7', zIndex: 2 }}>Code</th>
                    <th style={{ ...thL, position: 'sticky', left: 52, background: '#faf9f7', zIndex: 2, minWidth: 190 }}>Account</th>
                    <th style={thL}>Forecast</th>
                    {months.map(mo => (
                      <th key={mo} style={{ ...th, background: mo === thisMonth ? '#fff8e6' : '#faf9f7' }}>{monthShort(mo)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {accounts.length === 0 && (
                    <tr><td colSpan={months.length + 3} style={{ padding: 24, textAlign: 'center', color: '#aaa' }}>
                      No overhead accounts found. Sync Xero figures and check the Account Categorisation page.
                    </td></tr>
                  )}
                  {accounts.map(({ code, name }) => (
                    <tr key={code} style={{ borderBottom: '1px solid #f2f0ec' }}>
                      <td style={{ ...tdL, position: 'sticky', left: 0, background: '#fff', color: '#999', fontVariantNumeric: 'tabular-nums' }}>{code}</td>
                      <td style={{ ...tdL, position: 'sticky', left: 52, background: '#fff', fontWeight: 600, minWidth: 190 }}>{name || '(unnamed)'}</td>
                      <td style={tdL}>
                        <select value={forecastMethods[code] || 1} onChange={e => setForecastMethod(code, e.target.value)}
                          title="1 = avg completed months this FY; 2 = trailing 3 months; 3 = same month last year"
                          style={{ padding: '4px 6px', border: '1px solid #e2e0da', borderRadius: 6, fontSize: 11, background: '#fff' }}>
                          <option value={1}>1 - Avg this FY</option>
                          <option value={2}>2 - Last 3 mo</option>
                          <option value={3}>3 - Same mo last yr</option>
                        </select>
                      </td>
                      {months.map(mo => {
                        const complete = isComplete(mo)
                        const budget = budgetOf(code, mo)
                        if (complete) {
                          const actual = actualOf(code, mo) || 0
                          const over = budget != null && actual > budget
                          const under = budget != null && actual <= budget
                          const col = budget == null ? '#333' : over ? '#b91c1c' : '#166534'
                          return (
                            <td key={mo} style={{ ...tdCell }}>
                              <div style={{ color: col, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{gbp(actual)}</div>
                              <BudgetInput code={code} mo={mo} value={budgetCells[code]?.[mo] ?? ''} onSet={setBudget} onApplyForward={applyForward} />
                            </td>
                          )
                        }
                        // Future / current month: forecast (grey), overridable.
                        const fc = forecastOf(code, mo)
                        return (
                          <td key={mo} style={{ ...tdCell, background: mo === thisMonth ? '#fffdf5' : 'transparent' }}>
                            <input
                              type="number"
                              value={forecastOverrides[code]?.[mo] ?? ''}
                              onChange={e => setOverride(code, mo, e.target.value)}
                              placeholder={fc.value != null ? Math.round(fc.value).toLocaleString('en-GB') : '-'}
                              title={fc.value != null ? `Forecast: ${gbp(fc.value)} (type to override)` : 'No basis to forecast yet'}
                              style={{
                                width: 84, padding: '3px 5px', border: '1px dashed #dcdad3', borderRadius: 5,
                                fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                                color: fc.override ? '#333' : '#b8b8b8', background: 'transparent',
                              }}
                            />
                            <BudgetInput code={code} mo={mo} value={budgetCells[code]?.[mo] ?? ''} onSet={setBudget} onApplyForward={applyForward} />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
            Actuals from the P&amp;L benchmark ({data?.benchmarkUpdatedAt ? new Date(data.benchmarkUpdatedAt).toLocaleDateString('en-GB') : 'not synced'}).
            Forecast methods per line: 1 = average of completed months this FY, 2 = trailing 3 months, 3 = same month last year.
            The grey figure in each future cell is the forecast; type over it to override. The small box under each figure is the budget for that month.
          </div>
        </div>
      </div>
    </>
  )
}

// Small per-cell budget input with an "apply to following months?" prompt on change.
function BudgetInput({ code, mo, value, onSet, onApplyForward }) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onSet(code, mo, e.target.value)}
      onBlur={e => {
        if (e.target.value !== '' && typeof window !== 'undefined') {
          if (window.confirm('Apply this budget to the following months in this year too?')) {
            onApplyForward(code, mo)
          }
        }
      }}
      placeholder="budget"
      title="Monthly budget for this account"
      style={{
        width: 84, marginTop: 3, padding: '2px 5px', border: '1px solid #ecebe6', borderRadius: 5,
        fontSize: 10, textAlign: 'right', color: '#888', background: '#fafafa',
      }}
    />
  )
}

const th = { padding: '8px 10px', fontSize: 11, color: '#777', fontWeight: 600, textAlign: 'right' }
const thL = { padding: '8px 10px', fontSize: 11, color: '#777', fontWeight: 600, textAlign: 'left' }
const td = { padding: '6px 10px', textAlign: 'right' }
const tdL = { padding: '6px 10px', textAlign: 'left' }
const tdCell = { padding: '5px 8px', textAlign: 'right', borderLeft: '1px solid #f6f5f2' }
