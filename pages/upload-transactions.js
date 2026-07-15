import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'

const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)

export default function UploadPage() {
  const [projects, setProjects] = useState([])

  // Costs state
  const [costsProject, setCostsProject] = useState('')
  const [costsFile, setCostsFile] = useState(null)
  const [costsUploading, setCostsUploading] = useState(false)
  const [costsResult, setCostsResult] = useState(null)
  const [costsError, setCostsError] = useState(null)

  // Invoices state
  const [invoicesFile, setInvoicesFile] = useState(null)
  const [invoicesUploading, setInvoicesUploading] = useState(false)
  const [invoicesResult, setInvoicesResult] = useState(null)
  const [invoicesError, setInvoicesError] = useState(null)

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(d => setProjects(d.projects || []))
      .catch(() => {})
  }, [])

  async function handleCostsUpload() {
    if (!costsFile || !costsProject) return
    setCostsUploading(true)
    setCostsResult(null)
    setCostsError(null)
    try {
      const reader = new FileReader()
      reader.onload = async (e) => {
        const base64 = e.target.result.split(',')[1]
        const res = await fetch('/api/upload-transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: base64, projectId: costsProject, fileName: costsFile.name })
        })
        const data = await res.json()
        if (data.ok) setCostsResult(data)
        else setCostsError(data.error || 'Upload failed')
        setCostsUploading(false)
      }
      reader.readAsDataURL(costsFile)
    } catch (e) { setCostsError(e.message); setCostsUploading(false) }
  }

  async function handleInvoicesUpload() {
    if (!invoicesFile) return
    setInvoicesUploading(true)
    setInvoicesResult(null)
    setInvoicesError(null)
    try {
      const reader = new FileReader()
      reader.onload = async (e) => {
        const base64 = e.target.result.split(',')[1]
        // Bulk importer: parses the whole Sales Invoices export and matches each
        // invoice to its project automatically (all projects in one upload).
        const res = await fetch('/api/import-invoices-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: base64 })
        })
        const data = await res.json()
        if (res.ok && data.ok) setInvoicesResult(data)
        else setInvoicesError(data.error || 'Upload failed')
        setInvoicesUploading(false)
      }
      reader.readAsDataURL(invoicesFile)
    } catch (e) { setInvoicesError(e.message); setInvoicesUploading(false) }
  }

  const cardStyle = { background: '#fff', borderRadius: 12, padding: 32, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 20 }
  const labelStyle = { fontSize: 12, color: '#666', display: 'block', marginBottom: 6, fontWeight: 600 }
  const selectStyle = { width: '100%', padding: '9px 12px', border: '1px solid #e5e5e5', borderRadius: 8, fontSize: 14, background: '#fff', marginBottom: 16 }

  function FileDropzone({ file, setFile, accept, inputId }) {
    return (
      <div
        style={{ border: '2px dashed #e5e5e5', borderRadius: 8, padding: '20px', textAlign: 'center', cursor: 'pointer', background: file ? '#f0fdf4' : '#fafafa', borderColor: file ? '#bbf7d0' : '#e5e5e5', marginBottom: 16 }}
        onClick={() => document.getElementById(inputId).click()}
      >
        <input id={inputId} type="file" accept={accept} style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
        {file ? (
          <div>
            <div style={{ fontSize: 20, marginBottom: 4 }}>✓</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>{file.name}</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{(file.size / 1024).toFixed(0)} KB — click to change</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 28, marginBottom: 6 }}>📊</div>
            <div style={{ fontSize: 13, color: '#555' }}>Click to select file</div>
          </div>
        )}
      </div>
    )
  }

  function UploadButton({ onClick, disabled, uploading, label }) {
    return (
      <button onClick={onClick} disabled={disabled || uploading} style={{ width: '100%', background: disabled ? '#e5e5e5' : '#1a1a2e', color: disabled ? '#999' : '#fff', border: 'none', borderRadius: 8, padding: '11px', fontSize: 14, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' }}>
        {uploading ? 'Uploading...' : label}
      </button>
    )
  }

  function ErrorBox({ error }) {
    if (!error) return null
    return <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', color: '#e63946', fontSize: 13, marginTop: 12 }}>✕ {error}</div>
  }

  function CostsResult({ result }) {
    if (!result) return null
    return (
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 20, marginTop: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#16a34a', marginBottom: 12 }}>✓ Costs uploaded successfully</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: '#888' }}>Transactions</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{result.transactions}</div>
          </div>
          <div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: '#888' }}>Labour</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{fmt(result.labourTotal)}</div>
          </div>
          <div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: '#888' }}>Materials</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{fmt(result.materialsTotal)}</div>
          </div>
        </div>
        <div style={{ marginTop: 10, background: '#fff', borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: '#888' }}>Total costs</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmt(result.total)}</div>
        </div>
      </div>
    )
  }

  function InvoicesResult({ result }) {
    if (!result) return null
    const totalInvoiced = (result.summary || []).reduce((s, r) => s + (r.invoiced || 0), 0)
    return (
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 20, marginTop: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#16a34a', marginBottom: 12 }}>✓ Invoices imported successfully</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: '#888' }}>Invoices processed</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{result.totalInvoicesProcessed ?? 0}</div>
          </div>
          <div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: '#888' }}>Projects matched</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{result.projectsMatched ?? 0}</div>
          </div>
          <div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: '#888' }}>Total invoiced</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{fmt(totalInvoiced)}</div>
          </div>
        </div>
        {result.projectsUnmatched > 0 && (
          <div style={{ fontSize: 12, color: '#b45309', marginTop: 10 }}>
            {result.projectsUnmatched} invoice group(s) couldn't be matched to a project (their tracking category didn't match a known project). They were skipped.
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <Head><title>Rock Roofing — Data Upload</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <div style={{ background: '#1a1a2e', padding: '0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Link href="/" style={{ color: '#888', fontSize: 13 }}>← Portal</Link>
              <span style={{ color: '#444' }}>|</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 6 }} />
                <span style={{ color: '#fff', fontWeight: 600, fontSize: 16 }}>Data Upload</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 24px' }}>

          {/* Section 1: Cost Transactions */}
          <div style={cardStyle}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', margin: '0 0 4px' }}>Cost Transactions</h2>
            <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>
              Upload the Xero <strong>Account Transactions</strong> report for a project (Excel). This captures <strong>all project costs</strong> — materials, subcontractor labour (321) and direct wages (321/320) — in one file, split into Labour vs Materials automatically.
            </p>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: 12, color: '#92400e' }}>
              <strong>Important:</strong> when you run the report, make sure <strong>all cost accounts are included</strong> — especially Direct Wages (320), CIS Labour Expense (321) and your materials accounts (e.g. 311) — otherwise those costs won't be captured. Selecting "All accounts" (or all cost accounts) is safest.
            </div>
            <label style={labelStyle}>Project</label>
            <select value={costsProject} onChange={e => setCostsProject(e.target.value)} style={selectStyle}>
              <option value="">— Select project —</option>
              {projects.map(p => <option key={p.xeroId} value={p.xeroId}>{p.jobNo} — {p.name}</option>)}
            </select>
            <label style={labelStyle}>Excel file (.xlsx)</label>
            <FileDropzone file={costsFile} setFile={setCostsFile} accept=".xlsx,.xls" inputId="costsFile" />
            <UploadButton onClick={handleCostsUpload} disabled={!costsFile || !costsProject} uploading={costsUploading} label={`Upload Costs${costsProject ? ' for ' + (projects.find(p => p.xeroId === costsProject)?.jobNo || '') : ''}`} />
            <ErrorBox error={costsError} />
            <CostsResult result={costsResult} />
            <div style={{ marginTop: 12, fontSize: 12, color: '#888', lineHeight: 1.6 }}>
              <strong>How to run the report:</strong><br />
              1. Accounting → Reports → <strong>Account Transactions</strong><br />
              2. Filter by the <strong>Projects</strong> tracking category and pick the project<br />
              3. Set a date range wide enough to catch late/backdated entries (e.g. project start → today)<br />
              4. Under accounts, include <strong>all cost accounts</strong> (materials, 320 Direct Wages, 321 CIS Labour)<br />
              5. Export → <strong>Excel</strong>, then upload here.
            </div>
          </div>

          {/* Section 2: Sales Invoices (all projects, bulk) */}
          <div style={cardStyle}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', margin: '0 0 4px' }}>Sales Invoices</h2>
            <p style={{ fontSize: 13, color: '#888', margin: '0 0 20px' }}>
              Upload the Xero Sales Invoices CSV export containing <strong>all</strong> invoices. The system matches each invoice to its project automatically — no need to pick a project. Feeds the Retention Tracker and Outstanding Invoices. Re-uploading simply refreshes the figures (no duplicates).
            </p>
            <label style={labelStyle}>CSV file (.csv)</label>
            <FileDropzone file={invoicesFile} setFile={setInvoicesFile} accept=".csv" inputId="invoicesFile" />
            <UploadButton onClick={handleInvoicesUpload} disabled={!invoicesFile} uploading={invoicesUploading} label="Upload Invoices" />
            <ErrorBox error={invoicesError} />
            <InvoicesResult result={invoicesResult} />
            <div style={{ marginTop: 12, fontSize: 12, color: '#888', lineHeight: 1.6 }}>
              <strong>How to run the report:</strong><br />
              1. Accounting → <strong>Sales Invoices</strong> (or Business → Invoices)<br />
              2. Set the status/date filter to include <strong>all invoices you want reflected</strong> (a wide range is fine — the app de-duplicates)<br />
              3. Export → <strong>CSV</strong>, then upload here.<br />
              <span style={{ color: '#aaa' }}>The file should contain every invoice; the app matches each to its project by the tracking category and overwrites previous figures (no duplicates).</span>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
