import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n || 0)
const INK = '#1a1a2e'
const th = { textAlign: 'left', padding: '10px 12px', fontSize: 11, color: '#777', fontWeight: 600, borderBottom: '2px solid #eee', whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #f2f0ec' }
const sel = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff' }
const syncBtn = (busy) => ({ background: busy ? '#333' : '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' })
const grnBtn = (bg, busy) => ({ background: busy ? '#333' : bg, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' })
function fmtSyncWhen(iso) {
  if (!iso) return 'never'
  const d = new Date(iso), now = new Date()
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `today ${t}`
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${t}`
}

// Read a File -> base64 (no data: prefix)
function readB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = () => reject(new Error('Could not read file'))
    r.readAsDataURL(file)
  })
}

// In-page multi-file Bills upload modal. Posts each file to /api/import-bills-bulk
// (same endpoint/logic as the Xero Upload tool) so you never leave the page.
function BillsUploadModal({ onClose, onUploaded }) {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState([])   // [{name, status, result, error}]
  const [anyDone, setAnyDone] = useState(false)

  async function upload() {
    if (!files.length) return
    setUploading(true)
    const rows = files.map(f => ({ name: f.name, status: 'pending', result: null, error: null }))
    setResults([...rows])
    let done = false
    for (let i = 0; i < files.length; i++) {
      rows[i].status = 'uploading'; setResults([...rows])
      try {
        const fileData = await readB64(files[i])
        const res = await fetch('/api/import-bills-bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileData }) })
        const data = await res.json()
        if (res.ok && data.ok) { rows[i].status = 'done'; rows[i].result = data; done = true }
        else { rows[i].status = 'error'; rows[i].error = data.error || 'Upload failed' }
      } catch (e) { rows[i].status = 'error'; rows[i].error = e.message }
      setResults([...rows])
    }
    setUploading(false)
    if (done) setAnyDone(true)
  }

  function closeAndRefresh() {
    if (anyDone && onUploaded) onUploaded()
    onClose()
  }

  return (
    <div onClick={closeAndRefresh} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560, boxShadow: '0 12px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #eee' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Upload Bills</div>
          <button onClick={closeAndRefresh} style={{ background: 'transparent', border: 'none', fontSize: 22, lineHeight: 1, color: '#999', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 13, color: '#888', margin: '0 0 14px', lineHeight: 1.6 }}>
            Upload the Xero <strong>Bills</strong> export (CSV). Captures materials and subcontractor labour for every project (and untagged overheads), split by the account categorisation. Bills use exact per-day replace. You can select several files.
          </p>
          <div onClick={() => document.getElementById('bk_bills_file')?.click()}
            style={{ border: '2px dashed ' + (files.length ? '#bbf7d0' : '#e5e5e5'), borderRadius: 8, padding: 22, textAlign: 'center', cursor: 'pointer', background: files.length ? '#f0fdf4' : '#fafafa', marginBottom: 14 }}>
            <input id="bk_bills_file" type="file" accept=".csv,text/csv" multiple style={{ display: 'none' }}
              onChange={e => { setFiles(Array.from(e.target.files || [])); setResults([]); setAnyDone(false) }} />
            <div style={{ fontSize: 13, color: files.length ? '#166534' : '#888' }}>
              {files.length ? `${files.length} file${files.length > 1 ? 's' : ''} selected` : 'Click to select CSV file(s)'}
            </div>
            {files.length > 0 && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{files.map(f => f.name).join(', ')}</div>}
          </div>
          <button onClick={upload} disabled={!files.length || uploading}
            style={{ width: '100%', background: INK, color: '#fff', border: 'none', borderRadius: 8, padding: '11px 16px', fontSize: 14, fontWeight: 600, cursor: !files.length || uploading ? 'default' : 'pointer', opacity: !files.length || uploading ? 0.5 : 1 }}>
            {uploading ? 'Uploading…' : `Upload Bills${files.length > 1 ? ` (${files.length} files)` : ''}`}
          </button>

          {results.map((row, i) => (
            <div key={i}>
              {row.status === 'error' && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginTop: 12, fontSize: 13, color: '#b91c1c' }}><strong>{row.name}:</strong> {row.error}</div>}
              {row.status === 'done' && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 14px', marginTop: 12, fontSize: 13, color: '#166534' }}>
                  <strong>✓ {results.length > 1 ? row.name + ': ' : ''}Bills imported.</strong>
                  {row.result && (() => {
                    const r = row.result
                    const proj = r.totalLinesProcessed || 0
                    const overhead = r.untaggedLines || 0
                    const total = proj + overhead
                    const replaced = r.linesReplacedInRange || 0
                    return <> {total} line{total === 1 ? '' : 's'} imported ({proj} to project{proj === 1 ? '' : 's'}, {overhead} overhead/untagged){replaced ? `, replacing ${replaced} previous line${replaced === 1 ? '' : 's'}` : ''}{typeof r.daysCovered === 'number' ? ` across ${r.daysCovered} day${r.daysCovered === 1 ? '' : 's'}` : ''}.</>
                  })()}
                  {row.result?.daysNotCovered?.length > 0 && (
                    <div style={{ marginTop: 6, color: '#92400e', fontSize: 12 }}>
                      ⚠ {row.result.daysNotCovered.length} day(s) inside this file's range had app bills the file didn't include — left unchanged. If those bills were deleted in Xero, re-upload a file covering those dates.
                    </div>
                  )}
                </div>
              )}
              {(row.status === 'uploading' || row.status === 'pending') && <div style={{ marginTop: 12, fontSize: 13, color: '#888' }}>{row.status === 'uploading' ? '⏳ Uploading' : '• Queued'} {row.name}…</div>}
            </div>
          ))}

          {anyDone && (
            <button onClick={closeAndRefresh} style={{ width: '100%', marginTop: 14, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Done — refresh figures</button>
          )}
        </div>
      </div>
    </div>
  )
}


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
  const [syncStatus, setSyncStatus] = useState({})
  const [isAdmin, setIsAdmin] = useState(false)
  const [canTools, setCanTools] = useState(false)   // accounts/management/admin
  const [showBillsUpload, setShowBillsUpload] = useState(false)
  const [syncMonths, setSyncMonths] = useState(6)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => { if (d.user?.role === 'admin') setIsAdmin(true); if (['accounts', 'management', 'admin'].includes(d.user?.role)) setCanTools(true) }).catch(() => {})
  }, [])

  async function loadSyncStatus() {
    try { setSyncStatus(await fetch('/api/sync-status').then(r => r.json())) } catch {}
  }

  async function runSync(kind, endpoint, label) {
    setSyncing(kind); setSyncMsg('')
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months: syncMonths }) })
      const d = await res.json()
      if (res.ok && d.ok) {
        const detail = kind === 'invoices' ? `${d.invoicesMatched} matched to projects, ${d.invoicesUnassigned} unassigned (of ${d.invoicesFetched})`
          : kind === 'wages' ? `${d.taggedToProjects} tagged to projects, ${d.untagged} unassigned (of ${d.wageLinesFetched})`
          : `${d.monthsPulled} months`
        setSyncMsg(`${label}: ${detail}.`)
        const fresh = await fetch('/api/bookkeeping').then(r => r.json())
        setData(fresh)
        loadSyncStatus()
      } else setSyncMsg(d.error || `${label} failed.`)
    } catch (e) { setSyncMsg(`${label} failed.`) }
    setSyncing('')
  }

  useEffect(() => { loadSyncStatus() }, [])

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
  function switchTab(t) {
    setTab(t); setSupplier(''); setCodes([]); setCatFilter('')
    if (t === 'ignored') {           // Overheads: default to Categorised + all months
      setAssigned('yes'); setMonth('')
    } else {
      setAssigned('no'); setMonth(defaultMonthFor(t, data))
    }
  }

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
            style={grnBtn('#0d9488', syncing === 'invoices')}>{syncing === 'invoices' ? 'Syncing…' : '↻ Sync Invoices'}</button>
          <button onClick={() => runSync('wages', '/api/sync-wages', 'Wages')} disabled={!!syncing}
            style={grnBtn('#0f766e', syncing === 'wages')}>{syncing === 'wages' ? 'Syncing…' : '↻ Sync Wages'}</button>
          {canTools && (
            <button onClick={() => setShowBillsUpload(true)} style={grnBtn('#0b5c55', false)}>
              ⬆ Upload Bills
            </button>
          )}
          <button onClick={() => runSync('benchmark', '/api/sync-benchmark', 'Xero figures')} disabled={!!syncing}
            style={{ background: syncing === 'benchmark' ? '#0d8fbd' : '#13B5EA', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: syncing === 'benchmark' ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>{syncing === 'benchmark' ? 'Syncing…' : '↻ Sync Xero figures'}</button>
          {canTools && (
            <Link href="/admin/account-categorisation" style={{ background: '#2d2d44', color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
              ⚙ Bookkeeping Tools
            </Link>
          )}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: '#8a8a99', padding: '0 2px 8px' }}>
          <span>Last invoices sync: <strong style={{ color: '#bbb' }}>{fmtSyncWhen(syncStatus.invoices)}</strong></span>
          <span>Last wages sync: <strong style={{ color: '#bbb' }}>{fmtSyncWhen(syncStatus.wages)}</strong></span>
          <span>Last bills upload: <strong style={{ color: '#bbb' }}>{fmtSyncWhen(syncStatus.bills)}</strong></span>
          <span>Last Xero figures: <strong style={{ color: '#bbb' }}>{fmtSyncWhen(syncStatus.benchmark)}</strong></span>
        </div>
      </div>

      {showBillsUpload && (
        <BillsUploadModal
          onClose={() => setShowBillsUpload(false)}
          onUploaded={async () => { const fresh = await fetch('/api/bookkeeping').then(r => r.json()); setData(fresh); loadSyncStatus() }}
        />
      )}

      <div style={{ maxWidth: 1240, margin: '24px auto', padding: '0 24px' }}>
        <p style={{ color: '#666', fontSize: 14, margin: '0 0 20px' }}>
          Reconcile the app against Xero. Each tab shows both <strong>categorised</strong> items (attributed to a project) and <strong>uncategorised</strong> ones (no project tag in Xero). Costs are split by the account categorisation set in Admin.
        </p>

        {loading ? <div style={{ color: '#aaa', padding: 40 }}>Loading…</div> : !data ? <div style={{ color: '#b91c1c', padding: 40 }}>Could not load.</div> : (
          <>
            {(data.uncategorisedCodes || []).length > 0 && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#b91c1c' }}>
                <strong>⚠ {data.uncategorisedCodes.length} uncategorised account {data.uncategorisedCodes.length === 1 ? 'code' : 'codes'}</strong> — these are excluded from project costs until assigned in{' '}
                <Link href="/admin/account-categorisation" style={{ color: '#b91c1c', fontWeight: 600 }}>Account Categorisation</Link>:
                <span style={{ color: '#7f1d1d' }}> {data.uncategorisedCodes.map(c => `${c.code}${c.name ? ` (${c.name})` : ''}`).join(', ')}</span>
              </div>
            )}
            {(data.reconGaps || []).length > 0 && (
              <details style={{ background: '#fff', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
                <summary style={{ fontSize: 13, color: '#92400e', fontWeight: 700, cursor: 'pointer' }}>
                  ⚠ {data.reconGaps.length} account {data.reconGaps.length === 1 ? 'code has' : 'codes have'} more in Xero than the app can see — possible accruals / manual journals not captured as bills or wages
                </summary>
                <div style={{ overflowX: 'auto', marginTop: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: '#777', textAlign: 'left' }}>
                        <th style={{ padding: '6px 8px' }}>Code</th><th style={{ padding: '6px 8px' }}>Account</th>
                        <th style={{ padding: '6px 8px' }}>Category</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Xero P&L</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>App lines</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.reconGaps.map(g => (
                        <tr key={g.code} style={{ borderTop: '1px solid #f2f0ec' }}>
                          <td style={{ padding: '6px 8px', fontWeight: 600 }}>{g.code}</td>
                          <td style={{ padding: '6px 8px' }}>{g.name || '—'}</td>
                          <td style={{ padding: '6px 8px', color: g.category === 'uncategorised' ? '#dc2626' : '#666' }}>{g.category}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(g.xero)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(g.app)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#b45309' }}>{fmt(g.diff)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>
                  Compares Xero's P&L (per account code, over the synced months) against the app's bill &amp; wage line data for the same code. A positive difference means Xero has costs the app didn't import as lines — usually manual journals or accruals. Re-sync bills/wages first; anything remaining needs checking in Xero.
                </div>
              </details>
            )}
            <ReconPanel data={data} month={month} tab={tab} onPickMonth={setMonth} />

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, margin: '20px 0 0', flexWrap: 'wrap' }}>
              {[['bills', 'Costs (Bills)'], ['invoices', 'Sales Invoices'], ['wages', 'Direct Wages'], ['ignored', 'Overheads'], ['retention', 'Retention']].map(([id, label]) => (
                <button key={id} onClick={() => switchTab(id)}
                  style={{ padding: '9px 16px', fontSize: 13, fontWeight: tab === id ? 700 : 500, border: 'none', borderRadius: '8px 8px 0 0', cursor: 'pointer',
                    background: tab === id ? '#fff' : '#e8e8ea', color: tab === id ? INK : '#777' }}>{label}</button>
              ))}
            </div>

            <div style={{ background: '#fff', borderRadius: '0 8px 8px 8px', padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              {tab === 'retention' ? (
                <div style={{ margin: -16 }}>
                  <iframe src="/retention?embed=1" title="Retention Tracker (read-only)"
                    style={{ width: '100%', height: 'calc(100vh - 220px)', border: 'none', borderRadius: '0 8px 8px 8px', background: '#f0f2f5' }} />
                </div>
              ) : (<>
              {/* Filters */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
                <select value={month} onChange={e => setMonth(e.target.value)} style={sel}>
                  <option value="">All months</option>
                  {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
                <SupplierPicker
                  value={supplier}
                  options={suppliers}
                  onChange={setSupplier}
                  placeholder={isInvoiceTab ? 'All customers' : 'All suppliers'}
                />

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
              </>)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Multi-select account codes with tick boxes in a dropdown.
function SupplierPicker({ value, options, onChange, placeholder }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  // When a value is selected, show it in the box; typing filters the list.
  const shown = open ? q : (value || '')
  const needle = q.trim().toLowerCase()
  const matches = (needle ? options.filter(s => s.toLowerCase().includes(needle)) : options).slice(0, 200)
  const pick = (s) => { onChange(s); setQ(''); setOpen(false) }
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        value={shown}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQ('') }}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        style={{ ...sel, minWidth: 180, cursor: 'text' }}
      />
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 30, maxHeight: 280, overflowY: 'auto', minWidth: 220, padding: 6 }}>
          <div onClick={() => pick('')} style={{ padding: '6px 10px', fontSize: 12, color: value ? '#b45309' : '#666', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}>{placeholder}</div>
          {matches.length === 0
            ? <div style={{ padding: 10, fontSize: 12, color: '#aaa' }}>No matches</div>
            : matches.map(s => (
                <div key={s} onClick={() => pick(s)} style={{ padding: '6px 10px', fontSize: 13, cursor: 'pointer', borderRadius: 6, background: s === value ? '#f5f3ff' : 'transparent', fontWeight: s === value ? 700 : 400 }}>{s}</div>
              ))}
        </div>
      )}
    </div>
  )
}

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

  // P&L reference (grey), computed to the SAME rule as the app's Account
  // Categorisation (which is code-based):
  //  • Cost of Sale (Bills) = P&L cost lines whose code is marked Materials or
  //    Labour in Account Categorisation, EXCLUDING Direct Wages (320).
  //  • Direct Wages = P&L code 320 only.
  //  • Sales = P&L codes marked Sales in Account Categorisation (code 200 defaults
  //    to Sales, but any revenue code tagged Sales is included).
  const bm = data.benchmark?.months || {}
  const hasBm = Object.keys(bm).length > 0
  const monthsToSum = month ? [month] : Object.keys(bm)
  const catCfg = data.categorisation || {}          // { code: { category } }
  const catOf = (code) => {
    const c = String(code)
    let cat = catCfg[c]?.category
    if (cat === 'ignore') cat = 'overheads'
    if (!cat) { if (c === '200') cat = 'sales'; else if (c === '320') cat = 'labour' }
    return cat
  }
  const isBillCode = (code) => {
    const c = String(code)
    if (c === '320') return false                   // wages handled on its own card
    const cat = catOf(c)
    return cat === 'materials' || cat === 'labour'
  }
  const isSalesCode = (code) => catOf(code) === 'sales'
  let plSales = 0, plWages = 0, plBills = 0
  for (const mo of monthsToSum) {
    const b = bm[mo]; if (!b) continue
    if (b.byCode) {
      for (const [code, val] of Object.entries(b.byCode)) {
        const amt = Math.abs(val || 0); const c = String(code)
        if (isSalesCode(c)) plSales += amt
        else if (c === '320') plWages += amt
        else if (isBillCode(c)) plBills += amt        // only Materials/Labour-categorised codes
      }
    } else {
      // No per-code data yet (benchmark not re-synced). Fall back to section totals.
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
