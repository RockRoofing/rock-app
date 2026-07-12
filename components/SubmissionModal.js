import { useState, useRef, useEffect } from 'react'
import { INK, GOLD, Modal, primaryBtn, ghostBtn, linkBtn, fmtDateTime } from './opsUI'

// Shared submission modal used by the Forms page and the in-project Project
// Forms tab. View mode shows answers with question labels; Edit mode renders the
// SAME control types as the original form (single/multi choice, yes/no, date,
// text, photos), so editing preserves the original answer options.
export default function SubmissionModal({ sub, labels, onClose, onSaved, onDownload }) {
  const [editing, setEditing] = useState(false)
  const [answers, setAnswers] = useState(sub.answers || {})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [formDef, setFormDef] = useState(null)   // full form definition (fields incl. type/options)
  const lbl = (k) => (formDef?.fields?.find(f => f.id === k)?.label) || (labels && labels[sub.formId] && labels[sub.formId][k]) || k

  // Load the form definition so we can render the correct editor per field.
  useEffect(() => {
    if (!sub.formId) return
    (async () => {
      try { const r = await fetch(`/api/forms?id=${sub.formId}`); const d = await r.json(); if (d.form) setFormDef(d.form) } catch {}
    })()
  }, [sub.formId])

  // List entries are lightweight (no answers). Fetch the full submission so the
  // modal can actually show/edit the answers.
  useEffect(() => {
    if (sub.answers && Object.keys(sub.answers).length) return
    if (!sub.id) return
    (async () => {
      try {
        const r = await fetch(`/api/submissions?id=${encodeURIComponent(sub.id)}`)
        const d = await r.json()
        if (d?.submission?.answers) setAnswers(d.submission.answers)
      } catch {}
    })()
  }, [sub.id])

  const fieldFor = (k) => formDef?.fields?.find(f => f.id === k)

  async function save() {
    setSaving(true); setErr('')
    try {
      const r = await fetch('/api/submissions', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sub.id, answers }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Save failed'); setSaving(false); return }
      setEditing(false); setSaving(false)
      onSaved && onSaved(d.submission)
    } catch (e) { setErr(e?.message || 'Save failed'); setSaving(false) }
  }

  const set = (k, v) => setAnswers(a => ({ ...a, [k]: v }))
  const isPhotos = (v) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'string' && /^https?:|^data:/.test(v[0])
  const isPhotoKey = (k, v) => { const f = fieldFor(k); if (f) return f.type === 'photos'; return isPhotos(v) || /photo|image/i.test(lbl(k)) }

  function EditControl({ k, v }) {
    const f = fieldFor(k)
    const type = f?.type
    // Choice-based fields keep their original options.
    if (type === 'single' || type === 'yesno') {
      const opts = type === 'yesno' ? ['Yes', 'No'] : (f.options || [])
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {opts.map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
              <input type="radio" checked={v === opt} onChange={() => set(k, opt)} /> {opt}
            </label>
          ))}
        </div>
      )
    }
    if (type === 'multi' || type === 'members') {
      const arr = Array.isArray(v) ? v : (v ? [v] : [])
      const opts = type === 'members' ? [...new Set(arr)] : (f.options || [])
      // For members with no known option list, allow editing existing chips only.
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {opts.map(opt => {
            const on = arr.includes(opt)
            return (
              <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={on} onChange={() => set(k, on ? arr.filter(x => x !== opt) : [...arr, opt])} /> {opt}
              </label>
            )
          })}
          {type === 'members' && opts.length === 0 && <div style={{ fontSize: 13, color: '#aaa' }}>No names recorded.</div>}
        </div>
      )
    }
    if (type === 'date') return <input type="date" value={v || ''} onChange={e => set(k, e.target.value)} style={inpStyle} />
    if (type === 'longtext') return <textarea value={v ?? ''} onChange={e => set(k, e.target.value)} style={{ ...inpStyle, minHeight: 70, fontFamily: 'inherit' }} />
    // shorttext / unknown / signature-name fall back to text
    return <input value={typeof v === 'object' ? (v?.name || '') : (v ?? '')} onChange={e => set(k, e.target.value)} style={inpStyle} />
  }

  return (
    <Modal onClose={onClose} title={sub.formTitle} wide>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#666' }}>{sub.projectName} · {sub.operative} · {fmtDateTime(sub.submittedAt)}{sub.editedAt ? ' · edited' : ''}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onDownload && !editing && <button onClick={() => onDownload(sub)} style={ghostBtn}>Download PDF</button>}
          {!editing
            ? <button onClick={() => setEditing(true)} style={primaryBtn}>Edit</button>
            : <>
                <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save changes'}</button>
                <button onClick={() => { setAnswers(sub.answers || {}); setEditing(false); setErr('') }} style={ghostBtn}>Cancel</button>
              </>}
        </div>
      </div>
      {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {Object.entries(answers).map(([k, v]) => {
        if (!editing && (v == null || v === '' || (Array.isArray(v) && !v.length))) return null
        return (
          <div key={k} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #f2f2f2' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{lbl(k)}</div>
            {isPhotoKey(k, v)
              ? <PhotoEditor value={Array.isArray(v) ? v : []} editing={editing} onChange={nv => setAnswers(a => ({ ...a, [k]: nv }))} />
              : editing
                ? <EditControl k={k} v={v} />
                : <div style={{ fontSize: 14, color: INK }}>{typeof v === 'object' ? (v?.name ? `${v.name} (${v.date || ''})` : JSON.stringify(v)) : Array.isArray(v) ? v.join(', ') : String(v)}</div>}
          </div>
        )
      })}
    </Modal>
  )
}

const inpStyle = { width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }

function PhotoEditor({ value, editing, onChange }) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef()
  async function add(files) {
    if (!files?.length) return
    setUploading(true)
    const next = [...value]
    for (const file of Array.from(files)) {
      try {
        const up = await fetch('/api/upload-file', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name), 'x-content-type': file.type || 'image/jpeg' }, body: file })
        const d = await up.json(); if (up.ok && d.url) next.push(d.url)
      } catch (e) { console.error(e) }
    }
    if (inputRef.current) inputRef.current.value = ''
    onChange(next); setUploading(false)
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {value.map((u, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <a href={u} target="_blank" rel="noreferrer"><img src={u} style={{ height: 90, borderRadius: 6 }} /></a>
            {editing && <button onClick={() => onChange(value.filter((_, j) => j !== i))} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 12 }}>×</button>}
          </div>
        ))}
      </div>
      {editing && (
        <div style={{ marginTop: 8 }}>
          <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => add(e.target.files)} />
          <button onClick={() => inputRef.current?.click()} disabled={uploading} style={{ ...ghostBtn, fontSize: 13 }}>{uploading ? 'Uploading…' : '+ Add photo'}</button>
        </div>
      )}
    </div>
  )
}
