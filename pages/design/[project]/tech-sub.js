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
  const [loading, setLoading] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [unread, setUnread] = useState([])
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const addRef = useRef()
  const revRef = useRef()
  const revForId = useRef(null)

  useEffect(() => { if (auth.ready && projectNo) load() }, [auth.ready, projectNo])
  useEffect(() => {
    const openParam = router.query.open ? String(router.query.open) : ''
    if (openParam && docs.some(d => d.id === openParam)) openDoc(openParam)
  }, [router.query.open, docs])

  async function load() {
    setLoading(true); setErr('')
    try {
      const d = await fetch(`/api/design-techsubs?no=${encodeURIComponent(projectNo)}`).then(r => r.json())
      setDocs(d.docs || []); setPeople(d.people || []); setCanEdit(!!d.canEdit); setUnread(d.unread || [])
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
        await fetch('/api/design-techsubs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'add', title: file.name.replace(/\.[^.]+$/, ''), file: { name: file.name, url: blob.url, contentType: file.type || '', size: file.size } }) })
      }
    } catch (e) { setErr(e && e.message ? e.message : 'Upload failed') }
    if (addRef.current) addRef.current.value = ''
    setUploading(false); load()
  }
  async function addRevision(list) {
    const forId = revForId.current
    if (!list || !list.length || !forId) return
    setUploading(true); setErr('')
    try {
      const file = list[0]
      const blob = await uploadOne(file)
      await fetch('/api/design-techsubs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'add-revision', id: forId, file: { name: file.name, url: blob.url, contentType: file.type || '', size: file.size } }) })
    } catch (e) { setErr(e && e.message ? e.message : 'Upload failed') }
    if (revRef.current) revRef.current.value = ''
    revForId.current = null
    setUploading(false); load()
  }
  function triggerRevision(id) { revForId.current = id; if (revRef.current) revRef.current.click() }

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
          {canEdit && <button onClick={() => addRef.current && addRef.current.click()} disabled={uploading} style={{ ...btnPrimary, opacity: uploading ? 0.6 : 1 }}>{uploading ? 'Uploading...' : '+ Add Tech Sub'}</button>}
        </div>
        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        {loading ? <div style={{ color: '#999', padding: 20 }}>Loading...</div> : (
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead><tr style={{ background: '#faf9f7' }}>
                {['Tech Sub', 'Revision', 'Status', 'Uploaded by', 'Date', 'Comments', ''].map(h => <th key={h} style={th}>{h}</th>)}
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
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{d.uploadedBy || '-'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(d.uploadedAt)}</td>
                      <td style={td}>{(d.comments || []).length ? <span style={{ fontWeight: isUnread ? 700 : 400, color: isUnread ? '#c2410c' : undefined }}>{(d.comments || []).length}{isUnread ? ' new' : ''}</span> : '-'}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => openDoc(d.id)} style={linkBtn}>Open</button>
                        {canEdit && !d.superseded && <button onClick={() => triggerRevision(d.id)} style={linkBtn}>Add revision</button>}
                        {canEdit && <button onClick={() => del(d.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>}
                      </td>
                    </tr>
                  )
                })}
                {!docs.length && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#aaa', padding: 26 }}>No Tech Subs yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openDocObj && <TechSubViewer doc={openDocObj} people={people} personName={personName} onClose={() => setOpenId(null)} onComment={addComment} onMarkup={saveMarkup} />}
    </>
  )
}

function TechSubViewer({ doc, people, personName, onClose, onComment, onMarkup }) {
  const isViewable = (doc.contentType || '').startsWith('image/') || /\.(jpe?g|png|gif|webp|pdf)$/i.test(doc.url || '') || (doc.contentType || '') === 'application/pdf'
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '2vh 2vw' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 18, width: '96vw', height: '96vh', maxWidth: '96vw', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flex: '0 0 auto' }}>
          <div>
            <span style={{ fontSize: 17, fontWeight: 700, color: INK }}>{doc.title || doc.name}</span>
            <span style={{ marginLeft: 10, fontWeight: 700, color: '#4338ca', background: '#eef2ff', borderRadius: 6, padding: '2px 8px', fontSize: 13 }}>Rev {doc.revision}</span>
            {doc.superseded && <span style={{ marginLeft: 8, color: '#b45309', background: '#fef3c7', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>Superseded</span>}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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
            ? <DrawingMarkup key={doc.url} imageUrl={doc.url} contentType={doc.contentType} initial={doc.markup} canEdit onSave={(m) => onMarkup(doc.id, m)} fileName={doc.name} />
            : <div style={{ padding: 24, textAlign: 'center', color: '#888', background: '#faf9fd', borderRadius: 10 }}>This file type can't be previewed - use Download to view it.</div>}
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
const btnPrimary = { background: PURPLE, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const btnGhost = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
