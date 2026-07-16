import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'

const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n || 0)
const INK = '#1a1a2e'
const th = { textAlign: 'left', padding: '10px 12px', fontSize: 11, color: '#777', fontWeight: 600, borderBottom: '2px solid #eee', whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #f2f0ec' }
const sel = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff' }

function monthLabel(m) {
  if (!m) return ''
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export default function BookkeepingPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('bills')        // bills | invoices | wages | ignored
  const [month, setMonth] = useState('')
  const [supplier, setSupplier] = useState('')
  const [codes, setCodes] = useState([])          // multi-select account codes
  const [catFilter, setCatFilter] = useState('') // '' | labour | materials  (Costs tab)
  const [assigned, setAssigned] = useState('')   // '' | yes | no
  const [page, setPage] = useState(1)
  const PER_PAGE = 50

  useEffect(() => {
    fetch('/api/bookkeeping').then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    return tab === 'bills' ? (data.bills || []) : tab === 'wages' ? (data.wages || []) : tab === 'invoices' ? (data.invoices || []) : (data.ignored || [])
  }, [data, tab])

  const isInvoiceTab = tab === 'invoices'
  const isCostsTab = tab === 'bills'

  const months = useMemo(() => [...new Set(rows.map(r => r.month).filter(Boolean))].sort().reverse(), [rows])
  const suppliers = useMemo(() => [...new Set(rows.map(r => (r.supplier || r.contact || '').trim()).filter(Boolean))].sort(), [rows])
  const codeOptions = useMemo(() => [...new Set(rows.map(r => String(r.accountCode || '')).filter(Boolean))].sort(), [rows])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (month && r.month !== month) return false
      if (supplier && (r.supplier || r.contact || '').trim() !== supplier) return false
      if (codes.length && !codes.includes(String(r.accountCode || ''))) return false
      if (catFilter && r.category !== catFilter) return false
      if (assigned === 'yes' && !r.categorised) return false
      if (assigned === 'no' && r.categorised) return false
      return true
    })
  }, [rows, month, supplier, codes, catFilter, assigned])

  const total = useMemo(() => filtered.reduce((s, r) => s + (r.amount != null ? r.amount : (r.total || 0)), 0), [filtered])
  const assignedCount = filtered.filter(r => r.categorised).length
  const unassignedCount = filtered.length - assignedCount

  useEffect(() => { setPage(1) }, [tab, month, supplier, codes, catFilter, assigned])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  function resetFilters() { setMonth(''); setSupplier(''); setCodes([]); setCatFilter(''); setAssigned('') }
  function switchTab(t) { setTab(t); setSupplier(''); setCodes([]); setCatFilter('') }

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#f0f2f5' }}>
      <div style={{ background: INK, padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 56, gap: 8, overflowX: 'auto' }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <Link href="/" style={{ color: '#aaa', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>← Portal</Link>
          <span style={{ color: '#444' }}>|</span>
          <span style={{ color: '#fff', fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap' }}>Bookkeeping</span>
        </div>
      </div>

      <div style={{ maxWidth: 1240, margin: '24px auto', padding: '0 24px' }}>
        <p style={{ color: '#666', fontSize: 14, margin: '0 0 20px' }}>
          Reconcile the app against Xero. Each tab shows both <strong>categorised</strong> items (attributed to a project) and <strong>uncategorised</strong> ones (no project tag in Xero). Costs are split by the account categorisation set in Admin.
        </p>

        {loading ? <div style={{ color: '#aaa', padding: 40 }}>Loading…</div> : !data ? <div style={{ color: '#b91c1c', padding: 40 }}>Could not load.</div> : (
          <>
            <ReconPanel data={data} month={month} />

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, margin: '20px 0 0', flexWrap: 'wrap' }}>
              {[['bills', 'Costs (Bills)'], ['invoices', 'Sales Invoices'], ['wages', 'Direct Wages'], ['ignored', 'Overheads']].map(([id, label]) => (
                <button key={id} onClick={() => switchTab(id)}
                  style={{ padding: '9px 16px', fontSize: 13, fontWeight: tab === id ? 700 : 500, border: 'none', borderRadius: '8px 8px 0 0', cursor: 'pointer',
                    background: tab === id ? '#fff' : '#e8e8ea', color: tab === id ? INK : '#777' }}>{label}</button>
              ))}
            </div>

            <div style={{ background: '#fff', borderRadius: '0 8px 8px 8px', padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              {/* Filters */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
                <select value={month} onChange={e => setMonth(e.target.value)} style={sel}>
                  <option value="">All months</option>
                  {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
                <select value={supplier} onChange={e => setSupplier(e.target.value)} style={sel}>
                  <option value="">{isInvoiceTab ? 'All customers' : 'All suppliers'}</option>
                  {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
                </select>

                {/* Categorised / No-category filter (all tabs) */}
                <select value={assigned} onChange={e => setAssigned(e.target.value)} style={sel}>
                  <option value="">Categorised &amp; uncategorised</option>
                  <option value="yes">Categorised only</option>
                  <option value="no">No category assigned</option>
                </select>

                {/* Labour / Materials filter (Costs tab only) */}
                {isCostsTab && (
                  <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={sel}>
                    <option value="">Labour &amp; Materials</option>
                    <option value="labour">Labour</option>
                    <option value="materials">Materials</option>
                  </select>
                )}

                {/* Multi-select account codes (not on invoices) */}
                {!isInvoiceTab && <CodeMultiSelect options={codeOptions} selected={codes} onChange={setCodes} />}

                {(month || supplier || codes.length || catFilter || assigned) &&
                  <button onClick={resetFilters} style={{ ...sel, cursor: 'pointer', color: '#b45309', border: '1px solid #fde68a', background: '#fffbeb' }}>Clear filters</button>}

                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 13, color: '#555' }}>
                  {filtered.length} item{filtered.length !== 1 ? 's' : ''} · <strong>{fmt(total)}</strong>
                  <span style={{ color: '#999' }}> · {assignedCount} categorised / {unassignedCount} not</span>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Date</th>
                      <th style={th}>{isInvoiceTab ? 'Customer' : 'Supplier'}</th>
                      <th style={th}>{isInvoiceTab ? 'Invoice' : 'Reference'}</th>
                      <th style={th}>Description</th>
                      {!isInvoiceTab && <th style={th}>Code</th>}
                      <th style={th}>Category</th>
                      <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={7} style={{ ...td, color: '#aaa', textAlign: 'center', padding: 30 }}>{rows.length === 0 ? 'Nothing here yet — upload the relevant Xero export.' : 'No items match these filters — try Clear filters.'}</td></tr>
                    ) : pageRows.map((r, i) => (
                      <tr key={i} style={{ background: i % 2 ? '#fcfbf9' : '#fff' }}>
                        <td style={td}>{r.date || '—'}</td>
                        <td style={td}>{r.supplier || r.contact || '—'}</td>
                        <td style={td}>{r.invoiceNumber || r.reference || '—'}</td>
                        <td style={{ ...td, maxWidth: 300, whiteSpace: 'normal' }}>{r.description || '—'}</td>
                        {!isInvoiceTab && (
                          <td style={td}>
                            {r.accountCode || '—'}
                            {r.accountCode && !r.hasCode && <span title="Not set up in Account Categorisation" style={{ marginLeft: 6, fontSize: 9, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>NOT IN APP</span>}
                          </td>
                        )}
                        <td style={td}>
                          {r.categorised
                            ? <span title="Attributed to this project" style={{ fontSize: 12, color: '#166534' }}>{r.project || '—'}</span>
                            : <span style={{ fontSize: 9, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>NO CATEGORY</span>}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt(r.amount != null ? r.amount : r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                    style={{ ...sel, cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.5 : 1 }}>← Prev</button>
                  <span style={{ fontSize: 13, color: '#666' }}>Page {page} of {totalPages} · {filtered.length} items</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                    style={{ ...sel, cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.5 : 1 }}>Next →</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Multi-select account codes with tick boxes in a dropdown.
function CodeMultiSelect({ options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const toggle = (c) => onChange(selected.includes(c) ? selected.filter(x => x !== c) : [...selected, c])
  const label = selected.length === 0 ? 'All account codes' : `${selected.length} code${selected.length > 1 ? 's' : ''} selected`
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{ ...sel, cursor: 'pointer', minWidth: 160, textAlign: 'left' }}>{label} ▾</button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 30, maxHeight: 280, overflowY: 'auto', minWidth: 200, padding: 6 }}>
          {selected.length > 0 && <div onClick={() => onChange([])} style={{ padding: '6px 10px', fontSize: 12, color: '#b45309', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}>Clear selection</div>}
          {options.length === 0 ? <div style={{ padding: 10, fontSize: 12, color: '#aaa' }}>No codes</div> : options.map(c => (
            <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}>
              <input type="checkbox" checked={selected.includes(c)} onChange={() => toggle(c)} />
              {c}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function ReconPanel({ data, month }) {
  const fmtL = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n || 0)

  // Last 6 months (YYYY-MM), oldest -> newest.
  const now = new Date()
  const sixMonths = []
  for (let k = 5; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1)
    sixMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // Uncategorised value per month = bills + wages + invoices with categorised=false.
  const allUncat = [...(data.bills || []), ...(data.wages || []), ...(data.ignored || []), ...(data.invoices || [])].filter(r => !r.categorised)
  const uncatByMonth = {}
  for (const r of allUncat) {
    if (!r.month) continue
    const v = r.amount != null ? Math.abs(r.amount) : Math.abs(r.total || 0)
    uncatByMonth[r.month] = (uncatByMonth[r.month] || 0) + v
  }
  const series = sixMonths.map(m => ({ month: m, value: uncatByMonth[m] || 0 }))
  const maxV = Math.max(1, ...series.map(s => s.value))

  // Three-row summary for the filtered period (or all months).
  const bm = data.benchmark?.months || {}
  const app = data.appCategorised || {}
  const hasBm = Object.keys(bm).length > 0
  const monthsToSum = month ? [month] : [...new Set([...Object.keys(bm), ...Object.keys(app)])]
  let xeroWages = 0, xeroBills = 0, xeroSales = 0
  for (const m of monthsToSum) {
    for (const [name, val] of Object.entries(bm[m] || {})) {
      const ln = name.toLowerCase()
      if (ln.includes('sales') || ln.includes('income') || ln.includes('revenue')) xeroSales += val
      else if (ln.includes('wage') || ln.includes('direct wages') || ln.includes('paye') || ln.includes('salaries')) xeroWages += val
      else xeroBills += val   // remaining cost of sale = bills/materials/subbies
    }
  }
  const inPeriod = (r) => !month || r.month === month
  const appBills = (data.bills || []).filter(inPeriod).reduce((s, r) => s + (r.amount || 0), 0)
  const appWages = (data.wages || []).filter(inPeriod).reduce((s, r) => s + (r.amount || 0), 0)
  const appInvoices = (data.invoices || []).filter(inPeriod).reduce((s, r) => s + (r.total || 0), 0)
  const rows = [
    { label: 'Cost of Sale (Bills)', xero: xeroBills, app: appBills },
    { label: 'Direct Wages', xero: xeroWages, app: appWages },
    { label: 'Sales Invoices', xero: xeroSales, app: appInvoices },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'stretch' }}>
      {/* LEFT: 6-month uncategorised line graph */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 4 }}>Uncategorised over 6 months</div>
        <div style={{ fontSize: 11, color: '#999', marginBottom: 12 }}>Zero when the app matches Xero; spikes to the value of items with no project tag.</div>
        <LineGraph series={series} maxV={maxV} fmt={fmtL} />
      </div>

      {/* RIGHT: three figures per type */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>Xero vs app {month ? `· ${monthLabel(month)}` : '· all months'}</div>
        {!hasBm && <div style={{ fontSize: 12, color: '#999' }}>Xero benchmark pending — runs after the nightly sync.</div>}
        {rows.map(r => {
          const diff = r.xero - r.app
          const balanced = Math.abs(diff) < 1
          const col = !hasBm ? '#999' : balanced ? '#16a34a' : '#dc2626'
          return (
            <div key={r.label} style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: '10px 12px', background: hasBm ? (balanced ? '#f0fdf4' : '#fef2f2') : '#fafafa' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>{r.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <Fig label="Xero" value={hasBm ? fmtL(r.xero) : '—'} />
                <Fig label="App" value={fmtL(r.app)} />
                <Fig label="Difference" value={hasBm ? fmtL(diff) : '—'} color={col} bold />
              </div>
            </div>
          )
        })}
        {data.benchmarkUpdatedAt && <div style={{ fontSize: 10, color: '#bbb', marginTop: 'auto' }}>Xero as of {new Date(data.benchmarkUpdatedAt).toLocaleDateString('en-GB')}. Invoice-date basis.</div>}
      </div>
    </div>
  )
}

function Fig({ label, value, color, bold }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#999' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: bold ? 700 : 600, color: color || INK }}>{value}</div>
    </div>
  )
}

function LineGraph({ series, maxV, fmt }) {
  const W = 380, H = 150, padL = 8, padR = 8, padT = 10, padB = 22
  const n = series.length
  const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1)
  const y = (v) => padT + (H - padT - padB) * (1 - v / maxV)
  const pts = series.map((s, i) => `${x(i)},${y(s.value)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="#e5e5e5" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {series.map((s, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(s.value)} r={s.value > 0 ? 4 : 3} fill={s.value > 0 ? '#dc2626' : '#16a34a'} />
          {s.value > 0 && <text x={x(i)} y={y(s.value) - 8} fontSize="9" fill="#dc2626" textAnchor="middle" fontWeight="700">{fmt(s.value)}</text>}
          <text x={x(i)} y={H - 6} fontSize="9" fill="#999" textAnchor="middle">{s.month.slice(5)}/{s.month.slice(2, 4)}</text>
        </g>
      ))}
    </svg>
  )
}
