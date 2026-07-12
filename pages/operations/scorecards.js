import { useState, useEffect } from 'react'
import OperationsShell, { PageHeading, SubTabs } from '../../components/OperationsShell'

const pct = (n) => n == null ? '—' : `${(n * 100).toFixed(1)}%`
const num = (n) => n == null ? '—' : String(n)
const gbp = (n) => n == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)
const monthLabel = (s) => s ? new Date(s + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : ''
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const shiftMonth = (m, delta) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

// RAG colour. mode: 'normal' (higher better), 'lower' (lower better, target is a
// ceiling), 'binary' (>0 green), 'zero' (0 is good, anything above is bad).
function rag(actual, target, mode = 'normal') {
  if (actual == null) return '#aaa'
  if (mode === 'binary') return actual > 0 ? '#16a34a' : '#e63946'
  if (mode === 'zero') return actual === 0 ? '#16a34a' : (actual <= (target || 0) ? '#f59e0b' : '#e63946')
  if (target == null) return '#aaa'
  const ratio = actual / target
  if (mode === 'lower') return actual <= target ? '#16a34a' : (ratio <= 1.25 ? '#f59e0b' : '#e63946')
  return ratio >= 1 ? '#16a34a' : (ratio >= 0.8 ? '#f59e0b' : '#e63946')
}

// Tabs. Will & Mike are Contracts Managers (same metric set); Dori is Ops Manager.
// The `name` maps the tab to the Contracts Manager name used across the data.
const SUB_TABS = [
  { key: 'will', label: 'Will', kind: 'cm', name: 'Will' },
  { key: 'mike', label: 'Mike', kind: 'cm', name: 'Mike' },
  { key: 'dori', label: 'Dori', kind: 'ops', name: 'Dori' },
]

export default function OpsScorecardsPage() {
  const [sub, setSub] = useState('will')
  const [month, setMonth] = useState(thisMonth())
  const [data, setData] = useState(null)
  const [targets, setTargets] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editingTarget, setEditingTarget] = useState(null)
  const [editValue, setEditValue] = useState('')

  const current = SUB_TABS.find(t => t.key === sub)

  async function load() {
    setLoading(true)
    try {
      const [d, t] = await Promise.all([
        fetch(`/api/ops-scorecards?month=${month}`).then(r => r.json()),
        fetch('/api/targets').then(r => r.json()),
      ])
      setData(d); setTargets(t.targets || {})
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [month])

  async function saveTarget(type, key, value) {
    const v = parseFloat(value)
    const next = { ...targets, [type]: { ...(targets?.[type] || {}), [key]: isNaN(v) ? value : v } }
    setTargets(next); setEditingTarget(null)
    try { await fetch('/api/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targets: next }) }) } catch {}
  }

  async function setToolbox(yes) {
    try { await fetch('/api/ops-scorecards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month, toolbox: yes }) }) } catch {}
    load()
  }

  // Resolve the CM's data by matching the tab name against the computed cm names.
  const cmData = () => {
    if (!data?.cms) return null
    const want = current.name.toLowerCase()
    const key = Object.keys(data.cms).find(k => k.toLowerCase().includes(want))
    return key ? { ...data.cms[key], _name: key } : null
  }

  const cmMetrics = (d) => [
    { key: 'gpMargin', label: 'Gross margin — their projects', sub: 'Live & defects-period projects', format: pct, targetType: 'contractsManager', targetKey: 'gpMargin', mode: 'normal' },
    { key: 'hsIncidences', label: 'H&S incidences', sub: 'Accident Book / Accident & Incident Report (this month)', format: num, targetType: 'contractsManager', targetKey: 'hsIncidences', mode: 'zero' },
    { key: 'wiRockFault', label: 'Water Ingress — Rock at fault', sub: 'All projects, Rock responsible', format: num, targetType: 'contractsManager', targetKey: 'wiRockFault', mode: 'zero' },
    { key: 'psnSubmitted', label: 'Pre-Start Notifications submitted', sub: 'This month', format: num, targetType: 'contractsManager', targetKey: 'psnSubmitted', mode: 'normal' },
    { key: 'procIncomplete', label: 'Procurement savings incomplete', sub: 'Completed projects (this month) missing full savings doc', format: num, targetType: 'contractsManager', targetKey: 'procIncomplete', mode: 'zero' },
    { key: 'issuesLateResolved', label: 'Issues resolved late', sub: 'Required resolution date before resolved date', format: num, targetType: 'contractsManager', targetKey: 'issuesLateResolved', mode: 'zero' },
  ]

  const opsMetrics = (d) => [
    { key: 'sosDone', label: 'Start On Site Checklists', sub: 'Completed this month', format: num, targetType: 'operationsManager', targetKey: 'sosDone', mode: 'normal' },
    { key: 'diaryDone', label: 'Daily Site Diaries', sub: 'Completed this month', format: num, targetType: 'operationsManager', targetKey: 'diaryDone', mode: 'normal' },
    { key: 'wahDone', label: 'Work Area Handovers', sub: 'Completed this month', format: num, targetType: 'operationsManager', targetKey: 'wahDone', mode: 'normal' },
    { key: 'toolbox', label: 'Toolbox Talk', sub: '1 required per month', format: (v) => v == null ? 'Not set' : (v ? 'Yes' : 'No'), targetType: 'operationsManager', targetKey: 'toolbox', mode: 'binary', isToolbox: true },
    { key: 'tasksResolvedOverdue', label: 'Tasks resolved overdue', sub: 'Live Project Tasks closed after target date', format: num, targetType: 'operationsManager', targetKey: 'tasksResolvedOverdue', mode: 'zero' },
    { key: 'risksLate', label: 'Risk log items resolved late', sub: 'Resolved after target resolution date', format: num, targetType: 'operationsManager', targetKey: 'risksLate', mode: 'zero' },
  ]

  const d = current.kind === 'cm' ? cmData() : (data?.ops || null)
  const metrics = current.kind === 'cm' ? cmMetrics(d) : opsMetrics(d)

  return (
    <OperationsShell active="scorecards" title="Scorecards">
      <PageHeading title="Operations Scorecards" sub="Contracts Managers (Will & Mike) and Operations Manager (Dori)." />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <SubTabs tabs={SUB_TABS} active={sub} onChange={setSub} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setMonth(m => shiftMonth(m, -1))} style={navBtn}>‹</button>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a19', minWidth: 150, textAlign: 'center' }}>{monthLabel(month)}</div>
          <button onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={month >= thisMonth()} style={{ ...navBtn, opacity: month >= thisMonth() ? 0.4 : 1 }}>›</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>Loading…</div>
      ) : current.kind === 'cm' && !d ? (
        <div style={{ background: '#fff', border: '1px dashed #ddd', borderRadius: 12, padding: 30, textAlign: 'center', color: '#999' }}>
          No projects found for {current.label}. Check the Contracts Manager name on their projects matches "{current.name}".
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
          {metrics.map(m => {
            const actual = d ? d[m.key] : null
            const target = targets?.[m.targetType]?.[m.targetKey]
            const color = rag(actual, target, m.mode)
            const isEditing = editingTarget === m.key
            return (
              <div key={m.key} style={{ background: '#fff', borderRadius: 10, padding: '16px 18px', border: '1px solid #e1e0d9', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 14, color: '#888', marginBottom: 6, lineHeight: 1.3 }}>
                  {m.label}
                  {m.sub && <div style={{ color: '#bbb', fontSize: 12 }}>({m.sub})</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <div style={{ fontSize: 28, fontWeight: 600, color: '#1a1a19' }}>{m.format(actual)}</div>
                </div>
                {m.key === 'gpMargin' && d?._gpTotals && (
                  <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                    Profit {gbp(d._gpTotals.totalProfit)} · {d._gpTotals.count} project{d._gpTotals.count !== 1 ? 's' : ''}
                  </div>
                )}
                <div style={{ marginTop: 10 }}>
                  {m.isToolbox ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setToolbox(true)} style={{ ...toggleBtn, ...(actual === 1 ? toggleOn : {}) }}>Yes</button>
                      <button onClick={() => setToolbox(false)} style={{ ...toggleBtn, ...(actual === 0 ? toggleOff : {}) }}>No</button>
                    </div>
                  ) : isEditing ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') saveTarget(m.targetType, m.targetKey, editValue); if (e.key === 'Escape') setEditingTarget(null) }}
                        style={{ width: 80, fontSize: 15, padding: '3px 6px', border: '1px solid #d0d0cc', borderRadius: 4, fontFamily: 'inherit' }} />
                      <button onClick={() => saveTarget(m.targetType, m.targetKey, editValue)} style={{ fontSize: 13, padding: '3px 8px', border: 'none', borderRadius: 4, background: '#1a1a19', color: '#fff', cursor: 'pointer' }}>✓</button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 14, color: '#999', cursor: 'pointer' }} onClick={() => { setEditingTarget(m.key); setEditValue(String(target ?? '')) }}>
                      Target: {target == null ? '—' : (m.format === pct ? pct(target) : (m.format === gbp ? gbp(target) : target))} <span>✎</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </OperationsShell>
  )
}

const navBtn = { width: 34, height: 34, borderRadius: 8, border: '1px solid #e1e0d9', background: '#fff', cursor: 'pointer', fontSize: 18, color: '#555' }
const toggleBtn = { flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #e1e0d9', background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#888' }
const toggleOn = { background: '#16a34a', color: '#fff', borderColor: '#16a34a' }
const toggleOff = { background: '#e63946', color: '#fff', borderColor: '#e63946' }
