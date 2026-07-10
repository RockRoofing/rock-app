import { useState, useEffect } from 'react'
import { PRESTART_SECTIONS as DEFAULT_SECTIONS } from '../lib/preStartSchema'
import { INK, GOLD, Loading, EmptyCard, primaryBtn, ghostBtn, linkBtn, inp2, fmtDateTime } from './opsUI'

const teamName = (m) => [m.firstName, m.lastName].filter(Boolean).join(' ') || m.name || ''

// Pre-Start Meeting Minutes for a project. Editable in the portal like the IHM.
// Draft → Sent workflow: once sent, the record is fully locked.
export default function PreStartForm({ projectNo }) {
  const [data, setData] = useState(null)      // saved record
  const [form, setForm] = useState(null)      // working copy while editing
  const [ihm, setIhm] = useState(null)
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState(false)
  const [doc, setDoc] = useState(null)
  const [extraSections, setExtraSections] = useState({}) // sectionId -> [customRows]
  const [SECTIONS, setSECTIONS] = useState(DEFAULT_SECTIONS)

  useEffect(() => { load() }, [projectNo])
  useEffect(() => {
    // Load the (possibly admin-edited) template. Applies to new forms.
    fetch('/api/templates?key=prestart').then(r => r.json()).then(d => {
      if (Array.isArray(d.sections) && d.sections.length) setSECTIONS(d.sections)
    }).catch(() => {})
  }, [])
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
      setTeam((tm?.members || []).filter(m => m.active !== false))
      if (!ps?.data) setEditing(true)
    } catch {}
    setLoading(false)
  }

  const isSent = data?.stage === 'sent'

  function startEdit() {
    if (isSent) return
    const seed = JSON.parse(JSON.stringify(data || {}))
    for (const sec of SECTIONS) {
      for (const f of sec.fields) {
        if (f.type === 'qrow') {
          if (!seed[f.id]) seed[f.id] = { resolved: '', comments: f.default || '' }
          else if (seed[f.id].comments == null) seed[f.id].comments = f.default || ''
        }
      }
    }
    setForm(seed)
    setExtraSections(seed.customRows || {})
    setEditing(true)
  }

  // Keep "Completed by" auto-added to Rock attendees.
  useEffect(() => {
    if (!editing || !form?.completedBy) return
    const member = team.find(m => teamName(m) === form.completedBy)
    if (!member) return
    const rock = Array.isArray(form.attendeesRock) ? form.attendeesRock : []
    if (rock.some(r => r.name === form.completedBy)) return
    const row = { role: member.role || '', name: teamName(member), email: member.email || '', phone: member.phone || '', _auto: true }
    setForm(f => ({ ...f, attendeesRock: [row, ...rock.filter(r => !r._auto)] }))
  }, [form?.completedBy, editing]) // eslint-disable-line

  function setField(id, v) { setForm(prev => ({ ...(prev || {}), [id]: v })) }

  function buildPayload() {
    return { ...form, customRows: extraSections }
  }

  async function saveDraft() {
    setSaving(true)
    try {
      const payload = { ...buildPayload(), stage: 'draft' }
      const r = await fetch('/api/pre-start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, data: payload }) })
      const d = await r.json()
      if (r.ok) { setData(d.data); setEditing(false) } else alert(d.error || 'Save failed')
    } catch (e) { alert(e?.message || 'Save failed') }
    setSaving(false)
  }

  async function markSentManually() {
    if (!confirm('Mark these minutes as sent? This will lock the document and cannot be undone.')) return
    setSaving(true)
    try {
      const payload = { ...buildPayload(), stage: 'sent', sentAt: Date.now(), sentManually: true, recipients: allAttendeeEmails() }
      const r = await fetch('/api/pre-start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, data: payload }) })
      const d = await r.json()
      if (r.ok) { setData(d.data); setEditing(false) } else alert(d.error || 'Save failed')
    } catch (e) { alert(e?.message || 'Save failed') }
    setSaving(false)
  }

  function allAttendeeEmails() {
    const rock = (form?.attendeesRock || []).map(a => a.email).filter(Boolean)
    const cust = (form?.attendeesCustomer || []).map(a => a.email).filter(Boolean)
    return [...new Set([...rock, ...cust])]
  }

  async function saveAndSend() {
    const emails = allAttendeeEmails()
    if (!emails.length) { alert('Add at least one attendee with an email address before sending.'); return }
    if (!confirm(`Send the Pre-Start Minutes as a PDF to ${emails.length} attendee(s)? Once sent, the document is locked and cannot be edited.`)) return
    setSending(true)
    try {
      // First save as draft so the server has the latest data to render.
      const payload = { ...buildPayload(), stage: 'draft' }
      await fetch('/api/pre-start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, data: payload }) })
      // Then trigger send (server generates PDF, emails attendees, locks record).
      const r = await fetch('/api/pre-start-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo }) })
      const d = await r.json()
      if (r.ok) { setData(d.data); setEditing(false); alert('Pre-Start Minutes sent and locked.') }
      else alert(d.error || 'Send failed')
    } catch (e) { alert(e?.message || 'Send failed') }
    setSending(false)
  }

  function downloadPDF() { window.open(`/api/pre-start-pdf?no=${encodeURIComponent(projectNo)}`, '_blank') }

  if (loading) return <Loading />

  const src = editing ? form : data
  const scopeFilesIHM = Array.isArray(ihm?.scopeFiles) ? ihm.scopeFiles : []

  return (
    <div>
      {/* Stage banner */}
      {data && (
        isSent ? (
          <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, padding: '12px 16px', marginBottom: 16, color: '#065f46', fontSize: 13.5 }}>
            <strong>Complete{data.sentManually ? ' (marked manually)' : ' — sent'}</strong>{data.sentAt ? ` ${fmtDateTime(data.sentAt)}` : ''}{Array.isArray(data.recipients) && data.recipients.length ? ` · to ${data.recipients.join(', ')}` : ''}. This document is locked and cannot be edited.
          </div>
        ) : (
          <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: '12px 16px', marginBottom: 16, color: '#92400e', fontSize: 13.5 }}>
            <strong>Draft</strong> — these minutes have not been sent yet. Use “Save &amp; send” to issue them to attendees.
          </div>
        )
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Pre-Start Meeting Minutes</div>
          <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>{data ? `Last saved ${fmtDateTime(data.updatedAt)}` : 'Not yet completed'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {data && <button onClick={downloadPDF} style={ghostBtn}>Download PDF</button>}
          {!editing && !isSent && <button onClick={startEdit} style={primaryBtn}>{data ? 'Edit' : 'Complete Pre-Start Minutes'}</button>}
          {editing && <>
            <button onClick={saveDraft} disabled={saving || sending} style={ghostBtn}>{saving ? 'Saving…' : 'Save as draft'}</button>
            <button onClick={saveAndSend} disabled={saving || sending} style={primaryBtn}>{sending ? 'Sending…' : 'Save & send'}</button>
            {data?.stage === 'draft' && <button onClick={markSentManually} disabled={saving || sending} style={ghostBtn}>Mark as sent</button>}
            {data && <button onClick={() => setEditing(false)} style={{ ...ghostBtn, color: '#999' }}>Cancel</button>}
          </>}
        </div>
      </div>

      {!data && !editing ? (
        <EmptyCard title="No Pre-Start Minutes yet" body="Click “Complete Pre-Start Minutes” to fill them in." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {SECTIONS.map(sec => (
            <div key={sec.id} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: GOLD, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>{sec.title}</div>

              {sec.fields.map(f => (
                <FieldRow key={f.id} field={f} value={src?.[f.id]} editing={editing} team={team}
                  ihmDocs={f.id === 'scopeFiles' ? scopeFilesIHM.filter(d => !(src?.dismissedIhmDocs || []).includes(d.url)) : null}
                  onView={setDoc}
                  onDismissIhm={f.id === 'scopeFiles' ? (remaining => {
                    // remaining = the IHM docs still shown; anything missing is dismissed
                    const remainingUrls = remaining.map(d => d.url)
                    const dismissed = scopeFilesIHM.filter(d => !remainingUrls.includes(d.url)).map(d => d.url)
                    setField('dismissedIhmDocs', [...new Set([...(src?.dismissedIhmDocs || []), ...dismissed])])
                  }) : null}
                  onChange={nv => setField(f.id, nv)} />
              ))}

              {/* Custom user-added rows for this section */}
              {!sec.noCustom && (
                <CustomRows sectionId={sec.id} rows={extraSections[sec.id] || (src?.customRows?.[sec.id]) || []} editing={editing}
                  onChange={rows => setExtraSections(prev => ({ ...prev, [sec.id]: rows }))} />
              )}
            </div>
          ))}
        </div>
      )}

      {doc && <DocViewer doc={doc} onClose={() => setDoc(null)} />}
    </div>
  )
}

function CustomRows({ sectionId, rows, editing, onChange }) {
  const list = Array.isArray(rows) ? rows : []
  if (!editing && !list.length) return null
  return (
    <div style={{ marginTop: list.length ? 8 : 0 }}>
      {list.map((r, i) => (
        <div key={i} style={{ padding: '12px 0', borderTop: '1px dashed #eee' }}>
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input value={r.label || ''} onChange={e => { const n = [...list]; n[i] = { ...r, label: e.target.value }; onChange(n) }} placeholder="Item / description" style={{ ...inp2, fontWeight: 600 }} />
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <select value={r.resolved || ''} onChange={e => { const n = [...list]; n[i] = { ...r, resolved: e.target.value }; onChange(n) }} style={{ ...inp2, width: 130, flexShrink: 0 }}>
                  <option value="">Resolved?</option><option value="Y">Yes</option><option value="N">No</option><option value="NA">N/A</option>
                </select>
                <textarea value={r.comments || ''} onChange={e => { const n = [...list]; n[i] = { ...r, comments: e.target.value }; onChange(n) }} placeholder="Comments" style={{ ...inp2, flex: 1, minWidth: 240, minHeight: 60, fontFamily: 'inherit' }} />
                <button onClick={() => onChange(list.filter((_, j) => j !== i))} style={ghostBtn}>Remove</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13.5, color: INK, fontWeight: 600, marginBottom: 6 }}>{r.label}</div>
              <ResolvedRow resolved={r.resolved} comments={r.comments} />
            </div>
          )}
        </div>
      ))}
      {editing && <button onClick={() => onChange([...list, { label: '', resolved: '', comments: '' }])} style={{ ...ghostBtn, marginTop: 8 }}>+ Add item to this section</button>}
    </div>
  )
}

function ResolvedRow({ resolved, comments }) {
  const map = {
    Y: { t: 'Resolved', bg: '#ecfdf5', c: '#065f46' },
    N: { t: 'Outstanding', bg: '#fef2f2', c: '#991b1b' },
    NA: { t: 'N/A', bg: '#eef2ff', c: '#3730a3' },
  }
  const s = map[resolved] || { t: '—', bg: '#f3f4f6', c: '#9ca3af' }
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 20, padding: '2px 10px', flexShrink: 0, background: s.bg, color: s.c }}>{s.t}</span>
      <span style={{ fontSize: 14, color: comments ? INK : '#bbb', whiteSpace: 'pre-wrap' }}>{comments || '—'}</span>
    </div>
  )
}

function FieldRow({ field, value, editing, team, ihmDocs, onView, onChange, onDismissIhm }) {
  const { type, label, help } = field

  if (type === 'qrow') {
    const v = value || { resolved: '', comments: '' }
    return (
      <div style={{ padding: '12px 0', borderBottom: '1px solid #f4f4f2' }}>
        <div style={{ fontSize: 13.5, color: INK, marginBottom: 8, fontWeight: 500 }}>{label}</div>
        {editing ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <select value={v.resolved || ''} onChange={e => onChange({ ...v, resolved: e.target.value })} style={{ ...inp2, width: 130, flexShrink: 0 }}>
              <option value="">Resolved?</option><option value="Y">Yes</option><option value="N">No</option><option value="NA">N/A</option>
            </select>
            <textarea value={v.comments || ''} onChange={e => onChange({ ...v, comments: e.target.value })} placeholder="Comments — describe what was discussed" style={{ ...inp2, flex: 1, minWidth: 240, minHeight: 64, fontFamily: 'inherit' }} />
          </div>
        ) : <ResolvedRow resolved={v.resolved} comments={v.comments} />}
      </div>
    )
  }

  if (type === 'files') {
    const own = Array.isArray(value) ? value : []
    const ihm = Array.isArray(ihmDocs) ? ihmDocs : []
    return (
      <div style={{ padding: '10px 0', borderBottom: '1px solid #f4f4f2' }}>
        <div style={{ fontSize: 13.5, color: INK, marginBottom: 4, fontWeight: 500 }}>{label}</div>
        {help && <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>{help}</div>}
        <FileGrid files={own} editing={editing} onView={onView} onChange={onChange} />
        {ihm.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>From Internal Handover Minutes:</div>
            <FileGrid files={ihm} editing={editing} onView={onView} onChange={onDismissIhm} allowRemoveOnly />
          </div>
        )}
      </div>
    )
  }

  if (type === 'attendeesRock') {
    const rows = Array.isArray(value) ? value : []
    return (
      <div style={{ padding: '10px 0' }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{label}</div>
        {!editing ? (
          !rows.length ? <div style={{ fontSize: 13, color: '#bbb' }}>—</div> :
            rows.map((r, i) => <div key={i} style={{ fontSize: 13.5, color: INK }}>{[r.role, r.name, r.email, r.phone].filter(Boolean).join(' · ')}</div>)
        ) : (
          <>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={r.name || ''} onChange={e => {
                  const m = team.find(t => teamName(t) === e.target.value)
                  const n = [...rows]; n[i] = m ? { role: m.role || '', name: teamName(m), email: m.email || '', phone: m.phone || '' } : { ...r, name: e.target.value }; onChange(n)
                }} style={{ ...inp2, flex: '1 1 200px' }}>
                  <option value="">Select team member…</option>
                  {team.map(m => <option key={m.id} value={teamName(m)}>{teamName(m)}{m.role ? ` — ${m.role}` : ''}</option>)}
                </select>
                <span style={{ fontSize: 12.5, color: '#888', flex: '1 1 180px' }}>{[r.email, r.phone].filter(Boolean).join(' · ') || 'no contact details on file'}</span>
                <button onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ ...ghostBtn, flexShrink: 0 }}>Remove</button>
              </div>
            ))}
            <button onClick={() => onChange([...rows, { role: '', name: '', email: '', phone: '' }])} style={ghostBtn}>+ Add Rock Roofing attendee</button>
          </>
        )}
      </div>
    )
  }

  if (type === 'attendees') {
    const rows = Array.isArray(value) ? value : []
    return (
      <div style={{ padding: '10px 0' }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{label}</div>
        {!editing ? (
          !rows.length ? <div style={{ fontSize: 13, color: '#bbb' }}>—</div> :
            rows.map((r, i) => <div key={i} style={{ fontSize: 13.5, color: INK }}>{[r.role, r.name, r.email, r.phone].filter(Boolean).join(' · ')}</div>)
        ) : (
          <>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                <input value={r.role || ''} onChange={e => { const n = [...rows]; n[i] = { ...r, role: e.target.value }; onChange(n) }} placeholder="Role / company" style={{ ...inp2, flex: '1 1 120px' }} />
                <input value={r.name || ''} onChange={e => { const n = [...rows]; n[i] = { ...r, name: e.target.value }; onChange(n) }} placeholder="Name" style={{ ...inp2, flex: '1 1 120px' }} />
                <input value={r.email || ''} onChange={e => { const n = [...rows]; n[i] = { ...r, email: e.target.value }; onChange(n) }} placeholder="Email" style={{ ...inp2, flex: '1 1 160px' }} />
                <input value={r.phone || ''} onChange={e => { const n = [...rows]; n[i] = { ...r, phone: e.target.value }; onChange(n) }} placeholder="Phone" style={{ ...inp2, flex: '1 1 120px' }} />
                <button onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ ...ghostBtn, flexShrink: 0 }}>Remove</button>
              </div>
            ))}
            <button onClick={() => onChange([...rows, { role: '', name: '', email: '', phone: '' }])} style={ghostBtn}>+ Add customer attendee</button>
          </>
        )}
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
            {team.map(m => <option key={m.id} value={teamName(m)}>{teamName(m)}</option>)}
          </select>
        ) : <div style={{ fontSize: 14, color: value ? INK : '#bbb' }}>{value || '—'}</div>}
      </div>
    )
  }

  if (type === 'note') {
    return (
      <div style={{ padding: '10px 0' }}>
        <div style={{ fontSize: 13, color: '#666', background: '#f7f6f4', borderRadius: 8, padding: '10px 12px', whiteSpace: 'pre-wrap' }}>{label}</div>
      </div>
    )
  }

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

function FileGrid({ files, editing, onView, onChange, readOnly, allowRemoveOnly }) {
  const [uploading, setUploading] = useState(false)
  async function add(fileList) {
    if (!fileList?.length) return
    setUploading(true)
    const next = [...files]
    for (const file of Array.from(fileList)) {
      try {
        const up = await fetch('/api/upload-file', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name), 'x-content-type': file.type || 'application/octet-stream' }, body: file })
        const d = await up.json(); if (up.ok && d.url) next.push({ url: d.url, name: file.name, type: file.type })
      } catch (e) { console.error(e) }
    }
    onChange(next); setUploading(false)
  }
  const isImg = (f) => (f.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(f.name || f.url || '')
  return (
    <div>
      {files.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10 }}>
          {files.map((f, i) => (
            <div key={i} style={{ border: '1px solid #ececec', borderRadius: 10, overflow: 'hidden' }}>
              <div onClick={() => onView(f)} style={{ height: 84, background: '#f7f6f4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isImg(f) ? <img src={f.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ fontSize: 26, color: '#bbb' }}>📄</div>}
              </div>
              <div style={{ padding: '7px 9px' }}>
                <div style={{ fontSize: 11.5, color: INK, fontWeight: 600, wordBreak: 'break-word' }}>{f.name}</div>
                <div style={{ display: 'flex', gap: 10, marginTop: 5 }}>
                  <button onClick={() => onView(f)} style={{ ...linkBtn, padding: 0 }}>View</button>
                  <a href={f.url} download={f.name} target="_blank" rel="noreferrer" style={{ ...linkBtn, padding: 0, textDecoration: 'none' }}>Download</a>
                  {editing && !readOnly && <button onClick={() => onChange(files.filter((_, j) => j !== i))} style={{ ...linkBtn, padding: 0, color: '#dc2626' }}>Remove</button>}
                  {editing && allowRemoveOnly && <button onClick={() => onChange(files.filter((_, j) => j !== i))} style={{ ...linkBtn, padding: 0, color: '#dc2626' }}>Remove</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && !readOnly && !allowRemoveOnly && (
        <div style={{ marginTop: files.length ? 10 : 0 }}>
          <label style={{ ...ghostBtn, display: 'inline-block' }}>
            {uploading ? 'Uploading…' : '+ Upload file'}
            <input type="file" accept="application/pdf,image/*" multiple style={{ display: 'none' }} onChange={e => add(e.target.files)} />
          </label>
        </div>
      )}
    </div>
  )
}

function DocViewer({ doc, onClose }) {
  const img = (doc.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(doc.name || doc.url || '')
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', color: '#fff' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{doc.name}</div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 26, cursor: 'pointer' }}>×</button>
      </div>
      <div onClick={e => e.stopPropagation()} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto' }}>
        {img ? <img src={doc.url} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          : <iframe src={doc.url} title={doc.name} style={{ width: '100%', height: '100%', border: 'none', background: '#fff', borderRadius: 8 }} />}
      </div>
    </div>
  )
}
