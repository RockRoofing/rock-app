import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { upload } from '@vercel/blob/client'
import { useDesignProjectAuth, DesignNav, PURPLE, INK } from '../lib/designShell'
import DrawingMarkup from './DrawingMarkup'

const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
const fmtDateTime = (ts) => ts ? new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
const isImage = (f) => (f.contentType || '').startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(f.name || '')
const isDwg = (f) => /\.dwg$/i.test(f.name || '') && !(f.contentType || '').includes('pdf')

const STATUS = {
  'in-review': { label: 'In Review', c: '#b45309', bg: '#fef3c7' },
  'approved': { label: 'Approved', c: '#16a34a', bg: '#dcfce7' },
  'construction-issue': { label: 'Construction Issue', c: '#2563eb', bg: '#dbeafe' },
}

// set = 'rock' | 'contract'. Contract drawings show title-block metadata + extract on
// upload; Rock drawings show status (In Review -> Approved / Construction Issue).
// Approved / Construction Issue documents get a stamped copy baked at the moment the
// status changes. Always view and hand out the stamped copy when there is one.
const viewUrl = (d) => (d && d.stampedUrl) || (d && d.url) || ''

export default function DesignDrawingsPage({ pageKey, set, title, intro }) {
  const router = useRouter()
  const projectNo = router.query.project ? String(router.query.project) : ''
  const auth = useDesignProjectAuth(projectNo)
  const [drawings, setDrawings] = useState([])
  const [people, setPeople] = useState([])
  const [canEdit, setCanEdit] = useState(false)
  const [canMarkup, setCanMarkup] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [metaDraft, setMetaDraft] = useState(null)   // contract: confirm extracted meta
  const inputRef = useRef()

  useEffect(() => { if (auth.ready && projectNo) load() }, [auth.ready, projectNo])
  async function load() {
    setLoading(true)
    try {
      const d = await fetch(`/api/design-drawings?no=${encodeURIComponent(projectNo)}&set=${set}`).then(r => r.json())
      setDrawings(d.drawings || []); setPeople(d.people || []); setCanEdit(!!d.canEdit); setCanMarkup(!!d.canMarkup)
    } catch {}
    setLoading(false)
  }

  async function addFiles(list) {
    if (!list || !list.length) return
    setUploading(true)
    for (const file of Array.from(list)) {
      try {
        const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/blob-upload', contentType: file.type || 'application/octet-stream' })
        let meta = {}
        if (set === 'contract' && /\.pdf$/i.test(file.name)) {
          try { const mr = await fetch('/api/design-titleblock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: blob.url }) }); const md = await mr.json(); meta = md.meta || {} } catch {}
        }
        const thumbUrl = isImage({ name: file.name, contentType: file.type }) ? blob.url : ''
        await fetch('/api/design-drawings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectNo, set, action: 'create', drawing: { name: file.name, url: blob.url, contentType: file.type || '', size: file.size, thumbUrl, meta } }) })
      } catch {}
    }
    if (inputRef.current) inputRef.current.value = ''
    setUploading(false)
    load()
  }

  async function setStatus(id, status) {
    const r = await fetch('/api/design-drawings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, set, action: 'status', id, status }) })
    const d = await r.json(); if (r.ok) setDrawings(d.drawings || [])
  }
  async function saveMeta(id, meta) {
    const r = await fetch('/api/design-drawings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, set, action: 'meta', id, meta }) })
    const d = await r.json(); if (r.ok) { setDrawings(d.drawings || []); setMetaDraft(null) }
  }
  async function del(id) {
    if (!confirm('Delete this drawing?')) return
    const r = await fetch('/api/design-drawings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, set, action: 'delete', id }) })
    const d = await r.json(); if (r.ok) { setDrawings(d.drawings || []); setOpenId(null) }
  }
  async function saveMarkup(id, markup) {
    const r = await fetch('/api/design-drawings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, set, action: 'markup', id, markup }) })
    const d = await r.json(); if (r.ok) setDrawings(ds => ds.map(x => x.id === id ? d.drawing : x))
  }
  async function addComment(id, html) {
    const r = await fetch('/api/design-drawings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, set, action: 'comment', id, html }) })
    const d = await r.json(); if (r.ok) setDrawings(ds => ds.map(x => x.id === id ? d.drawing : x))
  }

  if (!auth.ready) return null
  const openDrawing = drawings.find(d => d.id === openId)

  return (
    <>
      <Head><title>{title} - Design</title></Head>
      <DesignNav active={pageKey} projectNo={projectNo} projectName={auth.project?.name} isInternal={auth.isInternal} />
      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '22px 28px 60px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: '0 0 2px', color: INK, fontSize: 24 }}>{title}</h1>
            <p style={{ color: '#8a857c', fontSize: 14, margin: 0 }}>{intro}</p>
          </div>
          {canEdit && (
            <div>
              <input ref={inputRef} type="file" accept="application/pdf,image/*,.dwg" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
              <button onClick={() => inputRef.current?.click()} disabled={uploading} style={btnPrimary}>{uploading ? 'Uploading...' : '+ Upload drawings'}</button>
            </div>
          )}
        </div>

        {set === 'contract' ? (
          <ContractTable drawings={drawings} canEdit={canEdit} loading={loading} onOpen={setOpenId} onEditMeta={d => setMetaDraft(d)} onDelete={del} />
        ) : (
          <RockGrid drawings={drawings} canEdit={canEdit} loading={loading} onOpen={setOpenId} onStatus={setStatus} onDelete={del} />
        )}
      </div>

      {openDrawing && <DrawingModal drawing={openDrawing} set={set} people={people} canEdit={canEdit} canMarkup={canMarkup}
        onClose={() => setOpenId(null)} onMarkup={saveMarkup} onComment={addComment} onStatus={setStatus} onDelete={() => del(openDrawing.id)} />}
      {metaDraft && <MetaModal drawing={metaDraft} onClose={() => setMetaDraft(null)} onSave={m => saveMeta(metaDraft.id, m)} />}
    </>
  )
}

// ---- Rock Drawings grid (thumbnails + status below) ----
function RockGrid({ drawings, canEdit, loading, onOpen, onStatus, onDelete }) {
  if (loading) return <div style={{ color: '#999', padding: 20 }}>Loading...</div>
  if (!drawings.length) return <Empty>No drawings yet.</Empty>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
      {drawings.map(d => {
        const st = STATUS[d.status] || STATUS['in-review']
        return (
          <div key={d.id} style={{ border: '1px solid #ece9f5', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
            <button onClick={() => onOpen(d.id)} style={{ display: 'block', width: '100%', border: 'none', padding: 0, cursor: 'pointer', background: '#f4f4f4', height: 150, overflow: 'hidden' }}>
              {d.thumbUrl ? <img src={d.thumbUrl} alt={d.name} style={{ width: '100%', height: 150, objectFit: 'cover' }} />
                : <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bb9', fontSize: 13 }}>PDF / DWG</div>}
            </button>
            <div style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={d.name}>{d.name}</div>
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ background: st.bg, color: st.c, borderRadius: 20, padding: '2px 10px', fontSize: 11.5, fontWeight: 700 }}>{st.label}</span>
                {(d.comments || []).length > 0 && <span style={{ fontSize: 11.5, color: '#888' }}>{d.comments.length} comment{d.comments.length === 1 ? '' : 's'}</span>}
              </div>
              {canEdit && (
                <select value={d.status} onChange={e => onStatus(d.id, e.target.value)} style={{ marginTop: 8, width: '100%', padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12.5 }}>
                  <option value="in-review">In Review</option>
                  <option value="approved">Approved</option>
                  <option value="construction-issue">Construction Issue</option>
                </select>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---- Contract Drawings table (title-block metadata) ----
function ContractTable({ drawings, canEdit, loading, onOpen, onEditMeta, onDelete }) {
  if (loading) return <div style={{ color: '#999', padding: 20 }}>Loading...</div>
  return (
    <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr style={{ background: '#faf9f7' }}>
          {['Drawing', 'Architect', 'Reference', 'Project', 'Revision', 'Status', 'Date', ''].map(h => <th key={h} style={th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {drawings.map(d => {
            const m = d.meta || {}
            return (
              <tr key={d.id} style={{ borderTop: '1px solid #f0f0f0', cursor: 'pointer' }} onClick={() => onOpen(d.id)}>
                <td style={{ ...td, fontWeight: 600 }}>{d.name}</td>
                <td style={td}>{m.architect || '-'}</td>
                <td style={td}>{m.reference || '-'}</td>
                <td style={td}>{m.project || '-'}</td>
                <td style={td}>{m.revision || '-'}</td>
                <td style={td}>{m.status || '-'}</td>
                <td style={td}>{m.date || '-'}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => onOpen(d.id)} style={linkBtn}>Open</button>
                  {canEdit && <button onClick={() => onEditMeta(d)} style={linkBtn}>Edit info</button>}
                  {canEdit && <button onClick={() => onDelete(d.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>}
                </td>
              </tr>
            )
          })}
          {!drawings.length && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#aaa', padding: 26 }}>No drawings yet.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ---- Drawing modal: viewer + markup + comments ----
function DrawingModal({ drawing, set, people, canEdit, canMarkup, onClose, onMarkup, onComment, onStatus, onDelete }) {
  const dwg = isDwg(drawing)   // .dwg files can't be rendered in-browser; download only
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, overflowY: 'auto', padding: '3vh 16px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: 1100, maxWidth: '96vw', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: INK }}>{drawing.name}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999' }}>&times;</button>
        </div>

        {set === 'rock' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            {(() => { const st = STATUS[drawing.status] || STATUS['in-review']; return <span style={{ background: st.bg, color: st.c, borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>{st.label}</span> })()}
            {canEdit && <select value={drawing.status} onChange={e => onStatus(drawing.id, e.target.value)} style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12.5 }}>
              <option value="in-review">In Review</option><option value="approved">Approved</option><option value="construction-issue">Construction Issue</option>
            </select>}
            <div style={{ flex: 1 }} />
            <a href={`/api/download?url=${encodeURIComponent(viewUrl(drawing))}&name=${encodeURIComponent(drawing.name)}`} style={linkBtn}>Download</a>
          </div>
        )}

        {dwg ? (
          <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, textAlign: 'center', background: '#faf9fd' }}>
            <div style={{ color: '#666', fontSize: 14, marginBottom: 10 }}>This is a .dwg CAD file, which can't be shown in the browser. Download it to open in CAD.</div>
            <a href={`/api/download?url=${encodeURIComponent(viewUrl(drawing))}&name=${encodeURIComponent(drawing.name)}`} style={btnPrimary}>Download drawing</a>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 10 }}>Tip: upload a PDF of the drawing to view and mark it up here.</div>
          </div>
        ) : (
          <DrawingMarkup key={viewUrl(drawing)} imageUrl={viewUrl(drawing)} contentType={drawing.contentType} initial={drawing.markup} canEdit={canMarkup} onSave={m => onMarkup(drawing.id, m)} />
        )}

        <div style={{ borderTop: '1px solid #eee', margin: '16px 0 10px' }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 8 }}>Comments</div>
        <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 10 }}>
          {(drawing.comments || []).length === 0 && <div style={{ color: '#aaa', fontSize: 13 }}>No comments yet.</div>}
          {(drawing.comments || []).map(c => (
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
        <CommentBox people={people} onSubmit={html => onComment(drawing.id, html)} />
        {canEdit && <div style={{ textAlign: 'right', marginTop: 10 }}><button onClick={onDelete} style={{ ...linkBtn, color: '#dc2626', marginLeft: 0 }}>Delete drawing</button></div>}
      </div>
    </div>
  )
}

function MetaModal({ drawing, onClose, onSave }) {
  const [m, setM] = useState({ architect: '', reference: '', project: '', revision: '', status: '', date: '', ...(drawing.meta || {}) })
  const F = (k, label) => (
    <div><Lbl>{label}</Lbl><input value={m[k] || ''} onChange={e => setM({ ...m, [k]: e.target.value })} style={inp} /></div>
  )
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 110, overflowY: 'auto', padding: '5vh 16px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, width: 480, maxWidth: '94vw' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Drawing information</h2>
        <div style={{ fontSize: 12.5, color: '#8a857c', marginBottom: 12 }}>Read from the PDF title block where possible - please check and correct.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {F('architect', 'Architect')}{F('reference', 'Reference')}
          {F('project', 'Project')}{F('revision', 'Revision')}
          {F('status', 'Status')}{F('date', 'Date')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={() => onSave(m)} style={btnPrimary}>Save</button>
        </div>
      </div>
    </div>
  )
}

function CommentBox({ people, onSubmit }) {
  const ref = useRef()
  const [showMentions, setShowMentions] = useState(false)
  const [q, setQ] = useState('')
  const cmd = (c) => { document.execCommand(c, false, null); ref.current?.focus() }
  function onInput() { const t = ref.current?.innerText || ''; const m = /@(\w*)$/.exec(t); if (m) { setQ(m[1].toLowerCase()); setShowMentions(true) } else setShowMentions(false) }
  function insert(p) { const el = ref.current; el.innerHTML = el.innerHTML.replace(/@(\w*)$/, `<span style="background:#f3e8ff;color:#7c3aed;border-radius:4px;padding:0 3px;font-weight:600">@${p.name}</span>&nbsp;`); setShowMentions(false); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r) }
  function submit() { const html = ref.current?.innerHTML?.trim(); if (!html) return; onSubmit(html); ref.current.innerHTML = '' }
  const matches = people.filter(p => p.name.toLowerCase().includes(q)).slice(0, 6)
  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 10, position: 'relative' }}>
      <div style={{ display: 'flex', gap: 6, padding: 6, borderBottom: '1px solid #eee', background: '#fafafa' }}>
        <Tb onClick={() => cmd('bold')} s={{ fontWeight: 800 }}>B</Tb><Tb onClick={() => cmd('italic')} s={{ fontStyle: 'italic' }}>I</Tb><Tb onClick={() => cmd('underline')} s={{ textDecoration: 'underline' }}>U</Tb>
        <span style={{ fontSize: 11.5, color: '#aaa', alignSelf: 'center', marginLeft: 6 }}>Type @ to mention</span>
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning onInput={onInput} style={{ minHeight: 56, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.5, outline: 'none' }} />
      {showMentions && matches.length > 0 && (
        <div style={{ position: 'absolute', bottom: 46, left: 12, background: '#fff', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.12)', zIndex: 10, minWidth: 220 }}>
          {matches.map(p => <button key={p.id} onClick={() => insert(p)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}><strong>{p.name}</strong> <span style={{ color: '#999', fontSize: 11.5 }}>{p.company}</span></button>)}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 8, borderTop: '1px solid #eee' }}><button onClick={submit} style={btnPrimary}>Comment</button></div>
    </div>
  )
}
function Tb({ onClick, s, children }) { return <button type="button" onMouseDown={e => { e.preventDefault(); onClick() }} style={{ minWidth: 30, padding: '4px 8px', border: '1px solid #e0e0e0', background: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 13, ...s }}>{children}</button> }

function Empty({ children }) { return <div style={{ color: '#aaa', fontSize: 14, padding: 40, textAlign: 'center', background: '#faf9fd', borderRadius: 12 }}>{children}</div> }
function Lbl({ children }) { return <div style={{ fontSize: 12, color: '#666', marginBottom: 4, fontWeight: 600 }}>{children}</div> }
const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#8a857c', fontWeight: 600, whiteSpace: 'nowrap' }
const td = { padding: '10px 12px', verticalAlign: 'middle' }
const inp = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13.5 }
const btnPrimary = { background: PURPLE, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', textDecoration: 'none' }
const btnGhost = { background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }
const linkBtn = { background: 'none', border: 'none', color: PURPLE, cursor: 'pointer', fontSize: 13, marginLeft: 10, fontWeight: 600, textDecoration: 'none' }
