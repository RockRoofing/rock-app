import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, th, td, Loading, EmptyCard, primaryBtn, ghostBtn, linkBtn } from '../../../components/opsUI'
import { useRouter } from 'next/router'

const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const parseLocal = (d) => { if (!d) return null; const [y, m, day] = String(d).split('-').map(Number); return new Date(y, (m || 1) - 1, day || 1) }
const fmtLocal = (d) => { const dt = parseLocal(d); return dt ? dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' }
const fmtTs = (ts) => ts ? new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const clamp = (s, n = 60) => { if (!s) return '—'; const t = String(s); return t.length > n ? t.slice(0, n) + '…' : t }
const PAGE_SIZE = 50

const SEND_OPTS = [
  { v: '', label: 'Select…' },
  { v: 'send', label: 'Yes — Send' },
  { v: 'edits', label: 'No — Requires edits' },
  { v: 'nosend', label: 'No — Do not send' },
]

export default function IssuesPage() {
  const router = useRouter()
  const [issues, setIssues] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(null)
  const [cell, setCell] = useState(null)
  const [sendFor, setSendFor] = useState(null)   // issue for which the send-to-customer pop-out is open
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState({ key: 'createdAt', dir: 'desc' })

  async function load() {
    setLoading(true)
    try {
      const [i, p] = await Promise.all([
        fetch('/api/issues').then(r => r.json()).catch(() => ({})),
        fetch('/api/ops-projects').then(r => r.json()).catch(() => ({})),
      ])
      setIssues(i.issues || [])
      setProjects((p.projects || []).map(x => ({ no: x.projectNo, name: x.projectName || '' })))
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Deep link from the notification email: ?issue=<id> opens that issue for editing
  useEffect(() => {
    const id = router.query.issue
    if (id && issues.length) { const found = issues.find(x => x.id === id); if (found) setEdit({ ...found }) }
  }, [router.query, issues])

  function toggleSort(key) { setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }) }
  const arrow = (key) => sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''
  const sorted = useMemo(() => {
    const arr = [...issues]
    const val = (i) => {
      if (sort.key === 'project') return `${i.projectNo || ''} ${i.projectName || ''}`.toLowerCase()
      if (sort.key === 'name') return (i.issueName || '').toLowerCase()
      if (sort.key === 'type') return (i.issueTypes || []).join(',').toLowerCase()
      if (sort.key === 'createdBy') return (i.createdBy || '').toLowerCase()
      if (sort.key === 'resolved') return i.resolvedDate || ''
      return i.createdAt || 0
    }
    arr.sort((a, b) => { const av = val(a), bv = val(b); if (av < bv) return sort.dir === 'asc' ? -1 : 1; if (av > bv) return sort.dir === 'asc' ? 1 : -1; return 0 })
    return arr
  }, [issues, sort])
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  async function patchIssue(id, patch) {
    setIssues(list => list.map(i => i.id === id ? { ...i, ...patch } : i))
    const current = issues.find(i => i.id === id) || {}
    await fetch('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issue: { ...current, ...patch, id } }) })
  }
  async function deleteIssue(i) {
    if (!confirm(`Delete issue ${i.issueId || ''}?`)) return
    await fetch('/api/issues', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: i.id }) })
    load()
  }

  // Status of the Send-to-Customer cell for a row
  function sendStatus(i) {
    if (!i.sendToCustomer) return { kind: 'action', text: '⚠ Needs actioning' }
    if (i.sendToCustomer === 'nosend') return { kind: 'clear', text: '—' }
    if (i.sendToCustomer === 'edits') return { kind: 'edits', text: 'Requires edits' }
    if (i.sendToCustomer === 'send') {
      if (i.sentToCustomer) return { kind: 'sent', text: `Sent ${fmtTs(i.sentAt)}` }
      if (i.sentManually) return { kind: 'sent', text: 'Sent manually' }
      return { kind: 'warn', text: '⚠ Not sent yet' }
    }
    return { kind: 'action', text: '—' }
  }

  return (
    <OperationsShell active="pm:issues" section="pm" title="Issues" wide>
      <PageHeading title="Issues" sub="Raised from the Site App. Decide whether each needs sending to the customer." />

      {loading ? <Loading /> : issues.length === 0 ? (
        <EmptyCard title="No issues yet" body="Issues raised by operatives on the Site App will appear here." />
      ) : (
        <>
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1250 }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              <th style={{ ...th, minWidth: 200 }}>Send to Customer?</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('project')}>Project{arrow('project')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('createdAt')}>Created{arrow('createdAt')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('createdBy')}>Created By{arrow('createdBy')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('name')}>Issue Name{arrow('name')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('type')}>Issue Type{arrow('type')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('resolved')}>Resolved Date{arrow('resolved')}</th>
              <th style={th}>Comments</th>
              <th style={th}>Attachments</th>
              <th style={{ ...th, textAlign: 'right' }}></th>
            </tr></thead>
            <tbody>
              {pageRows.map(i => {
                const st = sendStatus(i)
                const resolved = !!i.resolvedDate
                return (
                  <tr key={i.id} style={{ borderTop: '1px solid #f0f0f0', verticalAlign: 'top', background: resolved ? '#ecfdf5' : (st.kind === 'clear' ? '#fff' : '#fff') }}>
                    {/* Send to customer cell */}
                    <td style={{ ...td, minWidth: 200 }}>
                      <select value={i.sendToCustomer || ''} onChange={e => {
                        const v = e.target.value
                        if (v === 'send') { patchIssue(i.id, { sendToCustomer: v }); setSendFor({ ...i, sendToCustomer: v }) }
                        else patchIssue(i.id, { sendToCustomer: v })
                      }} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #e0e0e0', fontSize: 12, width: '100%', fontFamily: 'inherit' }}>
                        {SEND_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                      </select>
                      <div style={{ marginTop: 6 }}>
                        {st.kind === 'action' && <span style={{ fontSize: 11.5, color: '#b45309', background: '#fef3c7', padding: '2px 8px', borderRadius: 12 }}>{st.text}</span>}
                        {st.kind === 'warn' && (
                          <div>
                            <span style={{ fontSize: 11.5, color: '#dc2626', background: '#fee2e2', padding: '2px 8px', borderRadius: 12 }}>{st.text}</span>
                            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button onClick={() => setSendFor({ ...i })} style={{ ...linkBtn, fontSize: 11.5 }}>Send now</button>
                              <button onClick={() => patchIssue(i.id, { sentManually: true })} style={{ ...linkBtn, fontSize: 11.5, color: '#16a34a' }}>Sent manually?</button>
                            </div>
                          </div>
                        )}
                        {st.kind === 'sent' && <span style={{ fontSize: 11.5, color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: 12 }}>✓ {st.text}</span>}
                        {st.kind === 'edits' && <span style={{ fontSize: 11.5, color: '#888' }}>{st.text}</span>}
                      </div>
                    </td>
                    <td style={td}><strong>{i.projectNo || '—'}</strong>{i.projectName ? <div style={{ fontSize: 11, color: '#999' }}>{i.projectName}</div> : null}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtTs(i.createdAt)}</td>
                    <td style={td}>{i.createdBy || '—'}</td>
                    <td style={{ ...td, cursor: 'pointer' }} onClick={() => setCell({ title: 'Issue', text: i.issueName })}>{clamp(i.issueName, 40)}</td>
                    <td style={td}>{[...(i.issueTypes || []), ...(i.issueOther ? [`Other: ${i.issueOther}`] : [])].join(', ') || '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <input type="date" value={i.resolvedDate || ''} onChange={e => patchIssue(i.id, { resolvedDate: e.target.value })} style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid #e0e0e0', fontSize: 12 }} />
                      {resolved && <div style={{ fontSize: 11, color: '#16a34a', marginTop: 2 }}>Resolved</div>}
                    </td>
                    <td style={{ ...td, cursor: 'pointer', maxWidth: 200 }} onClick={() => setCell({ title: 'Comments', text: i.comments, editId: i.id })}>{clamp(i.comments, 50)}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{(i.photos || []).length ? <span title={`${i.photos.length} photo(s)`}>📎 {i.photos.length}</span> : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => setEdit({ ...i })} style={linkBtn}>Edit</button>
                      <button onClick={() => deleteIssue(i)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16, alignItems: 'center' }}>
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={ghostBtn}>‹ Prev</button>
            <span style={{ fontSize: 13, color: '#666' }}>Page {page + 1} of {pageCount}</span>
            <button disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)} style={ghostBtn}>Next ›</button>
          </div>
        )}
        </>
      )}

      {cell && <Modal title={cell.title} onClose={() => setCell(null)}>
        {cell.editId ? (
          <CommentsEditor id={cell.editId} initial={cell.text} onSave={(v) => { patchIssue(cell.editId, { comments: v }); setCell(null) }} onCancel={() => setCell(null)} />
        ) : <div style={{ fontSize: 14, color: '#333', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{cell.text || '—'}</div>}
      </Modal>}

      {edit && <EditModal initial={edit} onClose={() => { setEdit(null); if (router.query.issue) router.replace('/operations/project-management/issues', undefined, { shallow: true }) }} onSaved={() => { setEdit(null); load() }} onSend={(iss) => setSendFor(iss)} />}

      {sendFor && <SendCustomerModal issue={sendFor} onClose={() => setSendFor(null)} onSent={() => { setSendFor(null); load() }} />}
    </OperationsShell>
  )
}

function CommentsEditor({ initial, onSave, onCancel }) {
  const [v, setV] = useState(initial || '')
  return (
    <div>
      <textarea value={v} onChange={e => setV(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', minHeight: 140, padding: 11, border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }} placeholder="Add a comment…" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        <button onClick={() => onSave(v)} style={primaryBtn}>Save</button>
      </div>
    </div>
  )
}

// ── Edit window (click-off safe: only Save / X / Cancel close it) ──
function EditModal({ initial, onClose, onSaved, onSend }) {
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = (patch) => setF(prev => ({ ...prev, ...patch }))

  async function save(closeAfter = true) {
    setSaving(true)
    try {
      await fetch('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issue: f }) })
      if (closeAfter) onSaved()
    } catch { alert('Could not save.') }
    setSaving(false)
  }

  const L = ({ children }) => <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '16px 0 6px' }}>{children}</div>
  const val = { fontSize: 13.5, color: '#333', whiteSpace: 'pre-wrap' }
  const input = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }

  return (
    <Modal title={`${f.issueId || 'Issue'} — ${f.issueName || ''}`} onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
        <div><L>Project</L><div style={val}>{f.projectNo} {f.projectName ? `— ${f.projectName}` : ''}</div></div>
        <div><L>Created</L><div style={val}>{fmtTs(f.createdAt)} by {f.createdBy || '—'}</div></div>
      </div>
      {f.projectAddress && <><L>Project Address</L><div style={val}>{f.projectAddress}</div></>}

      <L>Issue Name</L>
      <input value={f.issueName || ''} onChange={e => set({ issueName: e.target.value })} style={input} />

      <L>Issue Type</L>
      <div style={val}>{[...(f.issueTypes || []), ...(f.issueOther ? [`Other: ${f.issueOther}`] : [])].join(', ') || '—'}</div>

      <L>Description</L>
      <textarea value={f.description || ''} onChange={e => set({ description: e.target.value })} style={{ ...input, minHeight: 90, resize: 'vertical' }} />

      <L>Comments</L>
      <textarea value={f.comments || ''} onChange={e => set({ comments: e.target.value })} style={{ ...input, minHeight: 70, resize: 'vertical' }} placeholder="Internal comments" />

      <L>Resolved Date</L>
      <input type="date" value={f.resolvedDate || ''} onChange={e => set({ resolvedDate: e.target.value })} style={{ ...input, maxWidth: 200 }} />
      {f.resolvedDate && <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4 }}>This issue is marked resolved.</div>}

      {(f.photos || []).length > 0 && <>
        <L>Photos</L>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {f.photos.map((p, i) => <a key={i} href={p} target="_blank" rel="noreferrer"><img src={p} alt="" style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid #eee' }} /></a>)}
        </div>
      </>}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 24, borderTop: '1px solid #eee', paddingTop: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <a href={`/api/issue-pdf?id=${f.id}`} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block' }}>Download PDF</a>
          <button onClick={async () => { await save(false); onSend({ ...f }) }} style={ghostBtn}>Send to Customer</button>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => save(true)} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Send to Customer pop-out: pulls IHM site contacts, edit line-by-line, add, send ──
function SendCustomerModal({ issue, onClose, onSent }) {
  const [emails, setEmails] = useState([])
  const [newEmail, setNewEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  useEffect(() => { (async () => {
    try {
      const r = await fetch(`/api/ops-projects?no=${encodeURIComponent(issue.projectNo)}`).then(r => r.json())
      const p = r.project || r
      const contacts = (p?.data?.siteContacts || p?.siteContacts || [])
      const found = contacts.map(c => c.email).filter(Boolean)
      setEmails([...new Set(found)])
    } catch {}
    setLoading(false)
  })() }, [issue])

  function addEmail() {
    const e = newEmail.trim()
    if (e && /\S+@\S+\.\S+/.test(e) && !emails.includes(e)) { setEmails([...emails, e]); setNewEmail('') }
  }
  async function send() {
    if (!emails.length) { alert('Add at least one email address.'); return }
    setSending(true)
    try {
      const r = await fetch('/api/issue-send-customer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: issue.id, emails }) })
      const d = await r.json()
      if (d.sent > 0) { alert(`Sent to ${d.sent} recipient(s).`); onSent() }
      else alert(`Could not send: ${d.error || 'unknown error'}`)
    } catch { alert('Send failed.') }
    setSending(false)
  }

  const input = { flex: 1, padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }
  return (
    <Modal title="Send Issue to Customer" onClose={onClose}>
      <p style={{ fontSize: 13, color: '#666', marginTop: 0 }}>Customer contacts from this project's IHM. Remove any you don't want, or add new ones, then send. They'll receive a styled PDF of the issue.</p>
      {loading ? <Loading /> : (
        <>
          {emails.length === 0 && <div style={{ fontSize: 13, color: '#999', marginBottom: 10 }}>No customer contacts found on the IHM. Add one below.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {emails.map((e, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#faf9f7', borderRadius: 8 }}>
                <span style={{ flex: 1, fontSize: 13 }}>{e}</span>
                <button onClick={() => setEmails(emails.filter((_, j) => j !== i))} style={{ ...linkBtn, color: '#dc2626' }}>Remove</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={newEmail} onChange={e => setNewEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEmail()} style={input} placeholder="Add email address…" type="email" />
            <button onClick={addEmail} style={ghostBtn}>Add</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24, borderTop: '1px solid #eee', paddingTop: 18 }}>
            <button onClick={onClose} style={ghostBtn}>Cancel</button>
            <button onClick={send} disabled={sending || !emails.length} style={primaryBtn}>{sending ? 'Sending…' : `Send to ${emails.length || 0}`}</button>
          </div>
        </>
      )}
    </Modal>
  )
}

// Shared modal — click-off safe (backdrop does NOT close)
function Modal({ title, children, onClose, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3vh 2vw', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: wide ? 860 : 620, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 26px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff', borderRadius: '14px 14px 0 0', zIndex: 2 }}>
          <h2 style={{ margin: 0, fontSize: 17, color: INK }}>{title}</h2>
          <button onClick={onClose} style={{ fontSize: 24, border: 'none', background: 'none', cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        <div style={{ padding: '8px 26px 26px' }}>{children}</div>
      </div>
    </div>
  )
}
