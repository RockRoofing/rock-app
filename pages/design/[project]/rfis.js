import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { upload } from '@vercel/blob/client'
import { useDesignProjectAuth, DesignNav, PURPLE, INK } from '../../../lib/designShell'

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

  useEffect(() => { if (auth.ready && projectNo) load() }, [auth.ready, projectNo])
  async function load() {
    setLoading(true)
    try {
      const d = await fetch(`/api/design-rfis?no=${encodeURIComponent(projectNo)}`).then(r => r.json())
      setRfis(d.rfis || []); setPeople(d.people || []); setCanEdit(!!d.canEdit); setMeId(d.meId || '')
    } catch {}
    setLoading(false)
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
  async function addComment(id, html) {
    const r = await fetch('/api/design-rfis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'comment', id, html }) })
    const d = await r.json()
    if (r.ok) setRfis(rs => rs.map(x => x.id === id ? d.rfi : x)); else alert(d.error || 'Could not comment')
  }

  if (!auth.ready) return null
  const openRfi = rfis.find(r => r.id === openId)

  return (
    <>
      <Head><title>RFIs - Design</title></Head>
      <DesignNav active="rfis" projectNo={projectNo} projectName={auth.project?.name} isInternal={auth.isInternal} />
      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '22px 28px 60px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: '0 0 2px', color: INK, fontSize: 24 }}>RFIs</h1>
            <p style={{ color: '#8a857c', fontSize: 14, margin: 0 }}>Requests for Information. {canEdit ? 'Create, track and resolve.' : 'View and comment.'}</p>
          </div>
          {canEdit && <button onClick={() => setEditing({ description: '', requiredDate: '', responsibleUserId: '', attachments: [] })} style={btnPrimary}>+ Add RFI</button>}
        </div>

        {loading ? <div style={{ color: '#999', padding: 20 }}>Loading...</div> : (
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead><tr style={{ background: '#faf9f7' }}>
                {['RFI', 'Issued', 'Description', 'Required by', 'Responsible', 'Status', 'Comments', ''].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rfis.map(r => {
                  const light = dueLight(r.requiredDate, r.status)
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid #f0f0f0', cursor: 'pointer' }} onClick={() => setOpenId(r.id)}>
                      <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.number}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(r.issuedAt)}</td>
                      <td style={{ ...td, maxWidth: 380 }}><div style={{ whiteSpace: 'pre-wrap' }}>{r.description || '-'}</div></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {r.requiredDate ? fmtDate(new Date(r.requiredDate).getTime()) : '-'}
                        {light && <span style={{ marginLeft: 8, background: light.bg, color: light.color, borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{light.label}</span>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{personName(r.responsibleUserId) || '-'}</td>
                      <td style={td}>{r.status === 'resolved' ? <Pill c="#16a34a" bg="#dcfce7">Resolved</Pill> : <Pill c="#2563eb" bg="#dbeafe">Open</Pill>}</td>
                      <td style={td}>{(r.comments || []).length || '-'}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => setOpenId(r.id)} style={linkBtn}>Open</button>
                        {canEdit && <button onClick={() => setEditing(r)} style={linkBtn}>Edit</button>}
                        {canEdit && <button onClick={() => del(r.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>}
                      </td>
                    </tr>
                  )
                })}
                {!rfis.length && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#aaa', padding: 26 }}>No RFIs yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <RfiEditor rfi={editing} people={people} onClose={() => setEditing(null)} onSave={saveRfi} />}
      {openRfi && <RfiDetail rfi={openRfi} people={people} personName={personName} canEdit={canEdit}
        onClose={() => setOpenId(null)} onComment={addComment} onStatus={setStatus} onEdit={() => { setEditing(openRfi); setOpenId(null) }} onDelete={() => del(openRfi.id)} />}
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

function RfiDetail({ rfi, people, personName, canEdit, onClose, onComment, onStatus, onEdit, onDelete }) {
  const light = dueLight(rfi.requiredDate, rfi.status)
  return (
    <Modal onClose={onClose} title={rfi.number} wide>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        {rfi.status === 'resolved' ? <Pill c="#16a34a" bg="#dcfce7">Resolved</Pill> : <Pill c="#2563eb" bg="#dbeafe">Open</Pill>}
        {light && <span style={{ background: light.bg, color: light.color, borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>{light.label}</span>}
        <div style={{ flex: 1 }} />
        {canEdit && <button onClick={() => onStatus(rfi.id, rfi.status === 'resolved' ? 'open' : 'resolved')} style={btnGhost}>{rfi.status === 'resolved' ? 'Re-open' : 'Mark resolved'}</button>}
        {canEdit && <button onClick={onEdit} style={btnGhost}>Edit</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13.5, marginBottom: 14 }}>
        <Info label="Issued">{fmtDate(rfi.issuedAt)}</Info>
        <Info label="Required by">{rfi.requiredDate ? fmtDate(new Date(rfi.requiredDate).getTime()) : '-'}</Info>
        <Info label="Customer responsible">{personName(rfi.responsibleUserId) || '-'}</Info>
        <Info label="Comments">{(rfi.comments || []).length}</Info>
      </div>
      <Info label="Description"><div style={{ whiteSpace: 'pre-wrap' }}>{rfi.description || '-'}</div></Info>

      {(rfi.attachments || []).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Lbl>Attachments</Lbl>
          {(rfi.attachments || []).map((a, i) => (
            <div key={i} style={{ fontSize: 13, padding: '3px 0' }}>
              <a href={`/api/download?url=${encodeURIComponent(a.url)}&name=${encodeURIComponent(a.name)}&inline=1`} target="_blank" rel="noreferrer" style={{ color: PURPLE, textDecoration: 'none', fontWeight: 600 }}>{a.name}</a>
            </div>
          ))}
        </div>
      )}

      <div style={{ borderTop: '1px solid #eee', margin: '16px 0 10px' }} />
      <Lbl>Comments</Lbl>
      <div style={{ maxHeight: 300, overflowY: 'auto', margin: '8px 0' }}>
        {(rfi.comments || []).length === 0 && <div style={{ color: '#aaa', fontSize: 13, padding: '6px 0' }}>No comments yet.</div>}
        {(rfi.comments || []).map(c => (
          <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid #f4f4f4' }}>
            <div style={{ fontSize: 12, color: '#8a857c', marginBottom: 2 }}>
              <strong style={{ color: c.external ? '#9333ea' : '#1a1a19' }}>{c.authorName}</strong>
              {c.external && <span style={{ marginLeft: 6, fontSize: 10.5, background: '#f3e8ff', color: '#7c3aed', borderRadius: 10, padding: '1px 6px', fontWeight: 700 }}>Customer</span>}
              <span style={{ marginLeft: 8 }}>{fmtDateTime(c.at)}</span>
            </div>
            <div style={{ fontSize: 13.5, color: '#222' }} dangerouslySetInnerHTML={{ __html: c.html }} />
          </div>
        ))}
      </div>
      <CommentBox people={people} onSubmit={(html) => onComment(rfi.id, html)} />
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

function Modal({ title, children, onClose, wide }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 100, overflowY: 'auto', padding: '4vh 16px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 24, width: wide ? 720 : 560, maxWidth: '95vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 19, color: INK }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999' }}>&times;</button>
        </div>
        {children}
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
