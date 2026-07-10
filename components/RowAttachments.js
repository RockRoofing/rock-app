import { useState } from 'react'

// Per-row attachments. Uses a full modal (not an inline popover) so it's never
// clipped by the table's scroll container. Shows a paperclip + count.
export default function RowAttachments({ files, onChange }) {
  const list = Array.isArray(files) ? files : []
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)

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
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderTop: i ? '1px solid #f2f2f2' : 'none' }}>
                <span style={{ flex: 1, fontSize: 13, color: '#333', wordBreak: 'break-word' }}>{f.name}</span>
                <a href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: '#2a78d6', textDecoration: 'none' }}>View</a>
                <a href={f.url} download={f.name} style={{ fontSize: 12.5, color: '#2a78d6', textDecoration: 'none' }}>Download</a>
                <button onClick={() => onChange(list.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
            ))}
            <label style={{ display: 'inline-block', marginTop: 14, background: '#ca8a04', color: '#fff', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {uploading ? 'Uploading…' : '+ Add file'}
              <input type="file" multiple style={{ display: 'none' }} onChange={e => add(e.target.files)} />
            </label>
          </div>
        </div>
      )}
    </>
  )
}
