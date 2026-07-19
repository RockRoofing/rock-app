import { useState, useRef, useEffect, useMemo } from 'react'

// Searchable project picker. Type to filter by job no / name; click to select.
// projects: [{ xeroId, jobNo, name }]  value: selected xeroId  onPick(xeroId)
export default function ProjectSearchSelect({ projects = [], value = '', onPick, placeholder = 'Search job no or project…', minWidth = 340 }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef(null)

  const selected = projects.find(p => String(p.xeroId) === String(value)) || null
  const label = selected ? [selected.jobNo, selected.name].filter(Boolean).join(' — ') : ''

  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = s
      ? projects.filter(p => `${p.jobNo || ''} ${p.name || ''}`.toLowerCase().includes(s))
      : projects
    return list.slice(0, 60)
  }, [q, projects])

  return (
    <div ref={boxRef} style={{ position: 'relative', minWidth, display: 'inline-block' }}>
      <input
        value={open ? q : label}
        placeholder={selected ? label : placeholder}
        onChange={e => { setQ(e.target.value); if (!open) setOpen(true) }}
        onFocus={() => { setQ(''); setOpen(true) }}
        autoComplete="off"
        style={{ width: '100%', padding: '8px 12px', border: '1px solid #d5d9e0', borderRadius: 8, fontSize: 13, background: '#fff' }}
      />
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 60, maxHeight: 320, overflowY: 'auto' }}>
          <div
            onClick={() => { onPick(''); setOpen(false) }}
            style={{ padding: '8px 12px', fontSize: 12, color: '#94a3b8', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
          >— Clear selection —</div>
          {filtered.length === 0 && <div style={{ padding: '10px 12px', fontSize: 13, color: '#aaa' }}>No matching projects</div>}
          {filtered.map(p => {
            const isSel = String(p.xeroId) === String(value)
            return (
              <div key={p.xeroId}
                onClick={() => { onPick(String(p.xeroId)); setOpen(false) }}
                style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', background: isSel ? '#eef2ff' : 'transparent', color: '#1a1a2e' }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = '#f8f9fa' }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ fontWeight: 700 }}>{p.jobNo || '—'}</span>
                {p.name ? <span style={{ color: '#475569' }}> — {p.name}</span> : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
