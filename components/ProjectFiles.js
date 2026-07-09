import { useState, useEffect, useRef } from 'react'
import { upload } from '@vercel/blob/client'
import { INK, GOLD, Loading, EmptyCard, primaryBtn, linkBtn } from './opsUI'

// Reusable file manager for a project + category (drawing | rams | handover).
// Upload PDFs/images, view inline, download, delete.
export default function ProjectFiles({ projectNo, category, title, note, accept = 'application/pdf,image/*', readOnly = false }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState(null)
  const inputRef = useRef()

  useEffect(() => { load() }, [projectNo, category])
  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/project-files?no=${encodeURIComponent(projectNo)}&cat=${category}`)
      const d = await r.json(); setFiles(d.files || [])
    } catch {}
    setLoading(false)
  }

  async function handleFiles(fileList) {
    if (!fileList || !fileList.length) return
    setErr(''); setUploading(true)
    let failed = 0
    let lastErr = ''
    for (const file of Array.from(fileList)) {
      try {
        // Upload bytes directly to Blob (bypasses the 4.5MB function limit)
        const blob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/upload-file',
          contentType: file.type || undefined,
        })
        await fetch('/api/project-files', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectNo, file: { category, name: file.name, url: blob.url, contentType: file.type, size: file.size } }),
        })
      } catch (e) { console.error(e); failed++; lastErr = e?.message || String(e) }
    }
    if (inputRef.current) inputRef.current.value = ''
    setUploading(false)
    if (failed) setErr(`${failed} file${failed > 1 ? 's' : ''} failed to upload. ${lastErr}`)
    load()
  }

  async function del(id) {
    if (!confirm('Delete this file?')) return
    await fetch('/api/project-files', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, id }) })
    load()
  }

  const isImage = (f) => (f.contentType || '').startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(f.name)
  const isPdf = (f) => (f.contentType || '').includes('pdf') || /\.pdf$/i.test(f.name)

  return (
    <div>
      {(title || !readOnly) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <div>
            {title && <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>{title}</div>}
            {note && <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>{note}</div>}
          </div>
          {!readOnly && (
            <div>
              <input ref={inputRef} type="file" accept={accept} multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
              <button onClick={() => inputRef.current?.click()} disabled={uploading} style={primaryBtn}>{uploading ? 'Uploading…' : '+ Upload files'}</button>
            </div>
          )}
        </div>
      )}
      {err && <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 10 }}>{err}</div>}

      {loading ? <Loading /> : !files.length ? (
        <EmptyCard title="No files yet" body={readOnly ? 'Nothing uploaded for this project.' : 'Upload PDFs or images using the button above.'} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 14 }}>
          {files.map(f => (
            <div key={f.id} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div onClick={() => setPreview(f)} style={{ height: 120, background: '#f7f6f4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {isImage(f)
                  ? <img src={f.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : isPdf(f)
                    ? <PdfThumb url={f.url} />
                    : <div style={{ textAlign: 'center', color: '#bbb' }}><div style={{ fontSize: 34 }}>📎</div><div style={{ fontSize: 11, marginTop: 4 }}>FILE</div></div>}
              </div>
              <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 13, color: INK, fontWeight: 600, wordBreak: 'break-word', lineHeight: 1.3 }}>{f.name}</div>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{fmtSize(f.size)} · {new Date(f.uploadedAt).toLocaleDateString('en-GB')}</div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <button onClick={() => setPreview(f)} style={linkBtn}>View</button>
                  <a href={f.url} download={f.name} target="_blank" rel="noreferrer" style={{ ...linkBtn, textDecoration: 'none' }}>Download</a>
                  {!readOnly && <button onClick={() => del(f.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', color: '#fff' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{preview.name}</div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <a href={preview.url} download={preview.name} target="_blank" rel="noreferrer" style={{ color: '#fff', fontSize: 14 }} onClick={e => e.stopPropagation()}>Download</a>
              <button onClick={() => setPreview(null)} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 26, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
          </div>
          <div onClick={e => e.stopPropagation()} style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            {isImage(preview)
              ? <img src={preview.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              : <iframe src={preview.url} title={preview.name} style={{ width: '100%', height: '100%', border: 'none', background: '#fff', borderRadius: 8 }} />}
          </div>
        </div>
      )}
    </div>
  )
}

function fmtSize(b) {
  if (!b) return ''
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB'
  return (b / 1048576).toFixed(1) + ' MB'
}
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

// Renders the first page of a PDF as a thumbnail using pdf.js (loaded from CDN).
function PdfThumb({ url }) {
  const canvasRef = useRef()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    async function render() {
      try {
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script')
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
            s.onload = resolve; s.onerror = reject
            document.body.appendChild(s)
          })
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        }
        const pdf = await window.pdfjsLib.getDocument(url).promise
        const page = await pdf.getPage(1)
        if (cancelled) return
        const canvas = canvasRef.current
        if (!canvas) return
        const vp0 = page.getViewport({ scale: 1 })
        const scale = 240 / vp0.width
        const viewport = page.getViewport({ scale })
        canvas.width = viewport.width; canvas.height = viewport.height
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      } catch (e) { if (!cancelled) setFailed(true) }
    }
    render()
    return () => { cancelled = true }
  }, [url])
  if (failed) return <div style={{ textAlign: 'center', color: '#bbb' }}><div style={{ fontSize: 34 }}>📄</div><div style={{ fontSize: 11, marginTop: 4 }}>PDF</div></div>
  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
}

function fmtSizeUnused() {}
