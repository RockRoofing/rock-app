import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, monthLbl, fmtDate, Card } from '../../components/BizNav'

const monthKey = (s) => (s || '').slice(0, 7)
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function Sales() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const today = new Date()
  const defFrom = isoDay(new Date(today.getFullYear(), today.getMonth() - 11, 1))
  const defTo = isoDay(new Date(today.getFullYear(), today.getMonth() + 1, 0))
  const [from, setFrom] = useState(defFrom)
  const [to, setTo] = useState(defTo)

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
    try { const d = await fetch('/api/business-financials?view=sales').then(r => r.json()); setData(d) } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  async function sync() {
    setSyncing(true)
    try { await fetch('/api/sync-benchmark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); await load() } catch {}
    setSyncing(false)
  }

  const byMonthAll = data?.byMonth || {}
  const lines = data?.lines || []
  const thisMonth = today.toISOString().slice(0, 7)

  // Chart data: months within the from/to window (by month).
  const chart = useMemo(() => {
    const fromM = monthKey(from), toM = monthKey(to)
    return Object.keys(byMonthAll)
      .filter(m => (!fromM || m >= fromM) && (!toM || m <= toM))
      .sort()
      .map(m => ({ month: m, amount: Math.round(byMonthAll[m]) }))
  }, [byMonthAll, from, to])

  // Detail lines within the date window.
  const filteredLines = useMemo(() => {
    return lines.filter(l => {
      const d = l.date || ''
      if (from && d && d < from) return false
      if (to && d && d > to) return false
      return true
    })
  }, [lines, from, to])

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
    else { setSortKey(key); setSortDir(key === 'amount' ? 'desc' : (key === 'date' ? 'desc' : 'asc')) }
  }
  const arrow = (key) => sortKey === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''

  const total = useMemo(() => filteredLines.reduce((s, l) => s + (l.amount || 0), 0), [filteredLines])
  const chartTotal = useMemo(() => chart.reduce((s, m) => s + m.amount, 0), [chart])

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

          {/* Date filter */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: '#888' }}>Between</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={dateInp} />
            <span style={{ fontSize: 12, color: '#888' }}>and</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={dateInp} />
            <button onClick={() => { setFrom(defFrom); setTo(defTo) }} style={{ background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: '#666' }}>Reset</button>
            <span style={{ marginLeft: 'auto', fontSize: 13, color: '#555' }}>Sales in range (lines): <strong style={{ color: INK }}>{gbp(total)}</strong> - {filteredLines.length} transactions</span>
          </div>

          {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : (
            <>
              <Card title="Sales by month (transaction date, incl. WIP)" sub={`From the P&L (code 200). Total shown: ${gbp(chartTotal)}`}>
                {chart.length === 0 ? <div style={{ color: '#bbb', padding: 30, textAlign: 'center' }}>No sales in this range. Click "Sync Xero figures".</div> : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={chart} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="month" tickFormatter={monthLbl} tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={52} />
                      <Tooltip formatter={(v) => gbp(v)} labelFormatter={monthLbl} />
                      <ReferenceLine x={thisMonth} stroke="#16a34a" strokeDasharray="4 3" label={{ value: 'now', fontSize: 10, fill: '#16a34a' }} />
                      <Bar dataKey="amount" name="Sales" fill="#2563eb" />
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
                        <td style={{ ...td, textAlign: 'left', color: '#aaa' }}>{l.code}</td>
                        <td style={{ ...td, fontWeight: 600, color: l.amount < 0 ? '#dc2626' : INK }}>{gbp(l.amount)}</td>
                      </tr>
                    ))}
                    {sortedLines.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#bbb', padding: 24 }}>No sales transactions in this range.</td></tr>}
                  </tbody>
                  {sortedLines.length > 0 && (
                    <tfoot>
                      <tr style={{ borderTop: '2px solid #eee', fontWeight: 700, background: '#faf9f7' }}>
                        <td colSpan={4} style={{ ...td, textAlign: 'right' }}>Total</td>
                        <td style={{ ...td, fontWeight: 800 }}>{gbp(total)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
                Chart from the P&amp;L benchmark (sales code 200, includes WIP), synced {data?.benchmarkUpdatedAt ? new Date(data.benchmarkUpdatedAt).toLocaleDateString('en-GB') : 'never'}.
                Line detail from the general ledger, synced {data?.ledgerUpdatedAt ? new Date(data.ledgerUpdatedAt).toLocaleDateString('en-GB') : 'never'}.
                The chart uses the P&amp;L monthly total; the line detail lists every ledger entry - small differences between the two can occur if a sales entry was posted after the last ledger pull.
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

const th = { padding: '10px 12px', fontSize: 12, color: '#777', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', textAlign: 'right' }
const dateInp = { padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }
