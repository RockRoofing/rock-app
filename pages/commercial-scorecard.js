import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const fmt = (n) => n == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)
const pct = (n) => n == null ? '—' : (n * 100).toFixed(1) + '%'
const monthLabel = (s) => s ? new Date(s + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : ''

function getMonthsBetween(fromStr, toStr) {
  const months = []
  const [fy, fm] = fromStr.split('-').map(Number)
  const [ty, tm] = toStr.split('-').map(Number)
  let y = fy, m = fm
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return months
}

function computeTrendline(data) {
  const points = data.map((d, i) => ({ i, value: d.value })).filter(d => d.value != null && !isNaN(d.value))
  if (points.length < 2) return data.map(() => null)
  const n = points.length
  const sumX = points.reduce((s, p) => s + p.i, 0)
  const sumY = points.reduce((s, p) => s + p.value, 0)
  const sumXY = points.reduce((s, p) => s + p.i * p.value, 0)
  const sumX2 = points.reduce((s, p) => s + p.i * p.i, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return data.map(() => null)
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return data.map((_, i) => slope * i + intercept)
}

function rag(actual, target, mode = 'normal') {
  if (actual == null || target == null) return '#aaa'
  if (mode === 'binary') return actual ? '#16a34a' : '#e63946'
  const ratio = actual / target
  if (ratio >= 1) return '#16a34a'
  if (ratio >= 0.85) return '#ca8a04'
  return '#e63946'
}

// Modal for drill-down details
function DrillModal({ title, rows, columns, onClose }) {
  if (!rows || rows.length === 0) return null
  const tdS = { padding: '7px 10px', borderBottom: '0.5px solid #f0efec', fontSize: 12 }
  const thS = { padding: '8px 10px', fontWeight: 500, color: '#555', textAlign: 'left', fontSize: 12, borderBottom: '1px solid #e1e0d9', whiteSpace: 'nowrap' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 900, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e1e0d9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          <button onClick={onClose} style={{ fontSize: 18, border: 'none', background: 'none', cursor: 'pointer', color: '#888' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#fff' }}>
              <tr>{columns.map(c => <th key={c.key} style={{ ...thS, textAlign: c.right ? 'right' : 'left' }}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafaf9' }}>
                  {columns.map(c => (
                    <td key={c.key} style={{ ...tdS, textAlign: c.right ? 'right' : 'left', color: c.color ? c.color(row[c.key]) : undefined }}>
                      {c.format ? c.format(row[c.key], row) : (row[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const DEFAULT_TARGETS = {
  gpMargin: 0.20,
  paylessNotices: 0,
  avgPaymentDays: 30,
}

const LAST_12_MONTHS = (() => {
  const months = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
})()

export default function CommercialScorecard() {
  const [metrics, setMetrics] = useState(null)
  const [retentionInvoiced, setRetentionInvoiced] = useState({})
  const [targets, setTargets] = useState(DEFAULT_TARGETS)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [editingTarget, setEditingTarget] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [savingRetention, setSavingRetention] = useState(null)

  const now = new Date()
  const _yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
  const [dateFrom, setDateFrom] = useState(_yearAgo.toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState(now.toISOString().split('T')[0])

  const displayMonths = getMonthsBetween(dateFrom.substring(0, 7), dateTo.substring(0, 7))

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [mr, rr, tr] = await Promise.all([
        fetch('/api/commercial-metrics'),
        fetch('/api/retention-invoiced'),
        fetch('/api/targets'),
      ])
      const md = await mr.json()
      const rd = await rr.json()
      const td = await tr.json()
      setMetrics(md)
      setRetentionInvoiced(rd.data || {})
      setTargets(td.targets?.commercial || DEFAULT_TARGETS)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function saveTarget(key, value) {
    const newTargets = { ...targets, [key]: parseFloat(value) }
    setTargets(newTargets)
    const all = await fetch('/api/targets').then(r => r.json())
    const updated = { ...all.targets, commercial: newTargets }
    await fetch('/api/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targets: updated }) })
    setEditingTarget(null)
  }

  async function toggleRetention(month) {
    setSavingRetention(month)
    const current = retentionInvoiced[month]
    const newVal = !current
    const res = await fetch('/api/retention-invoiced', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, value: newVal }),
    })
    const data = await res.json()
    setRetentionInvoiced(data.data || {})
    setSavingRetention(null)
  }

  const s = { fontFamily: 'system-ui,-apple-system,sans-serif', fontSize: 14, color: '#1a1a19' }
  const CARD_HEIGHT = 210

  function renderCard({ key, label, sub, value, format, target, targetKey, mode, trendData, showAvg, drillData, drillColumns, drillTitle, extra }) {
    const color = rag(value, target, mode)
    const isEditing = editingTarget === key
    const hasDrill = drillData && drillData.length > 0

    const trendValues = trendData || []
    const trendlineValues = computeTrendline(trendValues)
    const chartData = trendValues.map((d, i) => ({ ...d, trend: trendlineValues[i] }))

    const avgVal = showAvg && trendValues.length
      ? trendValues.filter(d => d.value != null).reduce((s, d) => s + d.value, 0) / trendValues.filter(d => d.value != null).length
      : null

    return (
      <div
        key={key}
        onClick={() => hasDrill && setModal({ title: drillTitle || label, rows: drillData, columns: drillColumns })}
        style={{
          background: '#fff', borderRadius: 10, padding: '14px 16px',
          border: '1px solid #e1e0d9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          display: 'grid', gridTemplateColumns: trendData ? '160px 1fr' : '1fr',
          gap: 16, alignItems: 'center',
          height: CARD_HEIGHT, boxSizing: 'border-box',
          cursor: hasDrill ? 'pointer' : 'default',
          transition: 'box-shadow 0.15s',
        }}
        onMouseEnter={e => { if (hasDrill) e.currentTarget.style.boxShadow = '0 3px 12px rgba(0,0,0,0.1)' }}
        onMouseLeave={e => { if (hasDrill) e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)' }}
      >
        <div>
          <div style={{ fontSize: 14, color: '#888', marginBottom: 6, lineHeight: 1.3 }}>
            {label}
            {hasDrill && <span style={{ fontSize: 10, color: '#bbb', marginLeft: 4 }}>↗</span>}
            {sub && <div style={{ color: '#bbb', fontSize: 13 }}>({sub})</div>}
          </div>
          <div style={{ fontSize: 29, fontWeight: 600, color: '#1a1a19', marginBottom: 2 }}>
            {value != null ? format(value) : '—'}
          </div>
          {avgVal != null && (
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 2 }}>Avg: {format(avgVal)}/mo</div>
          )}
          {extra}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            {isEditing ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)}
                  style={{ width: 70, fontSize: 16, padding: '2px 6px', border: '1px solid #d0d0cc', borderRadius: 4, fontFamily: 'inherit' }}
                  autoFocus onKeyDown={e => { if (e.key === 'Enter') saveTarget(targetKey || key, editValue); if (e.key === 'Escape') setEditingTarget(null) }} />
                <button onClick={() => saveTarget(targetKey || key, editValue)}
                  style={{ fontSize: 14, padding: '2px 6px', border: 'none', borderRadius: 4, background: '#1a1a19', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
              </div>
            ) : (
              <div style={{ fontSize: 17, color: '#888', cursor: 'pointer' }}
                onClick={() => { setEditingTarget(key); setEditValue(String(target || '')) }}>
                Target: {target != null ? format(target) : '—'} <span style={{ fontSize: 17 }}>✎</span>
              </div>
            )}
            <span style={{ color, fontSize: 48, lineHeight: 1 }}>●</span>
          </div>
        </div>
        {trendData && (
          <div style={{ height: CARD_HEIGHT - 28 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#bbb' }} interval="preserveStartEnd" />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip formatter={(v, n) => n === 'trend' ? null : format(v)} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="value" stroke="#2a78d6" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                <Line type="linear" dataKey="trend" stroke="#bbb" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    )
  }

  // Build trend data from metrics
  const gpTrend = displayMonths.map(m => ({
    month: monthLabel(m),
    value: metrics?.gpMargin != null ? metrics.gpMargin * 100 : null, // same value for now — would need historical data per month
  }))

  const paylessTrend = displayMonths.map(m => ({
    month: monthLabel(m),
    value: metrics?.paylessByMonth?.[m]?.length ?? 0,
  }))

  const paymentTimeTrend = displayMonths.map(m => ({
    month: monthLabel(m),
    value: metrics?.avgPaymentTime?.[m]?.avgDays ?? null,
  }))

  // Payless drill columns
  const paylessColumns = [
    { key: 'jobNo', label: 'Project' },
    { key: 'projectName', label: 'Project Name' },
    { key: 'invoiceNumber', label: 'Invoice No' },
    { key: 'date', label: 'Invoice Date', format: (v) => v ? new Date(v).toLocaleDateString('en-GB') : '—' },
    { key: 'total', label: 'Invoice Total', right: true, format: (v) => fmt(v) },
    { key: 'amountPaid', label: 'Paid', right: true, format: (v) => fmt(v) },
    { key: 'creditNoteTotal', label: 'Credit Note', right: true, format: (v) => v ? fmt(v) : '—' },
    { key: 'hasCreditNote', label: 'Type', format: (v) => v ? 'Credit Note' : 'Underpayment' },
  ]

  const paymentTimeColumns = [
    { key: 'jobNo', label: 'Project' },
    { key: 'projectName', label: 'Project Name' },
    { key: 'invoiceNumber', label: 'Invoice No' },
    { key: 'date', label: 'Invoice Date', format: (v) => v ? new Date(v).toLocaleDateString('en-GB') : '—' },
    { key: 'fullyPaidOnDate', label: 'Paid Date', format: (v) => v ? new Date(v).toLocaleDateString('en-GB') : '—' },
    { key: 'total', label: 'Amount', right: true, format: (v) => fmt(v) },
  ]

  // Last 12 months retention invoiced mini-table
  const retentionTable = (
    <div style={{ fontSize: 11, marginBottom: 4 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {LAST_12_MONTHS.map(m => {
          const done = retentionInvoiced[m]
          return (
            <div key={m}
              onClick={e => { e.stopPropagation(); toggleRetention(m) }}
              style={{
                cursor: 'pointer',
                background: done ? '#dcfce7' : '#fee2e2',
                border: `1px solid ${done ? '#86efac' : '#fca5a5'}`,
                borderRadius: 4, padding: '2px 5px',
                color: done ? '#16a34a' : '#e63946',
                fontWeight: 600, fontSize: 10,
                opacity: savingRetention === m ? 0.6 : 1,
              }}>
              {monthLabel(m)}: {done ? '✓' : '✗'}
            </div>
          )
        })}
      </div>
    </div>
  )

  // All payless notices for drill
  const allPayless = Object.values(metrics?.paylessByMonth || {}).flat()

  // All payment time invoices for current modal month or all
  const allPaymentInvoices = Object.values(metrics?.avgPaymentTime || {}).flatMap(m => m.invoices || [])

  return (
    <>
      <Head><title>Rock Roofing — Commercial Scorecard</title></Head>
      <div style={{ ...s, minHeight: '100vh', background: '#fafaf9' }}>
        {modal && <DrillModal title={modal.title} rows={modal.rows} columns={modal.columns} onClose={() => setModal(null)} />}

        {/* Nav */}
        <div style={{ background: '#1a1a19', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 8, height: 52 }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <Link href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>← Portal</Link>
          <span style={{ color: '#444' }}>|</span>
          <Link href="/commercial" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Project Financials</Link>
          <span style={{ color: '#444' }}>|</span>
          <Link href="/retention" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Retention</Link>
          <span style={{ color: '#444' }}>|</span>
          <Link href="/variations" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Variations</Link>
          <span style={{ color: '#444' }}>|</span>
          <Link href="/application-calendar" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Application Calendar</Link>
          <span style={{ color: '#444' }}>|</span>
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Commercial Scorecard</span>
          <div style={{ flex: 1 }} />
        </div>

        <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
          {loading ? <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading...</div> : (
            <>
              {/* Date filter + key */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24, padding: '12px 16px', background: '#f8f8f7', borderRadius: 8, border: '0.5px solid #e1e0d9' }}>
                <div>
                  <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>From</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>To</label>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }} />
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#888', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500 }}>Key:</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: '#16a34a', fontSize: 36, lineHeight: 1 }}>●</span> On target</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: '#ca8a04', fontSize: 36, lineHeight: 1 }}>●</span> Close (≥85%)</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: '#e63946', fontSize: 36, lineHeight: 1 }}>●</span> Below target</span>
                </div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Commercial Team</span>
                <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>— Live projects · {metrics?.liveProjectCount || 0} projects tracked</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* 1. GP Margin */}
                {renderCard({
                  key: 'gpMargin',
                  label: 'Gross Profit Margin',
                  sub: 'Live & in-progress projects only',
                  value: metrics?.gpMargin,
                  format: pct,
                  target: targets.gpMargin,
                  trendData: gpTrend,
                  showAvg: true,
                  extra: metrics && (
                    <div style={{ fontSize: 11, color: '#555', marginBottom: 2, lineHeight: 1.6 }}>
                      <div>Profit: <strong>{fmt(metrics.gpProfit)}</strong></div>
                      <div style={{ color: '#aaa', fontSize: 10 }}>Invoiced: {fmt(metrics.totalGrossInvoiced)} · Costs: {fmt(metrics.totalCosts)}</div>
                    </div>
                  ),
                })}

                {/* 2. Payless Notices */}
                {renderCard({
                  key: 'paylessNotices',
                  label: 'Payless Notices',
                  sub: 'Credit notes or underpayments on invoices',
                  value: metrics?.paylessTotal ?? 0,
                  format: v => v,
                  target: targets.paylessNotices,
                  trendData: paylessTrend,
                  showAvg: true,
                  drillData: allPayless,
                  drillColumns: paylessColumns,
                  drillTitle: 'Payless Notices — All',
                })}

                {/* 3. Retentions Invoiced */}
                {renderCard({
                  key: 'retentionInvoiced',
                  label: 'Retentions Invoiced',
                  sub: 'Manual — click month to toggle',
                  value: retentionInvoiced[displayMonths[displayMonths.length - 1]] ? 1 : 0,
                  format: v => v ? 'Yes' : 'No',
                  target: 1,
                  targetKey: 'retentionInvoiced',
                  mode: 'binary',
                  extra: retentionTable,
                })}

                {/* 4. Average Time to Get Paid */}
                {renderCard({
                  key: 'avgPaymentDays',
                  label: 'Average Time to Get Paid',
                  sub: 'Days from invoice to payment',
                  value: metrics?.avgPaymentTime
                    ? (() => {
                        const all = Object.values(metrics.avgPaymentTime)
                        if (!all.length) return null
                        return Math.round(all.reduce((s, m) => s + m.avgDays, 0) / all.length)
                      })()
                    : null,
                  format: v => v != null ? `${v} days` : '—',
                  target: targets.avgPaymentDays,
                  trendData: paymentTimeTrend,
                  showAvg: true,
                  drillData: allPaymentInvoices,
                  drillColumns: paymentTimeColumns,
                  drillTitle: 'Invoice Payment Times — All',
                })}

              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
