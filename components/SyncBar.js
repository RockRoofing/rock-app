import { useState, useEffect } from 'react'

// Shared Xero sync controls used on Bookkeeping and Commercial pages.
// Props:
//   show        : array of any of 'invoices' | 'wages' | 'bills'  (which buttons)
//   months      : sync window in months (default 6)
//   onDone      : async () => {}  — called after any successful sync/upload so the
//                 host page can refresh its own data
//   showBench   : (optional) also show "Sync Xero figures" (bookkeeping only)
//   compact     : (optional) smaller layout

const grn = (bg, busy) => ({ background: busy ? '#333' : bg, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' })
const GREENS = { invoices: '#0d9488', wages: '#0f766e', bills: '#0b5c55' }
const XERO_BLUE = '#13B5EA'

function readB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = () => reject(new Error('Could not read file'))
    r.readAsDataURL(file)
  })
}

function fmtWhen(iso) {
  if (!iso) return 'never'
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `today ${time}`
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  return `${date} ${time}`
}

export function BillsUploadModal({ onClose, onUploaded }) {
  const INK = '#1a1a2e'
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState([])
  const [anyDone, setAnyDone] = useState(false)

  async function upload() {
    if (!files.length) return
    setUploading(true)
    const rows = files.map(f => ({ name: f.name, status: 'pending', result: null, error: null }))
    setResults([...rows]); let done = false
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
    setUploading(false); if (done) setAnyDone(true)
  }

  function closeAndRefresh() { if (anyDone && onUploaded) onUploaded(); onClose() }

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
          <div onClick={() => document.getElementById('sb_bills_file')?.click()}
            style={{ border: '2px dashed ' + (files.length ? '#bbf7d0' : '#e5e5e5'), borderRadius: 8, padding: 22, textAlign: 'center', cursor: 'pointer', background: files.length ? '#f0fdf4' : '#fafafa', marginBottom: 14 }}>
            <input id="sb_bills_file" type="file" accept=".csv,text/csv" multiple style={{ display: 'none' }}
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
                    const proj = r.totalLinesProcessed || 0, overhead = r.untaggedLines || 0, total = proj + overhead, replaced = r.linesReplacedInRange || 0
                    return <> {total} line{total === 1 ? '' : 's'} imported ({proj} to project{proj === 1 ? '' : 's'}, {overhead} overhead/untagged){replaced ? `, replacing ${replaced} previous line${replaced === 1 ? '' : 's'}` : ''}{typeof r.daysCovered === 'number' ? ` across ${r.daysCovered} day${r.daysCovered === 1 ? '' : 's'}` : ''}.</>
                  })()}
                </div>
              )}
              {(row.status === 'uploading' || row.status === 'pending') && <div style={{ marginTop: 12, fontSize: 13, color: '#888' }}>{row.status === 'uploading' ? '⏳ Uploading' : '• Queued'} {row.name}…</div>}
            </div>
          ))}
          {anyDone && <button onClick={closeAndRefresh} style={{ width: '100%', marginTop: 14, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Done — refresh figures</button>}
        </div>
      </div>
    </div>
  )
}

export default function SyncBar({ show = ['invoices', 'wages', 'bills'], months: defaultMonths = 12, onDone, showBench = false, canUpload = true, compact = true, showPeriod = true }) {
  const [syncing, setSyncing] = useState('')
  const [msg, setMsg] = useState('')
  const [showBills, setShowBills] = useState(false)
  const [status, setStatus] = useState({})
  const [months, setMonths] = useState(defaultMonths)

  async function loadStatus() {
    try { setStatus(await fetch('/api/sync-status').then(r => r.json())) } catch {}
  }
  useEffect(() => { loadStatus() }, [])

  async function runSync(kind, endpoint, label) {
    setSyncing(kind); setMsg('')
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months }) })
      const d = await res.json()
      if (res.ok && d.ok) {
        const detail = kind === 'invoices' ? `${d.invoicesMatched} matched, ${d.invoicesUnassigned} unassigned (of ${d.invoicesFetched})`
          : kind === 'wages' ? `${d.taggedToProjects} tagged, ${d.untagged} unassigned (of ${d.wageLinesFetched})`
          : `${d.monthsPulled} months`
        setMsg(`${label}: ${detail}.`)
        await loadStatus()
        if (onDone) await onDone()
      } else setMsg(d.error || `${label} failed.`)
    } catch (e) { setMsg(`${label} failed.`) }
    setSyncing('')
  }

  const label = { invoices: '↻ Sync Invoices', wages: '↻ Sync Wages', bills: '⬆ Upload Bills' }
  const whenKey = { invoices: 'invoices', wages: 'wages', bills: 'bills' }
  // Most-recent stamp across the shown types, for the compact nav tooltip.
  const stamps = show.map(k => `${k === 'bills' ? 'Bills' : k === 'wages' ? 'Wages' : 'Invoices'}: ${fmtWhen(status[whenKey[k]])}`).join('  ·  ')

  const buttons = (
    <>
      {showPeriod && (show.includes('invoices') || show.includes('wages')) && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#8a8a99', whiteSpace: 'nowrap' }}>Sync last</span>
          <select value={months} onChange={e => setMonths(parseInt(e.target.value))} disabled={!!syncing}
            style={{ background: '#2d2d44', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '5px 6px', fontSize: 12, cursor: syncing ? 'default' : 'pointer' }}>
            {[3, 6, 12, 18, 24].map(m => <option key={m} value={m}>{m} mo</option>)}
          </select>
        </span>
      )}
      {show.includes('invoices') && (
        <button onClick={() => runSync('invoices', '/api/sync-invoices', 'Invoices')} disabled={!!syncing} style={grn(GREENS.invoices, syncing === 'invoices')}>{syncing === 'invoices' ? 'Syncing…' : label.invoices}</button>
      )}
      {show.includes('wages') && (
        <button onClick={() => runSync('wages', '/api/sync-wages', 'Wages')} disabled={!!syncing} style={grn(GREENS.wages, syncing === 'wages')}>{syncing === 'wages' ? 'Syncing…' : label.wages}</button>
      )}
      {show.includes('bills') && canUpload && (
        <button onClick={() => setShowBills(true)} disabled={!!syncing} style={grn(GREENS.bills, false)}>{label.bills}</button>
      )}
      {showBench && (
        <button onClick={() => runSync('benchmark', '/api/sync-benchmark', 'Xero figures')} disabled={!!syncing} style={{ ...grn(XERO_BLUE, syncing === 'benchmark'), background: syncing === 'benchmark' ? '#0d8fbd' : XERO_BLUE }}>{syncing === 'benchmark' ? 'Syncing…' : '↻ Sync Xero figures'}</button>
      )}
    </>
  )

  if (compact) {
    // Inline row suited to a nav bar: buttons + a small visible stamp.
    const newest = show.map(k => status[whenKey[k]]).filter(Boolean).sort().slice(-1)[0]
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={stamps}>
        {buttons}
        <span style={{ fontSize: 10, color: '#8a8a99', whiteSpace: 'nowrap' }}>synced {fmtWhen(newest)}</span>
        {showBills && <BillsUploadModal onClose={() => setShowBills(false)} onUploaded={async () => { await loadStatus(); if (onDone) await onDone() }} />}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{buttons}</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: '#8a8a99' }}>
        {show.map(k => (
          <span key={k}>Last {k === 'bills' ? 'bills upload' : `${k} sync`}: <strong style={{ color: '#6b6b7b' }}>{fmtWhen(status[whenKey[k]])}</strong></span>
        ))}
      </div>
      {msg && <div style={{ fontSize: 12, color: msg.includes('failed') ? '#b91c1c' : '#166534' }}>{msg}</div>}
      {showBills && <BillsUploadModal onClose={() => setShowBills(false)} onUploaded={async () => { await loadStatus(); if (onDone) await onDone() }} />}
    </div>
  )
}
