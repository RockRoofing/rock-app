import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { useDesignProjectAuth, DesignNav, INK } from '../../../lib/designShell'
import DrawingMarkup from '../../../components/DrawingMarkup'

const BRAND = '#1c704f'   // Rock Roofing green (O&M accents)

const fmtDateTime = (ts) => ts ? new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

export default function OMsPage() {
  const router = useRouter()
  const projectNo = router.query.project ? String(router.query.project) : ''
  const auth = useDesignProjectAuth(projectNo)
  const [manual, setManual] = useState(null)
  const [revisions, setRevisions] = useState([])
  const [viewingUrl, setViewingUrl] = useState('')
  const [available, setAvailable] = useState([])
  const [readiness, setReadiness] = useState(null)
  const [customers, setCustomers] = useState([])
  const [comments, setComments] = useState([])
  const [people, setPeople] = useState([])
  const [meId, setMeId] = useState('')
  const [isExternal, setIsExternal] = useState(false)
  const [customerDownloaded, setCustomerDownloaded] = useState(false)
  const [downloadedList, setDownloadedList] = useState([])
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [notifyPick, setNotifyPick] = useState({})
  const [notifying, setNotifying] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { if (auth.ready && projectNo) load() }, [auth.ready, projectNo])

  async function load() {
    setLoading(true); setErr('')
    try {
      const d = await fetch(`/api/design-oms?no=${encodeURIComponent(projectNo)}`).then(r => r.json())
      setManual(d.manual || null); setRevisions(d.revisions || []); setAvailable(d.available || []); setCanEdit(!!d.canEdit); setReadiness(d.readiness || null); setCustomers(d.customers || [])
      setComments(d.comments || []); setPeople(d.people || []); setMeId(d.meId || ''); setIsExternal(!!d.isExternal); setCustomerDownloaded(!!d.customerDownloaded); setDownloadedList(d.downloadedList || [])
      setViewingUrl(prev => (d.manual && (!prev || !(d.revisions || []).some(r => r.url === prev))) ? d.manual.url : prev)
    } catch { setErr('Could not load') }
    setLoading(false)
  }

  async function build() {
    if (building) return
    // Warn if items are missing or not yet Construction Issue - check with the Design Manager.
    if (readiness && !readiness.ready) {
      const lines = []
      if (readiness.warnings && readiness.warnings.length) lines.push('Still to be marked Construction Issue:\n  - ' + readiness.warnings.join('\n  - '))
      if (readiness.missing && readiness.missing.length) lines.push('Missing sections (nothing to include):\n  - ' + readiness.missing.join('\n  - '))
      const msg = 'The O&M Manual may not be ready to compile.\n\n' + lines.join('\n\n') + '\n\nPlease check with your Rock Roofing Design Manager that the O&Ms are ready to be compiled.\n\nBuild anyway?'
      if (!confirm(msg)) return
    } else if (manual && !confirm('Rebuild the O&M Manual? This replaces the current version.')) {
      return
    }
    setBuilding(true); setErr('')
    try {
      const r = await fetch('/api/design-oms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'build' }) })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Could not build'); setBuilding(false); return }
      setManual(d.manual); setRevisions(d.revisions || []); setViewingUrl(d.manual.url)
    } catch { setErr('Could not build') }
    setBuilding(false)
  }

  async function sendNotify() {
    const ids = Object.keys(notifyPick).filter(k => notifyPick[k])
    if (!ids.length) { setErr('Pick at least one customer.'); return }
    setNotifying(true); setErr('')
    try {
      const r = await fetch('/api/design-oms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'notify', recipientIds: ids }) })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Could not send'); setNotifying(false); return }
      setNotifyOpen(false); setNotifyPick({})
      alert(`Notified ${d.sent} customer${d.sent === 1 ? '' : 's'}.${d.failed && d.failed.length ? ` Could not send to: ${d.failed.join(', ')}.` : ''}`)
    } catch { setErr('Could not send') }
    setNotifying(false)
  }

  async function addComment(html) {
    try {
      const r = await fetch('/api/design-oms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'comment', html }) })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Could not comment'); return }
      setComments(d.comments || [])
    } catch { setErr('Could not comment') }
  }
  function recordDownload() {
    fetch('/api/design-oms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'record-download' }) })
      .then(() => { if (isExternal) setCustomerDownloaded(true); load() }).catch(() => {})
  }

  if (!auth.ready) return null
  const totalDocs = available.reduce((a, s) => a + s.count, 0)
  const viewingRev = revisions.find(r => r.url === viewingUrl) || manual
  const dlName = `${projectNo}-OM-Manual${viewingRev && viewingRev.revision ? `-Rev${viewingRev.revision}` : ''}.pdf`

  return (
    <>
      <Head><title>O&amp;Ms - Design</title></Head>
      <DesignNav active="oms" projectNo={projectNo} projectName={auth.project && auth.project.name} isInternal={auth.isInternal} />
      <div style={{ width: '100%', margin: 0, padding: '22px 24px 60px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ margin: '0 0 2px', color: INK, fontSize: 24 }}>O&amp;M Manual</h1>
            <p style={{ color: '#8a857c', fontSize: 14, margin: 0 }}>A single Operation &amp; Maintenance Manual combining the Technical Submittal, Construction Issue drawings, Calculations, Leak Test Certs and Warranties.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {viewingRev && <a href={`/api/download?url=${encodeURIComponent(viewingRev.url)}&name=${encodeURIComponent(dlName)}`} onClick={recordDownload} style={{ ...btnGhost, color: BRAND, borderColor: '#bbead6', textDecoration: 'none' }}>Download{viewingRev.revision ? ` Rev ${viewingRev.revision}` : ''}</a>}
            {canEdit && manual && <button onClick={() => setNotifyOpen(true)} style={{ ...btnGhost, color: BRAND, borderColor: '#bbead6' }}>Notify Customer O&amp;Ms are ready</button>}
            {canEdit && <button onClick={build} disabled={building} style={{ ...btnPrimary, opacity: building ? 0.6 : 1 }}>{building ? 'Building...' : (manual ? 'Rebuild O&M Manual' : 'Build O&M Manual')}</button>}
          </div>
        </div>
        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        {canEdit && readiness && !readiness.ready && (available.length > 0 || (readiness.missing && readiness.missing.length > 0)) && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '12px 14px', fontSize: 13, marginBottom: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>&#9888; Check before compiling</div>
            {readiness.warnings && readiness.warnings.map((w, i) => <div key={`w${i}`} style={{ marginTop: 2 }}>&bull; {w}</div>)}
            {readiness.missing && readiness.missing.length > 0 && <div style={{ marginTop: 2 }}>&bull; No documents yet for: {readiness.missing.join(', ')}</div>}
            <div style={{ marginTop: 8, fontWeight: 600 }}>Please check with your Rock Roofing Design Manager that the O&amp;Ms are ready to be compiled. Only Construction Issue documents are included.</div>
          </div>
        )}

        {loading ? <div style={{ color: '#999', padding: 20 }}>Loading...</div> : (
          <>
            {manual && (() => {
              const custDownloads = (downloadedList || []).filter(d => d.external).sort((a, b) => (b.at || 0) - (a.at || 0))
              const fmt = (ts) => { if (!ts) return ''; const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
              return customerDownloaded ? (
                <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', color: '#16a34a', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 0.3 }}>CUSTOMER DOWNLOADED</div>
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {custDownloads.map((d, i) => (
                      <div key={i} style={{ fontSize: 12.5, fontWeight: 600, color: '#15803d' }}>
                        {d.name || 'Customer user'}{d.company ? ` (${d.company})` : ''} &mdash; {fmt(d.at)}{d.revision ? <>&nbsp;&nbsp;&middot;&nbsp;&nbsp;Rev {d.revision}</> : ''}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ background: '#fee2e2', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 8, padding: '10px 14px', fontSize: 14, fontWeight: 800, letterSpacing: 0.3, marginBottom: 14 }}>
                  CUSTOMER NOT DOWNLOADED
                  {custDownloads.length > 0 && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#b91c1c', marginTop: 5 }}>
                      (Previously downloaded an earlier revision: {custDownloads.map(d => `${d.name || 'Customer'}${d.revision ? ` Rev ${d.revision}` : ''}`).join(', ')})
                    </div>
                  )}
                </div>
              )
            })()}

            {manual && (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#1e40af', fontWeight: 700, marginBottom: 6 }}>Comments ({comments.length})</div>
                <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 8 }}>
                  {comments.length === 0 && <div style={{ color: '#7c93b8', fontSize: 13, padding: '6px 0' }}>No comments yet. Customers can leave comments here to request changes.</div>}
                  {comments.map(c => (
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
                <OmCommentBox people={people} onSubmit={addComment} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: manual ? '300px 1fr' : '1fr', gap: 18, alignItems: 'start' }}>
              <div>
                <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 10 }}>What will be included</div>
                  {available.length === 0
                    ? <div style={{ fontSize: 13, color: '#aaa' }}>Nothing yet. Add Tech Subs, Construction Issue drawings, Calculations, Leak Test Certs or Warranties, then build.</div>
                    : available.map((s, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f4f4f4', fontSize: 13 }}>
                        <span style={{ color: '#333' }}>{i + 1}. {s.title}</span>
                        <span style={{ color: '#888' }}>{s.count} doc{s.count === 1 ? '' : 's'}</span>
                      </div>
                    ))}
                  {available.length > 0 && <div style={{ marginTop: 10, fontSize: 12, color: '#999' }}>{totalDocs} document{totalDocs === 1 ? '' : 's'} across {available.length} section{available.length === 1 ? '' : 's'}.</div>}
                </div>

                {revisions.length > 0 && (
                  <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 16, marginTop: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 10 }}>Revisions</div>
                    {revisions.map((r, i) => {
                      const isCurrent = manual && r.url === manual.url
                      const isViewing = r.url === viewingUrl
                      return (
                        <button key={r.url} onClick={() => setViewingUrl(r.url)} style={{ display: 'block', width: '100%', textAlign: 'left', border: `1px solid ${isViewing ? BRAND : '#eee'}`, background: isViewing ? '#f0fdf7' : '#fff', borderRadius: 8, padding: '8px 10px', marginBottom: 8, cursor: 'pointer' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>Rev {r.revision != null ? r.revision : (revisions.length - i)}</span>
                            {isCurrent
                              ? <span style={{ fontSize: 10.5, fontWeight: 700, color: '#15803d', background: '#dcfce7', borderRadius: 12, padding: '1px 8px' }}>CURRENT</span>
                              : <span style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', background: '#f3f4f6', borderRadius: 12, padding: '1px 8px' }}>OLD</span>}
                          </div>
                          <div style={{ fontSize: 11.5, color: '#888', marginTop: 3 }}>{fmtDateTime(r.builtAt)}{r.builtBy ? ` - ${r.builtBy}` : ''}</div>
                        </button>
                      )
                    })}
                    {canEdit && <div style={{ marginTop: 2, fontSize: 11.5, color: '#999' }}>Rebuilding creates a new revision and keeps the old ones here.</div>}
                  </div>
                )}
              </div>

              {viewingRev && (
                <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 12, minHeight: 400 }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Combined O&amp;M Manual{viewingRev.revision ? ` - Rev ${viewingRev.revision}` : ''}{manual && viewingRev.url === manual.url ? ' (current)' : ' (old revision)'} - view only</div>
                  <DrawingMarkup key={viewingRev.url} imageUrl={viewingRev.url} contentType="application/pdf" initial={null} canEdit={false} onSave={() => {}} fileName={dlName} docLabel="manual" />
                </div>
              )}
            </div>
            {!manual && available.length > 0 && !canEdit && <div style={{ marginTop: 16, color: '#999', fontSize: 13 }}>The O&amp;M Manual has not been built yet.</div>}
          </>
        )}
      </div>

      {notifyOpen && (
        <div onClick={() => setNotifyOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, width: 460, maxWidth: '92vw' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 17, color: INK }}>Notify Customer - O&amp;Ms are ready</h3>
            <p style={{ fontSize: 13, color: '#8a857c', marginTop: 0 }}>Choose who to email. They'll get a link to this project's O&amp;M page to view and download the manual. You can pick more than one.</p>
            <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #eee', borderRadius: 8, padding: 8 }}>
              {customers.length === 0 && <div style={{ fontSize: 13, color: '#aaa', padding: 8 }}>No customer users with an email on this project.</div>}
              {customers.map(c => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!notifyPick[c.id]} onChange={() => setNotifyPick(s => ({ ...s, [c.id]: !s[c.id] }))} />
                  <span style={{ fontSize: 13.5 }}>{c.name} <span style={{ color: '#999' }}>({c.company})</span><br /><span style={{ fontSize: 11.5, color: '#aaa' }}>{c.email}</span></span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <button onClick={() => setNotifyPick(customers.reduce((a, c) => (a[c.id] = true, a), {}))} style={{ background: 'none', border: 'none', color: BRAND, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>Select all</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setNotifyOpen(false)} style={btnGhost}>Cancel</button>
                <button onClick={sendNotify} disabled={notifying} style={{ ...btnPrimary, opacity: notifying ? 0.6 : 1 }}>{notifying ? 'Sending...' : 'Send notification'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function OmCommentBox({ people, onSubmit }) {
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
    for (const u of (people || [])) if (u.name) html = html.replace(new RegExp('@' + u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'g'), `<span style="color:#2563eb;font-weight:700">@${u.name}</span>`)
    onSubmit(html); setText(''); setSuggest(null)
  }
  const matches = suggest ? (people || []).filter(u => u.name && u.name.toLowerCase().includes(suggest.query)).slice(0, 6) : []
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

const btnPrimary = { background: BRAND, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const btnGhost = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
