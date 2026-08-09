import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { upload } from '@vercel/blob/client'
import { useDesignProjectAuth, DesignNav, PURPLE, INK } from '../../../lib/designShell'
import DrawingMarkup from '../../../components/DrawingMarkup'

const isImg = (f) => (f.contentType || '').startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(f.url || f.name || '')
const isPdf = (f) => (f.contentType || '') === 'application/pdf' || /\.pdf$/i.test(f.url || f.name || '')

export default function WarrantiesPage() {
  const router = useRouter()
  const projectNo = router.query.project ? String(router.query.project) : ''
  const auth = useDesignProjectAuth(projectNo)
  const [files, setFiles] = useState([])
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [selected, setSelected] = useState({})
  const [uploading, setUploading] = useState(false)
  const [viewFile, setViewFile] = useState(null)
  const inputRef = useRef()

  useEffect(() => { if (auth.ready && projectNo) load() }, [auth.ready, projectNo])

  async function load() {
    setLoading(true); setErr('')
    try {
      const d = await fetch(`/api/design-warranties?no=${encodeURIComponent(projectNo)}`).then(r => r.json())
      setFiles(d.files || []); setCanEdit(!!d.canEdit)
    } catch { setErr('Could not load') }
    setLoading(false)
  }

  async function post(payload) {
    const r = await fetch('/api/design-warranties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, ...payload }) })
    const d = await r.json()
    if (!r.ok) { setErr(d.error || 'Failed'); return null }
    if (d.files) setFiles(d.files)
    return d
  }

  async function uploadFiles(list) {
    if (!list || !list.length) return
    setUploading(true); setErr('')
    try {
      for (const file of Array.from(list)) {
        const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/blob-upload', contentType: file.type || 'application/octet-stream' })
        await post({ action: 'add-file', file: { name: file.name, url: blob.url, contentType: file.type || '', size: file.size } })
      }
    } catch (e) { setErr(e && e.message ? e.message : 'Upload failed') }
    if (inputRef.current) inputRef.current.value = ''
    setUploading(false)
  }
  async function deleteFile(fileId) {
    if (!confirm('Delete this warranty?')) return
    await post({ action: 'delete-file', fileId })
    setSelected(s => { const c = { ...s }; delete c[fileId]; return c })
  }

  function toggle(id) { setSelected(s => ({ ...s, [id]: !s[id] })) }
  const selectedUrls = files.filter(f => selected[f.id]).map(f => f.url)

  async function downloadZip(urls, zipName) {
    if (!urls.length) return
    try {
      const r = await fetch('/api/design-warranties-zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, urls, zipName }) })
      if (!r.ok) { let m = 'Could not build zip'; try { const d = await r.json(); m = d.error || m } catch {} setErr(m); return }
      const blob = await r.blob()
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${zipName}.zip`
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } catch { setErr('Could not download') }
  }

  if (!auth.ready) return null

  return (
    <>
      <Head><title>Warranties - Design</title></Head>
      <DesignNav active="warranties" projectNo={projectNo} projectName={auth.project && auth.project.name} isInternal={auth.isInternal} />
      <input ref={inputRef} type="file" accept="application/pdf,image/*" multiple style={{ display: 'none' }} onChange={e => uploadFiles(e.target.files)} />
      <div style={{ width: '100%', margin: 0, padding: '22px 24px 60px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ margin: '0 0 2px', color: INK, fontSize: 24 }}>Warranties</h1>
            <p style={{ color: '#8a857c', fontSize: 14, margin: 0 }}>Manufacturer warranty documents. {canEdit ? 'Upload warranties for the customer.' : 'View and download.'}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => downloadZip(files.map(f => f.url), `${projectNo}-warranties`)} disabled={!files.length} style={{ ...btnGhost, opacity: files.length ? 1 : 0.5 }}>Download all</button>
            <button onClick={() => downloadZip(selectedUrls, `${projectNo}-warranties-selected`)} disabled={!selectedUrls.length} style={{ ...btnGhost, opacity: selectedUrls.length ? 1 : 0.5 }}>Download selected ({selectedUrls.length})</button>
            {canEdit && <button onClick={() => inputRef.current && inputRef.current.click()} disabled={uploading} style={{ ...btnPrimary, opacity: uploading ? 0.6 : 1 }}>{uploading ? 'Uploading...' : '+ Upload Warranties'}</button>}
          </div>
        </div>
        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        {loading ? <div style={{ color: '#999', padding: 20 }}>Loading...</div>
          : files.length === 0 ? (
            <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 40, textAlign: 'center', color: '#aaa' }}>
              No warranties yet. {canEdit ? 'Use "+ Upload Warranties" to add documents.' : 'Nothing has been added yet.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
              {files.map(f => (
                <Thumb key={f.id} file={f} selected={!!selected[f.id]} onToggle={() => toggle(f.id)} canEdit={canEdit} onDelete={() => deleteFile(f.id)} onView={() => setViewFile(f)} />
              ))}
            </div>
          )}
      </div>
      {viewFile && <DocViewer file={viewFile} onClose={() => setViewFile(null)} />}
    </>
  )
}

function Thumb({ file, selected, onToggle, canEdit, onDelete, onView }) {
  const dlHref = `/api/download?url=${encodeURIComponent(file.url)}&name=${encodeURIComponent(file.name)}`
  return (
    <div style={{ border: `2px solid ${selected ? PURPLE : '#eee'}`, borderRadius: 10, overflow: 'hidden', background: '#fff', position: 'relative' }}>
      <label style={{ position: 'absolute', top: 6, left: 6, zIndex: 2, background: 'rgba(255,255,255,0.9)', borderRadius: 5, padding: '1px 3px', display: 'flex', cursor: 'pointer' }}>
        <input type="checkbox" checked={selected} onChange={onToggle} style={{ width: 16, height: 16, cursor: 'pointer' }} />
      </label>
      <button onClick={onView} title="View" style={{ display: 'block', width: '100%', height: 130, background: '#faf9fd', border: 'none', padding: 0, cursor: 'pointer' }}>
        {isImg(file) ? <img src={file.url} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <PdfThumb file={file} />}
      </button>
      <div style={{ padding: '8px 10px' }}>
        <div title={file.name} style={{ fontSize: 12.5, color: '#333', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <button onClick={onView} style={{ background: 'none', border: 'none', fontSize: 12, color: PURPLE, cursor: 'pointer', fontWeight: 600, padding: 0 }}>View</button>
          <a href={dlHref} style={{ fontSize: 12, color: PURPLE, textDecoration: 'none', fontWeight: 600 }}>Download</a>
          {canEdit && <button onClick={onDelete} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12 }}>Delete</button>}
        </div>
      </div>
    </div>
  )
}

function DocViewer({ file, onClose }) {
  const viewable = isImg(file) || isPdf(file)
  const dlHref = `/api/download?url=${encodeURIComponent(file.url)}&name=${encodeURIComponent(file.name)}`
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '2vh 2vw' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 16, width: '94vw', height: '94vh', maxWidth: '94vw', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flex: '0 0 auto', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: '0 0 auto' }}>
            <a href={dlHref} style={{ ...btnGhost, color: PURPLE, textDecoration: 'none' }}>Download</a>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#999' }}>&times;</button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, background: '#f4f4f4', borderRadius: 8 }}>
          {isImg(file)
            ? <div style={{ display: 'flex', justifyContent: 'center', padding: 10 }}><img src={file.url} alt={file.name} style={{ maxWidth: '100%', height: 'auto', display: 'block' }} /></div>
            : viewable
              ? <div style={{ padding: 10 }}><DrawingMarkup imageUrl={file.url} contentType={file.contentType} initial={null} canEdit={false} onSave={() => {}} fileName={file.name} docLabel="warranty" /></div>
              : <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>This file type can't be previewed here.
                  <div style={{ marginTop: 12 }}><a href={dlHref} style={{ ...btnPrimary, textDecoration: 'none' }}>Download {file.name}</a></div>
                </div>}
        </div>
      </div>
    </div>
  )
}

function PdfThumb({ file }) {
  const ref = useRef()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!isPdf(file)) { setFailed(true); return }
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; s.onload = resolve; s.onerror = reject; document.body.appendChild(s) })
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        }
        const pdf = await window.pdfjsLib.getDocument(file.url).promise
        const pg = await pdf.getPage(1)
        if (cancelled) return
        const holder = ref.current; if (!holder) return
        const maxW = holder.clientWidth || 160
        const vp0 = pg.getViewport({ scale: 1 })
        const vp = pg.getViewport({ scale: maxW / vp0.width })
        const canvas = document.createElement('canvas')
        canvas.width = vp.width; canvas.height = vp.height
        canvas.style.width = '100%'; canvas.style.height = '130px'; canvas.style.objectFit = 'cover'; canvas.style.objectPosition = 'top'
        holder.innerHTML = ''; holder.appendChild(canvas)
        await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
      } catch { if (!cancelled) setFailed(true) }
    })()
    return () => { cancelled = true }
  }, [file.url])
  if (failed) return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9333ea' }}><div style={{ fontSize: 34 }}>&#128196;</div><div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{isPdf(file) ? 'PDF' : 'File'}</div></div>
  return <div ref={ref} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
}

const btnPrimary = { background: PURPLE, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const btnGhost = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
