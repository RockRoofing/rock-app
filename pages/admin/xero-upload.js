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
        <p style={{ color: '#777', fontSize: 14, margin: '0 0 24px' }}>
          Upload your Xero exports here to refresh project costs and invoices. All three are <strong>all-projects</strong> uploads — each file contains every project and the app matches each line to its project by the Xero tracking category. Re-uploading refreshes the figures (no duplicates).
        </p>

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
          blurb={<>Upload the Xero <strong>Account Transactions</strong> export (CSV) for <strong>Direct Wages (320)</strong>. Captures PAYE/direct labour for every project, matched by the tracking category on each wage line.</>}
          accept=".csv"
          endpoint="/api/import-wages-bulk"
          howto={<>Accounting → Reports → <strong>Account Transactions</strong> → filter to account <strong>320 Direct Wages</strong> → make sure it's grouped/shown by the Projects tracking category → Export <strong>CSV</strong>.</>}
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
        <Stat label="Lines" value={r.totalLinesProcessed ?? 0} />
        <Stat label="Projects matched" value={r.projectsMatched ?? 0} />
        <Stat label="Total costs" value={fmt(r.totalCosts)} />
      </div>
      {r.projectsUnmatched > 0 && <div style={{ fontSize: 12, color: '#b45309', marginTop: 10 }}>{r.projectsUnmatched} project tag(s) didn't match a project and were skipped.</div>}
    </div>
  )
}
function InvoiceResult({ r }) {
  const totalInvoiced = (r.summary || []).reduce((s, x) => s + (x.invoiced || 0), 0)
  return (
    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 16, marginTop: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#16a34a', marginBottom: 10 }}>✓ Invoices imported</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Stat label="Invoices" value={r.totalInvoicesProcessed ?? 0} />
        <Stat label="Projects matched" value={r.projectsMatched ?? 0} />
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
