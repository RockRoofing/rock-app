import { useState, useEffect, useRef } from 'react'
import { upload } from '@vercel/blob/client'
import { compressImage } from '../../lib/compressImage'
import AdminShell from '../../components/AdminShell'

const CATS = [
  { key: 'company', label: 'Company Information' },
  { key: 'guidance', label: 'Operative Guidance Documents' },
]
const INK = '#1a1a19', GOLD = '#ca8a04'

// Admin › Documents — upload, name and manage the Company Information and
// Operative Guidance documents that appear as cards in the Site App.
export default function AdminDocumentsPage() {
  const [docs, setDocs] = useState({ company: [], guidance: [], project: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/ops-docs').then(r => r.json()); setDocs(d.docs || { company: [], guidance: [], project: [] }) } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function persist(next) {
    setDocs(next); setSaving(true)
    try { await fetch('/api/ops-docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs: next }) }) } catch {}
    setSaving(false)
  }

  function addDoc(cat, doc) { persist({ ...docs, [cat]: [...(docs[cat] || []), doc] }) }
  function renameDoc(cat, id, title) { persist({ ...docs, [cat]: docs[cat].map(d => d.id === id ? { ...d, title } : d) }) }
  function removeDoc(cat, id) { persist({ ...docs, [cat]: docs[cat].filter(d => d.id !== id) }) }

  return (
    <AdminShell active="/admin/documents" allow={['management', 'admin']}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, color: INK, margin: '0 0 4px' }}>Documents</h1>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 4px' }}>Upload and name the documents that appear as cards in the Site App.</p>
        {saving && <div style={{ fontSize: 12, color: GOLD, marginBottom: 8 }}>Saving…</div>}

        {loading ? <div style={{ color: '#aaa', padding: 30, textAlign: 'center' }}>Loading…</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28, marginTop: 12 }}>
            {CATS.map(c => (
              <DocSection key={c.key} label={c.label} cat={c.key} items={docs[c.key] || []}
                onAdd={doc => addDoc(c.key, doc)} onRename={(id, t) => renameDoc(c.key, id, t)} onRemove={id => removeDoc(c.key, id)} />
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  )
}

function DocSection({ label, cat, items, onAdd, onRename, onRemove }) {
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef()

  async function doUpload() {
    if (!file) { setErr('Choose a file first.'); return }
    if (!title.trim()) { setErr('Give the document a name.'); return }
    setUploading(true); setErr('')
    try {
      // Compress if it's an image; PDFs and other files pass through untouched.
      const toUpload = await compressImage(file)
      // Direct browser -> Blob upload (no 4.5MB serverless limit).
      const blob = await upload(toUpload.name, toUpload, {
        access: 'public',
        handleUploadUrl: '/api/blob-upload',
        contentType: toUpload.type || undefined,
      })
      onAdd({ id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, title: title.trim(), url: blob.url, contentType: toUpload.type, uploadedAt: Date.now() })
      clearFile()
      setTitle('')
    } catch (e) { setErr(e?.message || 'Upload failed') }
    setUploading(false)
  }

  function clearFile() { setFile(null); if (fileRef.current) fileRef.current.value = '' }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: GOLD, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>

      {/* Existing cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12, marginBottom: 14 }}>
        {items.length === 0 && <div style={{ color: '#aaa', fontSize: 13 }}>No documents yet.</div>}
        {items.map(d => (
          <div key={d.id} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ fontSize: 22 }}>📄</div>
              <input value={d.title} onChange={e => onRename(d.id, e.target.value)}
                style={{ flex: 1, border: 'none', borderBottom: '1px solid transparent', fontSize: 14, fontWeight: 600, color: INK, fontFamily: 'inherit', outline: 'none', background: 'transparent' }}
                onFocus={e => e.target.style.borderBottomColor = '#e0e0e0'} onBlur={e => e.target.style.borderBottomColor = 'transparent'} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: '#2a78d6', textDecoration: 'none' }}>View</a>
              <button onClick={() => { if (confirm('Delete this document?')) onRemove(d.id) }} style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 12.5, cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      {/* Upload new — one file at a time */}
      <div style={{ background: '#faf9f7', border: '1px dashed #d9d5cc', borderRadius: 12, padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Document name (shown on the card)" style={{ flex: '1 1 220px', padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
        {!file ? (
          <button onClick={() => fileRef.current?.click()} style={{ background: '#fff', border: '1px solid #d0d0cc', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#555' }}>Choose file</button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, color: '#333', maxWidth: 260 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
            <button onClick={clearFile} title="Clear" style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
        )}
        <input ref={fileRef} type="file" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
        <button onClick={doUpload} disabled={uploading || !file} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: uploading || !file ? 'default' : 'pointer', opacity: uploading || !file ? 0.5 : 1 }}>{uploading ? 'Uploading…' : 'Upload'}</button>
        {err && <div style={{ color: '#dc2626', fontSize: 12.5, flexBasis: '100%' }}>{err}</div>}
      </div>
    </div>
  )
}
