import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

const fmt = (n) => n == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)
const pct = (n) => n == null ? '—' : (n * 100).toFixed(1) + '%'
const shortDate = (s) => s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
const monthKey = (s) => s ? s.substring(0, 7) : null
const monthLabel = (s) => s ? new Date(s + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : ''

const TRACKED_STAGES = ['MC Unsecured', 'MC Secured', 'Negotiating', 'Variations']
const NAV = ['Deals Researched','Tenders Received','Projects Priced','Work Secured','Strike Rate','Lost Reasons','Geo Sales Open','Geo Sales Won','Customer Details']
const STATUS_COLORS = { won: '#16a34a', lost: '#e63946', open: '#2a78d6' }

// Get last full calendar month date range
function getLastMonthRange() {
  const now = new Date()
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastOfLastMonth = new Date(firstOfThisMonth - 1)
  return {
    from: firstOfLastMonth.toISOString().split('T')[0],
    to: lastOfLastMonth.toISOString().split('T')[0]
  }
}

// Get last 12 months keys including current month
function getLast12Months() {
  const months = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(d.toISOString().substring(0, 7))
  }
  // Ensure current month is included
  const currentMonth = now.toISOString().substring(0, 7)
  if (!months.includes(currentMonth)) {
    months.push(currentMonth)
  }
  return months
}

// Linear trendline calculation
function calcTrendline(data, key) {
  const pts = data.map((d, i) => ({ x: i, y: d[key] || 0 })).filter(p => p.y > 0)
  if (pts.length < 2) return data.map(() => null)
  const n = pts.length
  const sumX = pts.reduce((s, p) => s + p.x, 0)
  const sumY = pts.reduce((s, p) => s + p.y, 0)
  const sumXY = pts.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = pts.reduce((s, p) => s + p.x * p.x, 0)
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n
  return data.map((_, i) => Math.max(0, slope * i + intercept))
}

export default function Dashboard() {
  const lastMonth = getLastMonthRange()
  const [page, setPage] = useState('Deals Researched')
  const [deals, setDeals] = useState([])
  const [valueChanges, setValueChanges] = useState([])
  const [lastSync, setLastSync] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [filters, setFilters] = useState({ customerType: 'All', estimator: 'All', salesPerson: 'All', leadSource: 'All', status: 'All', region: 'All' })
  const [globalStages, setGlobalStages] = useState([])
  const _now = new Date()
  const _twelveMonthsAgo = new Date(_now.getFullYear()-1, _now.getMonth(), _now.getDate())
  const _today = _now.toISOString().split('T')[0]
  const _yearAgo = _twelveMonthsAgo.toISOString().split('T')[0]
  const [dateFrom, setDateFrom] = useState(_yearAgo)
  const [dateTo, setDateTo] = useState(_today)
  const [showValueForm, setShowValueForm] = useState(false)
  const [vcForm, setVcForm] = useState({ dealId: '', dealTitle: '', organizationName: '', oldValue: '', newValue: '', changeDate: new Date().toISOString().split('T')[0], estimator: '', notes: '' })
  const [savingVc, setSavingVc] = useState(false)
  const [drCustName, setDrCustName] = useState('All')
  const [drSalesPerson, setDrSalesPerson] = useState('All')
  const [ppStages, setPpStages] = useState([])
  const [ppFilters, setPpFilters] = useState({ customerType: 'All', estimator: 'All', salesPerson: 'All', status: 'All', leadSource: 'All', region: 'All', custName: 'All', systemPriced: 'All' })
  const [trLabelFilter, setTrLabelFilter] = useState('All') // 'All', 'gte5', 'lt5'
  const [srStages, setSrStages] = useState([])
  const [srSystemPriced, setSrSystemPriced] = useState('All')
  const [srValueMin, setSrValueMin] = useState('')
  const [srValueMax, setSrValueMax] = useState('')
  const [lrReasons, setLrReasons] = useState([])

  // Persist page in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const p = params.get('page')
    if (p && NAV.includes(p)) setPage(p)
  }, [])

  const navigateTo = (p) => {
    setPage(p)
    const url = new URL(window.location)
    url.searchParams.set('page', p)
    window.history.pushState({}, '', url)
  }

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [dr, vc] = await Promise.all([fetch('/api/deals'), fetch('/api/value-changes')])
      const dd = await dr.json()
      const vd = await vc.json()
      setDeals(dd.deals || [])
      setLastSync(dd.lastSync)
      setValueChanges(vd.changes || [])
    } catch(e) { console.error(e) }
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

  async function saveValueChange() {
    if (!vcForm.dealTitle || !vcForm.newValue) return
    setSavingVc(true)
    await fetch('/api/value-changes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...vcForm, oldValue: parseFloat(vcForm.oldValue) || 0, newValue: parseFloat(vcForm.newValue) }) })
    await loadData()
    setShowValueForm(false)
    setVcForm({ dealId: '', dealTitle: '', organizationName: '', oldValue: '', newValue: '', changeDate: new Date().toISOString().split('T')[0], estimator: '', notes: '' })
    setSavingVc(false)
  }

  async function deleteValueChange(id) {
    if (!confirm('Delete this entry?')) return
    await fetch('/api/value-changes', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    await loadData()
  }

  const filterDealsByDate = (arr, dateField) => {
    if (!dateFrom && !dateTo) return arr
    return arr.filter(d => {
      const v = d[dateField]
      if (!v) return true
      if (dateFrom && v < dateFrom) return false
      if (dateTo && v > dateTo + 'T99') return false
      return true
    })
  }

  const matchFilter = (val, filter) => {
    if (filter === 'All') return true
    if (filter === 'Blank') return !val || val === ''
    return val === filter || (val && val.includes && val.includes(filter))
  }

  const applyFilters = (arr) => arr.filter(d => {
    if (!matchFilter(d.customerType, filters.customerType)) return false
    if (!matchFilter(d.estimator, filters.estimator)) return false
    if (!matchFilter(d.salesPerson, filters.salesPerson)) return false
    if (!matchFilter(d.leadSource, filters.leadSource)) return false
    if (!matchFilter(d.status, filters.status)) return false
    if (!matchFilter(d.region, filters.region)) return false
    if (globalStages.length > 0 && !globalStages.includes(d.stageName)) return false
    return true
  })

  // Fields where Blank option makes sense (customisable/label fields, not automatic ones)
  const BLANK_ELIGIBLE = ['estimator', 'leadSource', 'region', 'systemPriced', 'projectType', 'customerType']
  const uniq = (arr, key) => {
    const noSplit = ['customerType', 'estimator', 'salesPerson', 'organizationName', 'region', 'status', 'projectType']
    const vals = arr.map(d => d[key])
    const blankOpt = BLANK_ELIGIBLE.includes(key) ? ['Blank'] : []
    const unique = noSplit.includes(key)
      ? ['All', ...blankOpt, ...new Set(vals.filter(Boolean))].sort((a,b) => a === 'All' ? -1 : b === 'All' ? 1 : a === 'Blank' ? -1 : b === 'Blank' ? 1 : a.localeCompare(b))
      : ['All', ...blankOpt, ...new Set(vals.filter(Boolean).flatMap(v => v.includes(',') ? v.split(',').map(s => s.trim()) : [v]))].sort((a,b) => a === 'All' ? -1 : b === 'All' ? 1 : a === 'Blank' ? -1 : b === 'Blank' ? 1 : a.localeCompare(b))
    return unique
  }
  

  // Styles
  const s = { fontFamily: 'system-ui,-apple-system,sans-serif', fontSize: 14, color: '#1a1a19' }
  const tdS = { padding: '7px 10px', borderBottom: '0.5px solid #f0efec', verticalAlign: 'middle', fontSize: 13 }
  const thS = { padding: '8px 10px', fontWeight: 500, color: '#555', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '1px solid #e1e0d9', fontSize: 13 }

  const filterBar = (
    <div style={{ marginBottom: 20, padding: '12px 16px', background: '#f8f8f7', borderRadius: 8, border: '0.5px solid #e1e0d9' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {[
          { label: 'Customer type', key: 'customerType', opts: uniq(deals, 'customerType') },
          { label: 'Estimator', key: 'estimator', opts: uniq(deals, 'estimator') },
          { label: 'Status', key: 'status', opts: ['All','won','lost','open'] },
          { label: 'Lead source', key: 'leadSource', opts: uniq(deals, 'leadSource') },
          { label: 'Region', key: 'region', opts: uniq(deals, 'region') },
        ].map(f => (
          <div key={f.key}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>{f.label}</label>
            <select value={filters[f.key]} onChange={e => setFilters(p => ({...p, [f.key]: e.target.value}))} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', fontFamily: 'inherit' }}>
              {f.opts.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        ))}
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>Customer name</label>
          <select value={drCustName} onChange={e => setDrCustName(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', fontFamily: 'inherit', maxWidth: 160 }}>
            {['All', ...new Set(deals.map(d => d.organizationName).filter(Boolean))].sort().map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>Sales person</label>
          <select value={drSalesPerson} onChange={e => setDrSalesPerson(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', fontFamily: 'inherit' }}>
            {['All', ...new Set(deals.map(d => d.salesPerson).filter(Boolean))].sort().map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>Project stage</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {['Received','Stage 1','Stage 2','Review','MC Unsecured - Not Priced','MC Unsecured','MC Secured','Negotiating','Variations'].map(stg => (
              <button key={stg} onClick={() => setGlobalStages(prev => prev.includes(stg) ? prev.filter(x => x !== stg) : [...prev, stg])} style={{ fontSize: 11, padding: '3px 8px', border: '0.5px solid #d0d0cc', borderRadius: 4, background: globalStages.includes(stg) ? '#1a1a19' : '#fff', color: globalStages.includes(stg) ? '#fff' : '#555', cursor: 'pointer', fontFamily: 'inherit' }}>{stg}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>Project score</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['All','All'],['gte5','≥ 5'],['lt5','< 5']].map(([val, lbl]) => (
              <button key={val} onClick={() => setTrLabelFilter(val)} style={{ fontSize: 12, padding: '4px 8px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: trLabelFilter === val ? '#1a1a19' : '#fff', color: trLabelFilter === val ? '#fff' : '#555', cursor: 'pointer', fontFamily: 'inherit' }}>{lbl}</button>
            ))}
          </div>
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }} />
        </div>
        <button onClick={() => { setFilters({ customerType:'All', estimator:'All', salesPerson:'All', leadSource:'All', status:'All', region:'All' }); setGlobalStages([]); const _r = new Date(); const _rf = new Date(_r.getFullYear()-1, _r.getMonth(), _r.getDate()); setDateFrom(_rf.toISOString().split('T')[0]); setDateTo(_r.toISOString().split('T')[0]); setDrCustName('All'); setDrSalesPerson('All'); setTrLabelFilter('All') }} style={{ fontSize: 12, padding: '4px 10px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>
      </div>
    </div>
  )

  const statCard = (label, value, sub, color) => (
    <div style={{ background: '#f8f8f7', borderRadius: 8, padding: '14px 18px', minWidth: 140 }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color: color || '#1a1a19' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{sub}</div>}
    </div>
  )

  const dealTable = (cols, rows) => (
    <div style={{ overflowX: 'auto', marginTop: 16 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{cols.map(c => <th key={c} style={thS}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={cols.length} style={{ padding: 24, textAlign: 'center', color: '#aaa' }}>No data</td></tr>
            : rows.map((d, i) => (
              <tr key={d.id || i} style={{ background: d.status === 'won' ? '#f0fdf4' : d.status === 'lost' ? '#fef2f2' : '#fff' }}>
                <td style={tdS}>{d.title}</td>
                <td style={tdS}>{d.organizationName}</td>
                <td style={tdS}>{d.salesPerson}</td>
                <td style={tdS}>{d.estimator || '—'}</td>
                <td style={tdS}>{shortDate(d.createdDate)}</td>
                <td style={tdS}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: (STATUS_COLORS[d.status] || '#888') + '22', color: STATUS_COLORS[d.status] || '#888' }}>{d.status}</span></td>
                <td style={{ ...tdS, textAlign: 'right' }}>{fmt(d.value)}</td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  )

  // Pivot table by month
  const pivotByMonth = (arr, valueKey, groupKey, months) => {
    const groups = [...new Set(arr.map(d => d[groupKey] || 'Unknown'))].sort()
    return groups.map(g => {
      const row = { group: g }
      let total = 0
      months.forEach(m => {
        const v = arr.filter(d => (d[groupKey] || 'Unknown') === g && monthKey(d.date || d.createdDate || d.wonTime || d.closeTime) === m).reduce((s, d) => s + (valueKey === 'count' ? 1 : (d.value || 0)), 0)
        row[m] = v
        total += v
      })
      row.total = total
      return row
    })
  }

  const trendChart = (data, valueKey, color = '#2a78d6') => {
    const trendData = data.map((d, i) => ({ ...d, trend: calcTrendline(data, valueKey)[i] }))
    return (
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={trendData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0efec" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#888' }} />
          <YAxis tick={{ fontSize: 11, fill: '#888' }} tickFormatter={v => valueKey === 'count' ? v : '£' + (v/1000).toFixed(0) + 'K'} />
          <Tooltip formatter={(v, n) => [n === 'trend' ? null : valueKey === 'count' ? v : fmt(v), n === 'trend' ? 'Trend' : 'Value']} />
          <Line type="monotone" dataKey={valueKey} stroke={color} strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="trend" stroke={color} strokeWidth={1} strokeDasharray="5 5" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  const last12 = getLast12Months()

  // ---- PAGE RENDERERS ----

  const pages = {

    'Deals Researched': () => {
      // Only deals that have ever been in 1st Contact, filtered by firstContactDate
      const base = deals.filter(d => d.everIn1stContact)
      
      const filtered = applyFilters(base.filter(d => {
        if (!d.firstContactDate) return false
        if (dateFrom && d.firstContactDate < dateFrom) return false
        if (dateTo && d.firstContactDate > dateTo) return false
        if (drCustName !== 'All' && d.organizationName !== drCustName) return false
        if (drSalesPerson !== 'All' && d.salesPerson !== drSalesPerson) return false
        return true
      }))

      const existing = filtered.filter(d => d.customerType === 'Existing Customer').length
      const prospects = filtered.filter(d => d.customerType === 'Prospect' || d.customerType === 'New Customer').length

      // Build months from the date filter range directly
      function getMonthsBetween(fromStr, toStr) {
        const months = []
        // fromStr and toStr are already YYYY-MM format
        const [fy, fm] = fromStr.split('-').map(Number)
        const [ty, tm] = toStr.split('-').map(Number)
        let y = fy, m = fm
        while (y < ty || (y === ty && m <= tm)) {
          months.push(`${y}-${String(m).padStart(2,'0')}`)
          m++
          if (m > 12) { m = 1; y++ }
        }
        return months
      }
      const displayMonths = dateFrom && dateTo 
        ? getMonthsBetween(dateFrom.substring(0,7), dateTo.substring(0,7))
        : last12

      const monthData = displayMonths.map(m => ({
        month: monthLabel(m),
        count: filtered.filter(d => monthKey(d.firstContactDate) === m).length
      }))

      const pivotRows = [
        { group: 'Existing Customer', ...Object.fromEntries(displayMonths.map(m => [m, filtered.filter(d => d.customerType === 'Existing Customer' && monthKey(d.firstContactDate) === m).length])), total: filtered.filter(d => d.customerType === 'Existing Customer').length },
        { group: 'New Customer', ...Object.fromEntries(displayMonths.map(m => [m, filtered.filter(d => d.customerType === 'New Customer' && monthKey(d.firstContactDate) === m).length])), total: filtered.filter(d => d.customerType === 'New Customer').length },
        { group: 'Prospect', ...Object.fromEntries(displayMonths.map(m => [m, filtered.filter(d => d.customerType === 'Prospect' && monthKey(d.firstContactDate) === m).length])), total: filtered.filter(d => d.customerType === 'Prospect').length },
        { group: 'Total', ...Object.fromEntries(displayMonths.map(m => [m, filtered.filter(d => monthKey(d.firstContactDate) === m).length])), total: filtered.length },
      ]

      return (
        <div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Shows deals by the date they first entered 1st Contact stage. Captured via webhook from 29 Jun 2026 — historical data prior to this date is not available. Variations are excluded.</p>
          {filterBar}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            {statCard('Total deals', filtered.length)}
            {statCard('Existing customers', existing)}
            {statCard('Prospects', prospects)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Summary</div>
              <div style={{ minWidth: 600 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ borderBottom: '1px solid #e1e0d9', position: 'sticky', top: 0, background: '#fff' }}>
                    <th style={thS}>Customer type</th>
                    {displayMonths.map(m => <th key={m} style={{ ...thS, textAlign: 'right' }}>{monthLabel(m)}</th>)}
                    <th style={{ ...thS, textAlign: 'right' }}>Total</th>
                  </tr></thead>
                  <tbody>{pivotRows.map(r => (
                    <tr key={r.group} style={{ borderBottom: '0.5px solid #f0efec', fontWeight: r.group === 'Total' ? 600 : 400 }}>
                      <td style={tdS}>{r.group}</td>
                      {displayMonths.map(m => <td key={m} style={{ ...tdS, textAlign: 'right' }}>{r[m] || '—'}</td>)}
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{r.total}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Trend</div>
              {trendChart(monthData, 'count')}
            </div>
          </div>
          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Detail</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Title','Organisation','Sales person','Estimator','1st Contact date','Customer type','Status','Value'].map(c => <th key={c} style={thS}>{c}</th>)}</tr></thead>
              <tbody>{filtered.map((d,i) => (
                <tr key={d.id || i} style={{ background: d.status === 'won' ? '#f0fdf4' : d.status === 'lost' ? '#fef2f2' : '#fff' }}>
                  <td style={tdS}>{d.title}</td>
                  <td style={tdS}>{d.organizationName}</td>
                  <td style={tdS}>{d.salesPerson}</td>
                  <td style={tdS}>{d.estimator || '—'}</td>
                  <td style={tdS}>{d.firstContactDate ? <span>{d.firstContactDate}{d.firstContactApproximate ? <span title="Approximate — based on created date" style={{color:'#aaa',fontSize:10,marginLeft:4}}>~</span> : ''}</span> : '—'}</td>
                  <td style={tdS}>{d.customerType || '—'}</td>
                  <td style={tdS}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: (STATUS_COLORS[d.status] || '#888') + '22', color: STATUS_COLORS[d.status] || '#888' }}>{d.status}</span></td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{fmt(d.value)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )
    },

    'Tenders Received': () => {
      const base = deals.filter(d => d.everInReceived)
      const filtered = applyFilters(base.filter(d => {
        if (!d.receivedDate) return false
        if (dateFrom && d.receivedDate < dateFrom) return false
        if (dateTo && d.receivedDate > dateTo) return false
        const score = parseInt(d.label)
        if (trLabelFilter === 'gte5' && (isNaN(score) || score < 5)) return false
        if (trLabelFilter === 'lt5' && (!isNaN(score) && score >= 5)) return false
        return true
      }))
      const existing = filtered.filter(d => d.customerType === 'Existing Customer').length
      const prospects = filtered.filter(d => d.customerType === 'Prospect' || d.customerType === 'New Customer').length

      function getMonthsBetweenTR(fromStr, toStr) {
        const months = []
        const [fy, fm] = fromStr.split('-').map(Number)
        const [ty, tm] = toStr.split('-').map(Number)
        let y = fy, m = fm
        while (y < ty || (y === ty && m <= tm)) {
          months.push(`${y}-${String(m).padStart(2,'0')}`)
          m++
          if (m > 12) { m = 1; y++ }
        }
        return months
      }
      const displayMonths = dateFrom && dateTo
        ? getMonthsBetweenTR(dateFrom.substring(0,7), dateTo.substring(0,7))
        : last12

      const monthData = displayMonths.map(m => ({
        month: monthLabel(m),
        count: filtered.filter(d => monthKey(d.receivedDate) === m).length
      }))
      const pivotRows = [
        { group: 'Existing Customer', ...Object.fromEntries(displayMonths.map(m => [m, filtered.filter(d => d.customerType === 'Existing Customer' && monthKey(d.receivedDate) === m).length])), total: filtered.filter(d => d.customerType === 'Existing Customer').length },
        { group: 'New Customer', ...Object.fromEntries(displayMonths.map(m => [m, filtered.filter(d => d.customerType === 'New Customer' && monthKey(d.receivedDate) === m).length])), total: filtered.filter(d => d.customerType === 'New Customer').length },
        { group: 'Prospect', ...Object.fromEntries(displayMonths.map(m => [m, filtered.filter(d => d.customerType === 'Prospect' && monthKey(d.receivedDate) === m).length])), total: filtered.filter(d => d.customerType === 'Prospect').length },
        { group: 'Total', ...Object.fromEntries(displayMonths.map(m => [m, filtered.filter(d => monthKey(d.receivedDate) === m).length])), total: filtered.length },
      ]
      return (
        <div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Shows any tender that has ever sat in the Received stage, by the first date it entered Received. Captured via webhook from 29 Jun 2026 — historical data prior to this date is not available.</p>
          {filterBar}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            {statCard('Tenders received', filtered.length)}
            {statCard('Existing customers', existing)}
            {statCard('Prospects', prospects)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Summary</div>
              <div style={{ minWidth: 600 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ borderBottom: '1px solid #e1e0d9' }}>
                    <th style={thS}>Customer type</th>
                    {displayMonths.map(m => <th key={m} style={{ ...thS, textAlign: 'right' }}>{monthLabel(m)}</th>)}
                    <th style={{ ...thS, textAlign: 'right' }}>Total</th>
                  </tr></thead>
                  <tbody>{pivotRows.map(r => (
                    <tr key={r.group} style={{ borderBottom: '0.5px solid #f0efec', fontWeight: r.group === 'Total' ? 600 : 400 }}>
                      <td style={tdS}>{r.group}</td>
                      {displayMonths.map(m => <td key={m} style={{ ...tdS, textAlign: 'right' }}>{r[m] || '—'}</td>)}
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{r.total}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Trend</div>
              {trendChart(monthData, 'count')}
            </div>
          </div>
          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Detail</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Title','Organisation','Sales person','Estimator','Received date','Customer type','Score','Status','Stage','Value'].map(c => <th key={c} style={thS}>{c}</th>)}</tr></thead>
              <tbody>{filtered.length === 0
                ? <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: '#aaa' }}>No data yet — will populate as deals enter Received stage from 29 Jun 2026</td></tr>
                : filtered.map(d => (
                <tr key={d.id} style={{ background: d.status === 'won' ? '#f0fdf4' : d.status === 'lost' ? '#fef2f2' : '#fff' }}>
                  <td style={tdS}>{d.title}</td>
                  <td style={tdS}>{d.organizationName}</td>
                  <td style={tdS}>{d.salesPerson}</td>
                  <td style={tdS}>{d.estimator || '—'}</td>
                  <td style={tdS}>{d.receivedDate || '—'}</td>
                  <td style={tdS}>{d.customerType || '—'}</td>
                  <td style={{ ...tdS, textAlign: 'center' }}>
                    {d.label != null ? <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: parseInt(d.label) >= 5 ? '#16a34a22' : '#e6394622', color: parseInt(d.label) >= 5 ? '#16a34a' : '#e63946' }}>{d.label}</span> : '—'}
                  </td>
                  <td style={tdS}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: (STATUS_COLORS[d.status] || '#888') + '22', color: STATUS_COLORS[d.status] || '#888' }}>{d.status}</span></td>
                  <td style={tdS}>{d.projectStage || '—'}</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{fmt(d.value)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )
    },

    'Projects Priced': () => {
      // Apply filters to value changes via their linked deals
      const vcFiltered = valueChanges.filter(v => {
        if (!v.changeDate) return false
        if (dateFrom && v.changeDate < dateFrom) return false
        if (dateTo && v.changeDate > dateTo) return false
        // Apply deal-level filters
        const deal = deals.find(d => String(d.id) === v.dealId)
        if (ppFilters.customerType !== 'All' && deal?.customerType !== ppFilters.customerType) return false
        if (ppFilters.estimator !== 'All' && deal?.estimator !== ppFilters.estimator) return false
        if (ppFilters.salesPerson !== 'All' && deal?.salesPerson !== ppFilters.salesPerson) return false
        if (ppFilters.status !== 'All' && deal?.status !== ppFilters.status) return false
        if (ppFilters.leadSource !== 'All' && !deal?.leadSource?.includes(ppFilters.leadSource)) return false
        if (ppFilters.region !== 'All' && deal?.region !== ppFilters.region) return false
        if (ppFilters.custName !== 'All' && deal?.organizationName !== ppFilters.custName) return false
        if (ppFilters.systemPriced !== 'All' && !deal?.systemPriced?.includes(ppFilters.systemPriced)) return false
        if (ppStages.length > 0 && !ppStages.includes(deal?.projectStage)) return false
        return true
      })
      const zeroValueDeals = deals.filter(d => d.status === 'open' && TRACKED_STAGES.includes(d.projectStage) && (!d.value || d.value === 0) &&
        (ppStages.length === 0 || ppStages.includes(d.projectStage)) &&
        (ppFilters.estimator === 'All' || d.estimator === ppFilters.estimator) &&
        (ppFilters.region === 'All' || d.region === ppFilters.region)
      )
      const totalValueChange = vcFiltered.reduce((s, v) => s + (v.valueChange || 0), 0)
      const uniqueDealsWithChanges = new Set(vcFiltered.map(v => v.dealId)).size
      const newlyPriced = vcFiltered.filter(v => !v.oldValue || v.oldValue === 0).length

      const monthData = last12.map(m => ({
        month: monthLabel(m),
        value: vcFiltered.filter(v => v.changeDate?.startsWith(m)).reduce((s, v) => s + (v.valueChange || 0), 0)
      }))

      const existingMonthData = last12.map(m => ({
        month: monthLabel(m),
        Customer: vcFiltered.filter(v => v.changeDate?.startsWith(m) && deals.find(d => String(d.id) === v.dealId)?.customerType === 'Existing').reduce((s, v) => s + (v.valueChange || 0), 0),
        Prospect: vcFiltered.filter(v => v.changeDate?.startsWith(m) && deals.find(d => String(d.id) === v.dealId)?.customerType !== 'Existing').reduce((s, v) => s + (v.valueChange || 0), 0),
      }))

      return (
        <div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Shows value changes to priced deals by date of change</p>
          <div style={{ marginBottom: 16, padding: '12px 16px', background: '#f8f8f7', borderRadius: 8, border: '0.5px solid #e1e0d9' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {(() => {
                // Only show filter options from deals that have value change entries
                const vcDealIds = new Set(valueChanges.map(v => v.dealId))
                const vcDeals = deals.filter(d => vcDealIds.has(String(d.id)))
                const ppFilterOpts = [
                  { label: 'Customer type', key: 'customerType', opts: ['All', ...new Set(vcDeals.map(d => d.customerType).filter(Boolean))].sort() },
                  { label: 'Estimator', key: 'estimator', opts: ['All', ...new Set(vcDeals.map(d => d.estimator).filter(Boolean))].sort() },
                  { label: 'Sales person', key: 'salesPerson', opts: ['All', ...new Set(vcDeals.map(d => d.salesPerson).filter(Boolean))].sort() },
                  { label: 'Status', key: 'status', opts: ['All','won','lost','open'] },
                  { label: 'Lead source', key: 'leadSource', opts: ['All', ...new Set(vcDeals.map(d => d.leadSource).filter(Boolean))].sort() },
                  { label: 'Region', key: 'region', opts: ['All', ...new Set(vcDeals.map(d => d.region).filter(Boolean))].sort() },
                  { label: 'Customer name', key: 'custName', opts: ['All', ...new Set(vcDeals.map(d => d.organizationName).filter(Boolean))].sort() },
                  { label: 'System priced', key: 'systemPriced', opts: ['All', ...new Set(vcDeals.map(d => d.systemPriced).filter(Boolean).flatMap(v => v.split(',').map(s => s.trim())))].sort() },
                ]
                return ppFilterOpts
              })().map(f => (
                <div key={f.key}>
                  <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>{f.label}</label>
                  <select value={ppFilters[f.key]} onChange={e => setPpFilters(p => ({...p, [f.key]: e.target.value}))} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', fontFamily: 'inherit' }}>
                    {f.opts.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>Project stage (multi-select)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {['MC Unsecured','MC Secured','Negotiating','Variations','Review','MC Unsecured - Not Priced'].map(s => (
                    <button key={s} onClick={() => setPpStages(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])} style={{ fontSize: 11, padding: '3px 8px', border: '0.5px solid #d0d0cc', borderRadius: 4, background: ppStages.includes(s) ? '#1a1a19' : '#fff', color: ppStages.includes(s) ? '#fff' : '#555', cursor: 'pointer', fontFamily: 'inherit' }}>{s}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }} />
              </div>
              <button onClick={() => { setPpFilters({ customerType:'All', estimator:'All', salesPerson:'All', status:'All', leadSource:'All', region:'All', custName:'All', systemPriced:'All' }); setPpStages([]) }} style={{ fontSize: 12, padding: '4px 10px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>
              <button onClick={() => setShowValueForm(true)} style={{ fontSize: 13, padding: '6px 14px', border: 'none', borderRadius: 6, background: '#1a1a19', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>+ Log value change</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            {statCard('Net value change', fmt(totalValueChange))}
            {statCard('Deals with changes', uniqueDealsWithChanges, 'unique projects')}
            {statCard('Newly priced', newlyPriced, 'first value entry')}
            {zeroValueDeals.length > 0 && statCard('⚠ Missing values', zeroValueDeals.length, 'need a value', '#c2410c')}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Summary — Net value change</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr>
                    <th style={thS}>Type</th>
                    {last12.map(m => <th key={m} style={{ ...thS, textAlign: 'right' }}>{monthLabel(m)}</th>)}
                    <th style={{ ...thS, textAlign: 'right' }}>Total</th>
                  </tr></thead>
                  <tbody>{['Customer','Prospect','Total'].map(type => {
                    const isTotal = type === 'Total'
                    const typeChanges = isTotal ? vcFiltered : vcFiltered.filter(v => {
                      const deal = deals.find(d => String(d.id) === v.dealId)
                      return type === 'Customer' ? deal?.customerType === 'Existing' : deal?.customerType !== 'Existing'
                    })
                    return (
                      <tr key={type} style={{ borderBottom: '0.5px solid #f0efec', fontWeight: isTotal ? 600 : 400 }}>
                        <td style={tdS}>{type}</td>
                        {last12.map(m => {
                          const v = typeChanges.filter(c => c.changeDate?.startsWith(m)).reduce((s, c) => s + (c.valueChange || 0), 0)
                          return <td key={m} style={{ ...tdS, textAlign: 'right', color: v < 0 ? '#e63946' : v > 0 ? '#16a34a' : '#aaa' }}>{v ? fmt(v) : '—'}</td>
                        })}
                        <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: typeChanges.reduce((s,c)=>s+(c.valueChange||0),0) < 0 ? '#e63946' : '#16a34a' }}>{fmt(typeChanges.reduce((s,c)=>s+(c.valueChange||0),0))}</td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Trend — Net value change</div>
              {trendChart(monthData, 'value', '#16a34a')}
            </div>
          </div>

          {showValueForm && (
            <div style={{ background: '#fff', border: '1px solid #e1e0d9', borderRadius: 10, padding: 20, marginBottom: 20 }}>
              <div style={{ fontWeight: 500, marginBottom: 14 }}>Log value change</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
                {[{ label: 'Deal title *', key: 'dealTitle', type: 'text' }, { label: 'Organisation', key: 'organizationName', type: 'text' }, { label: 'Old value (£)', key: 'oldValue', type: 'number' }, { label: 'New value (£) *', key: 'newValue', type: 'number' }, { label: 'Date *', key: 'changeDate', type: 'date' }].map(f => (
                  <div key={f.key}>
                    <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>{f.label}</label>
                    <input type={f.type} value={vcForm[f.key]} onChange={e => setVcForm(p => ({...p, [f.key]: e.target.value}))} style={{ width: '100%', fontSize: 13, padding: '6px 8px', border: '0.5px solid #d0d0cc', borderRadius: 6, boxSizing: 'border-box', fontFamily: 'inherit' }} />
                  </div>
                ))}
                <div>
                  <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Estimator</label>
                  <select value={vcForm.estimator} onChange={e => setVcForm(p => ({...p, estimator: e.target.value}))} style={{ width: '100%', fontSize: 13, padding: '6px 8px', border: '0.5px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }}>
                    <option value=''>Select…</option>
                    {uniq(deals, 'estimator').filter(e => e !== 'All').map(e => <option key={e}>{e}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Notes</label>
                <input type="text" value={vcForm.notes} onChange={e => setVcForm(p => ({...p, notes: e.target.value}))} placeholder="Reason for change…" style={{ width: '100%', fontSize: 13, padding: '6px 8px', border: '0.5px solid #d0d0cc', borderRadius: 6, boxSizing: 'border-box', fontFamily: 'inherit' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={saveValueChange} disabled={savingVc} style={{ fontSize: 13, padding: '6px 16px', border: 'none', borderRadius: 6, background: '#1a1a19', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>{savingVc ? 'Saving…' : 'Save'}</button>
                <button onClick={() => setShowValueForm(false)} style={{ fontSize: 13, padding: '6px 16px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              </div>
            </div>
          )}

          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Detail — All value changes</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['','Title','Organisation','Estimator','Date','Stage','Old value','New value','Change','Notes',''].map((c,i) => <th key={i} style={{ ...thS, textAlign: i > 5 ? 'right' : 'left' }}>{c}</th>)}</tr></thead>
              <tbody>
                {[...vcFiltered, ...zeroValueDeals.map(d => ({ _isWarning: true, dealId: String(d.id), dealTitle: d.title, organizationName: d.organizationName, estimator: d.estimator, projectStage: d.projectStage, changeDate: null, oldValue: null, newValue: 0, valueChange: 0 }))].map((v, i) => {
                  const isWarning = v._isWarning
                  return (
                    <tr key={v.id || `w${i}`} style={{ background: isWarning ? '#fff7ed' : '#fff', borderBottom: isWarning ? '0.5px solid #fed7aa' : '0.5px solid #f0efec' }}>
                      <td style={{ ...tdS, width: 20 }}>{isWarning ? '⚠️' : ''}</td>
                      <td style={tdS}>{v.dealTitle}</td>
                      <td style={tdS}>{v.organizationName}</td>
                      <td style={tdS}>{v.estimator || '—'}</td>
                      <td style={tdS}>{v.changeDate ? shortDate(v.changeDate) : <span style={{ color: '#c2410c', fontSize: 11 }}>No date</span>}</td>
                      <td style={tdS}>{v.stage || v.projectStage || '—'}</td>
                      <td style={{ ...tdS, textAlign: 'right' }}>{isWarning ? '—' : fmt(v.oldValue)}</td>
                      <td style={{ ...tdS, textAlign: 'right', color: isWarning ? '#c2410c' : undefined }}>{isWarning ? <span style={{ color: '#c2410c', fontWeight: 500 }}>£0 — needs value</span> : fmt(v.newValue)}</td>
                      <td style={{ ...tdS, textAlign: 'right', color: isWarning ? '#c2410c' : (v.valueChange || 0) >= 0 ? '#16a34a' : '#e63946', fontWeight: 500 }}>{isWarning ? '—' : fmt(v.valueChange)}</td>
                      <td style={{ ...tdS, color: '#888', fontSize: 12 }}>{isWarning ? `Stage: ${v.projectStage}` : v.notes}</td>
                      <td style={tdS}>{!isWarning && v.id && <button onClick={() => deleteValueChange(v.id)} style={{ fontSize: 11, padding: '2px 8px', border: '0.5px solid #e1e0d9', borderRadius: 4, background: '#fff', cursor: 'pointer', color: '#888' }}>×</button>}</td>
                    </tr>
                  )
                })}
                {vcFiltered.length === 0 && zeroValueDeals.length === 0 && <tr><td colSpan={11} style={{ padding: 24, textAlign: 'center', color: '#aaa' }}>No value changes in this period</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )
    },

    'Work Secured': () => {
      const secured = applyFilters(filterDealsByDate(deals.filter(d => d.status === 'won'), 'wonTime'))
      const totalVal = secured.reduce((s,d) => s+d.value, 0)
      const avgVal = secured.length ? totalVal / secured.length : 0
      const over200 = secured.filter(d => d.over200k).length
      const monthData = last12.map(m => ({
        month: monthLabel(m),
        value: secured.filter(d => monthKey(d.wonTime) === m).reduce((s,d) => s+d.value, 0)
      }))
      const pivotRows = ['Existing Customer','New Customer','Prospect','Total'].map(type => {
        const isTotal = type === 'Total'
        const arr = isTotal ? secured : secured.filter(d => d.customerType === type)
        return { group: type, ...Object.fromEntries(last12.map(m => [m, arr.filter(d => monthKey(d.wonTime) === m).reduce((s,d)=>s+d.value,0)])), total: arr.reduce((s,d)=>s+d.value,0) }
      })
      return (
        <div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Shows won deals by decision date</p>
          {filterBar}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            {statCard('Deals won', secured.length)}
            {statCard('Avg won value', fmt(avgVal))}
            {statCard('Won ≥£200K', over200)}
            {statCard('Total value', fmt(totalVal))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Summary</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr>
                    <th style={thS}>Customer type</th>
                    {last12.map(m => <th key={m} style={{ ...thS, textAlign: 'right' }}>{monthLabel(m)}</th>)}
                    <th style={{ ...thS, textAlign: 'right' }}>Total</th>
                  </tr></thead>
                  <tbody>{pivotRows.map(r => (
                    <tr key={r.group} style={{ borderBottom: '0.5px solid #f0efec', fontWeight: r.group === 'Total' ? 600 : 400 }}>
                      <td style={tdS}>{r.group}</td>
                      {last12.map(m => <td key={m} style={{ ...tdS, textAlign: 'right' }}>{r[m] ? fmt(r[m]) : '—'}</td>)}
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{fmt(r.total)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Trend</div>
              {trendChart(monthData, 'value', '#16a34a')}
            </div>
          </div>
          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Detail</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Title','Organisation','Sales person','Estimator','Won date','Stage','≥£200K','Value'].map(c => <th key={c} style={thS}>{c}</th>)}</tr></thead>
              <tbody>{secured.map(d => (
                <tr key={d.id} style={{ background: '#f0fdf4' }}>
                  <td style={tdS}>{d.title}</td>
                  <td style={tdS}>{d.organizationName}</td>
                  <td style={tdS}>{d.salesPerson}</td>
                  <td style={tdS}>{d.estimator || '—'}</td>
                  <td style={tdS}>{shortDate(d.wonTime)}</td>
                  <td style={tdS}>{d.projectStage || '—'}</td>
                  <td style={tdS}>{d.over200k ? 'Yes' : 'No'}</td>
                  <td style={{ ...tdS, textAlign: 'right', fontWeight: 500 }}>{fmt(d.value)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )
    },

    'Strike Rate': () => {
      const RECEIVED_ONWARDS = ['Received','Stage 1','Stage 2','Review','MC Unsecured - Not Priced','MC Unsecured','MC Secured','Negotiating']
      
      // Stage 2 onwards pipeline stages
      const STAGE2_ONWARDS = ['Stage 2','Review','MC Unsecured - Not Priced','MC Unsecured','MC Secured','Negotiating','Variations']
      
      // Only include deals with a value > 0
      const baseFiltered = applyFilters(filterDealsByDate(deals.filter(d => (d.status === 'won' || d.status === 'lost') && d.value > 0), 'closeTime'))
      
      const closed = baseFiltered.filter(d => {
        // Default: only deals decided from Stage 2 onwards (using projectStage custom field)
        // projectStage values: MC Unsecured, MC Secured, Negotiating, Variations, Contractor tendering, Live Project, End User
        // Pipeline stage at decision is in stageName but won/lost deals show blank stageName
        // Use projectStage as proxy for where deal was in process
        // If nothing selected, show all decided deals (no stage restriction - let user filter)
        
        // Multi-select pipeline stage filter — uses stageName (pipeline stage at decision)
        if (srStages.length > 0) {
          if (!srStages.includes(d.stageName)) return false
        }
        // System priced filter
        if (srSystemPriced !== 'All' && !d.systemPriced?.includes(srSystemPriced)) return false
        // Value range
        if (srValueMin && d.value < parseFloat(srValueMin)) return false
        if (srValueMax && d.value > parseFloat(srValueMax)) return false
        return true
      })

      const won = closed.filter(d => d.status === 'won')
      const lost = closed.filter(d => d.status === 'lost')
      const srValue = closed.length ? won.reduce((s,d)=>s+d.value,0) / closed.reduce((s,d)=>s+d.value,0) : null
      const srCount = closed.length ? won.length / closed.length : null

      // Rolling 6-month trendline using filtered deals
      // Build month range from date filter
      function srGetMonths(from, to) {
        const months = []
        if (!from || !to) return last12
        const [fy, fm] = from.substring(0,7).split('-').map(Number)
        const [ty, tm] = to.substring(0,7).split('-').map(Number)
        let y = fy, m = fm
        while (y < ty || (y === ty && m <= tm)) {
          months.push(`${y}-${String(m).padStart(2,'0')}`)
          m++; if (m > 12) { m = 1; y++ }
        }
        return months
      }
      const srMonths = srGetMonths(dateFrom, dateTo)
      const rollingData = srMonths.map((m, idx) => {
        // Rolling 6 months up to and including this month
        const sixMonthKeys = srMonths.slice(Math.max(0, idx - 5), idx + 1)
        // Use ALL filtered closed deals for rolling calc (not just within date range)
        const allClosed = baseFiltered.filter(d => {
          if (srStages.length > 0 && !srStages.includes(d.stageName)) return false
          if (srSystemPriced !== 'All' && !d.systemPriced?.includes(srSystemPriced)) return false
          if (srValueMin && d.value < parseFloat(srValueMin)) return false
          if (srValueMax && d.value > parseFloat(srValueMax)) return false
          return true
        })
        const periodClosed = allClosed.filter(d => sixMonthKeys.includes(monthKey(d.closeTime)))
        const periodWon = periodClosed.filter(d => d.status === 'won')
        const srVal = periodClosed.length ? periodWon.reduce((s,d)=>s+d.value,0) / periodClosed.reduce((s,d)=>s+d.value,0) * 100 : 0
        return { month: monthLabel(m), count: parseFloat(srVal.toFixed(1)) }
      })

      const summaryRows = ['Existing Customer','New Customer','Prospect','Total'].map(type => {
        const isTotal = type === 'Total'
        const arr = isTotal ? closed : closed.filter(d => d.customerType === type)
        const w = arr.filter(d => d.status === 'won')
        const l = arr.filter(d => d.status === 'lost')
        return { type, wonCount: w.length, lostCount: l.length, srCount: arr.length ? w.length/arr.length : null, wonVal: w.reduce((s,d)=>s+d.value,0), lostVal: l.reduce((s,d)=>s+d.value,0), srVal: arr.reduce((s,d)=>s+d.value,0) ? w.reduce((s,d)=>s+d.value,0)/arr.reduce((s,d)=>s+d.value,0) : null }
      })

      const srStageOptions = ['Stage 2','Review','MC Unsecured - Not Priced','MC Unsecured','MC Secured','Negotiating','Variations']
      const systemPricedOpts = ['All', ...new Set(deals.map(d => d.systemPriced).filter(Boolean).flatMap(v => v.split(',').map(s => s.trim())))].sort()

      return (
        <div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Shows strike rates for decided deals by decision date. Trend shows rolling 6-month strike rate.</p>
          <div style={{ marginBottom: 16, padding: '12px 16px', background: '#f8f8f7', borderRadius: 8, border: '0.5px solid #e1e0d9' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {[
                { label: 'Customer type', key: 'customerType', opts: uniq(deals, 'customerType') },
                { label: 'Estimator', key: 'estimator', opts: uniq(deals, 'estimator') },
                { label: 'Lead source', key: 'leadSource', opts: uniq(deals, 'leadSource') },
                { label: 'Region', key: 'region', opts: uniq(deals, 'region') },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>{f.label}</label>
                  <select value={filters[f.key]} onChange={e => setFilters(p => ({...p, [f.key]: e.target.value}))} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', fontFamily: 'inherit' }}>
                    {f.opts.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>System priced</label>
                <select value={srSystemPriced} onChange={e => setSrSystemPriced(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', fontFamily: 'inherit' }}>
                  {systemPricedOpts.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>

            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>Project stage (multi-select)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {srStageOptions.map(s => (
                    <button key={s} onClick={() => setSrStages(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])} style={{ fontSize: 11, padding: '3px 8px', border: '0.5px solid #d0d0cc', borderRadius: 4, background: srStages.includes(s) ? '#1a1a19' : '#fff', color: srStages.includes(s) ? '#fff' : '#555', cursor: 'pointer', fontFamily: 'inherit' }}>{s}</button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>Min value (£)</label>
                <input type="number" value={srValueMin} onChange={e => setSrValueMin(e.target.value)} placeholder="0" style={{ width: 100, fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>Max value (£)</label>
                <input type="number" value={srValueMax} onChange={e => setSrValueMax(e.target.value)} placeholder="No limit" style={{ width: 100, fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }} />
              </div>
              <button onClick={() => { setFilters(f => ({...f, customerType:'All', estimator:'All', leadSource:'All', region:'All'})); setSrStages([]); setSrSystemPriced('All'); setSrValueMin(''); setSrValueMax('') }} style={{ fontSize: 12, padding: '4px 10px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            {statCard('Strike rate (value)', srValue != null ? pct(srValue) : '—', 'Target: 25%')}
            {statCard('Strike rate (count)', srCount != null ? pct(srCount) : '—')}
            {statCard('Won', won.length)}
            {statCard('Lost', lost.length)}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Summary</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>{['Customer type','Won','Lost','SR (count)','Won value','Lost value','SR (value)','Variation'].map(c => <th key={c} style={thS}>{c}</th>)}</tr></thead>
                <tbody>{summaryRows.map(r => (
                  <tr key={r.type} style={{ borderBottom: '0.5px solid #f0efec', fontWeight: r.type === 'Total' ? 600 : 400 }}>
                    <td style={tdS}>{r.type}</td>
                    <td style={tdS}>{r.wonCount}</td>
                    <td style={tdS}>{r.lostCount}</td>
                    <td style={{ ...tdS, color: r.srCount >= 0.25 ? '#16a34a' : r.srCount >= 0.15 ? '#ca8a04' : '#e63946', fontWeight: 500 }}>{r.srCount != null ? pct(r.srCount) : '—'}</td>
                    <td style={tdS}>{fmt(r.wonVal)}</td>
                    <td style={tdS}>{fmt(r.lostVal)}</td>
                    <td style={{ ...tdS, color: r.srVal >= 0.25 ? '#16a34a' : r.srVal >= 0.15 ? '#ca8a04' : '#e63946', fontWeight: 500 }}>{r.srVal != null ? pct(r.srVal) : '—'}</td>
                    <td style={tdS}>{r.type !== 'Total' ? (() => { const arr = r.type === 'Existing' ? closed.filter(d => d.customerType === 'Existing') : closed.filter(d => d.customerType !== 'Existing'); return arr.filter(d => d.stageName === 'Variations').length })() : closed.filter(d => d.stageName === 'Variations').length}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Trend — Rolling 6-month strike rate (value %)</div>
              {trendChart(rollingData, 'count', '#2a78d6')}
            </div>
          </div>

          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Detail</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Title','Organisation','Customer type','Estimator','Decision date','Project stage','Variation','System priced','Status','Value'].map(c => <th key={c} style={thS}>{c}</th>)}</tr></thead>
              <tbody>{closed.map(d => (
                <tr key={d.id} style={{ background: d.status === 'won' ? '#f0fdf4' : '#fef2f2' }}>
                  <td style={tdS}>{d.title}</td>
                  <td style={tdS}>{d.organizationName}</td>
                  <td style={tdS}>{d.customerType || '—'}</td>
                  <td style={tdS}>{d.estimator || '—'}</td>
                  <td style={tdS}>{shortDate(d.closeTime)}</td>
                  <td style={tdS}>{d.stageName || '—'}</td>
                  <td style={tdS}>{d.stageName === 'Variations' ? <span style={{ color: '#2a78d6', fontSize: 11, fontWeight: 500 }}>Yes</span> : 'No'}</td>
                  <td style={tdS}>{d.systemPriced || '—'}</td>
                  <td style={tdS}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: (STATUS_COLORS[d.status]) + '22', color: STATUS_COLORS[d.status] }}>{d.status}</span></td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{fmt(d.value)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )
    },

    'Lost Reasons': () => {
      // Standard Pipedrive lost reason options (from field definition) — excludes free-text "Other" entries
      const STANDARD_LOST_REASONS = ['Roofing package already let','Price','Package Contractor','Unable to make contact','Alternative spec','Project Shelved','Project Not Suitable',"Gone with preferred, approved suppy chain",'No Feedback Given','Main Contractor not suitable',"Main Contractor didn't secure",'No Time to Price','No available labour resource','Lead Time','Design Liability']
      const allLostReasonsRaw = [...new Set(deals.filter(d => d.status === 'lost').map(d => d.lostReason).filter(Boolean))]
      const hasOther = allLostReasonsRaw.some(r => !STANDARD_LOST_REASONS.includes(r))
      const allLostReasons = [...STANDARD_LOST_REASONS.filter(r => allLostReasonsRaw.includes(r)), ...(hasOther ? ['Other'] : [])]
      const lost = applyFilters(filterDealsByDate(deals.filter(d => d.status === 'lost'), 'lostTime')).filter(d => {
        if (lrReasons.length === 0) return true
        if (lrReasons.includes('Other') && d.lostReason && !STANDARD_LOST_REASONS.includes(d.lostReason)) return true
        return lrReasons.includes(d.lostReason)
      })
      const byReason = lost.reduce((acc, d) => {
        let r = d.lostReason || 'No reason given'
        if (r !== 'No reason given' && !STANDARD_LOST_REASONS.includes(r)) r = 'Other'
        const priced = d.dealPriced === 'Yes' || d.systemPriced ? 'Yes' : 'No'
        if (!acc[r]) acc[r] = { Yes: 0, No: 0, total: 0 }
        acc[r][priced]++
        acc[r].total++
        return acc
      }, {})
      const monthData = last12.map(m => ({ month: monthLabel(m), count: lost.filter(d => monthKey(d.lostTime) === m).length }))
      // Build a custom filter bar without Status (all deals here are lost anyway)
      const lrFilterBar = (
        <div style={{ marginBottom: 20, padding: '12px 16px', background: '#f8f8f7', borderRadius: 8, border: '0.5px solid #e1e0d9' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {[
              { label: 'Customer type', key: 'customerType', opts: uniq(deals, 'customerType') },
              { label: 'Estimator', key: 'estimator', opts: uniq(deals, 'estimator') },
              { label: 'Lead source', key: 'leadSource', opts: uniq(deals, 'leadSource') },
              { label: 'Region', key: 'region', opts: uniq(deals, 'region') },
            ].map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>{f.label}</label>
                <select value={filters[f.key]} onChange={e => setFilters(p => ({...p, [f.key]: e.target.value}))} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', fontFamily: 'inherit' }}>
                  {f.opts.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
            ))}
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>Customer name</label>
              <select value={drCustName} onChange={e => setDrCustName(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', fontFamily: 'inherit', maxWidth: 160 }}>
                {['All', ...new Set(deals.map(d => d.organizationName).filter(Boolean))].sort().map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>Sales person</label>
              <select value={drSalesPerson} onChange={e => setDrSalesPerson(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', fontFamily: 'inherit' }}>
                {['All', ...new Set(deals.map(d => d.salesPerson).filter(Boolean))].sort().map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>Project stage</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {['Received','Stage 1','Stage 2','Review','MC Unsecured - Not Priced','MC Unsecured','MC Secured','Negotiating','Variations'].map(s => (
                  <button key={s} onClick={() => setGlobalStages(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])} style={{ fontSize: 11, padding: '3px 8px', border: '0.5px solid #d0d0cc', borderRadius: 4, background: globalStages.includes(s) ? '#1a1a19' : '#fff', color: globalStages.includes(s) ? '#fff' : '#555', cursor: 'pointer', fontFamily: 'inherit' }}>{s}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #d0d0cc', borderRadius: 6, fontFamily: 'inherit' }} />
            </div>
            <button onClick={() => { setFilters(f => ({...f, customerType:'All', estimator:'All', leadSource:'All', region:'All'})); setGlobalStages([]); setDrCustName('All'); setDrSalesPerson('All'); setLrReasons([]) }} style={{ fontSize: 12, padding: '4px 10px', border: '0.5px solid #d0d0cc', borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>
          </div>
        </div>
      )

      return (
        <div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Shows lost reasons for projects marked as lost in the time period</p>
          {lrFilterBar}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Lost reason (multi-select)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {allLostReasons.map(r => (
                <button key={r} onClick={() => setLrReasons(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r])} style={{ fontSize: 11, padding: '3px 8px', border: '0.5px solid #d0d0cc', borderRadius: 4, background: lrReasons.includes(r) ? '#1a1a19' : '#fff', color: lrReasons.includes(r) ? '#fff' : '#555', cursor: 'pointer', fontFamily: 'inherit' }}>{r}</button>
              ))}
              {lrReasons.length > 0 && <button onClick={() => setLrReasons([])} style={{ fontSize: 11, padding: '3px 8px', border: '0.5px solid #d0d0cc', borderRadius: 4, background: '#fff', color: '#888', cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            {statCard('Total lost', lost.length)}
            {statCard('Lost value', fmt(lost.reduce((s,d)=>s+d.value,0)))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Summary</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>{['Lost reason','Priced: No','Priced: Yes','Total'].map(c => <th key={c} style={thS}>{c}</th>)}</tr></thead>
                <tbody>{Object.entries(byReason).sort((a,b)=>b[1].total-a[1].total).map(([r,v]) => (
                  <tr key={r} style={{ borderBottom: '0.5px solid #f0efec' }}>
                    <td style={tdS}>{r}</td>
                    <td style={{ ...tdS, textAlign: 'right' }}>{v.No || '—'}</td>
                    <td style={{ ...tdS, textAlign: 'right' }}>{v.Yes || '—'}</td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{v.total}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Trend</div>
              {trendChart(monthData, 'count', '#e63946')}
            </div>
          </div>
          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Detail</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Title','Organisation','Estimator','Lost date','Lost reason','System priced','Value'].map(c => <th key={c} style={thS}>{c}</th>)}</tr></thead>
              <tbody>{lost.map(d => (
                <tr key={d.id} style={{ background: '#fef2f2' }}>
                  <td style={tdS}>{d.title}</td>
                  <td style={tdS}>{d.organizationName}</td>
                  <td style={tdS}>{d.estimator || '—'}</td>
                  <td style={tdS}>{shortDate(d.lostTime)}</td>
                  <td style={tdS}>{d.lostReason || '—'}</td>
                  <td style={tdS}>{d.systemPriced || '—'}</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{fmt(d.value)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )
    },

    'Geo Sales Open': () => {
      const open = applyFilters(filterDealsByDate(deals.filter(d => d.status === 'open'), 'createdDate'))
      const byRegion = open.reduce((acc,d) => { const r=d.region||'Unknown'; if(!acc[r]) acc[r]={count:0,value:0}; acc[r].count++; acc[r].value+=d.value; return acc },{})
      return (
        <div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Shows priced, open deals by region and created date</p>
          {filterBar}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            {statCard('Open deals', open.length)}
            {statCard('Pipeline value', fmt(open.reduce((s,d)=>s+d.value,0)))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Summary by region</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>{['Region','Deals','Value'].map(c => <th key={c} style={thS}>{c}</th>)}</tr></thead>
                <tbody>{Object.entries(byRegion).sort((a,b)=>b[1].value-a[1].value).map(([r,v]) => (
                  <tr key={r} style={{ borderBottom: '0.5px solid #f0efec' }}>
                    <td style={tdS}>{r}</td>
                    <td style={{ ...tdS, textAlign: 'right' }}>{v.count}</td>
                    <td style={{ ...tdS, textAlign: 'right' }}>{fmt(v.value)}</td>
                  </tr>
                ))}<tr style={{ borderTop: '1px solid #e1e0d9', fontWeight: 600 }}>
                  <td style={tdS}>Total</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{open.length}</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{fmt(open.reduce((s,d)=>s+d.value,0))}</td>
                </tr></tbody>
              </table>
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Detail</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['Title','Organisation','Sales person','Created','Region','Stage','Value'].map(c => <th key={c} style={thS}>{c}</th>)}</tr></thead>
                  <tbody>{open.map(d => (
                    <tr key={d.id}>
                      <td style={tdS}>{d.title}</td>
                      <td style={tdS}>{d.organizationName}</td>
                      <td style={tdS}>{d.salesPerson}</td>
                      <td style={tdS}>{shortDate(d.createdDate)}</td>
                      <td style={tdS}>{d.region || '—'}</td>
                      <td style={tdS}>{d.projectStage || '—'}</td>
                      <td style={{ ...tdS, textAlign: 'right' }}>{fmt(d.value)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )
    },

    'Geo Sales Won': () => {
      const won = applyFilters(filterDealsByDate(deals.filter(d => d.status === 'won'), 'wonTime'))
      const byRegion = won.reduce((acc,d) => { const r=d.region||'Unknown'; if(!acc[r]) acc[r]={count:0,value:0}; acc[r].count++; acc[r].value+=d.value; return acc },{})
      return (
        <div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Shows won deals by region and decision date</p>
          {filterBar}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            {statCard('Won deals', won.length)}
            {statCard('Won value', fmt(won.reduce((s,d)=>s+d.value,0)))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Summary by region</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>{['Region','Deals','Value'].map(c => <th key={c} style={thS}>{c}</th>)}</tr></thead>
                <tbody>{Object.entries(byRegion).sort((a,b)=>b[1].value-a[1].value).map(([r,v]) => (
                  <tr key={r} style={{ borderBottom: '0.5px solid #f0efec' }}>
                    <td style={tdS}>{r}</td>
                    <td style={{ ...tdS, textAlign: 'right' }}>{v.count}</td>
                    <td style={{ ...tdS, textAlign: 'right' }}>{fmt(v.value)}</td>
                  </tr>
                ))}<tr style={{ borderTop: '1px solid #e1e0d9', fontWeight: 600 }}>
                  <td style={tdS}>Total</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{won.length}</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{fmt(won.reduce((s,d)=>s+d.value,0))}</td>
                </tr></tbody>
              </table>
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Detail</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['Title','Organisation','Sales person','Won date','Region','Value'].map(c => <th key={c} style={thS}>{c}</th>)}</tr></thead>
                  <tbody>{won.map(d => (
                    <tr key={d.id} style={{ background: '#f0fdf4' }}>
                      <td style={tdS}>{d.title}</td>
                      <td style={tdS}>{d.organizationName}</td>
                      <td style={tdS}>{d.salesPerson}</td>
                      <td style={tdS}>{shortDate(d.wonTime)}</td>
                      <td style={tdS}>{d.region || '—'}</td>
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 500 }}>{fmt(d.value)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )
    },

    'Customer Details': () => {
      const filtered = applyFilters(filterDealsByDate(deals.filter(d => d.status === 'won'), 'wonTime'))
      const variations = filtered.filter(d => d.projectStage === 'Variations')
      const originals = filtered.filter(d => d.projectStage !== 'Variations')
      const byOrg = filtered.reduce((acc,d) => {
        const o = d.organizationName || 'Unknown'
        if (!acc[o]) acc[o] = { origCount: 0, origVal: 0, varCount: 0, varVal: 0 }
        if (d.projectStage === 'Variations') { acc[o].varCount++; acc[o].varVal += d.value }
        else { acc[o].origCount++; acc[o].origVal += d.value }
        return acc
      }, {})
      return (
        <div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Shows top customers by value and count of won deals by won date</p>
          {filterBar}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            {statCard('Organisations', Object.keys(byOrg).length)}
            {statCard('Original deals won', originals.length)}
            {statCard('Variations won', variations.length)}
            {statCard('Total won value', fmt(filtered.reduce((s,d)=>s+d.value,0)))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thS} rowSpan={2}>Organisation</th>
                  <th style={{ ...thS, textAlign: 'center', borderLeft: '1px solid #e1e0d9' }} colSpan={2}>Original deals</th>
                  <th style={{ ...thS, textAlign: 'center', borderLeft: '1px solid #e1e0d9' }} colSpan={2}>Variations</th>
                  <th style={{ ...thS, textAlign: 'center', borderLeft: '1px solid #e1e0d9' }} colSpan={2}>Total</th>
                </tr>
                <tr>
                  {['Value','Count','Value','Count','Value','Count'].map((c,i) => <th key={i} style={{ ...thS, textAlign: 'right', borderLeft: i % 2 === 0 ? '1px solid #e1e0d9' : 'none' }}>{c}</th>)}
                </tr>
              </thead>
              <tbody>{Object.entries(byOrg).sort((a,b) => (b[1].origVal+b[1].varVal)-(a[1].origVal+a[1].varVal)).map(([org,v]) => (
                <tr key={org} style={{ borderBottom: '0.5px solid #f0efec' }}>
                  <td style={tdS}>{org}</td>
                  <td style={{ ...tdS, textAlign: 'right', borderLeft: '1px solid #f0efec' }}>{fmt(v.origVal)}</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{v.origCount}</td>
                  <td style={{ ...tdS, textAlign: 'right', borderLeft: '1px solid #f0efec' }}>{fmt(v.varVal)}</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{v.varCount}</td>
                  <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, borderLeft: '1px solid #f0efec' }}>{fmt(v.origVal+v.varVal)}</td>
                  <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{v.origCount+v.varCount}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )
    },
  }

  return (
    <>
      <Head><title>Rock Roofing — Sales Dashboard</title></Head>
      <div style={{ ...s, minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 8, height: 52 }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <a href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>← Portal</a>
          <span style={{ color: '#444' }}>|</span>
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Sales Dashboard</span>
          <span style={{ color: '#444' }}>|</span>
          <a href="/scorecard" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Scorecards</a>
          <span style={{ color: '#444' }}>|</span>
          <a href="/project-financials" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Project Financials</a>
          <div style={{ flex: 1 }} />
          {lastSync && <span style={{ color: '#555', fontSize: 12 }}>Last sync: {shortDate(lastSync)}</span>}
          <button onClick={doSync} disabled={syncing} style={{ fontSize: 12, padding: '5px 12px', border: '0.5px solid #444', borderRadius: 6, background: 'transparent', color: '#ccc', cursor: 'pointer', fontFamily: 'inherit' }}>{syncing ? 'Syncing…' : 'Sync now'}</button>
        </div>
        <div style={{ borderBottom: '0.5px solid #e1e0d9', background: '#fff', padding: '0 24px', overflowX: 'auto', display: 'flex' }}>
          {NAV.map(n => (
            <button key={n} onClick={() => navigateTo(n)} style={{ padding: '12px 16px', border: 'none', borderBottom: page === n ? '2px solid #1a1a19' : '2px solid transparent', background: 'transparent', fontSize: 13, fontWeight: page === n ? 500 : 400, color: page === n ? '#1a1a19' : '#888', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>{n}</button>
          ))}
        </div>
        <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>
              {deals.length === 0 ? (
                <div>
                  <p style={{ marginBottom: 12 }}>No data yet. Run your first sync to pull from Pipedrive.</p>
                  <button onClick={doSync} disabled={syncing} style={{ fontSize: 13, padding: '8px 20px', border: 'none', borderRadius: 6, background: '#1a1a19', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>{syncing ? 'Syncing…' : 'Run first sync'}</button>
                </div>
              ) : 'Loading…'}
            </div>
          ) : (
            pages[page]?.() || <div style={{ color: '#888' }}>Page not found</div>
          )}
        </div>
      </div>
    </>
  )
}
