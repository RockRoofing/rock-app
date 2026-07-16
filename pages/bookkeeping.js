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
            <ReconSummary data={data} month={month} tab={tab} total={total} isInvoiceTab={isInvoiceTab} />

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, margin: '20px 0 0', flexWrap: 'wrap' }}>
              {[['bills', 'Costs (Bills)'], ['invoices', 'Sales Invoices'], ['wages', 'Direct Wages'], ['ignored', 'Ignored']].map(([id, label]) => (
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
                      <tr><td colSpan={7} style={{ ...td, color: '#aaa', textAlign: 'center', padding: 30 }}>No items match these filters.</td></tr>
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

function ReconSummary({ data, month, tab, total, isInvoiceTab }) {
  const bm = data.benchmark?.months || {}
  const app = data.appCategorised || {}
  const hasBenchmark = Object.keys(bm).length > 0
  const monthsToSum = month ? [month] : [...new Set([...Object.keys(bm), ...Object.keys(app)])]
  let xeroCost = 0, xeroSales = 0, appCost = 0, appSales = 0
  for (const m of monthsToSum) {
    for (const [name, val] of Object.entries(bm[m] || {})) {
      const ln = name.toLowerCase()
      if (ln.includes('sales') || ln.includes('income') || ln.includes('revenue')) xeroSales += val
      else xeroCost += val
    }
    appCost += (app[m]?.cost || 0)
    appSales += (app[m]?.sales || 0)
  }
  const xero = isInvoiceTab ? xeroSales : xeroCost
  const appVal = isInvoiceTab ? appSales : appCost
  const diff = xero - appVal
  const matches = Math.abs(diff) < 1
  const Card = ({ label, value, sub, color }) => (
    <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || INK }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{sub}</div>}
    </div>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
      <Card label={`In Xero (${isInvoiceTab ? 'sales' : 'cost of sale'})`} value={hasBenchmark ? fmt(xero) : '—'} sub={month ? monthLabel(month) : 'all months'} />
      <Card label="Categorised in app" value={fmt(appVal)} sub="attributed to projects" />
      <Card label="Difference (Xero − app)" value={hasBenchmark ? fmt(diff) : '—'} color={!hasBenchmark ? '#999' : matches ? '#16a34a' : '#dc2626'} sub={!hasBenchmark ? 'benchmark pending' : matches ? 'reconciles ✓' : 'does not match'} />
      <Card label="This view" value={fmt(total)} sub="current filter total" />
      {data.missingCodes && data.missingCodes.length > 0 && (
        <div style={{ gridColumn: '1 / -1', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#b91c1c' }}>
          <strong>{data.missingCodes.length} account code(s) not set up in the app:</strong> {data.missingCodes.join(', ')} — add them in Admin → Account Categorisation.
        </div>
      )}
      {data.benchmarkUpdatedAt && <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#bbb' }}>Xero figures as of {new Date(data.benchmarkUpdatedAt).toLocaleString('en-GB')}. Dates are Invoice date (filter Xero by Invoice date to compare).</div>}
    </div>
  )
}
