import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Per-row attachments. Uses a full modal (not an inline popover) so it's never
// clipped by the table's scroll container. Shows a paperclip + count.
// View opens an in-app viewer overlay (images inline, PDFs embedded) with
// prev/next; Download saves the actual file with its correct name/extension.
export default function RowAttachments({ files, onChange, readOnly = false }) {
  const list = Array.isArray(files) ? files : []
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [viewIdx, setViewIdx] = useState(null)

  async function add(fileList) {
    if (!fileList?.length) return
    setUploading(true)
    const next = [...list]
    for (const file of Array.from(fileList)) {
      try {
        const up = await fetch('/api/upload-file', {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name), 'x-content-type': file.type || 'application/octet-stream' },
          body: file,
        })
        const d = await up.json()
        if (up.ok && d.url) next.push({ url: d.url, name: file.name, type: file.type })
      } catch (e) { console.error(e) }
    }
    onChange(next); setUploading(false)
  }

  return (
    <>
      <button onClick={() => setOpen(true)} title="Attachments" style={{ background: list.length ? '#fef3c7' : '#f2f2f0', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12.5, color: '#555', whiteSpace: 'nowrap' }}>
        📎 {list.length || ''}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, width: 460, maxWidth: '92vw', maxHeight: '85vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a19' }}>Attachments</div>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#999', lineHeight: 1 }}>×</button>
            </div>
            {list.length === 0 && <div style={{ fontSize: 13, color: '#bbb', marginBottom: 12 }}>No files yet.</div>}
            {list.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i ? '1px solid #f2f2f2' : 'none' }}>
                {isImage(f) && <img src={f.url} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6 }} />}
                <span style={{ flex: 1, fontSize: 13, color: '#333', wordBreak: 'break-word' }}>{f.name || 'file'}</span>
                <button onClick={() => setViewIdx(i)} style={linkA}>View</button>
                <button onClick={() => downloadFile(f)} style={linkA}>Download</button>
                {!readOnly && <button onClick={() => onChange(list.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>}
              </div>
            ))}
            {!readOnly && (
              <label style={{ display: 'inline-block', marginTop: 14, background: '#ca8a04', color: '#fff', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {uploading ? 'Uploading…' : '+ Add file'}
                <input type="file" multiple style={{ display: 'none' }} onChange={e => add(e.target.files)} />
              </label>
            )}
          </div>
        </div>
      )}
      {viewIdx != null && list[viewIdx] && (
        <AttachmentViewer files={list} index={viewIdx} onIndex={setViewIdx} onClose={() => setViewIdx(null)} />
      )}
    </>
  )
}

const linkA = { background: 'none', border: 'none', fontSize: 12.5, color: '#2a78d6', cursor: 'pointer', padding: 0, fontWeight: 600 }

export function isImage(f) {
  if (!f) return false
  if (f.type && f.type.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)(\?|$)/i.test(f.url || f.name || '')
}
function isPdf(f) {
  if (!f) return false
  if (f.type === 'application/pdf') return true
  return /\.pdf(\?|$)/i.test(f.url || f.name || '')
}

// Save the file via our download proxy so it keeps its correct name/extension
// (blob URLs are cross-origin and ignore the <a download> attribute). Falls back
// to a direct blob fetch, then to opening the URL.
export async function downloadFile(f) {
  const name = f.name || guessName(f.url)
  const proxy = `/api/download?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(name)}`
  try {
    const a = document.createElement('a')
    a.href = proxy; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
  } catch {
    try {
      const r = await fetch(f.url); const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = name
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch { window.open(f.url, '_blank', 'noopener') }
  }
}
function guessName(url = '') {
  const clean = url.split('?')[0]
  const base = clean.substring(clean.lastIndexOf('/') + 1)
  return base || 'download'
}

// In-app viewer overlay with prev/next (buttons, arrow keys, swipe).
export function AttachmentViewer({ files, index, onIndex, onClose }) {
  const f = files[index]
  const has = files.length > 1
  const go = (delta) => onIndex((index + delta + files.length) % files.length)
  const touch = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, files.length])

  const onTouchStart = (e) => { touch.current = e.touches[0].clientX }
  const onTouchEnd = (e) => {
    if (touch.current == null) return
    const dx = e.changedTouches[0].clientX - touch.current
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
    touch.current = null
  }
  const navBtn = (side) => ({
    position: 'absolute', top: '50%', transform: 'translateY(-50%)', [side]: 8, zIndex: 3,
    width: 46, height: 46, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 26,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  })
  // Prefer the inline proxy (fixes octet-stream images that <img> won't render);
  // fall back to the raw blob URL if the proxy errors.
  const inlineUrl = `/api/download?inline=1&url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name || '')}`

  const overlay = (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 3000, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', color: '#fff', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name || 'Attachment'}</div>
          {has && <div style={{ fontSize: 12, color: '#bbb' }}>{index + 1} of {files.length}</div>}
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <button onClick={() => downloadFile(f)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>Download</button>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 28, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
      </div>
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, overflow: 'auto' }}>
        {has && <button onClick={() => go(-1)} aria-label="Previous" style={navBtn('left')}>‹</button>}
        {isPdf(f)
          ? <iframe key={f.url} src={inlineUrl} title={f.name} style={{ width: '100%', height: '100%', border: 'none', background: '#fff', borderRadius: 8 }} />
          : <img key={f.url} src={inlineUrl} alt={f.name || ''} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              onError={(e) => { if (e.target.src !== f.url) e.target.src = f.url }} />}
        {has && <button onClick={() => go(1)} aria-label="Next" style={navBtn('right')}>›</button>}
      </div>
      {has && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, padding: '10px 16px 16px' }}>
          <button onClick={() => go(-1)} style={pageNavBtn}>‹ Previous</button>
          <button onClick={() => go(1)} style={pageNavBtn}>Next ›</button>
        </div>
      )}
    </div>
  )
  // Render to document.body so table/scroll/transform ancestors can't clip or hide it.
  if (typeof document === 'undefined') return null
  return createPortal(overlay, document.body)
}
const pageNavBtn = { background: 'rgba(255,255,255,0.14)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
