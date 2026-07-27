import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { upload } from '@vercel/blob/client'
import { useDesignAuth, DesignNav, DesignProjectPicker, PURPLE, INK } from '../lib/designShell'

const fmtSize = (b) => { if (!b) return ''; const k = b / 1024; return k < 1024 ? `${Math.round(k)} KB` : `${(k / 1024).toFixed(1)} MB` }
const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

// Shared page used by Warranties, O&Ms, Calculations, Tech Sub (view), Leak Test Certs.
// props: pageKey, category, title, intro, accept, techSub (bool - show revised/current)
export default function DesignDocsPage({ pageKey, category, title, intro, accept = 'application/pdf,image/*,.dwg', techSub = false }) {
  const router = useRouter()
  const auth = useDesignAuth()
  const [projectNo, setProjectNo] = useState('')
  const [files, setFiles] = useState([])
  const [canUpload, setCanUpload] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState(null)
  const inputRef = useRef()

  // Restore/remember selected project in the URL.
  useEffect(() => { if (auth.ready && router.query.project) setProjectNo(String(router.query.project)) }, [auth.ready])
  useEffect(() => { if (projectNo) load() }, [projectNo])

  function pickProject(no) {
    setProjectNo(no)
    router.replace({ pathname: router.pathname, query: no ? { project: no } : {} }, undefined, { shallow: true })
  }

  async function load() {
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/design-files?no=${encodeURIComponent(projectNo)}&cat=${category}`)
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Could not load'); setFiles([]); setCanUpload(false) }
      else { setFiles(d.files || []); setCanUpload(!!d.canUpload) }
    } catch { setErr('Could not load') }
    setLoading(false)
  }

  async function handleFiles(list) {
    if (!list || !list.length || !projectNo) return
    setErr(''); setUploading(true)
    let failed = 0, lastErr = ''
    for (const file of Array.from(list)) {
      try {
        const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/blob-upload', contentType: file.type || 'application/octet-stream' })
        const r = await fetch('/api/design-files', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectNo, category, file: { name: file.name, url: blob.url, contentType: file.type || '', size: file.size } }),
        })
        if (!r.ok) { const d = await r.json().catch(() => ({})); failed++; lastErr = d.error || `HTTP ${r.status}` }
      } catch (e) { failed++; lastErr = e?.message || String(e) }
    }
    if (inputRef.current) inputRef.current.value = ''
    setUploading(false)
    if (failed) setErr(`${failed} file(s) failed. ${lastErr}`)
    load()
  }

  async function del(id) {
    if (!confirm('Delete this document?')) return
    await fetch('/api/design-files', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, category, id }) })
    load()
  }
  async function setCurrent(id) {
    await fetch('/api/design-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, category, id, action: 'set-current' }) })
    load()
  }

  if (!auth.ready) return null
  const currentTechSub = techSub ? files.find(f => !f.revised) : null

  return (
    <>
      <Head><title>{title} — Design</title></Head>
      <DesignNav active={pageKey} isInternal={auth.isInternal} />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '22px 20px 60px' }}>
        <h1 style={{ margin: '0 0 2px', color: INK, fontSize: 24 }}>{title}</h1>
        {intro && <p style={{ color: '#8a857c', fontSize: 14, marginTop: 2 }}>{intro}</p>}

        <div style={{ margin: '16px 0 20px' }}>
          <DesignProjectPicker projects={auth.projects} value={projectNo} onChange={pickProject} />
        </div>

        {!projectNo ? (
          <div style={{ color: '#aaa', fontSize: 14, padding: 30, textAlign: 'center', background: '#faf9fd', borderRadius: 12 }}>Select a project to view its {title.toLowerCase()}.</div>
        ) : (
          <>
            {canUpload && (
              <div style={{ marginBottom: 16 }}>
                <input ref={inputRef} type="file" accept={accept} multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
                <button onClick={() => inputRef.current?.click()} disabled={uploading}
                  style={{ background: PURPLE, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', opacity: uploading ? 0.6 : 1 }}>
                  {uploading ? 'Uploading…' : `+ Upload ${techSub ? 'new Tech Sub' : 'document(s)'}`}
                </button>
                {techSub && <span style={{ fontSize: 12.5, color: '#8a857c', marginLeft: 10 }}>Uploading a new Tech Sub marks the previous one as revised.</span>}
              </div>
            )}
            {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>{err}</div>}

            {/* Tech Sub: show the current one in a viewer above the table */}
            {techSub && currentTechSub && (
              <div style={{ marginBottom: 18, border: '1px solid #ece9f5', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ background: '#faf9fd', padding: '10px 14px', fontSize: 13.5, fontWeight: 700, color: INK, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Current: {currentTechSub.name}</span>
                  <a href={`/api/download?url=${encodeURIComponent(currentTechSub.url)}&name=${encodeURIComponent(currentTechSub.name)}&inline=1`} target="_blank" rel="noreferrer" style={{ color: PURPLE, fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>Open ↗</a>
                </div>
                <iframe src={`/api/download?url=${encodeURIComponent(currentTechSub.url)}&name=${encodeURIComponent(currentTechSub.name)}&inline=1`} style={{ width: '100%', height: 520, border: 'none' }} />
              </div>
            )}

            {loading ? <div style={{ color: '#999', padding: 20 }}>Loading…</div> : (
              <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                  <thead><tr style={{ background: '#faf9f7' }}>
                    <th style={th}>Document</th>
                    {techSub && <th style={th}>Status</th>}
                    <th style={th}>Uploaded by</th>
                    <th style={th}>Date</th>
                    <th style={th}>Size</th>
                    <th style={{ ...th, textAlign: 'right' }}></th>
                  </tr></thead>
                  <tbody>
                    {files.map(f => (
                      <tr key={f.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                        <td style={td}><strong>{f.name}</strong></td>
                        {techSub && <td style={td}>{f.revised ? <span style={{ color: '#b45309', background: '#fef3c7', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>Revised</span> : <span style={{ color: '#16a34a', background: '#dcfce7', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>Current</span>}</td>}
                        <td style={td}>{f.uploadedBy || '—'}</td>
                        <td style={td}>{fmtDate(f.uploadedAt)}</td>
                        <td style={td}>{fmtSize(f.size)}</td>
                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <a href={`/api/download?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name)}&inline=1`} target="_blank" rel="noreferrer" style={linkA}>View</a>
                          <a href={`/api/download?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name)}`} style={linkA}>Download</a>
                          {canUpload && techSub && f.revised && <button onClick={() => setCurrent(f.id)} style={linkBtn}>Make current</button>}
                          {canUpload && <button onClick={() => del(f.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>}
                        </td>
                      </tr>
                    ))}
                    {!files.length && <tr><td colSpan={techSub ? 6 : 5} style={{ ...td, textAlign: 'center', color: '#aaa', padding: 26 }}>No documents yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#8a857c', fontWeight: 600, whiteSpace: 'nowrap' }
const td = { padding: '10px 12px', verticalAlign: 'middle' }
const linkA = { color: PURPLE, textDecoration: 'none', fontSize: 13, marginLeft: 12, fontWeight: 600 }
const linkBtn = { background: 'none', border: 'none', color: PURPLE, cursor: 'pointer', fontSize: 13, marginLeft: 12, fontWeight: 600 }
