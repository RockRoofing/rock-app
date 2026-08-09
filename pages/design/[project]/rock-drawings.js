import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { upload } from '@vercel/blob/client'
import { useDesignProjectAuth, DesignNav, PURPLE, INK } from '../../../lib/designShell'
import DrawingMarkup from '../../../components/DrawingMarkup'

const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
const isImg = (f) => (f.contentType || '').startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(f.name || f.url || '')
const isPdf = (f) => (f.contentType || '') === 'application/pdf' || /\.pdf$/i.test(f.url || f.name || '')

export default function RockDrawingsPage() {
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
  const [selected, setSelected] = useState({})
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const [approverPick, setApproverPick] = useState(null)   // { mode, id?, approverId }
  const [notifyOpen, setNotifyOpen] = useState(false)
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
      const d = await fetch(`/api/design-rock-drawings?no=${encodeURIComponent(projectNo)}`).then(r => r.json())
      setDocs(d.docs || []); setPeople(d.people || []); setCanEdit(!!d.canEdit); setUnread(d.unread || []); setMeId(d.meId || ''); setIsExternal(!!d.external)
    } catch { setErr('Could not load') }
    setLoading(false)
  }

  function openDoc(id) {
    setOpenId(id)
    if (unread.includes(id)) {
      setUnread(u => u.filter(x => x !== id))
      fetch('/api/design-rock-drawings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'mark-read', id }) }).catch(() => {})
    }
  }

  async function uploadOne(file) {
    return upload(file.name, file, { access: 'public', handleUploadUrl: '/api/blob-upload', contentType: file.type || 'application/octet-stream' })
  }
  async function post(payload) {
    const r = await fetch('/api/design-rock-drawings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, ...payload }) })
    const d = await r.json()
    if (!r.ok) { setErr(d.error || 'Failed'); return null }
    if (d.docs) setDocs(d.docs)
    if (d.doc) setDocs(ds => ds.map(x => x.id === d.doc.id ? d.doc : x))
    return d
  }

  async function addNew(list) {
    if (!list || !list.length) return
    setUploading(true); setErr('')
    try {
      for (const file of Array.from(list)) {
        const blob = await uploadOne(file)
        await post({ action: 'add', title: file.name.replace(/\.[^.]+$/, ''), approverId: pendingApprover.current || '', file: { name: file.name, url: blob.url, contentType: file.type || '', size: file.size } })
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
      await post({ action: 'add-revision', id: forId, approverId: pendingApprover.current || '', file: { name: file.name, url: blob.url, contentType: file.type || '', size: file.size } })
    } catch (e) { setErr(e && e.message ? e.message : 'Upload failed') }
    if (revRef.current) revRef.current.value = ''
    revForId.current = null; pendingApprover.current = ''
    setUploading(false); load()
  }

  const docFor = (id) => docs.find(d => d.id === id)
  function startAdd() { setApproverPick({ mode: 'add', approverId: '' }) }
  // Mark superseded == upload a new revision (mandatory). Same picker + file flow.
  function startSupersede(id) { setApproverPick({ mode: 'revision', id, approverId: docFor(id)?.approverId || '' }) }
  function confirmApprover() {
    const p = approverPick; if (!p) return
    pendingApprover.current = p.approverId || ''
    setApproverPick(null)
    if (p.mode === 'add') { if (addRef.current) addRef.current.click() }
    else { revForId.current = p.id; if (revRef.current) revRef.current.click() }
  }

  async function approve(id) { if (!confirm('Approve this drawing?')) return; await post({ action: 'approve', id }) }
  async function toggleConstruction(id, value) { await post({ action: 'construction-issue', id, value }) }
  async function del(id) {
    if (!confirm('Delete this drawing?')) return
    await post({ action: 'delete', id })
    if (openId === id) setOpenId(null)
  }
  async function addComment(id, html) { const d = await post({ action: 'comment', id, html }); return d }
  async function saveMarkup(id, markup) { await post({ action: 'markup', id, markup }) }

  function toggleSel(id) { setSelected(s => ({ ...s, [id]: !s[id] })) }
  const selectedUrls = docs.filter(d => selected[d.id]).map(d => d.url)
  async function downloadZip(urls, zipName) {
    if (!urls.length) return
    try {
      const r = await fetch('/api/design-rock-drawings-zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, urls, zipName }) })
      if (!r.ok) { let m = 'Could not build zip'; try { const d = await r.json(); m = d.error || m } catch {} setErr(m); return }
      const blob = await r.blob()
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${zipName}.zip`
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } catch { setErr('Could not download') }
  }

  if (!auth.ready) return null
  const openDocObj = docs.find(d => d.id === openId)
  const personName = (id) => { const p = people.find(x => x.id === id); return p ? p.name : '' }
  const customers = people.filter(p => p.external)
  const canApprove = (d) => { if (!d || d.status === 'approved' || d.superseded) return false; if (!isExternal) return false; return d.approverId === meId }

  // Group into families; newest (non-superseded) is the front card, older are stacked behind.
  const families = []
  const seen = {}
  for (const d of docs) {
    const fam = d.familyId || d.id
    if (!seen[fam]) { seen[fam] = { famId: fam, current: null, older: [] }; families.push(seen[fam]) }
    if (d.superseded) seen[fam].older.push(d); else seen[fam].current = d
  }
  // If a family somehow has no current (all superseded), promote the newest.
  for (const f of families) if (!f.current && f.older.length) { f.current = f.older[0]; f.older = f.older.slice(1) }

  return (
    <>
      <Head><title>Rock Drawings - Design</title></Head>
      <DesignNav active="rock-drawings" projectNo={projectNo} projectName={auth.project && auth.project.name} isInternal={auth.isInternal} />
      <input ref={addRef} type="file" accept="application/pdf,image/*" multiple style={{ display: 'none' }} onChange={e => addNew(e.target.files)} />
      <input ref={revRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={e => addRevision(e.target.files)} />
      <div style={{ width: '100%', margin: 0, padding: '22px 24px 60px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ margin: '0 0 2px', color: INK, fontSize: 24 }}>Rock Drawings</h1>
            <p style={{ color: '#8a857c', fontSize: 14, margin: 0 }}>Our own drawings. {canEdit ? 'Upload, revise, mark up and comment.' : 'View, mark up and comment.'}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => downloadZip(docs.map(d => d.url), `${projectNo}-rock-drawings`)} disabled={!docs.length} style={{ ...btnGhost, opacity: docs.length ? 1 : 0.5 }}>Download all</button>
            <button onClick={() => downloadZip(selectedUrls, `${projectNo}-rock-drawings-selected`)} disabled={!selectedUrls.length} style={{ ...btnGhost, opacity: selectedUrls.length ? 1 : 0.5 }}>Download selected ({selectedUrls.length})</button>
            {canEdit && <button onClick={() => setNotifyOpen(true)} disabled={!docs.length} style={{ ...btnGhost, color: PURPLE, borderColor: '#e9d5ff', opacity: docs.length ? 1 : 0.5 }}>Notify project users</button>}
            {canEdit && <button onClick={startAdd} disabled={uploading} style={{ ...btnPrimary, opacity: uploading ? 0.6 : 1 }}>{uploading ? 'Uploading...' : '+ Add Drawing'}</button>}
          </div>
        </div>
        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        {loading ? <div style={{ color: '#999', padding: 20 }}>Loading...</div>
          : families.length === 0 ? (
            <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 40, textAlign: 'center', color: '#aaa' }}>No drawings yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 22 }}>
              {families.map(fam => {
                const d = fam.current
                const isUnread = unread.includes(d.id)
                const olderCount = fam.older.length
                return (
                  <div key={fam.famId} style={{ position: 'relative', paddingRight: olderCount ? 10 : 0, paddingBottom: olderCount ? 10 : 0 }}>
                    {/* Greyed superseded cards stacked behind */}
                    {olderCount > 0 && [...Array(Math.min(olderCount, 3))].map((_, i) => (
                      <div key={i} style={{ position: 'absolute', top: -(i + 1) * 4, right: -(i + 1) * 4, left: (i + 1) * 4, bottom: (i + 1) * 4, background: '#eee', border: '1px solid #ddd', borderRadius: 12, filter: 'grayscale(1)', zIndex: 0 }} />
                    ))}
                    <div style={{ position: 'relative', zIndex: 1, border: `2px solid ${selected[d.id] ? PURPLE : (isUnread ? '#f97316' : '#ece9f5')}`, borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
                      <label style={{ position: 'absolute', top: 6, left: 6, zIndex: 3, background: 'rgba(255,255,255,0.9)', borderRadius: 5, padding: '1px 3px', display: 'flex', cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!selected[d.id]} onChange={() => toggleSel(d.id)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                      </label>
                      {isUnread && <span title="New activity" style={{ position: 'absolute', top: 8, right: 8, zIndex: 3, width: 10, height: 10, borderRadius: '50%', background: '#f97316' }} />}
                      <button onClick={() => openDoc(d.id)} title="View" style={{ display: 'block', width: '100%', height: 150, background: '#f4f4f4', border: 'none', padding: 0, cursor: 'pointer' }}>
                        {d.thumbUrl ? <img src={d.thumbUrl} alt={d.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <PdfThumb file={d} />}
                      </button>
                      <div style={{ padding: '10px 12px' }}>
                        <div title={d.title || d.name} style={{ fontSize: 13, fontWeight: 700, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title || d.name}</div>
                        <div style={{ marginTop: 6, display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, color: '#4338ca', background: '#eef2ff', borderRadius: 6, padding: '1px 7px', fontSize: 11.5 }}>Rev {d.revision}</span>
                          {d.status === 'approved'
                            ? <span style={{ color: '#15803d', background: '#dcfce7', borderRadius: 20, padding: '1px 9px', fontSize: 11.5, fontWeight: 700 }}>&#10003; Approved</span>
                            : <span style={{ color: '#b45309', background: '#fef3c7', borderRadius: 20, padding: '1px 9px', fontSize: 11.5, fontWeight: 700 }}>In Review</span>}
                          {d.constructionIssue && <span style={{ color: '#2563eb', background: '#dbeafe', borderRadius: 20, padding: '1px 9px', fontSize: 11.5, fontWeight: 700 }}>Construction Issue</span>}
                          {olderCount > 0 && <span style={{ fontSize: 11, color: '#999' }}>{olderCount} old rev{olderCount === 1 ? '' : 's'}</span>}
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button onClick={() => openDoc(d.id)} style={btnOpenSm}>View</button>
                          <a href={`/api/download?url=${encodeURIComponent(d.url)}&name=${encodeURIComponent(d.name)}`} style={linkBtn}>Download</a>
                          {canApprove(d) && <button onClick={() => approve(d.id)} style={btnApproveSm}>Approve</button>}
                        </div>
                        {canEdit && (
                          <div style={{ marginTop: 6, display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid #f2f2f2', paddingTop: 6 }}>
                            <button onClick={() => toggleConstruction(d.id, !d.constructionIssue)} style={linkBtn}>{d.constructionIssue ? 'Unmark Constr.' : 'Construction Issue'}</button>
                            <button onClick={() => startSupersede(d.id)} style={linkBtn}>Mark superseded</button>
                            <button onClick={() => del(d.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
                          </div>
                        )}
                        {!canEdit && !canApprove(d) && d.status !== 'approved' && <div style={{ marginTop: 6, fontSize: 11.5, color: '#9a3412' }}>Awaiting customer approval</div>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {openDocObj && <DrawingViewer doc={openDocObj} people={people} personName={personName} onClose={() => setOpenId(null)} onComment={addComment} onMarkup={saveMarkup}
        canApprove={canApprove(openDocObj)} onApprove={() => approve(openDocObj.id)} approverName={personName(openDocObj.approverId)} />}

      {approverPick && (
        <div onClick={() => setApproverPick(null)} style={modalWrap}>
          <div onClick={e => e.stopPropagation()} style={modalCard}>
            <h3 style={{ margin: '0 0 4px', fontSize: 17, color: INK }}>{approverPick.mode === 'add' ? 'Add Drawing' : 'Mark superseded - upload new revision'}</h3>
            <p style={{ fontSize: 13, color: '#8a857c', marginTop: 0 }}>{approverPick.mode === 'add' ? 'Choose the customer who needs to review and approve this drawing.' : 'Marking a drawing superseded requires a new revision. Choose the approver, then pick the new drawing file.'}</p>
            <label style={{ fontSize: 12, color: '#888', fontWeight: 600 }}>Approver (customer)</label>
            <select value={approverPick.approverId} onChange={e => setApproverPick({ ...approverPick, approverId: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginTop: 4 }}>
              <option value="">Select a customer...</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setApproverPick(null)} style={btnGhost}>Cancel</button>
              <button onClick={confirmApprover} style={btnPrimary}>Choose file...</button>
            </div>
          </div>
        </div>
      )}

      {notifyOpen && <NotifyModal people={people} onClose={() => setNotifyOpen(false)} onSend={async (approverIds) => {
        const d = await post({ action: 'notify-uploaded', approverIds })
        setNotifyOpen(false)
        if (d) alert(`Notified ${d.sent} project user${d.sent === 1 ? '' : 's'}.`)
      }} />}
    </>
  )
}

function DrawingViewer({ doc, people, personName, onClose, onComment, onMarkup, canApprove, onApprove, approverName }) {
  const dwg = /\.dwg$/i.test(doc.name || '') && !(doc.contentType || '').includes('pdf')
  const viewable = !dwg && (isImg(doc) || isPdf(doc))
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '2vh 2vw' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 18, width: '96vw', height: '96vh', maxWidth: '96vw', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flex: '0 0 auto' }}>
          <div>
            <span style={{ fontSize: 17, fontWeight: 700, color: INK }}>{doc.title || doc.name}</span>
            <span style={{ marginLeft: 10, fontWeight: 700, color: '#4338ca', background: '#eef2ff', borderRadius: 6, padding: '2px 8px', fontSize: 13 }}>Rev {doc.revision}</span>
            {doc.superseded && <span style={{ marginLeft: 8, color: '#b45309', background: '#fef3c7', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>Superseded</span>}
            {doc.status === 'approved'
              ? <span style={{ marginLeft: 8, color: '#15803d', background: '#dcfce7', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>&#10003; Approved{doc.approvedBy ? ` by ${doc.approvedBy}` : ''}</span>
              : <span style={{ marginLeft: 8, color: '#b45309', background: '#fef3c7', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>In Review{approverName ? ` (${approverName})` : ''}</span>}
            {doc.constructionIssue && <span style={{ marginLeft: 8, color: '#2563eb', background: '#dbeafe', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>Construction Issue</span>}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {canApprove && <button onClick={onApprove} style={btnApprove}>Approve</button>}
            <a href={`/api/download?url=${encodeURIComponent(doc.url)}&name=${encodeURIComponent(doc.name)}`} style={{ ...btnGhost, color: PURPLE, textDecoration: 'none' }}>Download</a>
            <button onClick={onClose} title="Close" style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#999' }}>&times;</button>
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

          {dwg ? (
            <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 24, textAlign: 'center', background: '#faf9fd' }}>
              <div style={{ color: '#666', fontSize: 14, marginBottom: 10 }}>This is a .dwg CAD file, which can't be shown in the browser.</div>
              <a href={`/api/download?url=${encodeURIComponent(doc.url)}&name=${encodeURIComponent(doc.name)}`} style={{ ...btnPrimary, textDecoration: 'none' }}>Download drawing</a>
            </div>
          ) : viewable ? (
            <DrawingMarkup key={doc.url} imageUrl={doc.url} contentType={doc.contentType} initial={doc.markup} canEdit onSave={(m) => onMarkup(doc.id, m)} fileName={doc.name} docLabel="drawing" />
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: '#888', background: '#faf9fd', borderRadius: 10 }}>This file type can't be previewed - use Download to view it.</div>
          )}

          {doc.status === 'approved' && doc.approvalRecord && (
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
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function NotifyModal({ people, onClose, onSend }) {
  const [picked, setPicked] = useState({})
  const customers = people.filter(p => p.external)
  const toggle = (id) => setPicked(s => ({ ...s, [id]: !s[id] }))
  return (
    <div onClick={onClose} style={modalWrap}>
      <div onClick={e => e.stopPropagation()} style={{ ...modalCard, width: 480 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17, color: INK }}>Notify project users</h3>
        <p style={{ fontSize: 13, color: '#8a857c', marginTop: 0 }}>Everyone on this project will be told drawings have been uploaded. Tick anyone who needs to <strong>approve</strong> - they'll be asked to review and approve. Everyone else is just notified.</p>
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #eee', borderRadius: 8, padding: 8 }}>
          {customers.length === 0 && <div style={{ fontSize: 13, color: '#aaa', padding: 8 }}>No customer users on this project.</div>}
          {customers.map(c => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!picked[c.id]} onChange={() => toggle(c.id)} />
              <span style={{ fontSize: 13.5 }}>{c.name} <span style={{ color: '#999' }}>({c.company})</span></span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={() => onSend(Object.keys(picked).filter(k => picked[k]))} style={btnPrimary}>Send notifications</button>
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

function PdfThumb({ file }) {
  const ref = useRef()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!isPdf(file)) { setFailed(true); return }
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; s.onload = resolve; s.onerror = reject; document.body.appendChild(s) })
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        }
        const pdf = await window.pdfjsLib.getDocument(file.url).promise
        const pg = await pdf.getPage(1)
        if (cancelled) return
        const holder = ref.current; if (!holder) return
        const maxW = holder.clientWidth || 220
        const vp0 = pg.getViewport({ scale: 1 })
        const vp = pg.getViewport({ scale: maxW / vp0.width })
        const canvas = document.createElement('canvas')
        canvas.width = vp.width; canvas.height = vp.height
        canvas.style.width = '100%'; canvas.style.height = '150px'; canvas.style.objectFit = 'cover'; canvas.style.objectPosition = 'top'
        holder.innerHTML = ''; holder.appendChild(canvas)
        await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
      } catch { if (!cancelled) setFailed(true) }
    })()
    return () => { cancelled = true }
  }, [file.url])
  if (failed) return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9333ea' }}><div style={{ fontSize: 34 }}>&#128196;</div><div style={{ fontSize: 11, color: '#999' }}>{isPdf(file) ? 'PDF' : 'File'}</div></div>
  return <div ref={ref} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
}

const btnPrimary = { background: PURPLE, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const btnGhost = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const btnOpenSm = { background: PURPLE, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const btnApprove = { background: '#16a34a', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnApproveSm = { background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginLeft: 4 }
const linkBtn = { background: 'none', border: 'none', color: PURPLE, cursor: 'pointer', fontSize: 12, fontWeight: 600, marginLeft: 4 }
const modalWrap = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }
const modalCard = { background: '#fff', borderRadius: 14, padding: 22, width: 440, maxWidth: '92vw' }
