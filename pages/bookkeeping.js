import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n || 0)
const INK = '#1a1a2e'
const th = { textAlign: 'left', padding: '10px 12px', fontSize: 11, color: '#777', fontWeight: 600, borderBottom: '2px solid #eee', whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #f2f0ec' }
const sel = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff' }
const syncBtn = (busy) => ({ background: busy ? '#333' : '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' })

// Rows for a given tab (matches the page's tab->data mapping).
function tabRowsFor(tab, data) {
  if (!data) return []
  return tab === 'wages' ? (data.wages || []) : tab === 'invoices' ? (data.invoices || []) : tab === 'ignored' ? (data.ignored || []) : (data.bills || [])
}
// The most recent COMPLETE month (previous calendar month) if that tab has data
// for it; else the newest month present; else '' (all months).
function defaultMonthFor(tab, data) {
  const rows = tabRowsFor(tab, data)
  const present = [...new Set(rows.map(r => rowMonth(r)).filter(Boolean))].sort()   // ascending
  if (present.length === 0) return ''
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastFull = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
  if (present.includes(lastFull)) return lastFull
  return present[present.length - 1]   // newest available
}

function monthLabel(m) {
  if (!m) return ''
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}
// Derive a YYYY-MM month from a row, falling back to parsing a raw date string
// (handles "28 Feb 2023" style dates that predate the importer date fix).
const MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12' }
function rowMonth(r) {
  if (r.month) return r.month
  const s = String(r.date || '')
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7)
  const t = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(s)
  if (t) { const mo = MON[t[2].slice(0, 4).toLowerCase()] || MON[t[2].slice(0, 3).toLowerCase()]; if (mo) return `${t[3]}-${mo}` }
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (d) return `${d[3]}-${d[2].padStart(2, '0')}`
  return ''
}

export default function BookkeepingPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('bills')        // bills | invoices | wages | ignored
  const [month, setMonth] = useState('')
  const [supplier, setSupplier] = useState('')
  const [codes, setCodes] = useState([])          // multi-select account codes
  const [catFilter, setCatFilter] = useState('') // '' | labour | materials  (Costs tab)
  const [assigned, setAssigned] = useState('no')   // default: No category assigned
  const [page, setPage] = useState(1)
  const PER_PAGE = 50
  const [syncing, setSyncing] = useState('')     // '' | 'benchmark' | 'invoices' | 'wages'
  const [syncMsg, setSyncMsg] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [canTools, setCanTools] = useState(false)   // accounts/management/admin
  const [syncMonths, setSyncMonths] = useState(6)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => { if (d.user?.role === 'admin') setIsAdmin(true); if (['accounts', 'management', 'admin'].includes(d.user?.role)) setCanTools(true) }).catch(() => {})
  }, [])

  async function runSync(kind, endpoint, label) {
    setSyncing(kind); setSyncMsg('')
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months: syncMonths }) })
      const d = await res.json()
      if (res.ok && d.ok) {
        const detail = kind === 'invoices' ? `${d.invoicesMatched} matched to projects, ${d.invoicesUnassigned} unassigned (of ${d.invoicesFetched})`
          : kind === 'wages' ? `${d.projectsDone} projects, ${d.wageLinesRefreshed} wage lines`
          : `${d.monthsPulled} months`
        setSyncMsg(`${label}: ${detail}.`)
        const fresh = await fetch('/api/bookkeeping').then(r => r.json())
        setData(fresh)
      } else setSyncMsg(d.error || `${label} failed.`)
    } catch (e) { setSyncMsg(`${label} failed.`) }
    setSyncing('')
  }

  useEffect(() => {
    fetch('/api/bookkeeping').then(r => r.json()).then(d => {
      setData(d)
      setLoading(false)
      // Default the month filter to the most recent COMPLETE month for the
      // starting tab (falls back to newest available, else all months).
      if (d) setMonth(defaultMonthFor('bills', d))
    }).catch(() => setLoading(false))
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    return tab === 'bills' ? (data.bills || []) : tab === 'wages' ? (data.wages || []) : tab === 'invoices' ? (data.invoices || []) : (data.ignored || [])
  }, [data, tab])

  const isInvoiceTab = tab === 'invoices'
  const isCostsTab = tab === 'bills'

  const months = useMemo(() => [...new Set(rows.map(r => rowMonth(r)).filter(Boolean))].sort().reverse(), [rows])
  const suppliers = useMemo(() => [...new Set(rows.map(r => (r.supplier || r.contact || '').trim()).filter(Boolean))].sort(), [rows])
  const codeOptions = useMemo(() => [...new Set(rows.map(r => String(r.accountCode || '')).filter(Boolean))].sort(), [rows])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (month && rowMonth(r) !== month) return false
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
  function switchTab(t) { setTab(t); setSupplier(''); setCodes([]); setCatFilter(''); setAssigned('no'); setMonth(defaultMonthFor(t, data)) }

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#f0f2f5' }}>
      <div style={{ background: INK, padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 56, gap: 8, overflowX: 'auto' }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <Link href="/" style={{ color: '#aaa', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>← Portal</Link>
          <span style={{ color: '#444' }}>|</span>
          <span style={{ color: '#fff', fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap' }}>Bookkeeping</span>
          <div style={{ flex: 1 }} />
          {syncMsg && <span style={{ color: '#9fe3b0', fontSize: 12, whiteSpace: 'nowrap' }}>{syncMsg}</span>}
          <span style={{ color: '#888', fontSize: 12 }}>Sync last</span>
          <select value={syncMonths} onChange={e => setSyncMonths(parseInt(e.target.value))}
            style={{ background: '#2d2d44', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '5px 6px', fontSize: 12 }}>
            {[3, 6, 12, 18, 24].map(m => <option key={m} value={m}>{m} mo</option>)}
          </select>
          <button onClick={() => runSync('invoices', '/api/sync-invoices', 'Invoices')} disabled={!!syncing}
            style={syncBtn(syncing === 'invoices')}>{syncing === 'invoices' ? 'Syncing…' : '↻ Sync Invoices'}</button>
          <button onClick={() => runSync('wages', '/api/sync-wages', 'Wages')} disabled={!!syncing}
            style={syncBtn(syncing === 'wages')}>{syncing === 'wages' ? 'Syncing…' : '↻ Sync Wages'}</button>
          <button onClick={() => runSync('benchmark', '/api/sync-benchmark', 'Xero figures')} disabled={!!syncing}
            style={syncBtn(syncing === 'benchmark')}>{syncing === 'benchmark' ? 'Syncing…' : '↻ Sync Xero figures'}</button>
          {canTools && (
            <Link href="/admin/xero-upload" style={{ background: '#0f766e', color: '#fff', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
              ⬆ Upload Bills
            </Link>
          )}
          {canTools && (
            <Link href="/bookkeeping/admin" style={{ background: '#2d2d44', color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
              ⚙ Bookkeeping Tools
            </Link>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 1240, margin: '24px auto', padding: '0 24px' }}>
        <p style={{ color: '#666', fontSize: 14, margin: '0 0 20px' }}>
          Reconcile the app against Xero. Each tab shows both <strong>categorised</strong> items (attributed to a project) and <strong>uncategorised</strong> ones (no project tag in Xero). Costs are split by the account categorisation set in Admin.
        </p>

        {loading ? <div style={{ color: '#aaa', padding: 40 }}>Loading…</div> : !data ? <div style={{ color: '#b91c1c', padding: 40 }}>Could not load.</div> : (
          <>
            <ReconPanel data={data} month={month} tab={tab} onPickMonth={setMonth} />

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

function ReconPanel({ data, month, tab, onPickMonth, onPickPL }) {
  const fmtL = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n || 0)
  const showGraph = tab !== 'ignored'   // no graph on Overheads

  // Last 6 months (YYYY-MM), oldest -> newest.
  const now = new Date()
  const sixMonths = []
  for (let k = 5; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1)
    sixMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // Uncategorised value per month FOR THE CURRENT TAB only, so the graph reflects
  // the tab you're on (Costs / Sales / Wages).
  const tabRows = tab === 'wages' ? (data.wages || []) : tab === 'invoices' ? (data.invoices || []) : (data.bills || [])
  const uncatByMonth = {}
  for (const r of tabRows) {
    if (r.categorised) continue
    const m = rowMonth(r); if (!m) continue
    // Signed amount (credit notes subtract) so this matches the table's
    // "No category assigned" total exactly when you click through to a month.
    const v = r.amount != null ? r.amount : (r.total || 0)
    uncatByMonth[m] = (uncatByMonth[m] || 0) + v
  }
  const chartData = sixMonths.map(m => ({
    month: new Date(parseInt(m.slice(0, 4)), parseInt(m.slice(5)) - 1, 1).toLocaleDateString('en-GB', { month: 'short' }),
    ym: m,
    uncategorised: uncatByMonth[m] || 0,
  }))
  const anySpike = chartData.some(d => d.uncategorised > 0)

  // ── Card figures: reconcile WITHIN each source (net of VAT) ──
  // Main line per card: Total (all rows in source) − Categorised = Still to find.
  // This is the categorisation check and reaches zero when everything is tagged.
  // Below it we show the P&L figure (scoped to that category's codes) in grey as
  // a separate cross-check, clickable to investigate.
  const inMonth = (r) => !month || rowMonth(r) === month
  // Bills & wages: stored line amounts are already net (ex-VAT). Invoices: use net (subTotal).
  const billsRows = (data.bills || []).filter(inMonth)
  const wagesRows = (data.wages || []).filter(inMonth)
  const invRows = (data.invoices || []).filter(inMonth)
  const sumBills = (arr) => arr.reduce((s, r) => s + (r.amount || 0), 0)
  const sumInv = (arr) => arr.reduce((s, r) => s + (r.subTotal != null ? r.subTotal : (r.total || 0)), 0)

  const billsTotal = sumBills(billsRows),  billsCat = sumBills(billsRows.filter(r => r.categorised))
  const wagesTotal = sumBills(wagesRows),  wagesCat = sumBills(wagesRows.filter(r => r.categorised))
  const invTotal = sumInv(invRows),        invCat = sumInv(invRows.filter(r => r.categorised))

  // P&L reference (grey), scoped to each category's account codes, from the
  // section-aware benchmark. Kept as a cross-check, not part of "still to find".
  const bm = data.benchmark?.months || {}
  const hasBm = Object.keys(bm).length > 0
  const monthsToSum = month ? [month] : Object.keys(bm)
  const LABOUR_WAGE_CODES = ['320']
  let plSales = 0, plWages = 0, plBills = 0
  for (const mo of monthsToSum) {
    const b = bm[mo]; if (!b) continue
    // Prefer code-level data if present; else fall back to section totals.
    if (b.byCode) {
      for (const [code, val] of Object.entries(b.byCode)) {
        const amt = Math.abs(val || 0); const c = String(code)
        if (c === '200') plSales += amt
        else if (c === '320') plWages += amt
        else plBills += amt   // other cost-of-sale codes (labour/materials)
      }
    } else {
      plSales += Math.abs(b.incomeTotal || 0)
      plBills += Math.abs(b.costOfSalesTotal || 0)
    }
  }

  const rows = [
    { label: 'Cost of Sale (Bills)', total: billsTotal, cat: billsCat, pl: plBills },
    { label: 'Direct Wages', total: wagesTotal, cat: wagesCat, pl: plWages },
    { label: 'Sales Invoices', total: invTotal, cat: invCat, pl: plSales },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: showGraph ? '1fr 1fr' : '1fr', gap: 16, alignItems: 'stretch' }}>
      {showGraph && (
        <div style={{ background: '#fff', borderRadius: 12, padding: '16px 16px 8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 2 }}>
            Uncategorised {tab === 'wages' ? 'wages' : tab === 'invoices' ? 'invoices' : 'costs'} — last 6 months
          </div>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 10 }}>
            Last 6 months. Aim for the dashed line (zero): everything allocated. {month ? <span style={{ color: '#7c3aed', cursor: 'pointer', fontWeight: 600 }} onClick={() => onPickMonth && onPickMonth('')}>Showing {monthLabel(month)} — clear</span> : 'Click a month to filter the table to it.'}
          </div>
          <div style={{ height: 190 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 12, right: 18, bottom: 4, left: 8 }}
                onClick={(e) => { const p = e && e.activePayload && e.activePayload[0]; if (p && p.payload && onPickMonth) onPickMonth(p.payload.ym) }}
                style={{ cursor: 'pointer' }}>
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#999' }} axisLine={{ stroke: '#e5e5e5' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#999' }} axisLine={false} tickLine={false} width={56}
                  tickFormatter={(v) => Math.abs(v) >= 1000 ? `£${Math.round(v / 1000)}k` : `£${v}`} domain={['auto', 'auto']} />
                <Tooltip formatter={(v) => [fmtL(v), 'Uncategorised']} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <ReferenceLine y={0} stroke="#16a34a" strokeDasharray="5 4" strokeWidth={1.5} />
                <Line type="monotone" dataKey="uncategorised" stroke="#7c3aed" strokeWidth={2.5}
                  dot={{ r: 3, fill: '#7c3aed' }} activeDot={{ r: 6, cursor: 'pointer' }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {!anySpike && <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, textAlign: 'center', paddingBottom: 6 }}>All allocated — nothing uncategorised ✓</div>}
        </div>
      )}

      {/* Reconciliation — Total − Categorised = Still to find (net of VAT) */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>Categorisation check {month ? `· ${monthLabel(month)}` : '· all months'} <span style={{ fontWeight: 400, color: '#999' }}>(net of VAT)</span></div>
        {rows.map(r => {
          const toFind = r.total - r.cat
          const balanced = Math.abs(toFind) < 1
          const col = balanced ? '#16a34a' : '#dc2626'
          return (
            <div key={r.label} style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: '10px 12px', background: balanced ? '#f0fdf4' : '#fef2f2' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>{r.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <Fig label="Total" value={fmtL(r.total)} />
                <Fig label="Categorised" value={fmtL(r.cat)} />
                <Fig label="Still to find" value={fmtL(toFind)} color={col} bold />
              </div>
              {hasBm && (
                <div
                  onClick={() => onPickPL && onPickPL(r.label)}
                  title={onPickPL ? 'Click to investigate the P&L detail for this category' : ''}
                  style={{ fontSize: 11, color: '#aaa', marginTop: 6, cursor: onPickPL ? 'pointer' : 'default' }}>
                  P&L (Xero): {fmtL(r.pl)}{onPickPL ? <span style={{ textDecoration: 'underline' }}> investigate ›</span> : ''}
                </div>
              )}
            </div>
          )
        })}
        {data.benchmarkUpdatedAt && <div style={{ fontSize: 10, color: '#bbb', marginTop: 'auto' }}>P&L reference as of {new Date(data.benchmarkUpdatedAt).toLocaleDateString('en-GB')}. Main figures from synced/uploaded data, net of VAT.</div>}
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
