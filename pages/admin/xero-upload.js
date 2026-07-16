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
          <strong>Xero caps exports at 500 lines.</strong> For a large history (e.g. 3 years), export it in batches — you can select <strong>several files at once</strong> in each box below and they'll all import and merge (deduped), so partial batches build up the full picture without wiping earlier ones. Keep going until everything's in; the nightly sync then keeps it current.
        </div>
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px', marginBottom: 24, fontSize: 13, color: '#1e40af' }}>
          <strong>Select all columns</strong> when running each Xero report before exporting — the app relies on the <strong>Projects</strong> tracking column plus the account/amount columns to allocate costs. If columns are left out, some data won't be captured.
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


function UploadArea({ title, blurb, accept, endpoint, howto, renderResult }) {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState([])   // [{name, status, result, error}]

  async function upload() {
    if (!files.length) return
    setUploading(true)
    const rows = files.map(f => ({ name: f.name, status: 'pending', result: null, error: null }))
    setResults([...rows])
    for (let i = 0; i < files.length; i++) {
      rows[i].status = 'uploading'; setResults([...rows])
      try {
        const fileData = await readB64(files[i])
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileData }) })
        const data = await res.json()
        if (res.ok && data.ok) { rows[i].status = 'done'; rows[i].result = data }
        else { rows[i].status = 'error'; rows[i].error = data.error || 'Upload failed' }
      } catch (e) { rows[i].status = 'error'; rows[i].error = e.message }
      setResults([...rows])
    }
    setUploading(false)
  }

  const inputId = 'f_' + title.replace(/\W/g, '')
  return (
    <div style={cardStyle}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', margin: '0 0 6px' }}>{title}</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px', lineHeight: 1.6 }}>{blurb}</p>
      <label style={labelStyle}>{accept.includes('xlsx') ? 'Excel file(s)' : 'CSV file(s)'} — you can select several (e.g. 500-line batches)</label>
      <div onClick={() => document.getElementById(inputId)?.click()}
        style={{ border: '2px dashed ' + (files.length ? '#bbf7d0' : '#e5e5e5'), borderRadius: 8, padding: 20, textAlign: 'center', cursor: 'pointer', background: files.length ? '#f0fdf4' : '#fafafa', marginBottom: 14 }}>
        <input id={inputId} type="file" accept={accept} multiple style={{ display: 'none' }}
          onChange={e => { setFiles(Array.from(e.target.files || [])); setResults([]) }} />
        <div style={{ fontSize: 13, color: files.length ? '#166534' : '#888' }}>
          {files.length ? `${files.length} file${files.length > 1 ? 's' : ''} selected` : 'Click to select file(s)'}
        </div>
        {files.length > 0 && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{files.map(f => f.name).join(', ')}</div>}
      </div>
      <button onClick={upload} disabled={!files.length || uploading}
        style={{ width: '100%', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 16px', fontSize: 14, fontWeight: 600, cursor: !files.length || uploading ? 'default' : 'pointer', opacity: !files.length || uploading ? 0.5 : 1 }}>
        {uploading ? 'Uploading…' : `Upload ${title}${files.length > 1 ? ` (${files.length} files)` : ''}`}
      </button>

      {results.map((row, i) => (
        <div key={i}>
          {row.status === 'error' && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginTop: 12, fontSize: 13, color: '#b91c1c' }}><strong>{row.name}:</strong> {row.error}</div>}
          {row.status === 'done' && (
            <div style={{ marginTop: 12 }}>
              {results.length > 1 && <div style={{ fontSize: 12, color: '#666', fontWeight: 600, marginBottom: 4 }}>{row.name}</div>}
              {renderResult(row.result)}
            </div>
          )}
          {(row.status === 'uploading' || row.status === 'pending') && <div style={{ marginTop: 12, fontSize: 13, color: '#888' }}>{row.status === 'uploading' ? '⏳ Uploading' : '• Queued'} {row.name}…</div>}
        </div>
      ))}

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
