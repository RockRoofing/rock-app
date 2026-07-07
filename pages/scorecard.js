import { useState, useEffect } from 'react'
import Head from 'next/head'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const fmt = (n) => n == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)
const pct = (n) => n == null ? '—' : (n * 100).toFixed(1) + '%'
const monthLabel = (s) => s ? new Date(s + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : ''
const monthKey = (s) => s ? s.substring(0, 7) : null

const LEAD_SOURCE_KEY = '86cfae1776cc556bc156feb089649becd3e723e6'
const SALES_PERSON_KEY = 'edb0162ddb7bac7835f5858cec43b6c31d20b042'

function getMonthsBetween(fromStr, toStr) {
  const months = []
  const [fy, fm] = fromStr.split('-').map(Number)
  const [ty, tm] = toStr.split('-').map(Number)
  let y = fy, m = fm
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2,'0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return months
}

function getLastFullMonth() {
  const now = new Date()
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastFull = new Date(firstOfThisMonth.getTime() - 1)
  return lastFull.toISOString().substring(0, 7)
}

function getCurrentMonth() {
  return new Date().toISOString().substring(0, 7)
}

function rag(actual, target, mode = 'normal') {
  if (actual == null || target == null) return '#aaa'
  if (mode === 'binary') return actual > 0 ? '#16a34a' : '#e63946'
  const ratio = actual / target
  if (ratio >= 1) return '#16a34a'
  if (ratio >= 0.85) return '#ca8a04'
  return '#e63946'
}

function computeTrendline(data) {
  const points = data.map((d, i) => ({ i, value: d.value })).filter(d => d.value != null && !isNaN(d.value))
  if (points.length < 2) return data.map(() => null)
  const n = points.length
  const sumX = points.reduce((s, p) => s + p.i, 0)
  const sumY = points.reduce((s, p) => s + p.value, 0)
  const sumXY = points.reduce((s, p) => s + p.i * p.value, 0)
  const sumX2 = points.reduce((s, p) => s + p.i * p.i, 0)
  const denom = (n * sumX2 - sumX * sumX)
  if (denom === 0) return data.map(() => null)
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return data.map((_, i) => slope * i + intercept)
}

// Helper: get lead source value from deal (handles both mapped field name and raw API key)
function getLeadSource(d) {
  return d.leadSource || d[LEAD_SOURCE_KEY] || ''
}

// Helper: get sales person from deal
function getSalesPerson(d) {
  return d.salesPerson || d[SALES_PERSON_KEY] || d.ownerName || ''
}

const DEFAULT_TARGETS = {
  estimator: {
    strikeRateOverall: 0.25,
    strikeRateMCSecured: 0.30,
    valuePricedExisting: 300000,
    totalValuePriced: 667000,
    totalValueSecured: 133000,
    dealsSecuredOver200k: 1,
    gpMargin: 0.25,
  },
  sales: {
    gleniganReceived: 6,
    gleniganPriced: 3,
    gleniganScored5: 3,
    strikeRateValue: 0.25,
    strikeRateMCSecNeg: 0.30,
    totalValuePriced: 2000000,
    projectsPricedOver200k: 9,
    totalValueSecured: 400000,
    projectsSecuredOver200k: 3,
  }
}

// Drill-down modal component — handles both deal objects and value change events
function DrillModal({ title, projects, isValueChange, onClose }) {
  if (!projects || projects.length === 0) return null
  const tdS = { padding: '7px 10px', borderBottom: '0.5px solid #f0efec', fontSize: 12, verticalAlign: 'middle' }
  const thS = { padding: '8px 10px', fontWeight: 500, color: '#555', textAlign: 'left', fontSize: 12, borderBottom: '1px solid #e1e0d9', whiteSpace: 'nowrap' }
  const fmtGBP = (n) => n == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 1100, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e1e0d9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
            <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>{projects.length} {isValueChange ? 'event' : 'project'}{projects.length !== 1 ? 's' : ''}</span>
          </div>
          <button onClick={onClose} style={{ fontSize: 18, border: 'none', background: 'none', cursor: 'pointer', color: '#888', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
              <tr>
                {isValueChange ? (
                  <>
                    <th style={thS}>Project</th>
                    <th style={thS}>Organisation</th>
                    <th style={thS}>Estimator</th>
                    <th style={thS}>Stage</th>
                    <th style={{ ...thS, textAlign: 'right' }}>Previous Value</th>
                    <th style={{ ...thS, textAlign: 'right' }}>New Value</th>
                    <th style={{ ...thS, textAlign: 'right' }}>Change</th>
                    <th style={thS}>Date</th>
                  </>
                ) : (
                  <>
                    <th style={thS}>Project</th>
                    <th style={thS}>Organisation</th>
                    <th style={{ ...thS, textAlign: 'right' }}>Value</th>
                    <th style={thS}>Estimator</th>
                    <th style={thS}>Sales Person</th>
                    <th style={thS}>Stage</th>
                    <th style={thS}>Lead Source</th>
                    <th style={{ ...thS, textAlign: 'center' }}>Score</th>
                    <th style={thS}>Decision Date</th>
                    <th style={thS}>Status</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {isValueChange ? projects.map((v, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafaf9' }}>
                  <td style={tdS}>{v.dealTitle || v.dealId || '—'}</td>
                  <td style={tdS}>{v.orgName || '—'}</td>
                  <td style={tdS}>{v.estimator || '—'}</td>
                  <td style={tdS}>{v.stageName || '—'}</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{fmtGBP(v.oldValue)}</td>
                  <td style={{ ...tdS, textAlign: 'right', fontWeight: 500 }}>{fmtGBP(v.newValue)}</td>
                  <td style={{ ...tdS, textAlign: 'right', color: (v.valueChange || 0) >= 0 ? '#16a34a' : '#e63946', fontWeight: 500 }}>
                    {v.valueChange != null ? (v.valueChange >= 0 ? '+' : '') + fmtGBP(v.valueChange) : '—'}
                  </td>
                  <td style={tdS}>{v.changeDate ? new Date(v.changeDate).toLocaleDateString('en-GB') : '—'}</td>
                </tr>
              )) : projects.map((d, i) => (
                <tr key={d.id || i} style={{ background: i % 2 === 0 ? '#fff' : '#fafaf9' }}>
                  <td style={tdS}>{d.title || '—'}</td>
                  <td style={tdS}>{d.orgName || d.organisation || '—'}</td>
                  <td style={{ ...tdS, textAlign: 'right', fontWeight: 500 }}>{fmtGBP(d.value)}</td>
                  <td style={tdS}>{d.estimator || '—'}</td>
                  <td style={tdS}>{getSalesPerson(d) || '—'}</td>
                  <td style={tdS}>{d.stageName || '—'}</td>
                  <td style={tdS}>{getLeadSource(d) || '—'}</td>
                  <td style={{ ...tdS, textAlign: 'center' }}>{d.label || '—'}</td>
                  <td style={tdS}>{d.closeTime ? new Date(d.closeTime).toLocaleDateString('en-GB') : '—'}</td>
                  <td style={tdS}>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 10, background: d.status === 'won' ? '#dcfce7' : d.status === 'lost' ? '#fee2e2' : '#f3f4f6', color: d.status === 'won' ? '#16a34a' : d.status === 'lost' ? '#e63946' : '#555' }}>
                      {d.status || 'open'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function Scorecard() {
  const [person, setPerson] = useState('Roman')
  const [deals, setDeals] = useState([])
  const [valueChanges, setValueChanges] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [targets, setTargets] = useState(null)
  const [editingTarget, setEditingTarget] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [modal, setModal] = useState(null) // { title, projects }

  const lastFullMonth = getLastFullMonth()
  const currentMonth = getCurrentMonth()

  const _now = new Date()
  const _yearAgo = new Date(_now.getFullYear()-1, _now.getMonth(), _now.getDate())
  const [dateFrom, setDateFrom] = useState(_yearAgo.toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState(_now.toISOString().split('T')[0])

  const ESTIMATORS = ['Roman', 'Niall', 'James']

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const p = params.get('person')
    if (p) setPerson(p)
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [dr, vc, tr] = await Promise.all([
        fetch('/api/deals'),
        fetch('/api/value-changes'),
        fetch('/api/targets')
      ])
      const dd = await dr.json()
      const vcd = await vc.json()
      setDeals(dd.deals || [])
      setLastSync(dd.lastSync)
      setValueChanges(vcd.changes || [])
      const td = await tr.json()
      setTargets(td.targets || DEFAULT_TARGETS)
    } catch(e) {
      console.error(e)
      setTargets(DEFAULT_TARGETS)
    }
    setLoading(false)
  }

  async function doSync() {
    setSyncing(true)
    try {
      await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      await loadData()
    } catch(e) { console.error(e) }
    setSyncing(false)
  }

  async function saveTarget(key, value, type) {
    const newTargets = { ...targets, [type]: { ...targets[type], [key]: parseFloat(value) } }
    setTargets(newTargets)
    await fetch('/api/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targets: newTargets }) })
    setEditingTarget(null)
  }

  const navigateTo = (p) => {
    setPerson(p)
    const url = new URL(window.location)
    url.searchParams.set('person', p)
    window.history.pushState({}, '', url)
  }

  const s = { fontFamily: 'system-ui,-apple-system,sans-serif', fontSize: 14, color: '#1a1a19' }
  const tdS = { padding: '7px 10px', borderBottom: '0.5px solid #f0efec', verticalAlign: 'middle', fontSize: 13 }
  const thS = { padding: '8px 10px', fontWeight: 500, color: '#555', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '1px solid #e1e0d9', fontSize: 13 }

  const isEstimator = ESTIMATORS.includes(person)
  const type = isEstimator ? 'estimator' : 'sales'
  const t = targets?.[type] || DEFAULT_TARGETS[type]

  const personDeals = isEstimator
    ? deals.filter(d => d.estimator === person)
    : deals.filter(d => getSalesPerson(d) === 'Edita Durikova')

  const personDealIds = new Set(personDeals.map(d => String(d.id)))
  const personValueChanges = valueChanges.filter(v => personDealIds.has(v.dealId))

  function getEstimatorMetrics(m) {
    const mStart = m + '-01'
    const mEndDate = new Date(new Date(mStart).getFullYear(), new Date(mStart).getMonth() + 1, 0)
    const mEnd = mEndDate.toISOString().split('T')[0]

    const monthClosed = personDeals.filter(d => (d.status === 'won' || d.status === 'lost') && d.value > 0 && monthKey(d.closeTime) === m)
    const monthWon = monthClosed.filter(d => d.status === 'won')

    const sixMonthsAgo = new Date(mEndDate.getFullYear(), mEndDate.getMonth() - 5, 1).toISOString().split('T')[0]
    const rolling6 = personDeals.filter(d => (d.status === 'won' || d.status === 'lost') && d.value > 0 && d.closeTime >= sixMonthsAgo && d.closeTime <= mEnd)
    const rolling6Won = rolling6.filter(d => d.status === 'won')
    const strikeRateOverall = rolling6.length ? rolling6Won.reduce((s,d)=>s+d.value,0) / rolling6.reduce((s,d)=>s+d.value,0) : null

    const mcRolling = rolling6.filter(d => ['MC Secured','Negotiating'].includes(d.stageName))
    const mcRollingWon = mcRolling.filter(d => d.status === 'won')
    const strikeRateMCSecured = mcRolling.length ? mcRollingWon.reduce((s,d)=>s+d.value,0) / mcRolling.reduce((s,d)=>s+d.value,0) : null

    const monthChanges = personValueChanges.filter(v => v.changeDate && monthKey(v.changeDate) === m)
    const existingChanges = monthChanges.filter(v => {
      const deal = deals.find(d => String(d.id) === v.dealId)
      return deal?.customerType === 'Existing Customer'
    })
    const valuePricedExisting = existingChanges.reduce((s,v) => s + (v.valueChange || 0), 0)
    const totalValuePriced = monthChanges.reduce((s,v) => s + (v.valueChange || 0), 0)
    const totalValueSecured = monthWon.reduce((s,d) => s+d.value, 0)
    const dealsOver200kMonthList = personDeals.filter(d => d.status === 'won' && d.over200k && monthKey(d.wonTime) === m)
    const dealsOver200kMonth = dealsOver200kMonthList.length
    const threeMonthsAgo = new Date(mEndDate.getFullYear(), mEndDate.getMonth() - 2, 1).toISOString().split('T')[0]
    const dealsOver200kRolling3List = personDeals.filter(d => d.status === 'won' && d.over200k && d.wonTime >= threeMonthsAgo && d.wonTime <= mEnd)
    const dealsOver200kRolling3 = dealsOver200kRolling3List.length

    return {
      strikeRateOverall, strikeRateMCSecured, valuePricedExisting, totalValuePriced,
      totalValueSecured, dealsSecuredOver200k: dealsOver200kMonth,
      dealsSecuredOver200kRolling3: dealsOver200kRolling3, gpMargin: null,
      // drill-down project sets
      _rolling6Projects: rolling6,
      _mcRollingProjects: mcRolling,
      _monthWonProjects: monthWon,
      _dealsOver200kList: dealsOver200kMonthList,
    }
  }

  function getSalesMetrics(m) {
    const mStart = m + '-01'
    const mEndDate = new Date(new Date(mStart).getFullYear(), new Date(mStart).getMonth() + 1, 0)
    const mEnd = mEndDate.toISOString().split('T')[0]
    const sixMonthsAgo = new Date(mEndDate.getFullYear(), mEndDate.getMonth() - 5, 1).toISOString().split('T')[0]

    // Glenigan deals: current leadSource = Glenigan, date = receivedDate month
    const gleniganDeals = deals.filter(d => getLeadSource(d)?.toLowerCase().includes('glenigan'))

    // #1 Glenigan received: entered Received stage in month m AND current lead source = Glenigan
    const gleniganReceivedProjects = gleniganDeals.filter(d => d.receivedDate && monthKey(d.receivedDate) === m)
    const gleniganReceived = gleniganReceivedProjects.length

    // #2 Glenigan priced: Glenigan received deals that have had a value assigned (value > 0)
    const gleniganPricedProjects = gleniganReceivedProjects.filter(d => d.value > 0)
    const gleniganPriced = gleniganPricedProjects.length

    // #3 Glenigan scored >=5: Glenigan deals received in month where label (score) >= 5
    const gleniganScored5Projects = gleniganReceivedProjects.filter(d => {
      const score = parseInt(d.label)
      return !isNaN(score) && score >= 5
    })
    const gleniganScored5 = gleniganScored5Projects.length

    // #5 Strike rate (value): rolling 6 months, all estimators, all decided deals with a value
    const rolling6All = deals.filter(d =>
      (d.status === 'won' || d.status === 'lost') && d.value > 0 &&
      d.closeTime >= sixMonthsAgo && d.closeTime <= mEnd
    )
    const rolling6AllWon = rolling6All.filter(d => d.status === 'won')
    const strikeRateValue = rolling6All.length
      ? rolling6AllWon.reduce((s,d)=>s+d.value,0) / rolling6All.reduce((s,d)=>s+d.value,0)
      : null

    // #6 Strike rate MC Secured/Negotiating: rolling 6 months, all estimators, MC Secured + Negotiating only
    const rolling6MC = rolling6All.filter(d => ['MC Secured','Negotiating'].includes(d.stageName))
    const rolling6MCWon = rolling6MC.filter(d => d.status === 'won')
    const strikeRateMCSecNeg = rolling6MC.length
      ? rolling6MCWon.reduce((s,d)=>s+d.value,0) / rolling6MC.reduce((s,d)=>s+d.value,0)
      : null

    // #7 Total value of work priced: value changes across ALL estimators in month m
    const allMonthChanges = valueChanges.filter(v => v.changeDate && monthKey(v.changeDate) === m)
    const allMonthChangesEnriched = allMonthChanges.map(v => {
      const deal = deals.find(d => String(d.id) === v.dealId)
      return { ...v, dealTitle: deal?.title || v.dealId, orgName: deal?.orgName || deal?.organisation || '—', estimator: deal?.estimator || '—', stageName: deal?.stageName || '—' }
    })
    const totalValuePriced = allMonthChanges.reduce((s,v) => s + (v.valueChange || 0), 0)

    // #8 Projects priced >=200k: all estimators, value change where newValue >= 200k
    const projectsPricedOver200kList = allMonthChangesEnriched.filter(v => (v.newValue || 0) >= 200000)
    const projectsPricedOver200k = projectsPricedOver200kList.length

    // #9 Total value secured: all estimators, won deals decided in month m
    const allMonthWon = deals.filter(d => d.status === 'won' && d.value > 0 && monthKey(d.closeTime) === m)
    const totalValueSecured = allMonthWon.reduce((s,d)=>s+d.value,0)

    // #10 Projects secured >=200k: all estimators, won deals in month m with value >= 200k
    const projectsSecuredOver200kList = allMonthWon.filter(d => d.value >= 200000)
    const projectsSecuredOver200k = projectsSecuredOver200kList.length

    return {
      gleniganReceived, gleniganPriced, gleniganScored5,
      strikeRateValue, strikeRateMCSecNeg,
      totalValuePriced, projectsPricedOver200k,
      totalValueSecured, projectsSecuredOver200k,
      // drill-down sets
      _gleniganReceivedProjects: gleniganReceivedProjects,
      _gleniganPricedProjects: gleniganPricedProjects,
      _gleniganScored5Projects: gleniganScored5Projects,
      _rolling6AllProjects: rolling6All,
      _rolling6MCProjects: rolling6MC,
      _allMonthChanges: allMonthChangesEnriched,
      _projectsPricedOver200kList: projectsPricedOver200kList,
      _allWonProjects: allMonthWon,
      _projectsSecuredOver200kList: projectsSecuredOver200kList,
    }
  }

  const getMetrics = isEstimator ? getEstimatorMetrics : getSalesMetrics

  const estimatorMetricDefs = [
    { key: 'strikeRateOverall', label: 'Strike rate (overall)', sub: 'Rolling 6 months', format: pct, targetKey: 'strikeRateOverall', drillKey: '_rolling6Projects' },
    { key: 'strikeRateMCSecured', label: 'Strike rate (MC Secured/Negotiating)', sub: 'Rolling 6 months', format: pct, targetKey: 'strikeRateMCSecured', drillKey: '_mcRollingProjects' },
    { key: 'valuePricedExisting', label: 'Value priced — existing customers', format: fmt, targetKey: 'valuePricedExisting', showAvg: true },
    { key: 'totalValuePriced', label: 'Total value of work priced', sub: 'Value change data', format: fmt, targetKey: 'totalValuePriced', showAvg: true },
    { key: 'totalValueSecured', label: 'Total value of work secured', format: fmt, targetKey: 'totalValueSecured', drillKey: '_monthWonProjects', showAvg: true },
    { key: 'dealsSecuredOver200k', label: 'Deals secured ≥£200K', sub: 'Per month, target 1/quarter', format: v => v, targetKey: 'dealsSecuredOver200k', mode: 'binary', useRolling3: true, drillKey: '_dealsOver200kList' },
    { key: 'gpMargin', label: 'GP margin — own projects', sub: 'Coming soon — Xero integration', format: () => '—', targetKey: 'gpMargin' },
  ]

  const salesMetricDefs = [
    { key: 'gleniganReceived', label: 'Glenigan enquiries received', format: v => v, targetKey: 'gleniganReceived', drillKey: '_gleniganReceivedProjects' },
    { key: 'gleniganPriced', label: 'Glenigan enquiries priced', format: v => v, targetKey: 'gleniganPriced', drillKey: '_gleniganPricedProjects' },
    { key: 'gleniganScored5', label: 'Glenigan scored ≥5', format: v => v, targetKey: 'gleniganScored5', drillKey: '_gleniganScored5Projects' },
    { key: 'strikeRateValue', label: 'Strike rate (value) — all estimators', sub: 'Rolling 6 months', format: pct, targetKey: 'strikeRateValue', drillKey: '_rolling6AllProjects' },
    { key: 'strikeRateMCSecNeg', label: 'Strike rate — MC Secured/Negotiating', sub: 'Rolling 6 months, all estimators', format: pct, targetKey: 'strikeRateMCSecNeg', drillKey: '_rolling6MCProjects' },
    { key: 'totalValuePriced', label: 'Total value of work priced', sub: 'All estimators, value change data', format: fmt, targetKey: 'totalValuePriced', drillKey: '_allMonthChanges', isValueChange: true, showAvg: true },
    { key: 'projectsPricedOver200k', label: 'Projects priced ≥£200K', sub: 'All estimators', format: v => v, targetKey: 'projectsPricedOver200k', drillKey: '_projectsPricedOver200kList', isValueChange: true },
    { key: 'totalValueSecured', label: 'Total value of work secured', sub: 'All estimators', format: fmt, targetKey: 'totalValueSecured', drillKey: '_allWonProjects', showAvg: true },
    { key: 'projectsSecuredOver200k', label: 'Projects secured ≥£200K', sub: 'All estimators', format: v => v, targetKey: 'projectsSecuredOver200k', drillKey: '_projectsSecuredOver200kList' },
  ]

  const metricDefs = isEstimator ? estimatorMetricDefs : salesMetricDefs

  const targetDisplay = (key) => {
    const val = t[key]
    if (val == null) return '—'
    if (val < 1 && val > 0) return pct(val)
    if (val >= 1000) return fmt(val)
    return val
  }

  const displayMonths = getMonthsBetween(dateFrom.substring(0,7), dateTo.substring(0,7))
  const allMonthMetrics = displayMonths.map(m => ({ month: m, ...getMetrics(m) }))
  const lastFullMonthMetrics = getMetrics(lastFullMonth)
  const currentMonthMetrics = getMetrics(currentMonth)

  const CARD_HEIGHT = 190

  function openDrill(m, metrics, monthStr) {
    if (!m.drillKey) return
    const projects = metrics[m.drillKey] || []
    if (projects.length === 0) return
    setModal({ title: `${m.label} — ${monthLabel(monthStr)}`, projects, isValueChange: !!m.isValueChange })
  }

  function renderCard(m, metrics, label, withGraph, monthStr) {
    const actual = metrics[m.key]
    const target = t[m.targetKey]
    const useRolling = m.useRolling3 ? metrics.dealsSecuredOver200kRolling3 : actual
    const color = m.mode === 'binary' ? rag(useRolling, target, 'binary') : rag(actual, target)
    const isEditing = editingTarget === `${label}-${m.key}`
    const hasDrill = !!m.drillKey && (metrics[m.drillKey]?.length > 0)

    const trendData = allMonthMetrics.map(mm => ({ month: monthLabel(mm.month), value: mm[m.key] }))
    const trendlineValues = computeTrendline(trendData)
    const chartData = trendData.map((d, i) => ({ ...d, trend: trendlineValues[i] }))
    const dotSize = 48

    return (
      <div
        key={m.key}
        onClick={() => hasDrill && openDrill(m, metrics, monthStr)}
        style={{
          background: '#fff', borderRadius: 10, padding: '14px 16px',
          border: `1px solid #e1e0d9`, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          display: 'grid', gridTemplateColumns: withGraph ? '160px 1fr' : '1fr',
          gap: 16, alignItems: 'center', height: CARD_HEIGHT, boxSizing: 'border-box',
          cursor: hasDrill ? 'pointer' : 'default',
          transition: 'box-shadow 0.15s',
        }}
        onMouseEnter={e => { if (hasDrill) e.currentTarget.style.boxShadow = '0 3px 12px rgba(0,0,0,0.1)' }}
        onMouseLeave={e => { if (hasDrill) e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)' }}
      >
        <div style={!withGraph ? { textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' } : undefined}>
          <div style={{ fontSize: 14, color: '#888', marginBottom: 6, lineHeight: 1.3 }}>
            {m.label}
            {hasDrill && <span style={{ fontSize: 10, color: '#bbb', marginLeft: 4 }}>↗</span>}
            {m.sub && <div style={{ color: '#bbb', fontSize: 13 }}>({m.sub})</div>}
          </div>
          <div style={{ fontSize: 29, fontWeight: 600, color: '#1a1a19', marginBottom: 2 }}>{actual != null ? m.format(actual) : '—'}</div>
          {withGraph && m.showAvg && (() => {
            const vals = allMonthMetrics.map(mm => mm[m.key]).filter(v => v != null && !isNaN(v))
            const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
            return avg != null ? (
              <div style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>Avg: {m.format(avg)}/mo</div>
            ) : null
          })()}
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: withGraph ? 'space-between' : 'center', gap: withGraph ? 0 : 16, minHeight: dotSize, width: '100%' }}
            onClick={e => { e.stopPropagation() }}
          >
            {isEditing ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)} style={{ width: 70, fontSize: 16, padding: '2px 6px', border: '1px solid #d0d0cc', borderRadius: 4, fontFamily: 'inherit' }} autoFocus onKeyDown={e => { if (e.key === 'Enter') saveTarget(m.key, editValue, type); if (e.key === 'Escape') setEditingTarget(null) }} />
                <button onClick={() => saveTarget(m.key, editValue, type)} style={{ fontSize: 14, padding: '2px 6px', border: 'none', borderRadius: 4, background: '#1a1a19', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
              </div>
            ) : (
              <div style={{ fontSize: 17, color: '#888', cursor: 'pointer' }} onClick={() => { setEditingTarget(`${label}-${m.key}`); setEditValue(String(t[m.targetKey] || '')) }}>
                Target: {targetDisplay(m.targetKey)} <span style={{ fontSize: 17 }}>✎</span>
              </div>
            )}
            <span style={{ color, fontSize: dotSize, lineHeight: 1 }}>●</span>
          </div>
        </div>
        {withGraph && (
          <div style={{ height: CARD_HEIGHT - 28 }}>
            {actual != null && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#bbb' }} interval="preserveStartEnd" />
                  <YAxis hide domain={['auto','auto']} />
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

  return (
    <>
      <Head><title>Rock Roofing — Scorecards</title></Head>
      <div style={{ ...s, minHeight: '100vh', background: '#fafaf9' }}>
        {modal && <DrillModal title={modal.title} projects={modal.projects} isValueChange={modal.isValueChange} onClose={() => setModal(null)} />}

        <div style={{ background: '#1a1a19', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 8, height: 52 }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <a href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>← Portal</a>
          <span style={{ color: '#444' }}>|</span>
          <a href="/sales" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Sales Dashboard</a>
          <span style={{ color: '#444' }}>|</span>
          <a href="/project-financials" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Project Financials</a>
          <span style={{ color: '#444' }}>|</span>
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Scorecards</span>
          <div style={{ flex: 1 }} />
          {lastSync && <span style={{ color: '#555', fontSize: 12 }}>Last sync: {new Date(lastSync).toLocaleDateString('en-GB')}</span>}
          <button onClick={doSync} disabled={syncing} style={{ fontSize: 12, padding: '5px 12px', border: '0.5px solid #444', borderRadius: 6, background: 'transparent', color: '#ccc', cursor: 'pointer', fontFamily: 'inherit' }}>{syncing ? 'Syncing…' : 'Sync now'}</button>
        </div>

        <div style={{ borderBottom: '0.5px solid #e1e0d9', background: '#fff', padding: '0 24px', display: 'flex' }}>
          {['Roman', 'Niall', 'James', 'Edita'].map(p => (
            <button key={p} onClick={() => navigateTo(p)} style={{ padding: '12px 20px', border: 'none', borderBottom: person === p ? '2px solid #1a1a19' : '2px solid transparent', background: 'transparent', fontSize: 13, fontWeight: person === p ? 500 : 400, color: person === p ? '#1a1a19' : '#888', cursor: 'pointer', fontFamily: 'inherit' }}>{p}</button>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: '#aaa', alignSelf: 'center' }}>{isEstimator ? 'Estimator scorecard' : 'Sales scorecard'}</span>
        </div>

        <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
          {loading ? <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading…</div> : (
            <>
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

              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24, marginBottom: 32 }}>
                <div>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{person}</span>
                    <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>— Last full month: {monthLabel(lastFullMonth)}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {metricDefs.map(m => renderCard(m, lastFullMonthMetrics, 'last', true, lastFullMonth))}
                  </div>
                </div>
                <div>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{person}</span>
                    <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>— Current month tracking: {monthLabel(currentMonth)} (in progress)</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {metricDefs.map(m => renderCard(m, currentMonthMetrics, 'current', false, currentMonth))}
                  </div>
                </div>
              </div>

              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 12 }}>Trend — {monthLabel(displayMonths[0])} to {monthLabel(displayMonths[displayMonths.length-1])}</div>
              <div style={{ overflowX: 'auto', maxHeight: 400, border: '0.5px solid #e1e0d9', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e1e0d9', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                      <th style={{ ...thS, minWidth: 220, position: 'sticky', left: 0, background: '#fff' }}>Metric</th>
                      <th style={{ ...thS, minWidth: 130, position: 'sticky', left: 220, background: '#fff', zIndex: 1 }}>Target</th>
                      {displayMonths.map(m => <th key={m} style={{ ...thS, textAlign: 'right', minWidth: 80 }}>{monthLabel(m)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {metricDefs.map(md => (
                      <tr key={md.key} style={{ borderBottom: '0.5px solid #f0efec' }}>
                        <td style={{ ...tdS, position: 'sticky', left: 0, background: '#fff' }}>{md.label}{md.sub && <span style={{ fontSize: 10, color: '#bbb' }}> ({md.sub})</span>}</td>
                        <td style={{ ...tdS, color: '#888', position: 'sticky', left: 220, background: '#fff', zIndex: 1 }}>
                          {editingTarget === `table-${md.key}` ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)} style={{ width: 70, fontSize: 12, padding: '2px 6px', border: '1px solid #d0d0cc', borderRadius: 4, fontFamily: 'inherit' }} autoFocus onKeyDown={e => { if (e.key === 'Enter') saveTarget(md.key, editValue, type); if (e.key === 'Escape') setEditingTarget(null) }} />
                              <button onClick={() => saveTarget(md.key, editValue, type)} style={{ fontSize: 11, padding: '2px 6px', border: 'none', borderRadius: 4, background: '#1a1a19', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                            </div>
                          ) : (
                            <span style={{ cursor: 'pointer' }} onClick={() => { setEditingTarget(`table-${md.key}`); setEditValue(String(t[md.targetKey] || '')) }}>
                              {targetDisplay(md.targetKey)} <span style={{ fontSize: 10 }}>✎</span>
                            </span>
                          )}
                        </td>
                        {allMonthMetrics.map(mm => {
                          const val = mm[md.key]
                          const color = md.mode === 'binary' ? rag(val, t[md.targetKey], 'binary') : rag(val, t[md.targetKey])
                          return (
                            <td
                              key={mm.month}
                              style={{ ...tdS, textAlign: 'right', color: val != null ? color : '#ddd', fontWeight: val != null ? 500 : 400, cursor: md.drillKey ? 'pointer' : 'default' }}
                              onClick={() => md.drillKey && openDrill(md, mm, mm.month)}
                            >
                              {val != null ? md.format(val) : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
