import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, monthLbl, fmtDate, Card } from '../../components/BizNav'

const monthKey = (s) => (s || '').slice(0, 7)
const pad = (n) => String(n).padStart(2, '0')

// Financial year: 1 Dec -> 30 Nov, labelled by the year it ENDS in.
function fyMonths(endYear) {
  const out = [`${endYear - 1}-12`]
  for (let m = 1; m <= 11; m++) out.push(`${endYear}-${pad(m)}`)
  return out
}
function fyOf(mo) { const [y, m] = mo.split('-').map(Number); return m === 12 ? y + 1 : y }
const nowMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
function fyRange(endYear) {
  return { from: `${endYear - 1}-12-01`, to: `${endYear}-11-30` }
}

export default function Sales() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const [fyEnd, setFyEnd] = useState(() => fyOf(nowMonth()))
  const initRange = fyRange(fyOf(nowMonth()))
  const [from, setFrom] = useState(initRange.from)
  const [to, setTo] = useState(initRange.to)

  const [target, setTarget] = useState(0)
  const [targetDraft, setTargetDraft] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(null)   // click-a-bar filter

  const [sortKey, setSortKey] = useState('date')
  const [sortDir, setSortDir] = useState('desc')

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
      const d = await fetch('/api/business-financials?view=sales').then(r => r.json())
      setData(d)
      setTarget(d.monthlyTarget || 0)
      setTargetDraft(d.monthlyTarget ? String(d.monthlyTarget) : '')
    } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  async function sync() {
    setSyncing(true)
    try { await fetch('/api/sync-benchmark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); await load() } catch {}
    setSyncing(false)
  }

  async function saveTarget() {
    const v = Number(targetDraft) || 0
    setTarget(v)
    try {
      await fetch('/api/business-financials?view=sales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'sales', monthlyTarget: v }),
      })
    } catch {}
  }

  // Selecting a financial year sets the date range to that FY (still editable after).
  function pickFy(endYear) {
    setFyEnd(endYear)
    const r = fyRange(endYear)
    setFrom(r.from); setTo(r.to)
    setSelectedMonth(null)
  }

  const byMonthAll = data?.byMonth || {}
  const lines = data?.lines || []
  const thisMonth = nowMonth()

  // FY options: from earliest data (or this FY) back a few years.
  const fyOptions = useMemo(() => {
    const years = new Set([fyOf(thisMonth)])
    for (const m of Object.keys(byMonthAll)) years.add(fyOf(m))
    for (const l of lines) if (l.date) years.add(fyOf(monthKey(l.date)))
    return [...years].sort((a, b) => b - a)
  }, [byMonthAll, lines, thisMonth])

  const chart = useMemo(() => {
    const fromM = monthKey(from), toM = monthKey(to)
    return Object.keys(byMonthAll)
      .filter(m => (!fromM || m >= fromM) && (!toM || m <= toM))
      .sort()
      .map(m => ({ month: m, amount: Math.round(byMonthAll[m]) }))
  }, [byMonthAll, from, to])

  const avg = useMemo(() => chart.length ? chart.reduce((s, m) => s + m.amount, 0) / chart.length : 0, [chart])
  const liveTarget = Number(targetDraft) || target || 0
  const avgAboveTarget = avg >= liveTarget
  const avgColor = liveTarget > 0 ? (avgAboveTarget ? '#16a34a' : '#dc2626') : '#6b7280'

  // Detail lines within window, optionally narrowed to a clicked month.
  const filteredLines = useMemo(() => {
    return lines.filter(l => {
      const d = l.date || ''
      if (from && d && d < from) return false
      if (to && d && d > to) return false
      if (selectedMonth && monthKey(d) !== selectedMonth) return false
      return true
    })
  }, [lines, from, to, selectedMonth])

  const sortedLines = useMemo(() => {
    const arr = [...filteredLines]
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      let av, bv
      switch (sortKey) {
        case 'description': av = (a.description || '').toLowerCase(); bv = (b.description || '').toLowerCase(); break
        case 'reference': av = (a.reference || '').toLowerCase(); bv = (b.reference || '').toLowerCase(); break
        case 'amount': av = a.amount || 0; bv = b.amount || 0; break
        case 'date': default: av = a.date || ''; bv = b.date || ''; break
      }
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
    return arr
  }, [filteredLines, sortKey, sortDir])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'amount' || key === 'date' ? 'desc' : 'asc') }
  }
  const arrow = (key) => sortKey === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''
  const total = useMemo(() => filteredLines.reduce((s, l) => s + (l.amount || 0), 0), [filteredLines])

  if (!ok) return null
  return (
    <>
      <Head><title>Sales - Business Financials</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <BizNav />
        <div style={{ padding: '24px 16px', maxWidth: '100%', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>Sales <span style={{ fontSize: 12, color: '#aaa', fontWeight: 400 }}>(by transaction date, incl. WIP)</span></h1>
            <button onClick={sync} disabled={syncing} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: syncing ? 0.6 : 1 }}>{syncing ? 'Syncing...' : 'Sync Xero figures'}</button>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#888' }}>Financial year</span>
              <select value={fyEnd} onChange={e => pickFy(Number(e.target.value))} style={dateInp}>
                {fyOptions.map(y => <option key={y} value={y}>Dec {y - 1} - Nov {y} (FY{y})</option>)}
              </select>
            </div>
            <span style={{ fontSize: 12, color: '#888' }}>From</span>
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setSelectedMonth(null) }} style={dateInp} />
            <span style={{ fontSize: 12, color: '#888' }}>to</span>
            <input type="date" value={to} onChange={e => { setTo(e.target.value); setSelectedMonth(null) }} style={dateInp} />
            <button onClick={() => pickFy(fyEnd)} style={{ background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: '#666' }}>Reset to FY</button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
              <span style={{ fontSize: 12, color: '#888' }}>Monthly target</span>
              <span style={{ color: '#bbb', fontSize: 12 }}>&pound;</span>
              <input type="number" value={targetDraft} onChange={e => setTargetDraft(e.target.value)} onBlur={saveTarget}
                placeholder="0" style={{ ...dateInp, width: 110, textAlign: 'right' }} />
            </div>

            <span style={{ marginLeft: 'auto', fontSize: 13, color: '#555' }}>
              {selectedMonth ? <>Showing <strong>{monthLbl(selectedMonth)}</strong> - <button onClick={() => setSelectedMonth(null)} style={{ border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>clear</button> - </> : null}
              Sales in range: <strong style={{ color: INK }}>{gbp(total)}</strong> ({filteredLines.length})
            </span>
          </div>

          {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : (
            <>
              <Card title="Sales by month (transaction date, incl. WIP)" sub="Click a bar to show only that month's transactions below">
                {/* Key for the dashed lines */}
                <div style={{ display: 'flex', gap: 18, alignItems: 'center', margin: '0 0 8px 6px', fontSize: 12, color: '#666', flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Dash color="#6b7280" /> Target ({gbp(liveTarget)})</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Dash color={avgColor} /> Average ({gbp(avg)}) - {liveTarget > 0 ? (avgAboveTarget ? 'above target' : 'below target') : 'set a target'}</span>
                </div>
                {chart.length === 0 ? <div style={{ color: '#bbb', padding: 30, textAlign: 'center' }}>No sales in this range. Click "Sync Xero figures".</div> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chart} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="month" tickFormatter={monthLbl} tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={52} />
                      <Tooltip formatter={(v) => gbp(v)} labelFormatter={monthLbl} />
                      {(Number(targetDraft) || target) > 0 && <ReferenceLine y={Number(targetDraft) || target} stroke="#6b7280" strokeDasharray="6 4" strokeWidth={2} ifOverflow="extendDomain" />}
                      <ReferenceLine y={avg} stroke={avgColor} strokeDasharray="6 4" strokeWidth={2} ifOverflow="extendDomain" />
                      <Bar dataKey="amount" name="Sales" cursor="pointer" onClick={(d) => setSelectedMonth(sm => sm === d.month ? null : d.month)}>
                        {chart.map((e) => <Cell key={e.month} fill={selectedMonth === e.month ? '#1d4ed8' : (selectedMonth ? '#bcd0f5' : '#2563eb')} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

              <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                      <th style={{ ...th, textAlign: 'left', cursor: 'pointer' }} onClick={() => toggleSort('date')}>Date{arrow('date')}</th>
                      <th style={{ ...th, textAlign: 'left', cursor: 'pointer' }} onClick={() => toggleSort('description')}>Description{arrow('description')}</th>
                      <th style={{ ...th, textAlign: 'left', cursor: 'pointer' }} onClick={() => toggleSort('reference')}>Reference{arrow('reference')}</th>
                      <th style={{ ...th, textAlign: 'left' }}>Source</th>
                      <th style={{ ...th, textAlign: 'left' }}>Code</th>
                      <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('amount')}>Amount{arrow('amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLines.map((l, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f2f0ec' }}>
                        <td style={{ ...td, textAlign: 'left', color: '#555' }}>{fmtDate(l.date)}</td>
                        <td style={{ ...td, textAlign: 'left' }}>{l.description || '-'}</td>
                        <td style={{ ...td, textAlign: 'left', color: '#888' }}>{l.reference || '-'}</td>
                        <td style={{ ...td, textAlign: 'left', color: l.sourceType === 'Credit note' ? '#dc2626' : (l.sourceType === 'Manual journal' ? '#7c3aed' : '#555') }}>{l.sourceType || '-'}</td>
                        <td style={{ ...td, textAlign: 'left', color: '#aaa' }}>{l.code}</td>
                        <td style={{ ...td, fontWeight: 600, color: l.amount < 0 ? '#dc2626' : INK }}>{gbp(l.amount)}</td>
                      </tr>
                    ))}
                    {sortedLines.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#bbb', padding: 24 }}>
                      {lines.length === 0 ? 'No sales ledger yet - click "Sync Xero figures" to pull sales transactions.' : 'No sales transactions in this range.'}
                    </td></tr>}
                  </tbody>
                  {sortedLines.length === 0 && data?.diag && (
                    <tfoot>
                      <tr><td colSpan={6} style={{ padding: '10px 14px', fontSize: 11, color: '#999', textAlign: 'left', background: '#fafafa', fontFamily: 'monospace' }}>
                        diag - chart codes: {JSON.stringify(data.diag.benchmarkSalesCodes)} | ledger codes: {JSON.stringify(data.diag.ledgerCodesPresent)} | ledger lines: {data.diag.ledgerLineCount} | requested: {JSON.stringify(data.diag.salesCodesRequested)} | fetch: {JSON.stringify(data.diag.fetchMeta)} | has journals scope: {String(data.diag.hasJournalsScope)} | token scope: {data.diag.tokenScope || '(none)'}
                      </td></tr>
                    </tfoot>
                  )}
                  {sortedLines.length > 0 && (
                    <tfoot>
                      <tr style={{ borderTop: '2px solid #eee', fontWeight: 700, background: '#faf9f7' }}>
                        <td colSpan={5} style={{ ...td, textAlign: 'right' }}>Total{selectedMonth ? ` (${monthLbl(selectedMonth)})` : ''}</td>
                        <td style={{ ...td, fontWeight: 800 }}>{gbp(total)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
                Chart from the P&amp;L benchmark (sales code 200, includes WIP), synced {data?.benchmarkUpdatedAt ? new Date(data.benchmarkUpdatedAt).toLocaleDateString('en-GB') : 'never'}.
                Line detail from the general ledger, synced {data?.ledgerUpdatedAt ? new Date(data.ledgerUpdatedAt).toLocaleDateString('en-GB') : 'never'}.
                Average and target are dashed lines on the chart; the average is green when at/above target, red when below.
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Dash({ color, solid }) {
  return <span style={{ display: 'inline-block', width: 22, height: 0, borderTop: `2px ${solid ? 'solid' : 'dashed'} ${color}` }} />
}

const th = { padding: '10px 12px', fontSize: 12, color: '#777', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', textAlign: 'right' }
const dateInp = { padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, background: '#fff' }
