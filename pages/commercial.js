import { useState, useEffect, useRef, useMemo } from 'react'
import Head from 'next/head'
import Link from 'next/link'

const fmt = (n) => n == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)
const pct = (n) => n == null ? '—' : (n * 100).toFixed(1) + '%'
const pctColor = (n) => n == null ? '#888' : n > 0.2 ? '#16a34a' : n > 0 ? '#ca8a04' : '#e63946'

const GROUP = {
  contract:  { bg: '#eef2ff', border: '#c7d2fe' },
  labour:    { bg: '#f0fdf4', border: '#bbf7d0' },
  materials: { bg: '#fff7ed', border: '#fed7aa' },
  budget:    { bg: '#f5f3ff', border: '#ddd6fe' },
  wip:       { bg: '#fffbeb', border: '#fde68a' },
  profit:    { bg: '#fdf2f8', border: '#f5d0fe' },
  none:      { bg: '#ffffff', border: '#eeeeee' },
}

// Calculate figures for a project at its valuation date for a given month
function calcAtValDate(project, monthKey) {
  const costLines = project._costLines || []
  const invoiceLines = project._invoiceLines || []
  const valuationDay = project.valuationDay
  if (!valuationDay || !monthKey) return null
  const [year, month] = monthKey.split('-').map(Number)
  const valDate = new Date(Date.UTC(year, month - 1, parseInt(valuationDay)))
  const vDateStr = valDate.toISOString().split('T')[0]

  const costsToDate = costLines.filter(l => l.date && l.date <= vDateStr).reduce((s, l) => s + (l.amount || 0), 0)
  const labourToDate = costLines.filter(l => l.date && l.date <= vDateStr && ['321', '320'].includes(l.accountCode)).reduce((s, l) => s + (l.amount || 0), 0)
  const materialsToDate = costsToDate - labourToDate
  const invoicedToDate = invoiceLines.filter(i => i.date && i.date <= vDateStr).reduce((s, i) => s + (i.total || 0), 0)

  const retPct = parseFloat(project.retentionPct || 0)
  const retention = retPct > 0 ? invoicedToDate * retPct / (1 - retPct) : 0
  const grossInvoiced = invoicedToDate + retention
  const margin = grossInvoiced > 0 ? (grossInvoiced - costsToDate) / grossInvoiced : null
  const remainingToClaim = project.afa - invoicedToDate

  const costsAfterDate = costLines.filter(l => l.date && l.date > vDateStr).reduce((s, l) => s + (l.amount || 0), 0)
  const effectiveMargin = project.wipMarginOverride ? parseFloat(project.wipMarginOverride) / 100 : margin
  const wip = effectiveMargin != null && effectiveMargin < 1 && costsAfterDate > 0
    ? costsAfterDate / (1 - effectiveMargin) : 0

  const profit = grossInvoiced - costsToDate

  return {
    costsToDate, labourToDate, materialsToDate,
    invoicedToDate, grossInvoiced, retention,
    margin, remainingToClaim, wip, effectiveMargin,
    profit, profitPct: grossInvoiced > 0 ? profit / grossInvoiced : null,
    vDateStr
  }
}

export default function Dashboard() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [stageFilter, setStageFilter] = useState(['INPROGRESS'])
  const [cardFilter, setCardFilter] = useState(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('jobNo')
  const [eomMode, setEomMode] = useState(false)
  const [editingComment, setEditingComment] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [hiddenCols, setHiddenCols] = useState([])
  const [showColPanel, setShowColPanel] = useState(false)
  const [selectedProjects, setSelectedProjects] = useState(new Set())
  const [cmFilter, setCmFilter] = useState('')
  const [estimatorFilter, setEstimatorFilter] = useState('')
  const commentRef = useRef(null)

  const now = new Date()
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()).toISOString().split('T')[0]
  const todayStr = now.toISOString().split('T')[0]

  const [dateFrom, setDateFrom] = useState(twoYearsAgo)
  const [dateTo, setDateTo] = useState(todayStr)

  const monthOptions = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
    return { key, label }
  })
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[1].key)

  useEffect(() => { loadDashboard() }, [])

  const colPanelRef = useRef(null)
  useEffect(() => {
    if (!showColPanel) return
    function handleClick(e) {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target)) setShowColPanel(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showColPanel])

  async function loadDashboard(forceSync = false) {
    setLoading(true)
    try {
      const res = await fetch(forceSync ? '/api/dashboard?sync=true' : '/api/dashboard')
      const data = await res.json()
      setProjects(data.projects || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function syncXero() {
    setSyncing(true)
    try {
      await fetch('/api/xero/sync', { method: 'POST' })
      await loadDashboard(true)
    } catch (e) { console.error(e) }
    setSyncing(false)
  }

  async function saveComment(projectId) {
    await fetch(`/api/project/${projectId}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: commentText })
    })
    setProjects(projects.map(p => p.xeroId === projectId ? { ...p, comment: commentText } : p))
    setEditingComment(null)
  }

  async function saveWipMargin(projectId, jobNo, currentMargin, currentOverride) {
    const val = prompt(
      `WIP margin override for ${jobNo} (leave blank to use current margin ${currentMargin ? (currentMargin * 100).toFixed(1) + '%' : 'unknown'}):`,
      currentOverride || ''
    )
    if (val === null) return
    await fetch(`/api/project/${projectId}/wip-margin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wipMarginOverride: val || null })
    })
    loadDashboard(true)
  }

  function toggleCol(col) {
    setHiddenCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col])
  }

  const isColVisible = (col) => !hiddenCols.includes(col)

  // EOM calculations per project for selected month
  const eomData = useMemo(() => {
    if (!eomMode) return {}
    const result = {}
    for (const p of projects) {
      result[p.xeroId] = calcAtValDate(p, selectedMonth)
    }
    return result
  }, [eomMode, projects, selectedMonth])

  // Unique CMs and estimators for dropdowns
  const allCMs = [...new Set(projects.map(p => p.contractsManager).filter(Boolean))].sort()
  const allEstimators = [...new Set(projects.map(p => p.estimator).filter(Boolean))].sort()

  // Base filter: stage + date range (by last invoice date)
  const baseFiltered = projects
    .filter(p => stageFilter.includes('ALL') || stageFilter.includes(p.status))
    .filter(p => !search ||
      p.jobNo?.toLowerCase().includes(search.toLowerCase()) ||
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.customer?.toLowerCase().includes(search.toLowerCase()) ||
      p.contractsManager?.toLowerCase().includes(search.toLowerCase()) ||
      p.estimator?.toLowerCase().includes(search.toLowerCase()))
    .filter(p => !cmFilter || p.contractsManager === cmFilter)
    .filter(p => !estimatorFilter || p.estimator === estimatorFilter)
    .filter(p => {
      if (!p.lastInvoiceDate) return true
      if (dateFrom && p.lastInvoiceDate < dateFrom) return false
      if (dateTo && p.lastInvoiceDate > dateTo) return false
      return true
    })

  // Card filter on top
  const filtered = baseFiltered
    .filter(p => {
      if (!cardFilter) return true
      const labourLeft = (p.labourBudget || 0) - (p.labourSpend || 0)
      const matsLeft = (p.materialsBudget || 0) - (p.materialsSpend || 0)
      const totalLeft = (p.totalBudget || 0) - (p.totalCosts || 0)
      if (cardFilter === 'over_labour') return p.labourBudget > 0 && labourLeft < 0
      if (cardFilter === 'over_materials') return p.materialsBudget > 0 && matsLeft < 0
      if (cardFilter === 'over_total') return p.totalBudget > 0 && totalLeft < 0
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'jobNo') return (a.jobNo || '').localeCompare(b.jobNo || '')
      if (sortBy === 'afa') return (b.afa || 0) - (a.afa || 0)
      if (sortBy === 'remaining') return (b.remainingToClaim || 0) - (a.remainingToClaim || 0)
      if (sortBy === 'budget') return (b.remainingBudgetPct || 0) - (a.remainingBudgetPct || 0)
      if (sortBy === 'cm') return (a.contractsManager || '').localeCompare(b.contractsManager || '')
      return 0
    })

  // Card counts from baseFiltered
  const overLabour = baseFiltered.filter(p => p.labourBudget > 0 && (p.labourBudget - (p.labourSpend || 0)) < 0).length
  const overMaterials = baseFiltered.filter(p => p.materialsBudget > 0 && (p.materialsBudget - (p.materialsSpend || 0)) < 0).length
  const overTotal = baseFiltered.filter(p => p.totalBudget > 0 && (p.totalBudget - (p.totalCosts || 0)) < 0).length

  // Totals from filtered
  const totals = {
    afa: filtered.reduce((s, p) => s + (p.afa || 0), 0),
    totalInvoiced: filtered.reduce((s, p) => s + (p.totalInvoiced || 0), 0),
    remainingToClaim: filtered.reduce((s, p) => s + (p.remainingToClaim || 0), 0),
    totalCosts: filtered.reduce((s, p) => s + (p.totalCosts || 0), 0),
    totalBudget: filtered.reduce((s, p) => s + (p.totalBudget || 0), 0),
    labourSpend: filtered.reduce((s, p) => s + (p.labourSpend || 0), 0),
    materialsSpend: filtered.reduce((s, p) => s + (p.materialsSpend || 0), 0),
    labourBudget: filtered.reduce((s, p) => s + (p.labourBudget || 0), 0),
    materialsBudget: filtered.reduce((s, p) => s + (p.materialsBudget || 0), 0),
    retention: filtered.reduce((s, p) => s + (p.retentionOutstanding || 0), 0),
    grossInvoiced: filtered.reduce((s, p) => s + (p.grossInvoiced || 0), 0),
    remainingGross: filtered.reduce((s, p) => s + ((p.remainingToClaim || 0) + (p.retentionOutstanding || 0)), 0),
    // EOM totals
    eomGrossInvoiced: filtered.reduce((s, p) => s + (eomData[p.xeroId]?.grossInvoiced || 0), 0),
    eomCosts: filtered.reduce((s, p) => s + (eomData[p.xeroId]?.costsToDate || 0), 0),
    eomProfit: filtered.reduce((s, p) => s + (eomData[p.xeroId]?.profit || 0), 0),
    eomWip: filtered.reduce((s, p) => s + (eomData[p.xeroId]?.wip || 0), 0),
    eomRetention: filtered.reduce((s, p) => s + (eomData[p.xeroId]?.retention || 0), 0),
  }

  function handleCardClick(key) {
    setCardFilter(cardFilter === key ? null : key)
  }

  const cards = [
    { key: 'active', label: 'Active Projects', value: baseFiltered.length, raw: true, clickable: false,
      sub: `${baseFiltered.filter(p => p.status === 'INPROGRESS').length} in progress · ${baseFiltered.filter(p => p.status === 'DEFECTS').length} defects · ${baseFiltered.filter(p => p.status === 'CLOSED').length} closed` },
    { key: 'over_materials', label: 'Over Budget (Materials)', value: overMaterials, raw: true, clickable: true, warn: overMaterials > 0 },
    { key: 'over_labour', label: 'Over Budget (Labour)', value: overLabour, raw: true, clickable: true, warn: overLabour > 0 },
    { key: 'over_total', label: 'Over Budget (Total)', value: overTotal, raw: true, clickable: true, warn: overTotal > 0 },
    { key: 'remaining', label: 'Remaining to Claim (Ex. Retention)', value: fmt(totals.remainingToClaim), highlight: true, clickable: false },
    { key: 'retention', label: 'Retention Outstanding', value: fmt(totals.retention), warn: totals.retention > 0, clickable: false },
    { key: 'remaining_gross', label: 'Remaining to Claim (Inc. Retention)', value: fmt(totals.remainingGross), highlight: true, clickable: false },
  ]

  const cell = (group, color, bold) => ({
    padding: '7px 8px', textAlign: 'center', background: group.bg,
    color: color || 'inherit', fontWeight: bold ? 600 : 400,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  })

  const groupThStyle = (group) => ({
    padding: '6px 8px', textAlign: 'center', background: group.bg,
    borderBottom: `1px solid ${group.border}`, fontWeight: 600,
    fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase',
    color: '#666', position: 'sticky', top: 0, zIndex: 10,
  })

  const thStyle = (group, isLeft = false) => ({
    padding: '7px 8px', textAlign: isLeft ? 'left' : 'center',
    background: group.bg, borderBottom: `2px solid ${group.border}`,
    fontWeight: 600, color: '#555', whiteSpace: 'nowrap', fontSize: 11,
    position: 'sticky', top: 28, zIndex: 10,
  })

  // EOM column definitions
  const eomCols = [
    { key: 'cm', label: 'CM', group: 'none', fixed: true },
    { key: 'estimator', label: 'Estimator', group: 'none', fixed: true },
    { key: 'afa', label: 'AFA', group: 'contract' },
    { key: 'grossInvoiced', label: 'Gross Invoiced', group: 'contract' },
    { key: 'retention', label: 'Retention', group: 'contract' },
    { key: 'remaining', label: 'Remaining (Ex.)', group: 'contract' },
    { key: 'remainingInc', label: 'Remaining (Inc.)', group: 'contract' },
    { key: 'labourSpend', label: 'Lab Spend', group: 'labour' },
    { key: 'labourBudget', label: 'Lab Budget', group: 'labour' },
    { key: 'labourLeft', label: 'Lab Left £', group: 'labour' },
    { key: 'labourLeftPct', label: 'Lab Left %', group: 'labour' },
    { key: 'matsSpend', label: 'Mat Spend', group: 'materials' },
    { key: 'matsBudget', label: 'Mat Budget', group: 'materials' },
    { key: 'matsLeft', label: 'Mat Left £', group: 'materials' },
    { key: 'matsLeftPct', label: 'Mat Left %', group: 'materials' },
    { key: 'totalSpend', label: 'Total Spend', group: 'budget' },
    { key: 'totalBudget', label: 'Total Budget', group: 'budget' },
    { key: 'totalLeft', label: 'Total Left £', group: 'budget' },
    { key: 'totalLeftPct', label: 'Total Left %', group: 'budget' },
    { key: 'profit', label: 'Profit £', group: 'profit' },
    { key: 'profitPct', label: 'Profit %', group: 'profit' },
    { key: 'wip', label: 'WIP £', group: 'wip' },
    { key: 'wipMargin', label: 'WIP Margin %', group: 'wip' },
  ]

  const visibleEomCols = eomCols.filter(c => isColVisible(c.key))

  const groupColors = { contract: GROUP.contract, labour: GROUP.labour, materials: GROUP.materials, budget: GROUP.budget, profit: GROUP.profit, wip: GROUP.wip }

  return (
    <>
      <Head><title>Rock Roofing — Budget Tracker</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>

        {/* Nav */}
        <div style={{ background: '#1a1a2e', padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 16 }}>Rock Roofing Ltd</span>
              <span style={{ color: '#666', marginLeft: 8 }}>Budget Tracker</span>
              <a href="/" style={{ color: '#aaa', fontSize: 12, textDecoration: 'none', marginLeft: 16, padding: '3px 8px', borderRadius: 4, border: '1px solid #333' }}>← Portal</a>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {eomMode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#aaa', fontSize: 12 }}>Month:</span>
                  <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #444', background: '#2a2a3e', color: '#fff', fontSize: 12 }}>
                    {monthOptions.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#2a2a3e', borderRadius: 8, padding: '4px 12px' }}>
                <span style={{ color: eomMode ? '#888' : '#fff', fontSize: 12 }}>Budget Tracker</span>
                <div onClick={() => setEomMode(!eomMode)}
                  style={{ width: 36, height: 20, background: eomMode ? '#e63946' : '#444', borderRadius: 10, cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                  <div style={{ width: 16, height: 16, background: '#fff', borderRadius: 8, position: 'absolute', top: 2, left: eomMode ? 18 : 2, transition: 'left 0.2s' }} />
                </div>
                <span style={{ color: eomMode ? '#fff' : '#888', fontSize: 12 }}>EOM Report</span>
              </div>
              <Link href="/upload-transactions" style={{ color: '#aaa', fontSize: 13, padding: '6px 12px', borderRadius: 6, border: '1px solid #333' }}>Upload</Link>
              <Link href="/retention" style={{ color: '#aaa', fontSize: 13, padding: '6px 12px', borderRadius: 6, border: '1px solid #333' }}>Retention</Link>
              <Link href="/connect" style={{ color: '#aaa', fontSize: 13, padding: '6px 12px', borderRadius: 6, border: '1px solid #333' }}>Xero</Link>
              <button onClick={syncXero} disabled={syncing} style={{ background: syncing ? '#333' : '#e63946', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>
                {syncing ? 'Syncing...' : 'Sync Xero'}
              </button>
            </div>
          </div>
        </div>

        <div style={{ padding: '24px' }}>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12, marginBottom: 20 }}>
            {cards.map(card => {
              const isActive = cardFilter === card.key
              return (
                <div key={card.key} onClick={() => card.clickable && handleCardClick(card.key)}
                  style={{ background: isActive ? '#1a1a2e' : '#fff', borderRadius: 10, padding: '14px 16px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)', cursor: card.clickable ? 'pointer' : 'default',
                    border: isActive ? '2px solid #1a1a2e' : card.clickable ? '2px solid #e5e5e5' : '2px solid transparent',
                    position: 'relative' }}>
                  {card.clickable && <div style={{ position: 'absolute', top: 6, right: 8, fontSize: 9, color: isActive ? '#aaa' : '#ccc' }}>{isActive ? 'click to clear' : 'click to filter'}</div>}
                  <div style={{ fontSize: 11, color: isActive ? '#aaa' : '#888', marginBottom: 4 }}>{card.label}</div>
                  <div style={{ fontSize: card.raw ? 26 : 18, fontWeight: 700, color: isActive ? '#fff' : card.warn ? '#e63946' : card.highlight ? '#2563eb' : '#1a1a1a' }}>{card.value}</div>
                  {card.sub && <div style={{ fontSize: 10, color: isActive ? '#aaa' : '#888', marginTop: 3 }}>{card.sub}</div>}
                  {card.clickable && !isActive && card.value > 0 && <div style={{ fontSize: 10, color: '#e63946', marginTop: 2 }}>{card.value === 1 ? '1 project' : `${card.value} projects`}</div>}
                  {isActive && <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>filtering table ↓</div>}
                </div>
              )
            })}
          </div>

          {/* Date range + filters */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap', background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <span style={{ fontSize: 12, color: '#666', fontWeight: 600 }}>Last invoice date:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: '#888' }}>From</span>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: '#888' }}>To</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12 }} />
            </div>
            {(dateFrom !== twoYearsAgo || dateTo !== todayStr) && (
              <button onClick={() => { setDateFrom(twoYearsAgo); setDateTo(todayStr) }}
                style={{ padding: '5px 10px', background: '#f0f2f5', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#555' }}>
                Reset dates
              </button>
            )}
            <div style={{ width: 1, background: '#eee', height: 24, margin: '0 4px' }} />
            {/* Stage filters */}
            {[
              { key: 'INPROGRESS', label: 'In Progress', color: '#16a34a' },
              { key: 'DEFECTS', label: 'Defects Period', color: '#ca8a04' },
              { key: 'CLOSED', label: 'Closed', color: '#888' },
              { key: 'ALL', label: 'All', color: '#1a1a2e' },
            ].map(f => {
              const isActive = f.key === 'ALL' ? stageFilter.includes('ALL') : stageFilter.includes(f.key) && !stageFilter.includes('ALL')
              const count = f.key === 'ALL' ? baseFiltered.length : baseFiltered.filter(p => p.status === f.key).length
              return (
                <button key={f.key} onClick={() => {
                  setCardFilter(null)
                  if (f.key === 'ALL') { setStageFilter(['ALL']) }
                  else {
                    setStageFilter(prev => {
                      const without = prev.filter(s => s !== 'ALL')
                      if (without.includes(f.key)) {
                        const next = without.filter(s => s !== f.key)
                        return next.length === 0 ? ['ALL'] : next
                      }
                      return [...without, f.key]
                    })
                  }
                }} style={{
                  padding: '5px 10px', border: `2px solid ${isActive ? f.color : '#e5e5e5'}`,
                  borderRadius: 8, background: isActive ? f.color : '#fff',
                  color: isActive ? '#fff' : '#555', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 5
                }}>
                  {f.label}
                  <span style={{ background: isActive ? 'rgba(255,255,255,0.25)' : '#f0f2f5', borderRadius: 10, padding: '1px 5px', fontSize: 11 }}>{count}</span>
                </button>
              )
            })}
            <div style={{ width: 1, background: '#eee', height: 24, margin: '0 4px' }} />
            <input placeholder="Search job, project, customer, CM..."
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180, padding: '5px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, background: '#fff' }} />
            {eomMode && (
              <>
                <select value={cmFilter} onChange={e => setCmFilter(e.target.value)}
                  style={{ padding: '5px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, background: '#fff' }}>
                  <option value="">All CMs</option>
                  {allCMs.map(cm => <option key={cm} value={cm}>{cm}</option>)}
                </select>
                <select value={estimatorFilter} onChange={e => setEstimatorFilter(e.target.value)}
                  style={{ padding: '5px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, background: '#fff' }}>
                  <option value="">All Estimators</option>
                  {allEstimators.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </>
            )}
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              style={{ padding: '5px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, background: '#fff' }}>
              <option value="jobNo">Sort: Job No</option>
              <option value="cm">Sort: CM</option>
              <option value="afa">Sort: AFA</option>
              <option value="remaining">Sort: Remaining</option>
            </select>
            <span style={{ fontSize: 12, color: '#888' }}>{filtered.length} projects</span>
          </div>

          {cardFilter && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 16px', marginBottom: 12, fontSize: 13, color: '#e63946', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Showing {filtered.length} project{filtered.length !== 1 ? 's' : ''} — {cardFilter === 'over_labour' ? 'over budget on Labour' : cardFilter === 'over_materials' ? 'over budget on Materials' : 'over budget on Total'}</span>
              <button onClick={() => setCardFilter(null)} style={{ background: 'none', border: 'none', color: '#e63946', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Clear ✕</button>
            </div>
          )}

          {/* EOM column picker */}
          {eomMode && (
            <div style={{ position: 'relative', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => setShowColPanel(!showColPanel)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', border: '1px solid #ddd', borderRadius: 8, background: '#fff', fontSize: 12, cursor: 'pointer', color: '#333' }}>
                  <span>⊞</span>
                  Columns
                  {hiddenCols.length > 0 && (
                    <span style={{ background: '#eef2ff', color: '#4f46e5', fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 600 }}>
                      {hiddenCols.length} hidden
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: '#aaa', transform: showColPanel ? 'rotate(180deg)' : 'rotate(0)', display: 'inline-block', transition: 'transform 0.15s' }}>▼</span>
                </button>
                {hiddenCols.length > 0 && (
                  <button onClick={() => setHiddenCols([])}
                    style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    Show all
                  </button>
                )}
              </div>

              {showColPanel && (
                <div style={{ position: 'absolute', top: 36, left: 0, zIndex: 50, background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: '16px 20px', width: 520, boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Show / hide columns</span>
                    <button onClick={() => { setHiddenCols([]); setShowColPanel(false) }}
                      style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Show all</button>
                  </div>
                  {[
                    { label: 'People', cols: eomCols.filter(c => c.group === 'none' && c.key !== 'afa') },
                    { label: 'Contract', cols: eomCols.filter(c => c.group === 'contract'), color: '#eef2ff' },
                    { label: 'Labour (to val. date)', cols: eomCols.filter(c => c.group === 'labour'), color: '#f0fdf4' },
                    { label: 'Materials (to val. date)', cols: eomCols.filter(c => c.group === 'materials'), color: '#fff7ed' },
                    { label: 'Total budget (to val. date)', cols: eomCols.filter(c => c.group === 'budget'), color: '#f5f3ff' },
                    { label: 'Results', cols: eomCols.filter(c => c.group === 'profit' || c.group === 'wip'), color: '#fdf2f8' },
                  ].map(section => section.cols.length === 0 ? null : (
                    <div key={section.label} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{section.label}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {section.cols.map(col => {
                          const hidden = hiddenCols.includes(col.key)
                          return (
                            <label key={col.key}
                              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 6, border: `1px solid ${hidden ? '#ddd' : '#d0d7ff'}`, background: hidden ? '#f8f8f8' : (section.color || '#eef2ff'), fontSize: 12, color: hidden ? '#aaa' : '#333', cursor: 'pointer', userSelect: 'none' }}>
                              <input type="checkbox" checked={!hidden} onChange={() => toggleCol(col.key)} style={{ cursor: 'pointer', margin: 0 }} />
                              {col.label}
                            </label>
                          )
                        })}
                      </div>
                      {section.label !== 'Results' && <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 10 }} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* EOM aggregation bar */}
          {eomMode && (() => {
            const selArr = selectedProjects.size > 0
              ? filtered.filter(p => selectedProjects.has(p.xeroId))
              : filtered
            const selProfit = selArr.reduce((s, p) => s + (eomData[p.xeroId]?.profit || 0), 0)
            const selGrossInv = selArr.reduce((s, p) => s + (eomData[p.xeroId]?.grossInvoiced || 0), 0)
            const selProfitPct = selGrossInv > 0 ? selProfit / selGrossInv : null
            const selWip = selArr.reduce((s, p) => s + (eomData[p.xeroId]?.wip || 0), 0)
            const isSelection = selectedProjects.size > 0
            return (
              <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ background: GROUP.profit.bg, border: `1px solid ${GROUP.profit.border}`, borderRadius: 8, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span style={{ fontSize: 11, color: '#888' }}>{isSelection ? `${selectedProjects.size} selected` : `All ${filtered.length} projects`} — to val. date in {monthOptions.find(m => m.key === selectedMonth)?.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: '#888' }}>Profit £</span>
                      <span style={{ fontSize: 18, fontWeight: 700, color: selProfit >= 0 ? '#16a34a' : '#e63946' }}>{fmt(selProfit)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: '#888' }}>Profit %</span>
                      <span style={{ fontSize: 18, fontWeight: 700, color: selProfitPct != null ? (selProfitPct >= 0.25 ? '#16a34a' : selProfitPct >= 0.21 ? '#ca8a04' : '#e63946') : '#888' }}>{selProfitPct != null ? (selProfitPct * 100).toFixed(1) + '%' : '—'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: '#888' }}>WIP £</span>
                      <span style={{ fontSize: 18, fontWeight: 700, color: '#2563eb' }}>{fmt(selWip)}</span>
                    </div>
                    {isSelection && (
                      <button onClick={() => setSelectedProjects(new Set())}
                        style={{ padding: '3px 8px', background: '#f0f2f5', border: '1px solid #ddd', borderRadius: 6, fontSize: 11, cursor: 'pointer', color: '#555' }}>
                        Clear selection
                      </button>
                    )}
                  </div>
                </div>
                <button onClick={() => setSelectedProjects(selectedProjects.size === filtered.length ? new Set() : new Set(filtered.map(p => p.xeroId)))}
                  style={{ padding: '5px 12px', background: '#fff', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#555' }}>
                  {selectedProjects.size === filtered.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
            )
          })()}

          {/* Table */}
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading projects...</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>No projects found.</div>
            ) : !eomMode ? (
              /* ── BUDGET TRACKER TABLE ── */
              <div style={{ height: 'calc(100vh - 360px)', overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed', minWidth: 1400 }}>
                  <colgroup>
                    <col style={{ width: 65 }} /><col style={{ width: 160 }} /><col style={{ width: 110 }} />
                    <col style={{ width: 85 }} /><col style={{ width: 85 }} /><col style={{ width: 85 }} />
                    <col style={{ width: 85 }} /><col style={{ width: 85 }} /><col style={{ width: 85 }} /><col style={{ width: 85 }} />
                    <col style={{ width: 85 }} /><col style={{ width: 85 }} /><col style={{ width: 85 }} /><col style={{ width: 85 }} />
                    <col style={{ width: 85 }} /><col style={{ width: 85 }} /><col style={{ width: 85 }} /><col style={{ width: 85 }} />
                    <col style={{ width: 85 }} /><col style={{ width: 85 }} />
                    <col style={{ width: 130 }} /><col style={{ width: 65 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th colSpan={3} style={groupThStyle(GROUP.none)} />
                      <th colSpan={5} style={groupThStyle(GROUP.contract)}>Contract</th>
                      <th colSpan={4} style={groupThStyle(GROUP.labour)}>Labour</th>
                      <th colSpan={4} style={groupThStyle(GROUP.materials)}>Materials</th>
                      <th colSpan={4} style={groupThStyle(GROUP.budget)}>Total Budget</th>
                      <th colSpan={2} style={groupThStyle(GROUP.none)} />
                    </tr>
                    <tr>
                      {['Job No', 'Project', 'CM'].map(h => <th key={h} style={thStyle(GROUP.none, true)}>{h}</th>)}
                      {['AFA', 'Gross Invoiced', 'Retention', 'Remaining (Ex.)', 'Remaining (Inc.)'].map(h => <th key={h} style={thStyle(GROUP.contract)}>{h}</th>)}
                      {['Lab Spend', 'Lab Budget', 'Lab Left £', 'Lab Left %'].map(h => <th key={h} style={thStyle(GROUP.labour)}>{h}</th>)}
                      {['Mat Spend', 'Mat Budget', 'Mat Left £', 'Mat Left %'].map(h => <th key={h} style={thStyle(GROUP.materials)}>{h}</th>)}
                      {['Total Spend', 'Total Budget', 'Total Left £', 'Total Left %'].map(h => <th key={h} style={thStyle(GROUP.budget)}>{h}</th>)}
                      <th style={thStyle(GROUP.none, true)}>Comments</th>
                      <th style={thStyle(GROUP.none)} />
                    </tr>
                    <tr style={{ background: '#f0f2f5', borderBottom: '2px solid #ddd', fontWeight: 600, fontSize: 12 }}>
                      <td style={{ padding: '7px 8px', textAlign: 'left' }} colSpan={3}><span style={{ color: '#888', fontSize: 11 }}>TOTALS ({filtered.length})</span></td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', background: GROUP.contract.bg }}>{fmt(totals.afa)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', background: GROUP.contract.bg }}>{fmt(totals.grossInvoiced)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', color: '#ca8a04', background: GROUP.contract.bg }}>{fmt(totals.retention)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', color: '#2563eb', background: GROUP.contract.bg }}>{fmt(totals.remainingToClaim)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', color: '#2563eb', background: GROUP.contract.bg }}>{fmt(totals.remainingGross)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', background: GROUP.labour.bg }}>{fmt(totals.labourSpend)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', background: GROUP.labour.bg }}>{fmt(totals.labourBudget)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', background: GROUP.labour.bg }}>{fmt(totals.labourBudget - totals.labourSpend)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', background: GROUP.labour.bg }}>—</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', background: GROUP.materials.bg }}>{fmt(totals.materialsSpend)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', background: GROUP.materials.bg }}>{fmt(totals.materialsBudget)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', background: GROUP.materials.bg }}>{fmt(totals.materialsBudget - totals.materialsSpend)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', background: GROUP.materials.bg }}>—</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', background: GROUP.budget.bg }}>{fmt(totals.totalCosts)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', background: GROUP.budget.bg }}>{fmt(totals.totalBudget)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', color: '#2563eb', background: GROUP.budget.bg }}>{fmt(totals.totalBudget - totals.totalCosts)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', background: GROUP.budget.bg }}>—</td>

                      <td colSpan={2} />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p, i) => {
                      const ll = (p.labourBudget || 0) - (p.labourSpend || 0)
                      const llp = p.labourBudget > 0 ? ll / p.labourBudget : null
                      const ml = (p.materialsBudget || 0) - (p.materialsSpend || 0)
                      const mlp = p.materialsBudget > 0 ? ml / p.materialsBudget : null
                      const tl = (p.totalBudget || 0) - (p.totalCosts || 0)
                      const tlp = p.totalBudget > 0 ? tl / p.totalBudget : null
                      const rg = (p.remainingToClaim || 0) + (p.retentionOutstanding || 0)
                      const bg = i % 2 === 0
                      const cBg = bg ? GROUP.contract.bg : '#eef0fc'
                      const lBg = bg ? GROUP.labour.bg : '#e8faf0'
                      const mBg = bg ? GROUP.materials.bg : '#fff3e8'
                      const budBg = bg ? GROUP.budget.bg : '#ede8fc'
                      return (
                        <tr key={p.xeroId} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '7px 8px', fontWeight: 600, color: '#1a1a2e', whiteSpace: 'nowrap' }}>{p.jobNo || '—'}</td>
                          <td style={{ padding: '7px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <Link href={`/project/${p.xeroId}`} style={{ color: '#2563eb' }}>{p.name}</Link>
                            {p.status === 'DEFECTS' && <span style={{ marginLeft: 5, fontSize: 9, background: '#fffbeb', color: '#ca8a04', border: '1px solid #fde68a', borderRadius: 10, padding: '1px 5px', fontWeight: 600 }}>DEFECTS</span>}
                            {p.status === 'CLOSED' && <span style={{ marginLeft: 5, fontSize: 9, background: '#f0f0f0', color: '#888', border: '1px solid #ddd', borderRadius: 10, padding: '1px 5px', fontWeight: 600 }}>CLOSED</span>}
                          </td>
                          <td style={{ padding: '7px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: p.contractsManager ? '#333' : '#bbb' }}>{p.contractsManager || '—'}</td>
                          <td style={cell({ bg: cBg })}>{fmt(p.afa)}</td>
                          <td style={cell({ bg: cBg })}>{fmt(p.grossInvoiced)}</td>
                          <td style={cell({ bg: cBg }, p.retentionOutstanding > 0 ? '#ca8a04' : '#888')}>{fmt(p.retentionOutstanding)}</td>
                          <td style={cell({ bg: cBg }, p.remainingToClaim > 0 ? '#16a34a' : '#e63946', true)}>{fmt(p.remainingToClaim)}</td>
                          <td style={cell({ bg: cBg }, rg > 0 ? '#2563eb' : '#888', true)}>{fmt(rg)}</td>
                          <td style={cell({ bg: lBg })}>{fmt(p.labourSpend)}</td>
                          <td style={cell({ bg: lBg })}>{p.labourBudget > 0 ? fmt(p.labourBudget) : <span style={{ color: '#e63946', fontSize: 10 }}>⚠ Set</span>}</td>
                          <td style={cell({ bg: lBg }, ll >= 0 ? '#16a34a' : '#e63946', true)}>{p.labourBudget > 0 ? fmt(ll) : '—'}</td>
                          <td style={cell({ bg: lBg }, pctColor(llp))}>{p.labourBudget > 0 ? pct(llp) : '—'}</td>
                          <td style={cell({ bg: mBg })}>{fmt(p.materialsSpend)}</td>
                          <td style={cell({ bg: mBg })}>{p.materialsBudget > 0 ? fmt(p.materialsBudget) : <span style={{ color: '#e63946', fontSize: 10 }}>⚠ Set</span>}</td>
                          <td style={cell({ bg: mBg }, ml >= 0 ? '#16a34a' : '#e63946', true)}>{p.materialsBudget > 0 ? fmt(ml) : '—'}</td>
                          <td style={cell({ bg: mBg }, pctColor(mlp))}>{p.materialsBudget > 0 ? pct(mlp) : '—'}</td>
                          <td style={cell({ bg: budBg })}>{fmt(p.totalCosts)}</td>
                          <td style={cell({ bg: budBg })}>{p.totalBudget > 0 ? fmt(p.totalBudget) : <span style={{ color: '#e63946', fontSize: 10 }}>⚠ Set</span>}</td>
                          <td style={cell({ bg: budBg }, tl >= 0 ? '#16a34a' : '#e63946', true)}>{p.totalBudget > 0 ? fmt(tl) : '—'}</td>
                          <td style={cell({ bg: budBg }, pctColor(tlp))}>{p.totalBudget > 0 ? pct(tlp) : '—'}</td>

                          <td style={{ padding: '7px 8px', overflow: 'hidden' }}>
                            {editingComment === p.xeroId ? (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <input ref={commentRef} value={commentText} onChange={e => setCommentText(e.target.value)}
                                  onKeyDown={e => e.key === 'Enter' && saveComment(p.xeroId)}
                                  style={{ flex: 1, padding: '3px 6px', border: '1px solid #ddd', borderRadius: 4, fontSize: 11, minWidth: 0 }} autoFocus />
                                <button onClick={() => saveComment(p.xeroId)} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 11 }}>✓</button>
                                <button onClick={() => setEditingComment(null)} style={{ background: '#eee', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 11 }}>✕</button>
                              </div>
                            ) : (
                              <div onClick={() => { setEditingComment(p.xeroId); setCommentText(p.comment || '') }}
                                style={{ cursor: 'pointer', color: p.comment ? '#333' : '#bbb', fontSize: 11, padding: '2px 4px', borderRadius: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {p.comment || '+ Add comment'}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '7px 8px', textAlign: 'center' }}>
                            <Link href={`/project/${p.xeroId}`} style={{ background: '#f0f2f5', border: '1px solid #e5e5e5', borderRadius: 6, padding: '3px 8px', fontSize: 11, color: '#333', whiteSpace: 'nowrap' }}>View →</Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* ── EOM TABLE ── */
              <div style={{ height: 'calc(100vh - 400px)', overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'auto', minWidth: 400 + visibleEomCols.length * 85 }}>
                  <thead>
                    <tr>
                      <th colSpan={2} style={groupThStyle(GROUP.none)}>Project</th>
                      {isColVisible('cm') && <th colSpan={1} style={groupThStyle(GROUP.none)} />}
                      {isColVisible('estimator') && <th colSpan={1} style={groupThStyle(GROUP.none)} />}
                      <th colSpan={1} style={groupThStyle(GROUP.none)} />
                      {/* Group headers */}
                      {['contract', 'labour', 'materials', 'budget', 'profit', 'wip'].map(g => {
                        const cols = visibleEomCols.filter(c => c.group === g)
                        if (cols.length === 0) return null
                        const labels = { contract: 'Contract', labour: 'Labour (to val. date)', materials: 'Materials (to val. date)', budget: 'Total Budget (to val. date)', profit: 'Profit', wip: 'WIP' }
                        return <th key={g} colSpan={cols.length} style={groupThStyle(groupColors[g])}>{labels[g]}</th>
                      })}
                      <th colSpan={1} style={groupThStyle(GROUP.none)}>Comments</th>
                      <th colSpan={1} style={groupThStyle(GROUP.none)} />
                    </tr>
                    <tr>
                      <th style={{ ...thStyle(GROUP.none), width: 36, padding: '7px 4px' }} />
                      <th style={thStyle(GROUP.none, true)}>Job No / Project</th>
                      {isColVisible('cm') && <th style={thStyle(GROUP.none, true)}>CM</th>}
                      {isColVisible('estimator') && <th style={thStyle(GROUP.none, true)}>Estimator</th>}
                      <th style={thStyle(GROUP.none)}>Val. Date</th>
                      {visibleEomCols.filter(c => c.group !== 'none').map(col => (
                        <th key={col.key} style={thStyle(groupColors[col.group])}>{col.label}</th>
                      ))}
                      <th style={thStyle(GROUP.none, true)}>Comments</th>
                      <th style={thStyle(GROUP.none)} />
                    </tr>
                    {/* Totals row */}
                    <tr style={{ background: '#f0f2f5', borderBottom: '2px solid #ddd', fontWeight: 600, fontSize: 12 }}>
                      <td />
                      <td style={{ padding: '7px 8px', textAlign: 'left' }} colSpan={1 + (isColVisible('cm') ? 1 : 0) + (isColVisible('estimator') ? 1 : 0) + 1}><span style={{ color: '#888', fontSize: 11 }}>TOTALS ({filtered.length})</span></td>
                      {visibleEomCols.filter(c => c.group !== 'none').map(col => {
                        const g = groupColors[col.group]
                        let val = '—'
                        if (col.key === 'afa') val = fmt(totals.afa)
                        else if (col.key === 'grossInvoiced') val = fmt(totals.eomGrossInvoiced)
                        else if (col.key === 'retention') val = fmt(totals.eomRetention)
                        else if (col.key === 'remaining') val = fmt(filtered.reduce((s, p) => s + (eomData[p.xeroId]?.remainingToClaim || 0), 0))
                        else if (col.key === 'remainingInc') val = fmt(filtered.reduce((s, p) => { const e = eomData[p.xeroId]; return s + ((e?.remainingToClaim || 0) + (e?.retention || 0)) }, 0))
                        else if (col.key === 'labourSpend') val = fmt(filtered.reduce((s, p) => s + (eomData[p.xeroId]?.labourToDate || 0), 0))
                        else if (col.key === 'labourBudget') val = fmt(totals.labourBudget)
                        else if (col.key === 'matsSpend') val = fmt(filtered.reduce((s, p) => s + (eomData[p.xeroId]?.materialsToDate || 0), 0))
                        else if (col.key === 'matsBudget') val = fmt(totals.materialsBudget)
                        else if (col.key === 'totalSpend') val = fmt(totals.eomCosts)
                        else if (col.key === 'totalBudget') val = fmt(totals.totalBudget)
                        else if (col.key === 'profit') val = fmt(totals.eomProfit)
                        else if (col.key === 'wip') val = fmt(totals.eomWip)
                        return <td key={col.key} style={{ padding: '7px 8px', textAlign: 'center', background: g?.bg || GROUP.none.bg }}>{val}</td>
                      })}
                      <td />
                      <td />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p, i) => {
                      const e = eomData[p.xeroId]
                      const bg = i % 2 === 0
                      const ll = e ? (p.labourBudget - e.labourToDate) : null
                      const ml = e ? (p.materialsBudget - e.materialsToDate) : null
                      const tl = e ? (p.totalBudget - e.costsToDate) : null
                      const eRg = e ? ((e.remainingToClaim || 0) + (e.retention || 0)) : null
                      const isSelected = selectedProjects.has(p.xeroId)
                      return (
                        <tr key={p.xeroId} style={{ borderBottom: '1px solid #f0f0f0', background: isSelected ? '#f0f4ff' : 'inherit' }}>
                          <td style={{ padding: '7px 8px', textAlign: 'center', width: 36 }}>
                            <input type="checkbox" checked={isSelected}
                              onChange={() => setSelectedProjects(prev => {
                                const next = new Set(prev)
                                if (next.has(p.xeroId)) next.delete(p.xeroId)
                                else next.add(p.xeroId)
                                return next
                              })}
                              style={{ cursor: 'pointer' }} />
                          </td>
                          <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 600, color: '#1a1a2e', fontSize: 11 }}>{p.jobNo}</div>
                            <Link href={`/project/${p.xeroId}`} style={{ color: '#2563eb', fontSize: 11 }}>{p.name}</Link>
                            {p.status === 'DEFECTS' && <span style={{ marginLeft: 5, fontSize: 9, background: '#fffbeb', color: '#ca8a04', border: '1px solid #fde68a', borderRadius: 10, padding: '1px 5px', fontWeight: 600 }}>DEFECTS</span>}
                          </td>
                          {isColVisible('cm') && <td style={{ padding: '7px 8px', fontSize: 11, color: '#555', whiteSpace: 'nowrap' }}>{p.contractsManager || '—'}</td>}
                          {isColVisible('estimator') && <td style={{ padding: '7px 8px', fontSize: 11, color: '#555', whiteSpace: 'nowrap' }}>{p.estimator || '—'}</td>}
                          <td style={{ padding: '7px 8px', fontSize: 10, color: '#888', whiteSpace: 'nowrap' }}>{e?.vDateStr || (p.valuationDay ? `${p.valuationDay}th` : '—')}</td>
                          {visibleEomCols.filter(c => c.group !== 'none').map(col => {
                            const g = groupColors[col.group]
                            const bgC = bg ? g.bg : col.group === 'contract' ? '#eef0fc' : col.group === 'labour' ? '#e8faf0' : col.group === 'materials' ? '#fff3e8' : col.group === 'budget' ? '#ede8fc' : col.group === 'profit' ? '#faedf6' : '#fef9c3'
                            if (!e) return <td key={col.key} style={cell({ bg: bgC })}>—</td>
                            let val, color
                            if (col.key === 'afa') { val = fmt(p.afa) }
                            else if (col.key === 'grossInvoiced') { val = fmt(e.grossInvoiced) }
                            else if (col.key === 'retention') { val = fmt(e.retention); color = e.retention > 0 ? '#ca8a04' : '#888' }
                            else if (col.key === 'remaining') { val = fmt(e.remainingToClaim); color = e.remainingToClaim > 0 ? '#2563eb' : '#e63946' }
                            else if (col.key === 'remainingInc') { val = fmt(eRg); color = eRg != null && eRg > 0 ? '#2563eb' : '#888' }
                            else if (col.key === 'labourSpend') { val = fmt(e.labourToDate) }
                            else if (col.key === 'labourBudget') { val = p.labourBudget > 0 ? fmt(p.labourBudget) : '—' }
                            else if (col.key === 'labourLeft') { val = p.labourBudget > 0 ? fmt(ll) : '—'; color = ll != null ? (ll >= 0 ? '#16a34a' : '#e63946') : null }
                            else if (col.key === 'labourLeftPct') { val = p.labourBudget > 0 && ll != null ? pct(ll / p.labourBudget) : '—'; color = p.labourBudget > 0 && ll != null ? pctColor(ll / p.labourBudget) : '#888' }
                            else if (col.key === 'matsSpend') { val = fmt(e.materialsToDate) }
                            else if (col.key === 'matsBudget') { val = p.materialsBudget > 0 ? fmt(p.materialsBudget) : '—' }
                            else if (col.key === 'matsLeft') { val = p.materialsBudget > 0 ? fmt(ml) : '—'; color = ml != null ? (ml >= 0 ? '#16a34a' : '#e63946') : null }
                            else if (col.key === 'matsLeftPct') { val = p.materialsBudget > 0 && ml != null ? pct(ml / p.materialsBudget) : '—'; color = p.materialsBudget > 0 && ml != null ? pctColor(ml / p.materialsBudget) : '#888' }
                            else if (col.key === 'totalSpend') { val = fmt(e.costsToDate) }
                            else if (col.key === 'totalBudget') { val = p.totalBudget > 0 ? fmt(p.totalBudget) : '—' }
                            else if (col.key === 'totalLeft') { val = p.totalBudget > 0 ? fmt(tl) : '—'; color = tl != null ? (tl >= 0 ? '#16a34a' : '#e63946') : null }
                            else if (col.key === 'totalLeftPct') { val = p.totalBudget > 0 && tl != null ? pct(tl / p.totalBudget) : '—'; color = p.totalBudget > 0 && tl != null ? pctColor(tl / p.totalBudget) : '#888' }
                            else if (col.key === 'profit') { val = fmt(e.profit); color = e.profit >= 0 ? '#16a34a' : '#e63946' }
                            else if (col.key === 'profitPct') { val = e.profitPct != null ? pct(e.profitPct) : '—'; color = e.profitPct != null ? (e.profitPct >= 0.25 ? '#16a34a' : e.profitPct >= 0.21 ? '#ca8a04' : '#e63946') : '#888' }
                            else if (col.key === 'wip') { val = fmt(e.wip); color = e.wip > 0 ? '#2563eb' : '#888' }
                            else if (col.key === 'wipMargin') {
                              const m = e.effectiveMargin
                              val = m != null ? pct(m) : '—'
                              color = m != null ? (m >= 0.25 ? '#16a34a' : m >= 0.21 ? '#ca8a04' : '#e63946') : '#888'
                            }
                            return <td key={col.key} style={cell({ bg: bgC }, color, ['labourLeft', 'matsLeft', 'totalLeft', 'remaining', 'profit'].includes(col.key))}>{val}</td>
                          })}
                          <td style={{ padding: '7px 8px', overflow: 'hidden', minWidth: 120 }}>
                            {editingComment === p.xeroId ? (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <input ref={commentRef} value={commentText} onChange={e => setCommentText(e.target.value)}
                                  onKeyDown={e => e.key === 'Enter' && saveComment(p.xeroId)}
                                  style={{ flex: 1, padding: '3px 6px', border: '1px solid #ddd', borderRadius: 4, fontSize: 11, minWidth: 0 }} autoFocus />
                                <button onClick={() => saveComment(p.xeroId)} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 11 }}>✓</button>
                                <button onClick={() => setEditingComment(null)} style={{ background: '#eee', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 11 }}>✕</button>
                              </div>
                            ) : (
                              <div onClick={() => { setEditingComment(p.xeroId); setCommentText(p.comment || '') }}
                                style={{ cursor: 'pointer', color: p.comment ? '#333' : '#bbb', fontSize: 11, padding: '2px 4px', borderRadius: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {p.comment || '+ Add comment'}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '7px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <Link href={`/project/${p.xeroId}`} style={{ background: '#f0f2f5', border: '1px solid #e5e5e5', borderRadius: 6, padding: '3px 8px', fontSize: 11, color: '#333', whiteSpace: 'nowrap' }}>View →</Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
