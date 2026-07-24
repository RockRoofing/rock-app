import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { BizNav, INK, GOLD, monthLbl, Card } from '../../components/BizNav'

// Financial year: 1 Dec -> 30 Nov, labelled by the year it ENDS in.
const fyOf = (mo) => { const [y, m] = mo.split('-').map(Number); return m >= 12 ? y + 1 : y }
const nowMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const pct = (v) => v == null ? '-' : `${v.toFixed(1)}%`
const gbp0 = (v) => (v < 0 ? '-' : '') + '\u00a3' + Math.abs(Math.round(v || 0)).toLocaleString()

// Least-squares trend over points with a numeric y. Returns y-values aligned to xs.
function trendline(points, key) {
  const pts = points.map((p, i) => [i, p[key]]).filter(p => p[1] != null && isFinite(p[1]))
  if (pts.length < 2) return points.map(() => null)
  const n = pts.length
  const sx = pts.reduce((a, p) => a + p[0], 0)
  const sy = pts.reduce((a, p) => a + p[1], 0)
  const sxy = pts.reduce((a, p) => a + p[0] * p[1], 0)
  const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0)
  const denom = n * sxx - sx * sx
  if (!denom) return points.map(() => null)
  const slope = (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  return points.map((p, i) => (p[key] == null ? null : +(slope * i + intercept).toFixed(2)))
}

export default function Margin() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fyEnd, setFyEnd] = useState(() => fyOf(nowMonth()))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  useEffect(() => {
    if (!ok) return
    setLoading(true)
    fetch('/api/business-financials?view=margin').then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [ok])

  // Only completed months (exclude current + future).
  const allMonths = useMemo(() => {
    if (!data?.months) return []
    const nm = nowMonth()
    return data.months.filter(m => m.month < nm)
  }, [data])

  const fyOptions = useMemo(() => {
    if (!allMonths.length) return [fyEnd]
    const set = new Set(allMonths.map(m => fyOf(m.month)))
    return [...set].sort((a, b) => b - a)
  }, [allMonths, fyEnd])

  function pickFy(y) {
    setFyEnd(y)
    setFrom(`${y - 1}-12`)
    setTo(`${y}-11`)
  }

  // Current-FY series (respect date range if the user narrowed it).
  const fySeries = useMemo(() => {
    let rows = allMonths.filter(m => fyOf(m.month) === fyEnd)
    if (from) rows = rows.filter(m => m.month >= from)
    if (to) rows = rows.filter(m => m.month <= to)
    return rows.map(m => ({ ...m, label: monthLbl(m.month) }))
  }, [allMonths, fyEnd, from, to])

  // 12-month rolling: for each completed month, aggregate the trailing 12 months
  // (that month + 11 before), then compute margins on the aggregate.
  const rollingSeries = useMemo(() => {
    const byMonth = {}
    for (const m of allMonths) byMonth[m.month] = m
    const keys = allMonths.map(m => m.month).sort()
    const out = []
    for (let i = 0; i < keys.length; i++) {
      // Trailing up to 12 months (uses fewer for early months so the line plots backwards too).
      const windowKeys = keys.slice(Math.max(0, i - 11), i + 1)
      let income = 0, cos = 0, overheads = 0
      for (const k of windowKeys) { const m = byMonth[k]; income += m.income; cos += m.cos; overheads += m.overheads }
      const gp = income - cos, np = income - cos - overheads
      out.push({
        month: keys[i], label: monthLbl(keys[i]),
        grossMargin: income ? +((gp / income) * 100).toFixed(2) : null,
        netMargin: income ? +((np / income) * 100).toFixed(2) : null,
        income, cos, overheads, windowMonths: windowKeys.length,
      })
    }
    // Apply date range / FY-ish narrowing consistent with the other charts:
    let rows = out
    if (from) rows = rows.filter(m => m.month >= from)
    if (to) rows = rows.filter(m => m.month <= to)
    return rows
  }, [allMonths, from, to])

  const fyGross = useMemo(() => {
    const t = trendline(fySeries, 'grossMargin')
    return fySeries.map((p, i) => ({ ...p, trend: t[i] }))
  }, [fySeries])
  const fyNet = useMemo(() => {
    const t = trendline(fySeries, 'netMargin')
    return fySeries.map((p, i) => ({ ...p, trend: t[i] }))
  }, [fySeries])
  const rollGross = useMemo(() => {
    const t = trendline(rollingSeries, 'grossMargin')
    return rollingSeries.map((p, i) => ({ ...p, trend: t[i] }))
  }, [rollingSeries])
  const rollNet = useMemo(() => {
    const t = trendline(rollingSeries, 'netMargin')
    return rollingSeries.map((p, i) => ({ ...p, trend: t[i] }))
  }, [rollingSeries])

  if (!ok) return null

  const avg = (arr, key) => { const v = arr.map(x => x[key]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }

  return (
    <>
      <Head><title>Margin - Rock Roofing</title></Head>
      <BizNav />
      <div style={{ maxWidth: '100%', padding: '24px 32px 80px' }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, color: INK, fontSize: 26 }}>Margin</h1>
          <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4 }}>Gross and net margins from the monthly P&amp;L, completed months only. Gross = (Income &minus; Cost of Sales) / Income. Net also deducts overheads.</div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 14px' }}>
          <label style={{ fontSize: 12, color: '#666' }}>Financial year</label>
          <select value={fyEnd} onChange={e => pickFy(Number(e.target.value))} style={inp}>
            {fyOptions.map(y => <option key={y} value={y}>Dec {y - 1} - Nov {y} (FY{y})</option>)}
          </select>
          <span style={{ width: 1, height: 24, background: '#eee', margin: '0 4px' }} />
          <label style={{ fontSize: 12, color: '#666' }}>From</label>
          <input type="month" value={from} onChange={e => setFrom(e.target.value)} style={inp} />
          <label style={{ fontSize: 12, color: '#666' }}>To</label>
          <input type="month" value={to} onChange={e => setTo(e.target.value)} style={inp} />
          <button onClick={() => { setFrom(''); setTo('') }} style={btn}>Clear range</button>
          <button onClick={() => pickFy(fyEnd)} style={btn}>Reset to FY</button>
        </div>

        {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : !data ? <div style={{ color: '#b91c1c', padding: 40 }}>Could not load.</div> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
              <MarginChart title={`Gross margin - FY${fyEnd}`} sub={`Avg ${pct(avg(fySeries, 'grossMargin'))}`} data={fyGross} dataKey="grossMargin" colour="#2563eb" />
              <MarginChart title={`Net margin - FY${fyEnd}`} sub={`Avg ${pct(avg(fySeries, 'netMargin'))}`} data={fyNet} dataKey="netMargin" colour="#16a34a" />
              <MarginChart title="Gross margin - 12-month rolling" sub="Each point = trailing 12 months" data={rollGross} dataKey="grossMargin" colour="#2563eb" />
              <MarginChart title="Net margin - 12-month rolling" sub="Each point = trailing 12 months" data={rollNet} dataKey="netMargin" colour="#16a34a" />
            </div>

            {/* Calculation table (current FY) */}
            <div style={{ marginTop: 22 }}>
              <Card title={`How each month was calculated - FY${fyEnd}`} sub="Completed months in the selected financial year.">
                <div style={{ overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 760 }}>
                    <thead>
                      <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                        <th style={{ ...th, textAlign: 'left' }}>Month</th>
                        <th style={th}>Income</th>
                        <th style={th}>Cost of sales</th>
                        <th style={th}>Gross profit</th>
                        <th style={th}>Gross margin</th>
                        <th style={th}>Overheads</th>
                        <th style={th}>Net profit</th>
                        <th style={th}>Net margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fySeries.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#aaa' }}>No completed months in this selection.</td></tr>}
                      {[...fySeries].reverse().map((m, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f2f0ec' }}>
                          <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{monthLbl(m.month)}</td>
                          <td style={td}>{gbp0(m.income)}</td>
                          <td style={td}>{gbp0(m.cos)}</td>
                          <td style={{ ...td, fontWeight: 600 }}>{gbp0(m.grossProfit)}</td>
                          <td style={{ ...td, color: '#2563eb', fontWeight: 700 }}>{pct(m.grossMargin)}</td>
                          <td style={td}>{gbp0(m.overheads)}</td>
                          <td style={{ ...td, fontWeight: 600, color: m.netProfit < 0 ? '#dc2626' : INK }}>{gbp0(m.netProfit)}</td>
                          <td style={{ ...td, color: m.netMargin != null && m.netMargin < 0 ? '#dc2626' : '#16a34a', fontWeight: 700 }}>{pct(m.netMargin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
              Figures come from the monthly Profit &amp; Loss in your Xero benchmark sync. The 12-month rolling charts plot each month using up to 12 trailing months (fewer for the earliest months, until a full year of data has built up). Margins are blank for any month with zero income. Monthly margins are naturally volatile in a project business because costs and sales land in different months - the rolling view smooths this out.
            </div>
          </>
        )}
      </div>
    </>
  )
}

function MarginChart({ title, sub, data, dataKey, colour }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: '#9a958c', marginBottom: 6 }}>{sub}</div>}
      {data.length === 0 ? <div style={{ color: '#bbb', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>No data for this selection.</div> : (
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" angle={-30} textAnchor="end" height={52} />
            <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} width={44} />
            <Tooltip formatter={(v, n) => [v == null ? '-' : `${Number(v).toFixed(1)}%`, n === 'trend' ? 'Trend' : 'Margin']} />
            <ReferenceLine y={0} stroke="#999" />
            <Line type="monotone" dataKey={dataKey} name="Margin" stroke={colour} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
            <Line type="monotone" dataKey="trend" name="Trend" stroke="#b45309" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

const inp = { padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, color: '#333' }
const btn = { background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#666' }
const th = { padding: '10px 12px', fontSize: 11, color: '#9a958c', fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap' }
