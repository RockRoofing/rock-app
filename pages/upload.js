import { useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'

export default function UploadPage() {
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setResult(null)
    setError(null)
    try {
      const text = await file.text()
      const res = await fetch('/api/upload-bills', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: text
      })
      const data = await res.json()
      if (data.error) setError(data.error)
      else setResult(data)
    } catch (e) {
      setError(e.message)
    }
    setUploading(false)
    e.target.value = ''
  }

  return (
    <>
      <Head><title>Upload Bills — Rock Roofing</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <div style={{ background: '#1a1a2e', padding: '0 24px' }}>
          <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 16 }}>Rock Roofing Ltd</span>
            </div>
            <Link href="/commercial" style={{ color: '#aaa', fontSize: 13 }}>← Budget Tracker</Link>
          </div>
        </div>

        <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 24px' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 40, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Upload Xero Bills Export</h1>
            <p style={{ color: '#666', marginBottom: 32, fontSize: 14, lineHeight: 1.6 }}>
              Export bills from Xero (Purchases → Bills → Export) and upload the CSV here. 
              You can upload multiple files — data will be merged. Upload in batches of 500 to cover all historical data.
            </p>

            <div style={{ border: '2px dashed #e5e5e5', borderRadius: 10, padding: 40, textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
              <p style={{ color: '#555', marginBottom: 16, fontSize: 14 }}>Select a CSV file exported from Xero</p>
              <label style={{ background: '#1a1a2e', color: '#fff', padding: '10px 24px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>
                {uploading ? 'Processing...' : 'Choose CSV file'}
                <input type="file" accept=".csv" onChange={handleUpload} disabled={uploading} style={{ display: 'none' }} />
              </label>
            </div>

            {result && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 20, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, color: '#16a34a', marginBottom: 8 }}>✓ Upload successful</div>
                <div style={{ fontSize: 13, color: '#555' }}>
                  <div>Lines processed: {result.linesProcessed}</div>
                  <div>Cost entries matched to projects: {result.matchedLines}</div>
                  <div>Projects updated: {result.projectsUpdated}</div>
                  <div>Labour total: £{result.labourTotal?.toLocaleString()}</div>
                  <div>Materials total: £{result.materialsTotal?.toLocaleString()}</div>
                </div>
              </div>
            )}

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 20, color: '#e63946', fontSize: 13 }}>
                Error: {error}
              </div>
            )}

            <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 16, fontSize: 13, color: '#666' }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#333' }}>How to export from Xero:</div>
              <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}>
                <li>Go to Xero → Purchases → Bills</li>
                <li>Filter by date range (max 500 bills per export)</li>
                <li>Click Export → CSV</li>
                <li>Upload the file here</li>
                <li>Repeat for each date range until all historical data is uploaded</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
