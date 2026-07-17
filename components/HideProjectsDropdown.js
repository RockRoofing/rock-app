import { useState, useEffect, useRef } from 'react'

// Settings-icon dropdown for hiding/showing projects across the commercial views.
// Shared setting (config:hidden-projects) — any user's change is seen by all.
// Ticked = visible; unticked = hidden. Default (not in list) = visible.
//
// Props:
//   projects : [{ id, jobNo, name }]  — full list to choose from
//   hidden   : string[]               — currently hidden ids (from the page)
//   onChange : (newHiddenArray) => {} — called after a successful save
export default function HideProjectsDropdown({ projects = [], hidden = [], onChange }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [local, setLocal] = useState(hidden)
  const [saving, setSaving] = useState(false)
  const ref = useRef(null)

  useEffect(() => { setLocal(hidden) }, [hidden])
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const hiddenSet = new Set(local.map(String))
  const needle = q.trim().toLowerCase()
  const list = projects
    .filter(p => !needle || `${p.jobNo || ''} ${p.name || ''}`.toLowerCase().includes(needle))
    .sort((a, b) => String(a.jobNo || '').localeCompare(String(b.jobNo || ''), undefined, { numeric: true }))

  function toggle(id) {
    const s = String(id)
    setLocal(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }
  function setAll(hide) {
    setLocal(hide ? projects.map(p => String(p.id)) : [])
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/hidden-projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden: local }),
      })
      const data = await res.json()
      if (res.ok && onChange) onChange(data.hidden || local)
      setOpen(false)
    } catch (e) { /* leave open on failure */ }
    setSaving(false)
  }

  const hiddenCount = hiddenSet.size

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(o => !o)} title="Show / hide projects"
        style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, color: '#555' }}>
        <span style={{ fontSize: 15 }}>⚙</span>
        {hiddenCount > 0 && <span style={{ fontSize: 11, color: '#6366f1', fontWeight: 600 }}>{hiddenCount} hidden</span>}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.15)', zIndex: 60, width: 320, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', marginBottom: 4 }}>Show / hide projects</div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>Ticked = visible. Unticked projects are hidden across Project Financials, Retention, Application Calendar and the Commercial Scorecard — for everyone.</div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search job or project…"
            style={{ width: '100%', padding: '6px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, boxSizing: 'border-box', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 10, marginBottom: 8, fontSize: 11 }}>
            <span onClick={() => setAll(false)} style={{ color: '#6366f1', cursor: 'pointer' }}>Show all</span>
            <span onClick={() => setAll(true)} style={{ color: '#b45309', cursor: 'pointer' }}>Hide all</span>
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
            {list.length === 0 ? <div style={{ padding: 12, fontSize: 12, color: '#aaa' }}>No projects</div>
              : list.map(p => {
                const id = String(p.id)
                const visible = !hiddenSet.has(id)
                return (
                  <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '0.5px solid #f5f5f5', background: visible ? 'transparent' : '#fafafa' }}>
                    <input type="checkbox" checked={visible} onChange={() => toggle(id)} />
                    <span style={{ color: visible ? '#1a1a2e' : '#aaa' }}>
                      <strong>{p.jobNo || '—'}</strong>{p.name ? ` · ${p.name}` : ''}
                    </span>
                  </label>
                )
              })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button onClick={() => { setLocal(hidden); setOpen(false) }} style={{ background: '#f0f2f5', border: '1px solid #ddd', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#555' }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ background: saving ? '#ccc' : '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
