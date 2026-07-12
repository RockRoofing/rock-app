import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import OperationsShell, { PageHeading, SubTabs } from '../../components/OperationsShell'

const pct = (n) => n == null ? '—' : (n * 100).toFixed(1) + '%'
const num = (n) => n == null ? '—' : String(n)
const gbp = (n) => n == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)
const monthLabel = (s) => s ? new Date(s + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : ''

// Least-squares trend line over the series (nulls skipped), matching pre-contract.
function computeTrendline(data) {
  const pts = data.map((d, i) => ({ i, v: d.value })).filter(d => d.v != null && !isNaN(d.v))
  if (pts.length < 2) return data.map(() => null)
  const n = pts.length
  const sx = pts.reduce((s, p) => s + p.i, 0), sy = pts.reduce((s, p) => s + p.v, 0)
  const sxy = pts.reduce((s, p) => s + p.i * p.v, 0), sx2 = pts.reduce((s, p) => s + p.i * p.i, 0)
  const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx)
  const intercept = (sy - slope * sx) / n
  return data.map((_, i) => slope * i + intercept)
}

// higher-better % / count → normal; lower-better count → 'lower'/'zero'; binary Yes/No.
function rag(actual, target, mode = 'normal') {
  if (actual == null) return '#aaa'
  if (mode === 'binary') return actual > 0 ? '#16a34a' : '#e63946'
  if (mode === 'zero') return actual === 0 ? '#16a34a' : (actual <= (target || 0) ? '#f59e0b' : '#e63946')
  if (target == null) return '#aaa'
  const ratio = actual / target
  if (mode === 'lower') return actual <= target ? '#16a34a' : (ratio <= 1.25 ? '#f59e0b' : '#e63946')
  return ratio >= 1 ? '#16a34a' : (ratio >= 0.8 ? '#f59e0b' : '#e63946')
}

const SUB_TABS = [
  { key: 'will', label: 'Will', kind: 'cm', name: 'Will' },
  { key: 'mike', label: 'Mike', kind: 'cm', name: 'Mike' },
  { key: 'dori', label: 'Dori', kind: 'ops', name: 'Dori' },
]

const CARD_H = 150

export default function OpsScorecardsPage() {
  const [sub, setSub] = useState('will')
  const [data, setData] = useState(null)
  const [targets, setTargets] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editingTarget, setEditingTarget] = useState(null)
  const [editValue, setEditValue] = useState('')

  const _now = new Date()
  const _yearAgo = new Date(_now.getFullYear() - 1, _now.getMonth(), 1)
  const [dateFrom, setDateFrom] = useState(_yearAgo.toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState(_now.toISOString().split('T')[0])

  const current = SUB_TABS.find(t => t.key === sub)

  async function load() {
    setLoading(true)
    try {
      const [d, t] = await Promise.all([
        fetch(`/api/ops-scorecards?from=${dateFrom}&to=${dateTo}`).then(r => r.json()),
        fetch('/api/targets').then(r => r.json()),
      ])
      setData(d); setTargets(t.targets || {})
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [dateFrom, dateTo])

  async function saveTarget(type, key, value) {
    const v = parseFloat(value)
    const next = { ...targets, [type]: { ...(targets?.[type] || {}), [key]: isNaN(v) ? value : v } }
    setTargets(next); setEditingTarget(null)
    try { await fetch('/api/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targets: next }) }) } catch {}
  }

  async function setToolbox(month, yes) {
    try { await fetch('/api/ops-scorecards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month, toolbox: yes }) }) } catch {}
    load()
  }

  const cmEntry = () => {
    if (!data?.cms) return null
    const want = current.name.toLowerCase()
    const key = Object.keys(data.cms).find(k => k.toLowerCase().includes(want))
    return key ? data.cms[key] : null
  }

  // Metric definitions. seriesKey pulls the value from each month's object.
  const CM_METRICS = [
    { key: 'gpMargin', label: 'Gross margin — their projects', sub: 'Live & defects projects', format: pct, targetType: 'contractsManager', targetKey: 'gpMargin', mode: 'normal', latestOnly: true },
    { key: 'psnPct', label: 'Pre-Start Notifications', sub: 'Completed vs required', format: pct, targetType: 'contractsManager', targetKey: 'psnPct', mode: 'normal' },
    { key: 'hsIncidences', label: 'H&S incidences', sub: 'Accident Book / Accident & Incident Report', format: num, targetType: 'contractsManager', targetKey: 'hsIncidences', mode: 'zero' },
    { key: 'wiRockFault', label: 'Water Ingress — Rock at fault', sub: 'Reports where Rock responsible', format: num, targetType: 'contractsManager', targetKey: 'wiRockFault', mode: 'zero' },
    { key: 'procPct', label: 'Procurement savings complete', sub: 'Completed projects with full savings doc', format: pct, targetType: 'contractsManager', targetKey: 'procPct', mode: 'normal', latestOnly: true },
    { key: 'issuesOnTimePct', label: 'Issues resolved on time', sub: 'On-time vs total resolved', format: pct, targetType: 'contractsManager', targetKey: 'issuesOnTimePct', mode: 'normal' },
  ]
  const OPS_METRICS = [
    { key: 'sosPct', label: 'Start On Site Checklists', sub: 'Completed vs required', format: pct, targetType: 'operationsManager', targetKey: 'sosPct', mode: 'normal' },
    { key: 'diaryPct', label: 'Daily Site Diaries', sub: 'Completed vs required', format: pct, targetType: 'operationsManager', targetKey: 'diaryPct', mode: 'normal' },
    { key: 'wahPct', label: 'Work Area Handovers', sub: 'Completed vs required', format: pct, targetType: 'operationsManager', targetKey: 'wahPct', mode: 'normal' },
    { key: 'toolbox', label: 'Toolbox Talk', sub: '1 required per month', format: (v) => v == null ? 'Not set' : (v ? 'Yes' : 'No'), targetType: 'operationsManager', targetKey: 'toolbox', mode: 'binary', isToolbox: true },
    { key: 'tasksPct', label: 'Tasks completed on time', sub: 'On-time vs total closed', format: pct, targetType: 'operationsManager', targetKey: 'tasksPct', mode: 'normal' },
    { key: 'risksPct', label: 'Risk log completed on time', sub: 'On-time vs total resolved', format: pct, targetType: 'operationsManager', targetKey: 'risksPct', mode: 'normal' },
  ]

  const entry = current.kind === 'cm' ? cmEntry() : (data?.ops || null)
  const series = entry?.series || []
  const latest = entry?.latest || {}
  const metrics = current.kind === 'cm' ? CM_METRICS : OPS_METRICS
  const latestMonth = data?.months?.[data.months.length - 1]

  function renderCard(m) {
    const actual = latest[m.key]
    const target = targets?.[m.targetType]?.[m.targetKey]
    const color = rag(actual, target, m.mode)
    const isEditing = editingTarget === m.key

    const trendData = series.map(s => ({ month: monthLabel(s.month), value: s[m.key] }))
    const trend = computeTrendline(trendData)
    const chartData = trendData.map((d, i) => ({ ...d, trend: trend[i] }))
    const showChart = !m.isToolbox && !m.latestOnly

    return (
      <div key={m.key} style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', border: '1px solid #e1e0d9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'grid', gridTemplateColumns: showChart ? '220px 1fr' : '1fr', gap: 20, alignItems: 'center', minHeight: CARD_H, boxSizing: 'border-box' }}>
        <div style={!showChart ? { textAlign: 'center' } : undefined}>
          <div style={{ fontSize: 13.5, color: '#888', marginBottom: 6, lineHeight: 1.3 }}>
            {m.label}
            {m.sub && <div style={{ color: '#bbb', fontSize: 12 }}>({m.sub})</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: showChart ? 'flex-start' : 'center' }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <div style={{ fontSize: 27, fontWeight: 600, color: '#1a1a19' }}>{m.format(actual)}</div>
          </div>
          {m.key === 'gpMargin' && latest._gpTotals && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>Profit {gbp(latest._gpTotals.totalProfit)} · {latest._gpTotals.count} project{latest._gpTotals.count !== 1 ? 's' : ''}</div>
          )}
          <div style={{ marginTop: 8 }}>
            {m.isToolbox ? (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button onClick={() => setToolbox(latestMonth, true)} style={{ ...toggleBtn, ...(actual === 1 ? toggleOn : {}) }}>Yes</button>
                <button onClick={() => setToolbox(latestMonth, false)} style={{ ...toggleBtn, ...(actual === 0 ? toggleOff : {}) }}>No</button>
              </div>
            ) : isEditing ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: showChart ? 'flex-start' : 'center' }}>
                <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') saveTarget(m.targetType, m.targetKey, editValue); if (e.key === 'Escape') setEditingTarget(null) }}
                  style={{ width: 80, fontSize: 15, padding: '3px 6px', border: '1px solid #d0d0cc', borderRadius: 4, fontFamily: 'inherit' }} />
                <button onClick={() => saveTarget(m.targetType, m.targetKey, editValue)} style={{ fontSize: 13, padding: '3px 8px', border: 'none', borderRadius: 4, background: '#1a1a19', color: '#fff', cursor: 'pointer' }}>✓</button>
              </div>
            ) : (
              <div style={{ fontSize: 13.5, color: '#999', cursor: 'pointer' }} onClick={() => { setEditingTarget(m.key); setEditValue(String(target ?? '')) }}>
                Target: {target == null ? '—' : (m.format === pct ? pct(target) : (m.format === gbp ? gbp(target) : target))} <span>✎</span>
              </div>
            )}
          </div>
        </div>
        {showChart && (
          <div style={{ height: CARD_H - 24 }}>
            {series.some(s => s[m.key] != null) && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#bbb' }} interval="preserveStartEnd" />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip formatter={(v) => m.format(v)} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="value" stroke="#2a78d6" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                  <Line type="linear" dataKey="trend" stroke="#bbb" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    )
  }

  const months = data?.months || []

  return (
    <OperationsShell active="scorecards" title="Scorecards">
      <PageHeading title="Operations Scorecards" sub="Contracts Managers (Will & Mike) and Operations Manager (Dori)." />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <SubTabs tabs={SUB_TABS} active={sub} onChange={setSub} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#888' }}>From</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={dateInp} />
            <span style={{ fontSize: 12, color: '#888' }}>To</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={dateInp} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: '#888' }}>
            <span style={{ fontWeight: 600 }}>Key:</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#16a34a' }} /> On target</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} /> Close (≥80%)</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e63946' }} /> Below target</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>Loading…</div>
      ) : current.kind === 'cm' && !entry ? (
        <div style={{ background: '#fff', border: '1px dashed #ddd', borderRadius: 12, padding: 30, textAlign: 'center', color: '#999' }}>
          No projects found for {current.label}. Check the Contracts Manager name on their projects matches "{current.name}".
        </div>
      ) : (
        <>
          {/* Full-width graph cards (no current-month column) */}
          <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
            {current.label}{latestMonth && <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>— Latest: {monthLabel(latestMonth)}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
            {metrics.map(renderCard)}
          </div>

          {/* Bottom trend table — same as pre-contract */}
          {months.length > 0 && (
            <>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 12 }}>Trend — {monthLabel(months[0])} to {monthLabel(months[months.length - 1])}</div>
              <div style={{ overflowX: 'auto', maxHeight: 460, border: '0.5px solid #e1e0d9', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e1e0d9', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>
                      <th style={{ ...thS, minWidth: 220, position: 'sticky', left: 0, background: '#fff', zIndex: 3 }}>Metric</th>
                      <th style={{ ...thS, minWidth: 110, position: 'sticky', left: 220, background: '#fff', zIndex: 3 }}>Target</th>
                      {months.map(m => <th key={m} style={{ ...thS, textAlign: 'right', minWidth: 72 }}>{monthLabel(m)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map(md => {
                      const target = targets?.[md.targetType]?.[md.targetKey]
                      return (
                        <tr key={md.key} style={{ borderBottom: '0.5px solid #f0efec' }}>
                          <td style={{ ...tdS, position: 'sticky', left: 0, background: '#fff' }}>{md.label}{md.sub && <span style={{ fontSize: 10, color: '#bbb' }}> ({md.sub})</span>}</td>
                          <td style={{ ...tdS, color: '#888', position: 'sticky', left: 220, background: '#fff' }}>
                            {editingTarget === `table-${md.key}` ? (
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus onKeyDown={e => { if (e.key === 'Enter') saveTarget(md.targetType, md.targetKey, editValue); if (e.key === 'Escape') setEditingTarget(null) }} style={{ width: 64, fontSize: 12, padding: '2px 6px', border: '1px solid #d0d0cc', borderRadius: 4, fontFamily: 'inherit' }} />
                                <button onClick={() => saveTarget(md.targetType, md.targetKey, editValue)} style={{ fontSize: 11, padding: '2px 6px', border: 'none', borderRadius: 4, background: '#1a1a19', color: '#fff', cursor: 'pointer' }}>✓</button>
                              </div>
                            ) : md.isToolbox ? (
                              <span style={{ color: '#bbb' }}>—</span>
                            ) : (
                              <span style={{ cursor: 'pointer' }} onClick={() => { setEditingTarget(`table-${md.key}`); setEditValue(String(target ?? '')) }}>
                                {target == null ? '—' : (md.format === pct ? pct(target) : (md.format === gbp ? gbp(target) : target))} <span style={{ fontSize: 10 }}>✎</span>
                              </span>
                            )}
                          </td>
                          {series.map(s => {
                            const val = s[md.key]
                            const color = rag(val, target, md.mode)
                            return (
                              <td key={s.month} style={{ ...tdS, textAlign: 'right', color: val != null ? color : '#ddd', fontWeight: val != null ? 500 : 400 }}>
                                {val != null ? md.format(val) : '—'}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </OperationsShell>
  )
}

const thS = { padding: '8px 10px', fontWeight: 500, color: '#555', textAlign: 'left', fontSize: 12, borderBottom: '1px solid #e1e0d9', whiteSpace: 'nowrap' }
const tdS = { padding: '7px 10px', borderBottom: '0.5px solid #f0efec', fontSize: 12, verticalAlign: 'middle' }
const dateInp = { fontSize: 12, padding: '5px 8px', border: '1px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }
const toggleBtn = { flex: 1, maxWidth: 90, padding: '8px 0', borderRadius: 8, border: '1px solid #e1e0d9', background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#888' }
const toggleOn = { background: '#16a34a', color: '#fff', borderColor: '#16a34a' }
const toggleOff = { background: '#e63946', color: '#fff', borderColor: '#e63946' }
