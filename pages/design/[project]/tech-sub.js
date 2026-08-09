import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { upload } from '@vercel/blob/client'
import { useDesignProjectAuth, DesignNav, PURPLE, INK } from '../../../lib/designShell'
import DrawingMarkup from '../../../components/DrawingMarkup'

const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'

export default function TechSubPage() {
  const router = useRouter()
  const projectNo = router.query.project ? String(router.query.project) : ''
  const auth = useDesignProjectAuth(projectNo)
  const [docs, setDocs] = useState([])
  const [people, setPeople] = useState([])
  const [canEdit, setCanEdit] = useState(false)
  const [meId, setMeId] = useState('')
  const [isExternal, setIsExternal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [unread, setUnread] = useState([])
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const [approverPick, setApproverPick] = useState(null)
  const addRef = useRef()
  const revRef = useRef()
  const revForId = useRef(null)
  const pendingApprover = useRef('')

  useEffect(() => { if (auth.ready && projectNo) load() }, [auth.ready, projectNo])
  useEffect(() => {
    const openParam = router.query.open ? String(router.query.open) : ''
    if (openParam && docs.some(d => d.id === openParam)) openDoc(openParam)
  }, [router.query.open, docs])

  async function load() {
    setLoading(true); setErr('')
    try {
      const d = await fetch(`/api/design-techsubs?no=${encodeURIComponent(projectNo)}`).then(r => r.json())
      setDocs(d.docs || []); setPeople(d.people || []); setCanEdit(!!d.canEdit); setUnread(d.unread || []); setMeId(d.meId || ''); setIsExternal(!!d.external)
    } catch { setErr('Could not load') }
    setLoading(false)
  }

  function openDoc(id) {
    setOpenId(id)
    if (unread.includes(id)) {
      setUnread(u => u.filter(x => x !== id))
      fetch('/api/design-techsubs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'mark-read', id }) }).catch(() => {})
    }
  }

  async function uploadOne(file) {
    return upload(file.name, file, { access: 'public', handleUploadUrl: '/api/blob-upload', contentType: file.type || 'application/octet-stream' })
  }
  async function addNew(list) {
    if (!list || !list.length) return
    setUploading(true); setErr('')
    try {
      for (const file of Array.from(list)) {
        const blob = await uploadOne(file)
        await fetch('/api/design-techsubs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'add', title: file.name.replace(/\.[^.]+$/, ''), approverId: pendingApprover.current || '', file: { name: file.name, url: blob.url, contentType: file.type || '', size: file.size } }) })
      }
    } catch (e) { setErr(e && e.message ? e.message : 'Upload failed') }
    if (addRef.current) addRef.current.value = ''
    pendingApprover.current = ''
    setUploading(false); load()
  }
  async function addRevision(list) {
    const forId = revForId.current
    if (!list || !list.length || !forId) return
    setUploading(true); setErr('')
    try {
      const file = list[0]
      const blob = await uploadOne(file)
      await fetch('/api/design-techsubs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'add-revision', id: forId, approverId: pendingApprover.current || '', file: { name: file.name, url: blob.url, contentType: file.type || '', size: file.size } }) })
    } catch (e) { setErr(e && e.message ? e.message : 'Upload failed') }
    if (revRef.current) revRef.current.value = ''
    revForId.current = null; pendingApprover.current = ''
    setUploading(false); load()
  }
  // Approver must be chosen before the file picker opens.
  function startAdd() { setApproverPick({ mode: 'add', approverId: '' }) }
  function startRevision(id) { setApproverPick({ mode: 'revision', id, approverId: docFor(id)?.approverId || '' }) }
  function confirmApprover() {
    const p = approverPick; if (!p) return
    pendingApprover.current = p.approverId || ''
    setApproverPick(null)
    if (p.mode === 'add') { if (addRef.current) addRef.current.click() }
    else { revForId.current = p.id; if (revRef.current) revRef.current.click() }
  }
  const docFor = (id) => docs.find(d => d.id === id)
  async function approve(id) {
    if (!confirm('Approve this Tech Sub?')) return
    const r = await fetch('/api/design-techsubs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'approve', id }) })
    const d = await r.json()
    if (r.ok) setDocs(ds => ds.map(x => x.id === id ? d.doc : x)); else alert(d.error || 'Could not approve')
  }

  async function del(id) {
    if (!confirm('Delete this Tech Sub revision?')) return
    await fetch('/api/design-techsubs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'delete', id }) })
    if (openId === id) setOpenId(null)
    load()
  }

  async function addComment(id, html) {
    const r = await fetch('/api/design-techsubs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'comment', id, html }) })
    const d = await r.json()
    if (r.ok) setDocs(ds => ds.map(x => x.id === id ? d.doc : x)); else alert(d.error || 'Could not comment')
  }
  async function saveMarkup(id, markup) {
    const r = await fetch('/api/design-techsubs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'markup', id, markup }) })
    const d = await r.json()
    if (r.ok) setDocs(ds => ds.map(x => x.id === id ? d.doc : x))
  }

  if (!auth.ready) return null
  const openDocObj = docs.find(d => d.id === openId)
  const personName = (id) => { const p = people.find(x => x.id === id); return p ? p.name : '' }
  const customers = people.filter(p => p.external)
  // Only the assigned CUSTOMER approver can approve - never Rock Roofing staff, not once
  // superseded, and not if already approved.
  const canApprove = (d) => {
    if (!d || d.approvalStatus === 'approved' || d.superseded) return false
    if (!isExternal) return false
    return d.approverId === meId
  }

  return (
    <>
      <Head><title>Tech Sub - Design</title></Head>
      <DesignNav active="tech-sub" projectNo={projectNo} projectName={auth.project && auth.project.name} isInternal={auth.isInternal} />
      <input ref={addRef} type="file" accept="application/pdf,image/*" multiple style={{ display: 'none' }} onChange={e => addNew(e.target.files)} />
      <input ref={revRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={e => addRevision(e.target.files)} />
      <div style={{ width: '100%', margin: 0, padding: '22px 24px 60px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ margin: '0 0 2px', color: INK, fontSize: 24 }}>Tech Sub</h1>
            <p style={{ color: '#8a857c', fontSize: 14, margin: 0 }}>Technical submissions. {canEdit ? 'Upload, revise, mark up and comment.' : 'View, mark up and comment.'}</p>
          </div>
          {canEdit && <button onClick={startAdd} disabled={uploading} style={{ ...btnPrimary, opacity: uploading ? 0.6 : 1 }}>{uploading ? 'Uploading...' : '+ Add Tech Sub'}</button>}
        </div>
        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        {loading ? <div style={{ color: '#999', padding: 20 }}>Loading...</div> : (
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead><tr style={{ background: '#faf9f7' }}>
                {['Tech Sub', 'Revision', 'Status', 'Approval', 'Uploaded by', 'Date', 'Comments', ''].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {docs.map(d => {
                  const isUnread = unread.includes(d.id)
                  return (
                    <tr key={d.id} style={{ borderTop: '1px solid #f0f0f0', background: isUnread ? '#fff7ed' : undefined }}>
                      <td style={{ ...td, fontWeight: 700 }}>
                        {isUnread && <span title="New activity - not yet opened" style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#f97316', marginRight: 7, verticalAlign: 'middle' }} />}
                        {d.title || d.name}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}><span style={{ fontWeight: 700, color: '#4338ca', background: '#eef2ff', borderRadius: 6, padding: '2px 8px' }}>Rev {d.revision}</span></td>
                      <td style={td}>{d.superseded
                        ? <span style={{ color: '#b45309', background: '#fef3c7', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>Superseded</span>
                        : <span style={{ color: '#16a34a', background: '#dcfce7', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>Current</span>}</td>
                      <td style={td}>{d.approvalStatus === 'approved'
                        ? <span style={{ color: '#15803d', background: '#dcfce7', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>&#10003; Approved</span>
                        : <span style={{ color: '#9a3412', background: '#ffedd5', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>To Be Approved</span>}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{d.uploadedBy || '-'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(d.uploadedAt)}</td>
                      <td style={td}>{(d.comments || []).length ? <span style={{ fontWeight: isUnread ? 700 : 400, color: isUnread ? '#c2410c' : undefined }}>{(d.comments || []).length}{isUnread ? ' new' : ''}</span> : '-'}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => openDoc(d.id)} style={btnOpen}>Open</button>
                        {d.approvalStatus !== 'approved' && (canApprove(d)) && <button onClick={() => approve(d.id)} style={btnApprove}>Approve</button>}
                        {d.approvalStatus !== 'approved' && !d.superseded && !isExternal && <span style={{ fontSize: 11.5, color: '#9a3412', marginLeft: 8 }}>Awaiting customer approval</span>}
                        {canEdit && !d.superseded && <button onClick={() => startRevision(d.id)} style={linkBtn}>Add New Revision</button>}
                        {canEdit && <button onClick={() => del(d.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>}
                      </td>
                    </tr>
                  )
                })}
                {!docs.length && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#aaa', padding: 26 }}>No Tech Subs yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openDocObj && <TechSubViewer doc={openDocObj} people={people} personName={personName} onClose={() => setOpenId(null)} onComment={addComment} onMarkup={saveMarkup}
        canApprove={canApprove(openDocObj)} onApprove={() => approve(openDocObj.id)} approverName={personName(openDocObj.approverId)} />}

      {approverPick && (
        <div onClick={() => setApproverPick(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, width: 440, maxWidth: '92vw' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 17, color: INK }}>{approverPick.mode === 'add' ? 'Add Tech Sub' : 'Add New Revision'}</h3>
            <p style={{ fontSize: 13, color: '#8a857c', marginTop: 0 }}>Choose the customer who needs to review and approve this Tech Sub. They'll be emailed to review, comment or approve it.</p>
            <label style={{ fontSize: 12, color: '#888', fontWeight: 600 }}>Approver (customer)</label>
            <select value={approverPick.approverId} onChange={e => setApproverPick({ ...approverPick, approverId: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginTop: 4 }}>
              <option value="">Select a customer...</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {customers.length === 0 && <div style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>No customer users are assigned to this project yet. Add one in Admin, or continue without an approver.</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setApproverPick(null)} style={btnGhost}>Cancel</button>
              <button onClick={confirmApprover} style={btnPrimary}>Choose file...</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function TechSubViewer({ doc, people, personName, onClose, onComment, onMarkup, canApprove, onApprove, approverName }) {
  const isViewable = (doc.contentType || '').startsWith('image/') || /\.(jpe?g|png|gif|webp|pdf)$/i.test(doc.url || '') || (doc.contentType || '') === 'application/pdf'
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '2vh 2vw' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 18, width: '96vw', height: '96vh', maxWidth: '96vw', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flex: '0 0 auto' }}>
          <div>
            <span style={{ fontSize: 17, fontWeight: 700, color: INK }}>{doc.title || doc.name}</span>
            <span style={{ marginLeft: 10, fontWeight: 700, color: '#4338ca', background: '#eef2ff', borderRadius: 6, padding: '2px 8px', fontSize: 13 }}>Rev {doc.revision}</span>
            {doc.superseded && <span style={{ marginLeft: 8, color: '#b45309', background: '#fef3c7', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>Superseded</span>}
            {doc.approvalStatus === 'approved'
              ? <span style={{ marginLeft: 8, color: '#15803d', background: '#dcfce7', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>&#10003; Approved{doc.approvedBy ? ` by ${doc.approvedBy}` : ''}</span>
              : <span style={{ marginLeft: 8, color: '#9a3412', background: '#ffedd5', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>To Be Approved{approverName ? ` (${approverName})` : ''}</span>}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {canApprove && <button onClick={onApprove} style={btnApprove}>Approve</button>}
            {!canApprove && doc.approvalStatus !== 'approved' && !doc.superseded && <span style={{ fontSize: 12, color: '#9a3412', fontWeight: 600 }}>Awaiting customer approval</span>}
            <a href={`/api/download?url=${encodeURIComponent(doc.url)}&name=${encodeURIComponent(doc.name)}`} style={{ ...btnGhost, color: PURPLE, textDecoration: 'none' }}>Download</a>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#999' }}>&times;</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: '#1e40af', fontWeight: 700, marginBottom: 6 }}>Comments ({(doc.comments || []).length})</div>
            <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 8 }}>
              {(doc.comments || []).length === 0 && <div style={{ color: '#7c93b8', fontSize: 13, padding: '6px 0' }}>No comments yet.</div>}
              {(doc.comments || []).map(c => (
                <div key={c.id} style={{ padding: '8px 10px', marginBottom: 8, background: '#fff', border: '1px solid #dbeafe', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: '#5b6b85', marginBottom: 2 }}>
                    <strong style={{ color: c.external ? '#9333ea' : '#1a1a19' }}>{c.authorName}</strong>
                    {c.external && <span style={{ marginLeft: 6, fontSize: 10.5, background: '#f3e8ff', color: '#7c3aed', borderRadius: 10, padding: '1px 6px', fontWeight: 700 }}>Customer</span>}
                    <span style={{ marginLeft: 8 }}>{new Date(c.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div style={{ fontSize: 13.5, color: '#222' }} dangerouslySetInnerHTML={{ __html: c.html }} />
                </div>
              ))}
            </div>
            <CommentBox people={people} onSubmit={(html) => onComment(doc.id, html)} />
          </div>

          {isViewable
            ? <DrawingMarkup key={doc.url} imageUrl={doc.url} contentType={doc.contentType} initial={doc.markup} canEdit onSave={(m) => onMarkup(doc.id, m)} fileName={doc.name} docLabel="technical submittal" />
            : <div style={{ padding: 24, textAlign: 'center', color: '#888', background: '#faf9fd', borderRadius: 10 }}>This file type can't be previewed - use Download to view it.</div>}

          {/* Digital approval record, date/time-stamped, at the end of the tech sub */}
          {doc.approvalStatus === 'approved' && doc.approvalRecord && (
            <div style={{ marginTop: 16, border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#15803d', marginBottom: 8 }}>&#10003; Approved - digital record</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 13.5, color: '#166534' }}>
                <div><strong>Approved by:</strong> {doc.approvalRecord.name || doc.approvedBy}</div>
                <div><strong>Company:</strong> {doc.approvalRecord.company || '-'}</div>
                <div><strong>Role:</strong> {doc.approvalRecord.role || 'Customer'}</div>
                <div><strong>Email:</strong> {doc.approvalRecord.email || '-'}</div>
                <div><strong>Phone:</strong> {doc.approvalRecord.phone || '-'}</div>
                <div><strong>Revision:</strong> Rev {doc.revision}</div>
                <div style={{ gridColumn: '1 / -1' }}><strong>Date &amp; time:</strong> {doc.approvalRecord.atText || new Date(doc.approvalRecord.at).toLocaleString('en-GB')}</div>
                {doc.approvalRecord.fileHash && <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#4d7c5a', wordBreak: 'break-all' }}><strong>File fingerprint:</strong> {doc.approvalRecord.fileHash}</div>}
                {doc.approvalRecord.certificateUrl && <div style={{ gridColumn: '1 / -1', marginTop: 4 }}><a href={doc.approvalRecord.certificateUrl} target="_blank" rel="noreferrer" style={{ color: '#15803d', fontWeight: 700, fontSize: 13 }}>Download approval certificate (PDF)</a></div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CommentBox({ people, onSubmit }) {
  const [text, setText] = useState('')
  const [suggest, setSuggest] = useState(null)
  const taRef = useRef()
  function onChange(e) {
    const v = e.target.value; setText(v)
    const caret = e.target.selectionStart
    const m = /@([\w'-]*)$/.exec(v.slice(0, caret))
    setSuggest(m ? { query: m[1].toLowerCase(), from: caret - m[1].length - 1 } : null)
  }
  function pick(u) {
    const before = text.slice(0, suggest.from)
    const caret = taRef.current ? taRef.current.selectionStart : text.length
    const after = text.slice(caret)
    setText(`${before}@${u.name} ${after}`); setSuggest(null)
    setTimeout(() => taRef.current && taRef.current.focus(), 0)
  }
  function submit() {
    const t = text.trim(); if (!t) return
    let html = t.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
    for (const u of people) if (u.name) html = html.replace(new RegExp('@' + u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'g'), `<span style="color:#2563eb;font-weight:700">@${u.name}</span>`)
    onSubmit(html); setText(''); setSuggest(null)
  }
  const matches = suggest ? people.filter(u => u.name && u.name.toLowerCase().includes(suggest.query)).slice(0, 6) : []
  return (
    <div style={{ position: 'relative' }}>
      {suggest && matches.length > 0 && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 -4px 16px rgba(0,0,0,0.1)', overflow: 'hidden', marginBottom: 4, zIndex: 5, minWidth: 200 }}>
          {matches.map(u => <button key={u.id} onMouseDown={e => { e.preventDefault(); pick(u) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: '#fff', cursor: 'pointer', fontSize: 13 }}><strong>{u.name}</strong></button>)}
        </div>
      )}
      <textarea ref={taRef} value={text} onChange={onChange} placeholder="Add a comment. Use @ to tag someone..." rows={2}
        style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #cdd9ea', borderRadius: 8, padding: '8px 10px', fontSize: 13.5, resize: 'vertical', fontFamily: 'inherit' }} />
      <div style={{ textAlign: 'right', marginTop: 6 }}><button onClick={submit} disabled={!text.trim()} style={{ ...btnPrimary, opacity: text.trim() ? 1 : 0.5 }}>Comment</button></div>
    </div>
  )
}

const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#8a857c', fontWeight: 600, whiteSpace: 'nowrap' }
const td = { padding: '10px 12px', verticalAlign: 'middle' }
const linkBtn = { background: 'none', border: 'none', color: PURPLE, cursor: 'pointer', fontSize: 13, marginLeft: 12, fontWeight: 600 }
const btnOpen = { background: PURPLE, color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', marginLeft: 6 }
const btnApprove = { background: '#16a34a', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', marginLeft: 8 }
const btnPrimary = { background: PURPLE, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const btnGhost = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
