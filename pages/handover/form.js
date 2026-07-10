import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import PreContractNav from '../../components/PreContractNav'
import { INK, GOLD, Lbl, inp2, primaryBtn, ghostBtn, Loading } from '../../components/opsUI'
import { IHM_SECTIONS as IHM_DEFAULT, CONTACT_ROLES, emptyRoofType } from '../../lib/ihmSchema'

const tmName = (m) => [m.firstName, m.lastName].filter(Boolean).join(' ') || m.name || ''

function Wrap({ children }) {
  return (
    <>
      <Head><title>Rock Roofing — Internal Handover</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        <PreContractNav active="handover" />
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>{children}</div>
      </div>
    </>
  )
}

export default function Handover() {
  const router = useRouter()
  const { no } = router.query   // editing an existing project?
  const [data, setData] = useState({ siteContacts: [], manufacturerContacts: [], roofTypes: [emptyRoofType()], risks: [], liveTasks: [], scopeFiles: [] })
  const [status, setStatus] = useState('draft')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [openSection, setOpenSection] = useState('meeting')
  const [err, setErr] = useState('')
  const [team, setTeam] = useState([])
  const [mfrBook, setMfrBook] = useState([])
  const [IHM_SECTIONS, setIhmSections] = useState(IHM_DEFAULT)

  useEffect(() => {
    fetch('/api/templates?key=ihm').then(r => r.json()).then(d => {
      if (Array.isArray(d.sections) && d.sections.length) setIhmSections(d.sections)
    }).catch(() => {})
  }, [])

  // Load team members + manufacturer address book (shared context for fields)
  useEffect(() => {
    ;(async () => {
      try { const r = await fetch('/api/team'); const d = await r.json(); setTeam((d.members || []).filter(m => m.active !== false)) } catch {}
      try { const r = await fetch('/api/manufacturers'); const d = await r.json(); setMfrBook(d.contacts || []) } catch {}
    })()
  }, [])

  useEffect(() => {
    if (!no) {
      // New handover — suggest the next J-number after the highest existing one.
      ;(async () => {
        try {
          const r = await fetch('/api/ops-projects')
          const d = await r.json()
          let maxNum = 0
          for (const p of (d.projects || [])) {
            const m = /^J(\d+)$/i.exec((p.projectNo || '').trim())
            if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10))
          }
          const next = 'J' + (maxNum + 1)
          setData(d0 => ({ ...d0, projectNo: d0.projectNo || next }))
        } catch {}
      })()
      return
    }
    setLoading(true)
    ;(async () => {
      try {
        const r = await fetch(`/api/ops-projects?no=${no}`)
        const d = await r.json()
        if (d.project) {
          setData({
            siteContacts: [], manufacturerContacts: [], roofTypes: [emptyRoofType()], risks: [], liveTasks: [], scopeFiles: [],
            ...d.project.data,
          })
          setStatus(d.project.status || 'active')
        }
      } catch {}
      setLoading(false)
    })()
  }, [no])

  function set(id, val) { setData(d => ({ ...d, [id]: val })); setErr('') }

  async function save(finalise) {
    setErr('')
    if (!data.projectNo?.trim() || !data.projectName?.trim()) {
      setErr('Project Name and RR Project Number are required.')
      setOpenSection('project')
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/ops-projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: data, status: finalise ? 'active' : 'draft' }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Could not save'); setSaving(false); return }

      // On Meeting Complete (finalise): create tasks, risks, save manufacturer contacts
      if (finalise) {
        // Sync live tasks
        await fetch('/api/tasks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sync-ihm', projectNo: data.projectNo, projectName: data.projectName, tasks: data.liveTasks || [] }),
        })
        // Sync risks
        await fetch('/api/risks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sync-ihm', projectNo: data.projectNo, projectName: data.projectName,
            risks: (data.risks || []).map(r => ({ description: r.risk, mitigation: r.mitigation, assignee: r.assignee, closeOutDate: r.closeOutDate, closed: r.closed, comments: r.comments })) }),
        })
        // Save manufacturer contacts to the address book for reuse
        for (const c of (data.manufacturerContacts || [])) {
          if (c && c.name) {
            try { await fetch('/api/manufacturers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact: c }) }) } catch {}
          }
        }
      }
      router.push("/handover")
    } catch { setErr('Could not save'); setSaving(false) }
  }

  if (loading) return <Wrap><Loading /></Wrap>

  return (
    <Wrap>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <button onClick={() => router.push("/handover")} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }}>‹ All handovers</button>
      </div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: INK }}>{no ? `Internal Handover — ${no}` : 'New Internal Handover'}</h1>
        <div style={{ color: '#999', fontSize: 13, marginTop: 2 }}>Completing this creates the operations project</div>
      </div>

      {/* Section accordion */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {IHM_SECTIONS.map(section => {
          const isOpen = openSection === section.id
          return (
            <div key={section.id} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden' }}>
              <button onClick={() => setOpenSection(isOpen ? '' : section.id)} style={{
                width: '100%', textAlign: 'left', background: isOpen ? '#fffbeb' : '#fff', border: 'none',
                padding: '14px 18px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: 15, fontWeight: 600, color: INK,
              }}>
                <span>{section.title}</span>
                <span style={{ color: GOLD }}>{isOpen ? '−' : '+'}</span>
              </button>
              {isOpen && (
                <div style={{ padding: '4px 18px 20px' }}>
                  {section.fields.map(f => (
                    <FieldRenderer key={f.id} f={f} value={data[f.id]} onChange={v => set(f.id, v)}
                      team={team} mfrBook={mfrBook} projectNo={data.projectNo} projectName={data.projectName} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: 14, marginTop: 16 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 24, position: 'sticky', bottom: 0, background: '#fafaf9', padding: '12px 0' }}>
        <button onClick={() => save(true)} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Meeting Complete'}</button>
        <button onClick={() => save(false)} disabled={saving} style={ghostBtn}>Save as draft</button>
        <button onClick={() => router.push("/handover")} style={ghostBtn}>Cancel</button>
      </div>
    </Wrap>
  )
}

// ── Field renderer ──────────────────────────────────────────────────────────
function FieldRenderer({ f, value, onChange, team, mfrBook, projectNo, projectName }) {
  if (f.type === 'contacts') return <ContactsField value={value || []} onChange={onChange} />
  if (f.type === 'mfrcontacts') return <MfrContactsField value={value || []} onChange={onChange} book={mfrBook || []} />
  if (f.type === 'rooftypes') return <RoofTypesField value={value || []} onChange={onChange} />
  if (f.type === 'risklog') return <RiskLogField value={value || []} onChange={onChange} team={team} />
  if (f.type === 'livetasks') return <LiveTasksField value={value || []} onChange={onChange} team={team} projectNo={projectNo} projectName={projectName} />
  if (f.type === 'files') return <FilesField label={f.label} value={value || []} onChange={onChange} />

  if (f.type === 'team') {
    // Every team member selectable for every role. Use a real <select> so it
    // opens on click and clearly lists everyone (datalists render unreliably).
    const list = team || []
    return (
      <div style={{ margin: '14px 0' }}>
        <Lbl>{f.label}</Lbl>
        {list.length > 0 ? (
          <select value={value || ''} onChange={e => onChange(e.target.value)} style={inp2}>
            <option value="">Select…</option>
            {list.map(m => <option key={m.id} value={tmName(m)}>{tmName(m)}{m.role ? ` — ${m.role}` : ''}</option>)}
            {value && !list.some(m => tmName(m) === value) && <option value={value}>{value}</option>}
          </select>
        ) : (
          <input value={value || ''} onChange={e => onChange(e.target.value)} style={inp2}
            placeholder="No team members yet — add them in Operations → Team Members" />
        )}
      </div>
    )
  }

  return (
    <div style={{ margin: '14px 0' }}>
      <Lbl>{f.label}{f.required && <span style={{ color: '#dc2626' }}> *</span>}</Lbl>
      {f.help && <div style={{ fontSize: 12, color: '#aaa', marginTop: -4, marginBottom: 4 }}>{f.help}</div>}
      {f.type === 'long'
        ? <textarea value={value || ''} onChange={e => onChange(e.target.value)} rows={2} style={{ ...inp2, resize: 'vertical' }} />
        : f.type === 'date'
        ? <input type="date" value={value || ''} onChange={e => onChange(e.target.value)} style={inp2} />
        : f.type === 'yesno'
        ? <select value={value || ''} onChange={e => onChange(e.target.value)} style={inp2}>
            <option value="">—</option><option>Yes</option><option>No</option><option>N/A</option><option>TBC</option>
          </select>
        : <input value={value || ''} onChange={e => onChange(e.target.value)} style={inp2} />}
    </div>
  )
}

// Repeatable contact rows: title / name / email / phone
function ContactsField({ value, onChange }) {
  function addRow() { onChange([...value, { title: '', name: '', email: '', phone: '' }]) }
  function update(i, k, v) { const n = [...value]; n[i] = { ...n[i], [k]: v }; onChange(n) }
  function remove(i) { onChange(value.filter((_, j) => j !== i)) }
  return (
    <div style={{ margin: '8px 0' }}>
      {value.map((c, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 1.6fr 1.2fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <input list="contactRoles" value={c.title} onChange={e => update(i, 'title', e.target.value)} placeholder="Title/Role" style={inpSm} />
          <input value={c.name} onChange={e => update(i, 'name', e.target.value)} placeholder="Name" style={inpSm} />
          <input value={c.email} onChange={e => update(i, 'email', e.target.value)} placeholder="Email" style={inpSm} />
          <input value={c.phone} onChange={e => update(i, 'phone', e.target.value)} placeholder="Phone" style={inpSm} />
          <button onClick={() => remove(i)} style={removeBtn}>×</button>
        </div>
      ))}
      <datalist id="contactRoles">{CONTACT_ROLES.map(r => <option key={r} value={r} />)}</datalist>
      <button onClick={addRow} style={addBtn}>+ Add contact</button>
    </div>
  )
}

// Repeatable roof-type spec blocks
function RoofTypesField({ value, onChange }) {
  function addType() { onChange([...value, emptyRoofType()]) }
  function updateType(i, patch) { const n = [...value]; n[i] = { ...n[i], ...patch }; onChange(n) }
  function updateRow(ti, ri, k, v) {
    const n = [...value]; const rows = [...n[ti].rows]; rows[ri] = { ...rows[ri], [k]: v }; n[ti] = { ...n[ti], rows }; onChange(n)
  }
  function removeType(i) { onChange(value.filter((_, j) => j !== i)) }
  return (
    <div style={{ margin: '8px 0' }}>
      {value.map((rt, ti) => (
        <div key={ti} style={{ border: '1px solid #eee', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input value={rt.name} onChange={e => updateType(ti, { name: e.target.value })} placeholder={`Roof Type ${ti + 1} name`} style={{ ...inpSm, flex: 1, fontWeight: 600 }} />
            <input value={rt.substrate} onChange={e => updateType(ti, { substrate: e.target.value })} placeholder="Substrate" style={{ ...inpSm, flex: 1 }} />
            <button onClick={() => removeType(ti)} style={removeBtn}>×</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ color: '#999', textAlign: 'left' }}>
              {['Layer', 'Manufacturer', 'Reference', 'Thickness', 'Calc?'].map(h => <th key={h} style={{ padding: '2px 4px', fontWeight: 600 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rt.rows.map((row, ri) => (
                <tr key={ri}>
                  <td style={{ padding: '2px 4px', color: '#666', whiteSpace: 'nowrap' }}>{row.layer}</td>
                  <td style={{ padding: '2px 4px' }}><input value={row.manufacturer} onChange={e => updateRow(ti, ri, 'manufacturer', e.target.value)} style={inpXs} /></td>
                  <td style={{ padding: '2px 4px' }}><input value={row.reference} onChange={e => updateRow(ti, ri, 'reference', e.target.value)} style={inpXs} /></td>
                  <td style={{ padding: '2px 4px' }}><input value={row.thickness} onChange={e => updateRow(ti, ri, 'thickness', e.target.value)} style={inpXs} /></td>
                  <td style={{ padding: '2px 4px' }}><input value={row.calc} onChange={e => updateRow(ti, ri, 'calc', e.target.value)} style={inpXs} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <button onClick={addType} style={addBtn}>+ Add roof type</button>
    </div>
  )
}

// Repeatable risk rows — now with assignee, close-out, closed, comments
function RiskLogField({ value, onChange, team }) {
  function addRow() { onChange([...value, { risk: '', mitigation: '', assignee: '', closeOutDate: '', closed: false, comments: '' }]) }
  function update(i, k, v) { const n = [...value]; n[i] = { ...n[i], [k]: v }; onChange(n) }
  function remove(i) { onChange(value.filter((_, j) => j !== i)) }
  return (
    <div style={{ margin: '8px 0' }}>
      {value.map((r, i) => (
        <div key={i} style={{ border: '1px solid #eee', borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr auto', gap: 8, marginBottom: 8, alignItems: 'start' }}>
            <textarea value={r.risk} onChange={e => update(i, 'risk', e.target.value)} placeholder="Risk" rows={2} style={{ ...inpSm, resize: 'vertical' }} />
            <textarea value={r.mitigation} onChange={e => update(i, 'mitigation', e.target.value)} placeholder="Mitigation" rows={2} style={{ ...inpSm, resize: 'vertical' }} />
            <button onClick={() => remove(i)} style={removeBtn}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'center' }}>
            <select value={r.assignee || ''} onChange={e => update(i, 'assignee', e.target.value)} style={inpSm}>
              <option value="">Assigned to…</option>
              {(team || []).map(m => <option key={m.id} value={tmName(m)}>{tmName(m)}</option>)}
              {r.assignee && !(team || []).some(m => tmName(m) === r.assignee) && <option value={r.assignee}>{r.assignee}</option>}
            </select>
            <input type="date" value={r.closeOutDate || ''} onChange={e => update(i, 'closeOutDate', e.target.value)} style={inpSm} />
            <label style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={!!r.closed} onChange={e => update(i, 'closed', e.target.checked)} /> Closed
            </label>
          </div>
          <textarea value={r.comments || ''} onChange={e => update(i, 'comments', e.target.value)} placeholder="Comments" rows={1} style={{ ...inpSm, resize: 'vertical', marginTop: 8 }} />
        </div>
      ))}
      <button onClick={addRow} style={addBtn}>+ Add risk</button>
    </div>
  )
}

// Live Project Tasks rows — project no/name auto from the handover
function LiveTasksField({ value, onChange, team, projectNo, projectName }) {
  function addRow() { onChange([...value, { description: '', assignee: '', status: 'Open', comments: '' }]) }
  function update(i, k, v) { const n = [...value]; n[i] = { ...n[i], [k]: v }; onChange(n) }
  function remove(i) { onChange(value.filter((_, j) => j !== i)) }
  return (
    <div style={{ margin: '8px 0' }}>
      <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
        Project auto-filled: <strong>{projectNo || '—'}</strong> {projectName ? `· ${projectName}` : ''}. Added to Live Project Tasks on Meeting Complete.
      </div>
      {value.map((t, i) => (
        <div key={i} style={{ border: '1px solid #eee', borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 0.8fr auto', gap: 8, alignItems: 'center' }}>
            <input value={t.description} onChange={e => update(i, 'description', e.target.value)} placeholder="Task description" style={inpSm} />
            <select value={t.assignee || ''} onChange={e => update(i, 'assignee', e.target.value)} style={inpSm}>
              <option value="">Responsible…</option>
              {(team || []).map(m => <option key={m.id} value={tmName(m)}>{tmName(m)}</option>)}
              {t.assignee && !(team || []).some(m => tmName(m) === t.assignee) && <option value={t.assignee}>{t.assignee}</option>}
            </select>
            <select value={t.status || 'Open'} onChange={e => update(i, 'status', e.target.value)} style={inpSm}>
              <option>Open</option><option>Complete</option>
            </select>
            <button onClick={() => remove(i)} style={removeBtn}>×</button>
          </div>
          <textarea value={t.comments || ''} onChange={e => update(i, 'comments', e.target.value)} placeholder="Comments" rows={1} style={{ ...inpSm, resize: 'vertical', marginTop: 8 }} />
        </div>
      ))}
      <button onClick={addRow} style={addBtn}>+ Add task</button>
    </div>
  )
}

// Manufacturer contacts — reusable address book: search existing or add new
function MfrContactsField({ value, onChange, book }) {
  function addRow() { onChange([...value, { title: '', name: '', company: '', email: '', phone: '' }]) }
  function update(i, k, v) { const n = [...value]; n[i] = { ...n[i], [k]: v }; onChange(n) }
  function pick(i, contact) { const n = [...value]; n[i] = { ...contact }; onChange(n) }
  function remove(i) { onChange(value.filter((_, j) => j !== i)) }
  return (
    <div style={{ margin: '8px 0' }}>
      {value.map((c, i) => (
        <div key={i} style={{ border: '1px solid #eee', borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <input list="mfrBook" value={c.name} placeholder="Search saved or type new name…"
              onChange={e => {
                const match = (book || []).find(b => b.name === e.target.value)
                if (match) pick(i, match); else update(i, 'name', e.target.value)
              }} style={{ ...inpSm, flex: 1 }} />
            <button onClick={() => remove(i)} style={removeBtn}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input value={c.title || ''} onChange={e => update(i, 'title', e.target.value)} placeholder="Role (e.g. Sales Rep)" style={inpSm} />
            <input value={c.company || ''} onChange={e => update(i, 'company', e.target.value)} placeholder="Company" style={inpSm} />
            <input value={c.email || ''} onChange={e => update(i, 'email', e.target.value)} placeholder="Email" style={inpSm} />
            <input value={c.phone || ''} onChange={e => update(i, 'phone', e.target.value)} placeholder="Phone" style={inpSm} />
          </div>
        </div>
      ))}
      <datalist id="mfrBook">{(book || []).map(b => <option key={b.id} value={b.name}>{b.company ? `${b.name} — ${b.company}` : b.name}</option>)}</datalist>
      <button onClick={addRow} style={addBtn}>+ Add manufacturer contact</button>
    </div>
  )
}

// File uploads (PDF / image) with fullscreen view
function FilesField({ label, value, onChange }) {
  const [uploading, setUploading] = useState(false)
  const [viewer, setViewer] = useState(null)
  async function handle(files) {
    setUploading(true)
    const next = [...value]
    for (const file of Array.from(files)) {
      try {
        const up = await fetch('/api/upload-file', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name), 'x-content-type': file.type || 'application/octet-stream' }, body: file })
        const d = await up.json()
        if (up.ok && d.url) next.push({ url: d.url, name: file.name, type: file.type })
      } catch (e) { console.error(e) }
    }
    onChange(next); setUploading(false)
  }
  const isImg = (f) => (f.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(f.name || f.url || '')
  return (
    <div style={{ margin: '14px 0' }}>
      <Lbl>{label}</Lbl>
      <label style={{ ...addBtn, display: 'inline-block' }}>
        {uploading ? 'Uploading…' : '+ Upload PDF / image'}
        <input type="file" accept="application/pdf,image/*" multiple style={{ display: 'none' }} onChange={e => handle(e.target.files)} />
      </label>
      {value.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 10, marginTop: 10 }}>
          {value.map((f, i) => (
            <div key={i} style={{ border: '1px solid #eee', borderRadius: 8, padding: 6, textAlign: 'center' }}>
              {isImg(f)
                ? <img src={f.url} alt={f.name} onClick={() => setViewer(f)} style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }} />
                : <a href={f.url} target="_blank" rel="noreferrer" style={{ display: 'block', padding: '20px 0', fontSize: 28 }}>📄</a>}
              <div style={{ fontSize: 11, color: '#666', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
              <button onClick={() => onChange(value.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11 }}>Remove</button>
            </div>
          ))}
        </div>
      )}
      {viewer && (
        <div onClick={() => setViewer(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <img src={viewer.url} alt={viewer.name} style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain' }} />
        </div>
      )}
    </div>
  )
}

const inpSm = { boxSizing: 'border-box', width: '100%', padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13 }
const inpXs = { boxSizing: 'border-box', width: '100%', padding: '5px 7px', border: '1px solid #e8e8e8', borderRadius: 6, fontSize: 12 }
const addBtn = { background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }
const removeBtn = { background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16 }
