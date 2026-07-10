import { useState, useEffect, useRef } from 'react'
import { INK, primaryBtn, ghostBtn } from './opsUI'

// Searchable supplier-contact picker with inline "add contact".
// value = contactId (string) | null. onChange(contactId, contactObject).
// Contacts are global (/api/contacts) so this is reusable across the portal.
export default function ContactPicker({ value, onChange, compact }) {
  const [contacts, setContacts] = useState([])
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ firstName: '', lastName: '', company: '', phone: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [pos, setPos] = useState(null)   // {top,left,width} for fixed overlay
  const boxRef = useRef(null)
  const btnRef = useRef(null)

  useEffect(() => { load() }, [])
  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setAdding(false) } }
    function onScroll() { if (open) place() }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll) }
  }, [open])
  async function load() {
    try { const d = await fetch('/api/contacts').then(r => r.json()); setContacts(d.contacts || []) } catch {}
  }

  function place() {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = 280
    let left = r.left
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12)
    setPos({ top: r.bottom + 4, left, width })
  }
  function toggle() { if (!open) place(); setOpen(o => !o) }

  const selected = contacts.find(c => c.id === value)
  const label = selected ? `${selected.firstName || ''} ${selected.lastName || ''}${selected.company ? ` · ${selected.company}` : ''}`.trim() : ''
  const filtered = q.trim()
    ? contacts.filter(c => `${c.firstName || ''} ${c.lastName || ''} ${c.company || ''} ${c.email || ''} ${c.phone || ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    : contacts

  async function saveNew() {
    if (!form.firstName && !form.lastName && !form.company) return
    setSaving(true)
    try {
      const d = await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact: form }) }).then(r => r.json())
      if (d.contact) {
        setContacts(cs => [...cs, d.contact])
        onChange(d.contact.id, d.contact)
        setAdding(false); setOpen(false); setForm({ firstName: '', lastName: '', company: '', phone: '', email: '' }); setQ('')
      }
    } catch {}
    setSaving(false)
  }

  return (
    <div ref={boxRef} style={{ width: '100%' }}>
      <button ref={btnRef} onClick={toggle} style={{ ...cellBtn, color: selected ? INK : '#bbb' }}>
        {selected ? label : 'Select contact…'}
      </button>
      {open && pos && (
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000, width: pos.width, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.16)' }}>
          {!adding ? (
            <>
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search contacts…" style={search} />
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                {selected && <div onClick={() => { onChange(null, null); setOpen(false) }} style={{ ...opt, color: '#dc2626' }}>✕ Clear selection</div>}
                {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: '#999' }}>No matches.</div>}
                {filtered.map(c => (
                  <div key={c.id} onClick={() => { onChange(c.id, c); setOpen(false); setQ('') }} style={opt}>
                    <div style={{ fontSize: 13, color: INK, fontWeight: 500 }}>{`${c.firstName || ''} ${c.lastName || ''}`.trim() || '(no name)'}</div>
                    <div style={{ fontSize: 11.5, color: '#888' }}>{[c.company, c.phone, c.email].filter(Boolean).join(' · ')}</div>
                  </div>
                ))}
              </div>
              <div onClick={() => setAdding(true)} style={{ ...opt, borderTop: '1px solid #eee', color: '#ca8a04', fontWeight: 600 }}>+ Add new contact</div>
            </>
          ) : (
            <div style={{ padding: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 8 }}>New contact</div>
              {['firstName', 'lastName', 'company', 'phone', 'email'].map(f => (
                <input key={f} value={form[f]} onChange={e => setForm({ ...form, [f]: e.target.value })}
                  placeholder={{ firstName: 'First name', lastName: 'Last name', company: 'Company', phone: 'Phone', email: 'Email' }[f]}
                  style={{ ...search, marginBottom: 6 }} />
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button onClick={saveNew} disabled={saving} style={{ ...primaryBtn, padding: '6px 12px', fontSize: 12 }}>{saving ? 'Saving…' : 'Save'}</button>
                <button onClick={() => setAdding(false)} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 12 }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const cellBtn = { width: '100%', textAlign: 'left', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #eee', borderRadius: 6, fontSize: 12.5, background: '#fff', cursor: 'pointer' }
const dropdown = { position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 4, width: 280, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }
const search = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, margin: '8px 8px 4px', width: 'calc(100% - 16px)' }
const opt = { padding: '8px 10px', cursor: 'pointer', borderRadius: 6 }
