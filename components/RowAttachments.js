import { useState } from 'react'

// Compact per-row attachments control for PM tables.
// Shows a paperclip with a count; clicking opens a small panel to view,
// download, add, or remove files. Uploads via the shared raw-body endpoint.
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
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="Attachments" style={{ background: list.length ? '#fef3c7' : '#f2f2f0', border: 'none', borderRadius: 6, padding: '5px 9px', cursor: 'pointer', fontSize: 12.5, color: '#555', whiteSpace: 'nowrap' }}>
        📎 {list.length || ''}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', top: '110%', right: 0, zIndex: 50, background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.14)', width: 260, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#666', marginBottom: 8 }}>Attachments</div>
            {list.length === 0 && <div style={{ fontSize: 12.5, color: '#bbb', marginBottom: 8 }}>No files yet.</div>}
            {list.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderTop: i ? '1px solid #f2f2f2' : 'none' }}>
                <span style={{ flex: 1, fontSize: 12, color: '#333', wordBreak: 'break-word' }}>{f.name}</span>
                <a href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: '#2a78d6', textDecoration: 'none' }}>View</a>
                <a href={f.url} download={f.name} style={{ fontSize: 11.5, color: '#2a78d6', textDecoration: 'none' }}>Save</a>
                <button onClick={() => onChange(list.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
              </div>
            ))}
            <label style={{ display: 'inline-block', marginTop: 10, background: '#ca8a04', color: '#fff', borderRadius: 7, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              {uploading ? 'Uploading…' : '+ Add file'}
              <input type="file" multiple style={{ display: 'none' }} onChange={e => add(e.target.files)} />
            </label>
          </div>
        </>
      )}
    </div>
  )
}
