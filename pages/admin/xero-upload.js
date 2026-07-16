import { useState, useEffect } from 'react'
import AdminShell from '../../components/AdminShell'

const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n || 0)
const cardStyle = { background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, padding: 24, marginBottom: 20 }
const labelStyle = { fontSize: 12, color: '#666', display: 'block', marginBottom: 6, fontWeight: 600 }

// Read a File -> base64 (no data: prefix)
function readB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = () => reject(new Error('Could not read file'))
    r.readAsDataURL(file)
  })
}

export default function XeroUploadPage() {
  return (
    <AdminShell active="/admin/xero-upload" title="Xero Upload">
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, color: '#1a1a19', margin: '0 0 6px' }}>Xero Upload</h1>
        <p style={{ color: '#777', fontSize: 14, margin: '0 0 16px' }}>
          Upload your Xero exports here to refresh project costs and invoices. All three are <strong>all-projects</strong> uploads — each file contains every project and the app matches each line to its project by the Xero tracking category. Uploads <strong>accumulate</strong>: they add new transactions and refresh existing ones, and de-duplicate so nothing is counted twice.
        </p>
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 14px', marginBottom: 24, fontSize: 13, color: '#92400e' }}>
          <strong>Xero caps exports at 500 lines.</strong> For a large history (e.g. 3 years), just export it in batches and upload each one — the uploads <strong>merge together</strong> (deduped), so several partial uploads build up the full picture without wiping earlier ones. Keep going until everything's in; the nightly sync then keeps it current.
        </div>
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px', marginBottom: 24, fontSize: 13, color: '#1e40af' }}>
          <strong>Select all columns</strong> when running each Xero report before exporting — the app relies on the <strong>Projects</strong> tracking column plus the account/amount columns to allocate costs. If columns are left out, some data won't be captured.
        </div>

        <MultiUpload />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '28px 0 20px' }}>
          <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
          <span style={{ fontSize: 12, color: '#aaa' }}>or upload one type at a time</span>
          <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
        </div>

        <UploadArea
          title="Bills (Costs)"
          blurb={<>Upload the Xero <strong>Bills</strong> export (CSV) containing all bills. Captures <strong>materials</strong> and <strong>subcontractor labour</strong> for every project, split by the account categorisation. Doesn't include PAYE Direct Wages — upload those below.</>}
          accept=".csv"
          endpoint="/api/import-bills-bulk"
          howto={<>Business → <strong>Bills to pay</strong> → export (or Accounting → Reports → Payable Invoice Detail) → include the Projects tracking category → Export <strong>CSV</strong>.</>}
          renderResult={(r) => <CostResult r={r} label="bills" />}
        />

        <UploadArea
          title="Direct Wages"
          blurb={<>Upload the Xero <strong>Account Transactions</strong> export for <strong>Direct Wages (320)</strong> (Excel). Captures PAYE/direct labour for every project, matched by the <strong>Projects</strong> tracking column on each line. Only project-tagged lines are imported (the pool/contra lines are ignored automatically).</>}
          accept=".xlsx,.xls"
          endpoint="/api/import-wages-bulk"
          howto={<>Accounting → Reports → <strong>Account Transactions</strong> → account <strong>320 Direct Wages</strong> → set the date range → <strong>select ALL columns</strong> (so the "Projects" tracking column is included) → Export <strong>Excel</strong>.</>}
          renderResult={(r) => <CostResult r={r} label="wages" />}
        />

        <UploadArea
          title="Sales Invoices"
          blurb={<>Upload the Xero <strong>Sales Invoices</strong> export (CSV) containing all invoices. Feeds the Retention Tracker and Outstanding Invoices. Matched to each project automatically.</>}
          accept=".csv"
          endpoint="/api/import-invoices-bulk"
          howto={<>Accounting → <strong>Sales Invoices</strong> → set a wide status/date filter → Export <strong>CSV</strong>.</>}
          renderResult={(r) => <InvoiceResult r={r} />}
        />
      </div>
    </AdminShell>
  )
}


// Upload several Xero exports at once — auto-detects each file's type and routes
// it to the right importer (xlsx -> Wages; CSV with "Bill" rows -> Bills;
// CSV with "Sales invoice"/"Credit note" rows -> Sales Invoices).
function MultiUpload() {
  const [items, setItems] = useState([])   // [{name, status, kind, result, error}]
  const [busy, setBusy] = useState(false)

  async function detectKind(file) {
    const name = (file.name || '').toLowerCase()
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'wages'
    // CSV: read the header + a chunk, find the "Type" column, and inspect its values.
    const text = await file.slice(0, 300000).text().catch(() => '')
    const lines = text.split(/\r?\n/).filter(Boolean)
    if (!lines.length) return 'bills'
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase())
    const typeIdx = headers.indexOf('type')
    if (typeIdx !== -1) {
      let sales = 0, bills = 0
      for (let i = 1; i < Math.min(lines.length, 60); i++) {
        const cells = lines[i].split(',')
        const t = (cells[typeIdx] || '').replace(/^"|"$/g, '').trim().toLowerCase()
        if (t.startsWith('sales')) sales++
        else if (t.startsWith('bill')) bills++
      }
      if (sales > bills) return 'invoices'
      if (bills > 0) return 'bills'
    }
    // Fallback if there's no Type column: filename hint, else bills.
    if (name.includes('salesinvoice') || name.includes('sales_invoice') || name.includes('invoice')) return 'invoices'
    return 'bills'
  }

  const endpointFor = (kind) => kind === 'wages' ? '/api/import-wages-bulk' : kind === 'invoices' ? '/api/import-invoices-bulk' : '/api/import-bills-bulk'
  const labelFor = (kind) => kind === 'wages' ? 'Direct Wages' : kind === 'invoices' ? 'Sales Invoices' : 'Bills (Costs)'

  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setBusy(true)
    const next = files.map(f => ({ name: f.name, status: 'pending', kind: null, result: null, error: null }))
    setItems(next)

    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      try {
        const kind = await detectKind(f)
        next[i] = { ...next[i], kind, status: 'uploading' }
        setItems([...next])
        const fileData = await readB64(f)
        const res = await fetch(endpointFor(kind), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileData }) })
        const data = await res.json()
        if (res.ok && data.ok) next[i] = { ...next[i], status: 'done', result: data }
        else next[i] = { ...next[i], status: 'error', error: data.error || 'Upload failed' }
      } catch (e) { next[i] = { ...next[i], status: 'error', error: e.message } }
      setItems([...next])
    }
    setBusy(false)
  }

  return (
    <div style={{ ...cardStyle, border: '2px solid #1a1a2e' }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', margin: '0 0 6px' }}>Upload all files at once</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px', lineHeight: 1.6 }}>
        Drop or select your Bills, Sales Invoices and Direct Wages exports together — each file is detected and imported automatically. (Bills &amp; Sales are CSV; Direct Wages is Excel.)
      </p>
      <div onClick={() => !busy && document.getElementById('multi_files')?.click()}
        style={{ border: '2px dashed #c7c7cc', borderRadius: 8, padding: 24, textAlign: 'center', cursor: busy ? 'default' : 'pointer', background: '#fafafa', marginBottom: 14 }}>
        <input id="multi_files" type="file" accept=".csv,.xlsx,.xls" multiple style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)} />
        <div style={{ fontSize: 14, color: '#555', fontWeight: 600 }}>{busy ? 'Uploading…' : 'Click to select multiple files'}</div>
        <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>You can select Bills, Sales Invoices and Direct Wages all together</div>
      </div>

      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, background: it.status === 'error' ? '#fef2f2' : it.status === 'done' ? '#f0fdf4' : '#f7f7f8', border: '1px solid ' + (it.status === 'error' ? '#fecaca' : it.status === 'done' ? '#bbf7d0' : '#eee') }}>
              <span style={{ fontSize: 16 }}>{it.status === 'done' ? '✓' : it.status === 'error' ? '✕' : it.status === 'uploading' ? '⏳' : '•'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                <div style={{ fontSize: 12, color: '#888' }}>
                  {it.kind ? labelFor(it.kind) : 'detecting…'}
                  {it.status === 'done' && it.result && ' · ' + resultSummary(it.kind, it.result)}
                  {it.status === 'error' && ' · ' + it.error}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function resultSummary(kind, r) {
  if (kind === 'invoices') return `${r.newInvoices ?? 0} new, ${r.updatedInvoices ?? 0} updated`
  const parts = [`${r.newLinesAdded ?? 0} new`]
  if (r.untaggedLines > 0) parts.push(`${r.untaggedLines} untagged`)
  if (r.projectsUnmatched > 0) parts.push(`${r.projectsUnmatched} archived/unmatched`)
  return parts.join(', ')
}

function UploadArea({ title, blurb, accept, endpoint, howto, renderResult }) {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function upload() {
    if (!file) return
    setUploading(true); setResult(null); setError(null)
    try {
      const fileData = await readB64(file)
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileData }) })
      const data = await res.json()
      if (res.ok && data.ok) setResult(data)
      else setError(data.error || 'Upload failed')
    } catch (e) { setError(e.message) }
    setUploading(false)
  }

  return (
    <div style={cardStyle}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', margin: '0 0 6px' }}>{title}</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px', lineHeight: 1.6 }}>{blurb}</p>
      <label style={labelStyle}>CSV file (.csv)</label>
      <div onClick={() => document.getElementById('f_' + title)?.click()}
        style={{ border: '2px dashed ' + (file ? '#bbf7d0' : '#e5e5e5'), borderRadius: 8, padding: 20, textAlign: 'center', cursor: 'pointer', background: file ? '#f0fdf4' : '#fafafa', marginBottom: 14 }}>
        <input id={'f_' + title} type="file" accept={accept} style={{ display: 'none' }} onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); setError(null) }} />
        <div style={{ fontSize: 13, color: file ? '#166534' : '#888' }}>{file ? file.name : 'Click to select file'}</div>
      </div>
      <button onClick={upload} disabled={!file || uploading}
        style={{ width: '100%', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 16px', fontSize: 14, fontWeight: 600, cursor: !file || uploading ? 'default' : 'pointer', opacity: !file || uploading ? 0.5 : 1 }}>
        {uploading ? 'Uploading…' : 'Upload ' + title}
      </button>
      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginTop: 12, fontSize: 13, color: '#b91c1c' }}>{error}</div>}
      {result && renderResult(result)}
      <div style={{ marginTop: 12, fontSize: 12, color: '#999', lineHeight: 1.6 }}><strong>How to export:</strong> {howto}</div>
    </div>
  )
}

function CostResult({ r, label }) {
  return (
    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 16, marginTop: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#16a34a', marginBottom: 10 }}>✓ {label === 'wages' ? 'Wages' : 'Bills'} imported</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Stat label="New lines added" value={r.newLinesAdded ?? r.totalLinesProcessed ?? 0} />
        <Stat label="Projects matched" value={r.projectsMatched ?? 0} />
        <Stat label="Total costs" value={fmt(r.totalCosts)} />
      </div>
      {r.projectsUnmatched > 0 && <div style={{ fontSize: 12, color: '#b45309', marginTop: 10 }}>{r.projectsUnmatched} project tag(s) didn't match a current project (e.g. archived) and were skipped.</div>}
      {r.untaggedLines > 0 && <div style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>{r.untaggedLines} line(s) had no project tag ({r.untaggedAdded ?? 0} new) — captured under Bookkeeping → {label === 'wages' ? 'Direct Wages' : 'Costs (Bills)'} as unassigned.</div>}
      {(r.newLinesAdded === 0 && (r.untaggedLines > 0 || r.projectsUnmatched > 0)) && <div style={{ fontSize: 12, color: '#555', marginTop: 8 }}>0 added to projects here doesn't mean nothing imported — these lines are either already present, untagged, or tied to archived projects. See Bookkeeping for untagged items.</div>}
    </div>
  )
}
function InvoiceResult({ r }) {
  const totalInvoiced = (r.summary || []).reduce((s, x) => s + (x.invoiced || 0), 0)
  return (
    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 16, marginTop: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#16a34a', marginBottom: 10 }}>✓ Invoices imported</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Stat label="New added" value={r.newInvoices ?? r.totalInvoicesProcessed ?? 0} />
        <Stat label="Updated (already had)" value={r.updatedInvoices ?? 0} />
        <Stat label="Total invoiced" value={fmt(totalInvoiced)} />
      </div>
      {r.projectsUnmatched > 0 && <div style={{ fontSize: 12, color: '#b45309', marginTop: 10 }}>{r.projectsUnmatched} project tag(s) didn't match and were skipped.</div>}
    </div>
  )
}
function Stat({ label, value }) {
  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
    </div>
  )
}
