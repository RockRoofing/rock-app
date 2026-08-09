import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { upload } from '@vercel/blob/client'
import { useDesignProjectAuth, DesignNav, PURPLE, INK } from '../../../lib/designShell'
import DrawingMarkup from '../../../components/DrawingMarkup'

const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
const fmtDateTime = (ts) => ts ? new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

// Traffic light on required response date. No green (per spec): orange = upcoming
// (due within 5 days), red = overdue. Resolved RFIs get no light.
function dueLight(requiredDate, status) {
  if (status === 'resolved' || !requiredDate) return null
  const due = new Date(requiredDate + 'T23:59:59')
  const days = Math.ceil((due - new Date()) / 86400000)
  if (days < 0) return { color: '#dc2626', label: 'Overdue', bg: '#fee2e2' }
  if (days <= 5) return { color: '#d97706', label: `Due in ${days}d`, bg: '#fef3c7' }
  return null
}

export default function RFIsPage() {
  const router = useRouter()
  const projectNo = router.query.project ? String(router.query.project) : ''
  const auth = useDesignProjectAuth(projectNo)
  const [rfis, setRfis] = useState([])
  const [people, setPeople] = useState([])
  const [canEdit, setCanEdit] = useState(false)
  const [meId, setMeId] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [unread, setUnread] = useState([])
  const [sending, setSending] = useState(false)

  async function sendReminders() {
    const outstanding = rfis.filter(r => r.status !== 'resolved').length
    if (!outstanding) { alert('There are no outstanding RFIs to send reminders for.'); return }
    if (!confirm(`Send the outstanding RFI list (${outstanding} item${outstanding === 1 ? '' : 's'}) to everyone assigned to this project?`)) return
    setSending(true)
    try {
      const r = await fetch('/api/design-rfis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'send-reminders' }) })
      const d = await r.json()
      if (r.ok) alert(d.sent ? `Reminder sent to ${d.sent} recipient${d.sent === 1 ? '' : 's'}.` : (d.message || 'Nothing sent.'))
      else alert(d.error || 'Could not send reminders.')
    } catch { alert('Could not send reminders.') }
    setSending(false)
  }

  useEffect(() => { if (auth.ready && projectNo) load() }, [auth.ready, projectNo])
  // Deep-link from notification emails: /design/<no>/rfis?open=<rfiId>
  useEffect(() => {
    const openParam = router.query.open ? String(router.query.open) : ''
    if (openParam && rfis.some(r => r.id === openParam)) openRfi(openParam)
  }, [router.query.open, rfis])
  async function load() {
    setLoading(true)
    try {
      const d = await fetch(`/api/design-rfis?no=${encodeURIComponent(projectNo)}`).then(r => r.json())
      setRfis(d.rfis || []); setPeople(d.people || []); setCanEdit(!!d.canEdit); setMeId(d.meId || ''); setUnread(d.unread || [])
    } catch {}
    setLoading(false)
  }
  // Open an RFI and mark it read for this user (clears its unread flag).
  function openRfi(id) {
    setOpenId(id)
    if (unread.includes(id)) {
      setUnread(u => u.filter(x => x !== id))
      fetch('/api/design-rfis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'mark-read', id }) }).catch(() => {})
    }
  }
  const personName = (id) => { const p = people.find(x => x.id === id); return p ? p.name : '' }

  async function saveRfi(rfi) {
    const action = rfi.id ? 'update' : 'create'
    const r = await fetch('/api/design-rfis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action, rfi }) })
    const d = await r.json()
    if (r.ok) { setRfis(d.rfis || []); setEditing(null) } else alert(d.error || 'Could not save')
  }
  async function setStatus(id, status) {
    const r = await fetch('/api/design-rfis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'status', id, status }) })
    const d = await r.json(); if (r.ok) setRfis(d.rfis || [])
  }
  async function del(id) {
    if (!confirm('Delete this RFI?')) return
    const r = await fetch('/api/design-rfis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'delete', id }) })
    const d = await r.json(); if (r.ok) { setRfis(d.rfis || []); setOpenId(null) }
  }
  async function saveAttachmentMarkup(id, attachmentUrl, markup) {
    const r = await fetch('/api/design-rfis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'attachment-markup', id, attachmentUrl, markup }) })
    const d = await r.json()
    if (r.ok) setRfis(rs => rs.map(x => x.id === id ? d.rfi : x)); else alert(d.error || 'Could not save markup')
  }
  async function addComment(id, html) {
    const r = await fetch('/api/design-rfis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'comment', id, html }) })
    const d = await r.json()
    if (r.ok) {
      setRfis(rs => rs.map(x => x.id === id ? d.rfi : x))
      const n = d.notify
      if (n && n.mentioned > 0) console.log(`Emailed ${n.sent}/${n.mentioned} mentioned user(s).`)
    } else alert(d.error || 'Could not comment')
  }

  async function addAttachments(id, attachments) {
    const r = await fetch('/api/design-rfis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'add-attachments', id, attachments }) })
    const d = await r.json()
    if (r.ok) setRfis(rs => rs.map(x => x.id === id ? d.rfi : x))
    else alert(d.error || 'Could not add attachments')
    return r.ok
  }

  if (!auth.ready) return null
  const openRfiObj = rfis.find(r => r.id === openId)

  return (
    <>
      <Head><title>RFIs - Design</title></Head>
      <DesignNav active="rfis" projectNo={projectNo} projectName={auth.project?.name} isInternal={auth.isInternal} />
      <div style={{ width: '100%', margin: 0, padding: '22px 24px 60px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: '0 0 2px', color: INK, fontSize: 24 }}>RFIs</h1>
            <p style={{ color: '#8a857c', fontSize: 14, margin: 0 }}>Requests for Information. {canEdit ? 'Create, track and resolve.' : 'View and comment.'}</p>
          </div>
          {canEdit && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={sendReminders} disabled={sending} style={{ ...btnGhost, color: PURPLE, borderColor: '#e9d5ff', opacity: sending ? 0.6 : 1 }}>{sending ? 'Sending...' : 'Send reminders'}</button>
                <button onClick={() => setEditing({ description: '', requiredDate: '', responsibleUserId: '', attachments: [] })} style={btnPrimary}>+ Add RFI</button>
              </div>
              <span style={{ fontSize: 11.5, color: '#a09a90' }}>Reminders are also sent out automatically every 3 working days.</span>
            </div>
          )}
        </div>

        {loading ? <div style={{ color: '#999', padding: 20 }}>Loading...</div> : (
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead><tr style={{ background: '#faf9f7' }}>
                {['RFI', 'Issued', 'Description', 'Required by', 'Responsible', 'Status', 'Attachments', 'Comments', ''].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rfis.map(r => {
                  const light = dueLight(r.requiredDate, r.status)
                  const isUnread = unread.includes(r.id)
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid #f0f0f0', background: isUnread ? '#fff7ed' : undefined }}>
                      <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {isUnread && <span title="New activity - not yet opened" style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#f97316', marginRight: 7, verticalAlign: 'middle' }} />}
                        {r.number}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(r.issuedAt)}</td>
                      <td style={{ ...td, maxWidth: 380 }}><div style={{ whiteSpace: 'pre-wrap' }}>{r.description || '-'}</div></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {r.requiredDate ? fmtDate(new Date(r.requiredDate).getTime()) : '-'}
                        {light && <span style={{ marginLeft: 8, background: light.bg, color: light.color, borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{light.label}</span>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{personName(r.responsibleUserId) || '-'}</td>
                      <td style={td}>{r.status === 'resolved' ? <Pill c="#16a34a" bg="#dcfce7">Resolved</Pill> : <Pill c="#2563eb" bg="#dbeafe">Open</Pill>}</td>
                      <td style={td}>{(r.attachments || []).length ? <span style={{ background: '#f3e8ff', color: '#7c3aed', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>&#128206; {(r.attachments || []).length}</span> : <span style={{ color: '#ccc' }}>-</span>}</td>
                      <td style={td}>{(r.comments || []).length ? <span style={{ fontWeight: isUnread ? 700 : 400, color: isUnread ? '#c2410c' : undefined }}>{(r.comments || []).length}{isUnread ? ' new' : ''}</span> : '-'}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => openRfi(r.id)} style={linkBtn}>Open</button>
                        {canEdit && <button onClick={() => del(r.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>}
                      </td>
                    </tr>
                  )
                })}
                {!rfis.length && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#aaa', padding: 26 }}>No RFIs yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <RfiEditor rfi={editing} people={people} onClose={() => setEditing(null)} onSave={saveRfi} />}
      {openRfiObj && <RfiDetail rfi={openRfiObj} people={people} personName={personName} canEdit={canEdit}
        onClose={() => setOpenId(null)} onComment={addComment} onStatus={setStatus} onSaveEdit={saveRfi} onDelete={() => del(openRfiObj.id)} onMarkup={saveAttachmentMarkup} onAddAttachments={addAttachments} />}
    </>
  )
}

function Pill({ c, bg, children }) { return <span style={{ color: c, background: bg, borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>{children}</span> }

function RfiEditor({ rfi, people, onClose, onSave }) {
  const [f, setF] = useState({ ...rfi })
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef()
  const taRef = useRef()
  useEffect(() => { autogrow() }, [])
  function autogrow() { const el = taRef.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }
  const customers = people.filter(p => p.external)

  async function addFiles(list) {
    if (!list || !list.length) return
    setUploading(true)
    const atts = [...(f.attachments || [])]
    for (const file of Array.from(list)) {
      try {
        const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/blob-upload', contentType: file.type || 'application/octet-stream' })
        atts.push({ name: file.name, url: blob.url, contentType: file.type || '', size: file.size })
      } catch {}
    }
    if (inputRef.current) inputRef.current.value = ''
    setF({ ...f, attachments: atts }); setUploading(false)
  }

  return (
    <Modal onClose={onClose} title={f.id ? `Edit ${f.number}` : 'New RFI'}>
      <Lbl>Description</Lbl>
      <textarea ref={taRef} value={f.description || ''} onChange={e => { setF({ ...f, description: e.target.value }); autogrow() }}
        placeholder="Describe the information being requested..." style={{ ...inp, minHeight: 90, resize: 'none', overflow: 'hidden' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <div>
          <Lbl>Required response date</Lbl>
          <input type="date" value={f.requiredDate || ''} onChange={e => setF({ ...f, requiredDate: e.target.value })} style={inp} />
        </div>
        <div>
          <Lbl>Customer responsible</Lbl>
          <select value={f.responsibleUserId || ''} onChange={e => setF({ ...f, responsibleUserId: e.target.value })} style={inp}>
            <option value="">Select...</option>
            {customers.map(p => <option key={p.id} value={p.id}>{p.name}{p.company ? ` (${p.company})` : ''}</option>)}
          </select>
          {customers.length === 0 && <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 4 }}>No customer users assigned to this project yet.</div>}
        </div>
      </div>

      <Lbl style={{ marginTop: 14 }}>Attachments</Lbl>
      <input ref={inputRef} type="file" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
      <button onClick={() => inputRef.current?.click()} disabled={uploading} style={{ ...btnGhost, marginBottom: 8 }}>{uploading ? 'Uploading...' : '+ Attach files'}</button>
      {(f.attachments || []).map((a, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '4px 0' }}>
          <span>{a.name}</span>
          <button onClick={() => setF({ ...f, attachments: f.attachments.filter((_, j) => j !== i) })} style={{ ...linkBtn, color: '#dc2626' }}>Remove</button>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button onClick={onClose} style={btnGhost}>Cancel</button>
        <button onClick={() => onSave(f)} style={btnPrimary}>{f.id ? 'Save' : 'Create & issue'}</button>
      </div>
    </Modal>
  )
}

function RfiDetail({ rfi, people, personName, canEdit, onClose, onComment, onStatus, onSaveEdit, onDelete, onMarkup, onAddAttachments }) {
  const light = dueLight(rfi.requiredDate, rfi.status)
  const atts = rfi.attachments || []
  const [attIdx, setAttIdx] = useState(0)
  const [editMode, setEditMode] = useState(false)
  const [ef, setEf] = useState(null)          // edit form draft
  const [uploading, setUploading] = useState(false)
  const [addingAtt, setAddingAtt] = useState(false)
  const editRef = useRef()
  const addAttRef = useRef()
  const customers = people.filter(p => p.external)
  const current = atts[attIdx]
  const isViewable = current && ((current.contentType || '').startsWith('image/') || /\.(jpe?g|png|gif|webp|pdf)$/i.test(current.url || '') || (current.contentType || '') === 'application/pdf')

  async function addAttachmentFiles(list) {
    if (!list || !list.length) return
    setAddingAtt(true)
    const picked = []
    for (const file of Array.from(list)) {
      try {
        const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/blob-upload', contentType: file.type || 'application/octet-stream' })
        picked.push({ name: file.name, url: blob.url, contentType: file.type || '', size: file.size })
      } catch {}
    }
    if (addAttRef.current) addAttRef.current.value = ''
    if (picked.length) await onAddAttachments(rfi.id, picked)
    setAddingAtt(false)
  }

  function startEdit() { setEf({ ...rfi, attachments: [...(rfi.attachments || [])] }); setEditMode(true) }
  function cancelEdit() { setEditMode(false); setEf(null) }
  async function saveEdit() { await onSaveEdit(ef); setEditMode(false); setEf(null) }
  async function addEditFiles(list) {
    if (!list || !list.length) return
    setUploading(true)
    const next = [...(ef.attachments || [])]
    for (const file of Array.from(list)) {
      try {
        const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/blob-upload', contentType: file.type || 'application/octet-stream' })
        next.push({ name: file.name, url: blob.url, contentType: file.type || '', size: file.size })
      } catch {}
    }
    if (editRef.current) editRef.current.value = ''
    setEf({ ...ef, attachments: next }); setUploading(false)
  }

  return (
    <Modal onClose={onClose} title={rfi.number} full>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        {rfi.status === 'resolved' ? <Pill c="#16a34a" bg="#dcfce7">Resolved</Pill> : <Pill c="#2563eb" bg="#dbeafe">Open</Pill>}
        {light && <span style={{ background: light.bg, color: light.color, borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>{light.label}</span>}
        <div style={{ flex: 1 }} />
        {/* Mark resolved / re-open is Rock Roofing (internal) only */}
        {canEdit && !editMode && <button onClick={() => onStatus(rfi.id, rfi.status === 'resolved' ? 'open' : 'resolved')} style={btnGhost}>{rfi.status === 'resolved' ? 'Re-open' : 'Mark resolved'}</button>}
        {canEdit && !editMode && <button onClick={startEdit} style={btnGhost}>Edit</button>}
        {canEdit && editMode && <button onClick={cancelEdit} style={btnGhost}>Cancel</button>}
        {canEdit && editMode && <button onClick={saveEdit} style={btnPrimary}>Save</button>}
      </div>

      {!editMode ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13.5, marginBottom: 12 }}>
            <Info label="Issued">{fmtDate(rfi.issuedAt)}</Info>
            <Info label="Required by">{rfi.requiredDate ? fmtDate(new Date(rfi.requiredDate).getTime()) : '-'}</Info>
            <Info label="Customer responsible">{personName(rfi.responsibleUserId) || '-'}</Info>
          </div>
          <Info label="Description"><div style={{ whiteSpace: 'pre-wrap' }}>{rfi.description || '-'}</div></Info>
        </>
      ) : (
        <div style={{ background: '#faf9f7', border: '1px solid #ece9e3', borderRadius: 12, padding: 14, marginBottom: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><Lbl>Issued</Lbl><div style={{ fontSize: 13.5, color: '#666', padding: '9px 0' }}>{fmtDate(rfi.issuedAt)}</div></div>
            <div><Lbl>Required response date</Lbl><input type="date" value={ef.requiredDate || ''} onChange={e => setEf({ ...ef, requiredDate: e.target.value })} style={inp} /></div>
            <div><Lbl>Customer responsible</Lbl>
              <select value={ef.responsibleUserId || ''} onChange={e => setEf({ ...ef, responsibleUserId: e.target.value })} style={inp}>
                <option value="">Select...</option>
                {customers.map(p => <option key={p.id} value={p.id}>{p.name}{p.company ? ` (${p.company})` : ''}</option>)}
              </select>
            </div>
          </div>
          <Lbl>Description</Lbl>
          <textarea value={ef.description || ''} onChange={e => setEf({ ...ef, description: e.target.value })} style={{ ...inp, minHeight: 80, resize: 'vertical' }} />
          <Lbl style={{ marginTop: 12 }}>Attachments</Lbl>
          <input ref={editRef} type="file" multiple style={{ display: 'none' }} onChange={e => addEditFiles(e.target.files)} />
          <button onClick={() => editRef.current?.click()} disabled={uploading} style={{ ...btnGhost, marginBottom: 6 }}>{uploading ? 'Uploading...' : '+ Attach files'}</button>
          {(ef.attachments || []).map((a, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '4px 0' }}>
              <span style={{ wordBreak: 'break-word' }}>{a.name}</span>
              <button onClick={() => setEf({ ...ef, attachments: ef.attachments.filter((_, j) => j !== i) })} style={{ ...linkBtn, color: '#dc2626' }}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {/* Comments - above the markup, in a clear light-blue panel */}
      <div style={{ marginTop: 16, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 14 }}>
        <Lbl style={{ color: '#1e40af' }}>Comments ({(rfi.comments || []).length})</Lbl>
        <div style={{ margin: '8px 0', maxHeight: 260, overflowY: 'auto' }}>
          {(rfi.comments || []).length === 0 && <div style={{ color: '#7c93b8', fontSize: 13, padding: '6px 0' }}>No comments yet.</div>}
          {(rfi.comments || []).map(c => (
            <div key={c.id} style={{ padding: '8px 10px', marginBottom: 8, background: '#fff', border: '1px solid #dbeafe', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#5b6b85', marginBottom: 2 }}>
                <strong style={{ color: c.external ? '#9333ea' : '#1a1a19' }}>{c.authorName}</strong>
                {c.external && <span style={{ marginLeft: 6, fontSize: 10.5, background: '#f3e8ff', color: '#7c3aed', borderRadius: 10, padding: '1px 6px', fontWeight: 700 }}>Customer</span>}
                <span style={{ marginLeft: 8 }}>{fmtDateTime(c.at)}</span>
              </div>
              <div style={{ fontSize: 13.5, color: '#222' }} dangerouslySetInnerHTML={{ __html: c.html }} />
            </div>
          ))}
        </div>
        <CommentBox people={people} onSubmit={(html) => onComment(rfi.id, html)} />
      </div>

      {/* Add attachments - available to everyone (incl. customers) in the open window */}
      <div style={{ marginTop: 16 }}>
        <input ref={addAttRef} type="file" multiple style={{ display: 'none' }} onChange={e => addAttachmentFiles(e.target.files)} />
        <button onClick={() => addAttRef.current?.click()} disabled={addingAtt}
          style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, opacity: addingAtt ? 0.6 : 1 }}>
          {addingAtt ? 'Uploading...' : <>&#128206; Add attachments</>}
        </button>
      </div>

      {/* Attachment markup viewer, embedded (below comments) */}
      {atts.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <Lbl>Attachment{atts.length > 1 ? 's' : ''}</Lbl>
            {atts.length > 1 && atts.map((a, i) => (
              <button key={i} onClick={() => setAttIdx(i)} style={{ ...btnGhost, padding: '5px 10px', background: i === attIdx ? '#7c3aed' : '#fff', color: i === attIdx ? '#fff' : '#333', border: i === attIdx ? 'none' : '1px solid #ddd', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</button>
            ))}
          </div>
          {isViewable
            ? <DrawingMarkup key={current.url} imageUrl={current.url} contentType={current.contentType} initial={current.markup} canEdit onSave={(markup) => onMarkup(rfi.id, current.url, markup)} fileName={current.name} />
            : <div style={{ padding: 24, textAlign: 'center', color: '#888', background: '#faf9fd', borderRadius: 10 }}>This file type can't be previewed - use Download to view it.</div>}
        </div>
      )}

      {canEdit && <div style={{ textAlign: 'right', marginTop: 12 }}><button onClick={onDelete} style={{ ...linkBtn, color: '#dc2626', marginLeft: 0 }}>Delete RFI</button></div>}
    </Modal>
  )
}

function Info({ label, children }) {
  return <div><div style={{ fontSize: 11.5, color: '#999', fontWeight: 600, marginBottom: 2 }}>{label}</div><div style={{ color: '#222' }}>{children}</div></div>
}

function CommentBox({ people, onSubmit }) {
  const ref = useRef()
  const [showMentions, setShowMentions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const cmd = (c) => { document.execCommand(c, false, null); ref.current?.focus() }

  function onInput() {
    const text = ref.current?.innerText || ''
    const m = /@(\w*)$/.exec(text)
    if (m) { setMentionQuery(m[1].toLowerCase()); setShowMentions(true) } else setShowMentions(false)
  }
  function insertMention(p) {
    const el = ref.current
    el.innerHTML = el.innerHTML.replace(/@(\w*)$/, `<span style="background:#f3e8ff;color:#7c3aed;border-radius:4px;padding:0 3px;font-weight:600">@${p.name}</span>&nbsp;`)
    setShowMentions(false)
    el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
  }
  function submit() { const html = ref.current?.innerHTML?.trim(); if (!html) return; onSubmit(html); ref.current.innerHTML = '' }

  const matches = people.filter(p => p.name.toLowerCase().includes(mentionQuery)).slice(0, 6)

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 10, position: 'relative' }}>
      <div style={{ display: 'flex', gap: 6, padding: 6, borderBottom: '1px solid #eee', background: '#fafafa' }}>
        <ToolBtn onClick={() => cmd('bold')} style={{ fontWeight: 800 }}>B</ToolBtn>
        <ToolBtn onClick={() => cmd('italic')} style={{ fontStyle: 'italic' }}>I</ToolBtn>
        <ToolBtn onClick={() => cmd('underline')} style={{ textDecoration: 'underline' }}>U</ToolBtn>
        <span style={{ fontSize: 11.5, color: '#aaa', alignSelf: 'center', marginLeft: 6 }}>Type @ to mention someone</span>
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning onInput={onInput}
        style={{ minHeight: 60, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.5, outline: 'none' }} />
      {showMentions && matches.length > 0 && (
        <div style={{ position: 'absolute', bottom: 46, left: 12, background: '#fff', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.12)', zIndex: 10, minWidth: 220 }}>
          {matches.map(p => (
            <button key={p.id} onClick={() => insertMention(p)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>
              <strong>{p.name}</strong> <span style={{ color: '#999', fontSize: 11.5 }}>{p.company}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 8, borderTop: '1px solid #eee' }}>
        <button onClick={submit} style={btnPrimary}>Comment</button>
      </div>
    </div>
  )
}

function ToolBtn({ onClick, style, children }) {
  return <button type="button" onMouseDown={e => { e.preventDefault(); onClick() }} style={{ minWidth: 30, padding: '4px 8px', border: '1px solid #e0e0e0', background: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 13, ...style }}>{children}</button>
}

function Modal({ title, children, onClose, wide, full }) {
  const inner = full
    ? { width: '96vw', height: '96vh', maxWidth: '96vw', display: 'flex', flexDirection: 'column' }
    : { width: wide ? 720 : 560, maxWidth: '95vw' }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: full ? 'center' : 'flex-start', justifyContent: 'center', zIndex: 100, overflowY: full ? 'hidden' : 'auto', padding: full ? '2vh 2vw' : '4vh 16px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: full ? 18 : 24, ...inner }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flex: '0 0 auto' }}>
          <h2 style={{ margin: 0, fontSize: 19, color: INK }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999' }}>&times;</button>
        </div>
        {full ? <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>{children}</div> : children}
      </div>
    </div>
  )
}

function Lbl({ children, style }) { return <div style={{ fontSize: 12.5, color: '#666', marginBottom: 4, fontWeight: 600, ...style }}>{children}</div> }

const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#8a857c', fontWeight: 600, whiteSpace: 'nowrap' }
const td = { padding: '10px 12px', verticalAlign: 'top' }
const inp = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, fontFamily: 'inherit' }
const btnPrimary = { background: PURPLE, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const btnGhost = { background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }
const linkBtn = { background: 'none', border: 'none', color: PURPLE, cursor: 'pointer', fontSize: 13, marginLeft: 10, fontWeight: 600 }
