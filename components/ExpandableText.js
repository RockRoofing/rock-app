import { useState, useEffect } from 'react'

// A table cell for longer text. Shows a clamped preview; clicking opens a modal
// with a large textarea for comfortable multi-line editing. Saves on modal close
// / Save. If `readOnly`, it just expands to read.
export default function ExpandableText({ value, onSave, placeholder = '—', label = 'Edit', readOnly = false, width = 240 }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value || '')
  useEffect(() => setDraft(value || ''), [value])

  function close(saveIt) {
    if (saveIt && !readOnly && draft !== (value || '')) onSave?.(draft)
    setOpen(false)
  }

  return (
    <>
      <div onClick={() => setOpen(true)} title="Click to expand"
        style={{ width: typeof width === 'number' ? width : '100%', minWidth: 120, minHeight: 34, maxHeight: 66, overflow: 'hidden', cursor: 'pointer', border: '1px solid #eee', borderRadius: 6, padding: '6px 8px', fontSize: 12.5, color: value ? '#333' : '#bbb', whiteSpace: 'pre-wrap', lineHeight: 1.4, background: '#fff', boxSizing: 'border-box' }}>
        {value ? clamp(value) : placeholder}
      </div>
      {open && (
        <div onClick={() => close(true)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, width: 620, maxWidth: '94vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a19' }}>{label}</div>
              <button onClick={() => close(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#999', lineHeight: 1 }}>×</button>
            </div>
            <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} readOnly={readOnly}
              style={{ width: '100%', boxSizing: 'border-box', minHeight: 220, border: '1px solid #e0e0e0', borderRadius: 10, padding: 14, fontSize: 14, fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }} />
            {!readOnly && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={() => close(true)} style={{ background: '#ca8a04', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Save</button>
                <button onClick={() => { setDraft(value || ''); setOpen(false) }} style={{ background: '#f2f2f0', color: '#555', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function clamp(s) {
  const str = String(s)
  return str.length > 140 ? str.slice(0, 140) + '…' : str
}
