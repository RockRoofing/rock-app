import { useState, useEffect } from 'react'
import { PRESTART_SECTIONS } from '../lib/preStartSchema'
import { INK, GOLD, Loading, EmptyCard, primaryBtn, ghostBtn, linkBtn, inp2, fmtDateTime } from './opsUI'

// Pre-Start Meeting Minutes for a project. Mirrors the IHM look & feel:
// sectioned form, editable in the portal, read-only view when saved. Surfaces
// the IHM's uploaded documents. AI "Suggest" buttons are added in a later pass.
export default function PreStartForm({ projectNo }) {
  const [data, setData] = useState(null)          // saved record (null = none yet)
  const [form, setForm] = useState(null)          // working copy while editing
  const [ihm, setIhm] = useState(null)            // IHM data (docs + team defaults)
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [doc, setDoc] = useState(null)

  useEffect(() => { load() }, [projectNo])
  async function load() {
    setLoading(true)
    try {
      const [ps, pr, tm] = await Promise.all([
        fetch(`/api/pre-start?no=${encodeURIComponent(projectNo)}`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/ops-projects?no=${encodeURIComponent(projectNo)}`).then(r => r.json()).catch(() => ({})),
        fetch('/api/team').then(r => r.json()).catch(() => ({})),
      ])
      setData(ps?.data || null)
      setIhm(pr?.project?.data || null)
      setTeam((tm?.members || tm?.team || []).filter(m => m.active !== false))
      if (!ps?.data) setEditing(true) // no record yet → start in edit mode
    } catch {}
    setLoading(false)
  }

  function startEdit() {
    // Seed working copy from saved data, filling qrow defaults where empty.
    const seed = JSON.parse(JSON.stringify(data || {}))
    for (const sec of PRESTART_SECTIONS) {
      for (const f of sec.fields) {
        if (f.type === 'qrow') {
          if (!seed[f.id]) seed[f.id] = { resolved: '', comments: f.default || '' }
          else if (seed[f.id].comments == null) seed[f.id].comments = f.default || ''
        }
      }
    }
    setForm(seed); setEditing(true)
  }

  async function save() {
    setSaving(true)
    try {
      const r = await fetch('/api/pre-start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectNo, data: form }),
      })
      const d = await r.json()
      if (r.ok) { setData(d.data); setEditing(false) }
      else alert(d.error || 'Save failed')
    } catch (e) { alert(e?.message || 'Save failed') }
    setSaving(false)
  }

  if (loading) return <Loading />

  const scopeFiles = Array.isArray(ihm?.scopeFiles) ? ihm.scopeFiles : []
  const src = editing ? form : data

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Pre-Start Meeting Minutes</div>
          <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>
            {data ? `Last saved ${fmtDateTime(data.updatedAt)}` : 'Not yet completed'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!editing
            ? <button onClick={startEdit} style={primaryBtn}>{data ? 'Edit' : 'Complete Pre-Start Minutes'}</button>
            : <>
                <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
                {data && <button onClick={() => setEditing(false)} style={ghostBtn}>Cancel</button>}
              </>}
        </div>
      </div>

      {!data && !editing ? (
        <EmptyCard title="No Pre-Start Minutes yet" body="Click “Complete Pre-Start Minutes” to fill them in." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {PRESTART_SECTIONS.map(sec => (
            <div key={sec.id} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: GOLD, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>{sec.title}</div>
              {sec.fields.map(f => (
                <FieldRow key={f.id} field={f} value={src?.[f.id]} editing={editing} team={team}
                  onChange={nv => setForm(prev => ({ ...(prev || {}), [f.id]: nv }))} />
              ))}
            </div>
          ))}

          {/* IHM uploaded documents surfaced here */}
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: GOLD, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Handover Documents (from IHM)</div>
            {!scopeFiles.length ? <div style={{ fontSize: 13, color: '#999' }}>No documents were uploaded in the Internal Handover Minutes.</div> : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
                {scopeFiles.map((fl, i) => {
                  const img = (fl.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(fl.name || fl.url || '')
                  return (
                    <div key={i} style={{ border: '1px solid #ececec', borderRadius: 10, overflow: 'hidden' }}>
                      <div onClick={() => setDoc(fl)} style={{ height: 90, background: '#f7f6f4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {img ? <img src={fl.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ fontSize: 28, color: '#bbb' }}>📄</div>}
                      </div>
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{ fontSize: 12, color: INK, fontWeight: 600, wordBreak: 'break-word' }}>{fl.name}</div>
                        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                          <button onClick={() => setDoc(fl)} style={linkBtn}>View</button>
                          <a href={fl.url} download={fl.name} target="_blank" rel="noreferrer" style={{ ...linkBtn, textDecoration: 'none' }}>Download</a>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {doc && (
        <div onClick={() => setDoc(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', color: '#fff' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{doc.name}</div>
            <button onClick={() => setDoc(null)} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 26, cursor: 'pointer' }}>×</button>
          </div>
          <div onClick={e => e.stopPropagation()} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto' }}>
            {((doc.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(doc.name || doc.url || ''))
              ? <img src={doc.url} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              : <iframe src={doc.url} title={doc.name} style={{ width: '100%', height: '100%', border: 'none', background: '#fff', borderRadius: 8 }} />}
          </div>
        </div>
      )}
    </div>
  )
}

function FieldRow({ field, value, editing, team, onChange }) {
  const { type, label } = field

  if (type === 'qrow') {
    const v = value || { resolved: '', comments: '' }
    return (
      <div style={{ padding: '12px 0', borderBottom: '1px solid #f4f4f2' }}>
        <div style={{ fontSize: 13.5, color: INK, marginBottom: 8, fontWeight: 500 }}>{label}</div>
        {editing ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <select value={v.resolved || ''} onChange={e => onChange({ ...v, resolved: e.target.value })}
              style={{ ...inp2, width: 130, flexShrink: 0 }}>
              <option value="">Resolved?</option>
              <option value="Y">Yes</option>
              <option value="N">No</option>
            </select>
            <textarea value={v.comments || ''} onChange={e => onChange({ ...v, comments: e.target.value })}
              placeholder="Comments — describe what was discussed" style={{ ...inp2, flex: 1, minWidth: 240, minHeight: 64, fontFamily: 'inherit' }} />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 20, padding: '2px 10px', flexShrink: 0,
              background: v.resolved === 'Y' ? '#ecfdf5' : v.resolved === 'N' ? '#fef2f2' : '#f3f4f6',
              color: v.resolved === 'Y' ? '#065f46' : v.resolved === 'N' ? '#991b1b' : '#9ca3af' }}>
              {v.resolved === 'Y' ? 'Resolved' : v.resolved === 'N' ? 'Outstanding' : '—'}
            </span>
            <span style={{ fontSize: 14, color: v.comments ? INK : '#bbb', whiteSpace: 'pre-wrap' }}>{v.comments || '—'}</span>
          </div>
        )}
      </div>
    )
  }

  if (type === 'attendees') {
    const rows = Array.isArray(value) ? value : []
    if (!editing) {
      return (
        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{label}</div>
          {!rows.length ? <div style={{ fontSize: 13, color: '#bbb' }}>—</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {rows.map((r, i) => <div key={i} style={{ fontSize: 13.5, color: INK }}>{[r.role, r.name, r.email, r.phone].filter(Boolean).join(' · ')}</div>)}
            </div>
          )}
        </div>
      )
    }
    return (
      <div style={{ padding: '10px 0' }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{label}</div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
            <input value={r.role || ''} onChange={e => { const n = [...rows]; n[i] = { ...r, role: e.target.value }; onChange(n) }} placeholder="Role" style={{ ...inp2, flex: '1 1 120px' }} />
            <input value={r.name || ''} onChange={e => { const n = [...rows]; n[i] = { ...r, name: e.target.value }; onChange(n) }} placeholder="Name" style={{ ...inp2, flex: '1 1 120px' }} />
            <input value={r.email || ''} onChange={e => { const n = [...rows]; n[i] = { ...r, email: e.target.value }; onChange(n) }} placeholder="Email" style={{ ...inp2, flex: '1 1 160px' }} />
            <input value={r.phone || ''} onChange={e => { const n = [...rows]; n[i] = { ...r, phone: e.target.value }; onChange(n) }} placeholder="Phone" style={{ ...inp2, flex: '1 1 120px' }} />
            <button onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ ...ghostBtn, flexShrink: 0 }}>Remove</button>
          </div>
        ))}
        <button onClick={() => onChange([...rows, { role: '', name: '', email: '', phone: '' }])} style={ghostBtn}>+ Add attendee</button>
      </div>
    )
  }

  if (type === 'team') {
    return (
      <div style={{ padding: '10px 0' }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{label}</div>
        {editing ? (
          <select value={value || ''} onChange={e => onChange(e.target.value)} style={inp2}>
            <option value="">Select…</option>
            {team.map(m => { const nm = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.name; return <option key={m.id} value={nm}>{nm}</option> })}
          </select>
        ) : <div style={{ fontSize: 14, color: value ? INK : '#bbb' }}>{value || '—'}</div>}
      </div>
    )
  }

  // text / long / date
  return (
    <div style={{ padding: '10px 0' }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{label}</div>
      {editing ? (
        type === 'long'
          ? <textarea value={value || ''} onChange={e => onChange(e.target.value)} style={{ ...inp2, minHeight: 70, fontFamily: 'inherit' }} />
          : <input type={type === 'date' ? 'date' : 'text'} value={value || ''} onChange={e => onChange(e.target.value)} style={inp2} />
      ) : <div style={{ fontSize: 14, color: value ? INK : '#bbb', whiteSpace: 'pre-wrap' }}>{value || '—'}</div>}
    </div>
  )
}
