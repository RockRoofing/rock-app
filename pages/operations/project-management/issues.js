import { useState, useEffect, useMemo } from 'react'
import { compressImage } from '../../../lib/compressImage'
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
  const [create, setCreate] = useState(false)
  const [meName, setMeName] = useState('')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState({ key: 'createdAt', dir: 'desc' })
  const [filters, setFilters] = useState({ project: '', status: 'open', createdBy: '', type: '', from: '', to: '' })
  const setF = (patch) => { setFilters(prev => ({ ...prev, ...patch })); setPage(0) }

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
  useEffect(() => { fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => setMeName(d.user?.name || '')).catch(() => {}) }, [])

  // Deep link from the notification email: ?issue=<id> opens that issue for editing
  useEffect(() => {
    const id = router.query.issue
    if (id && issues.length) { const found = issues.find(x => x.id === id); if (found) setEdit({ ...found }) }
  }, [router.query, issues])

  function toggleSort(key) { setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }) }
  const arrow = (key) => sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''
  const filterOptions = useMemo(() => {
    const byField = (get) => [...new Set(issues.map(get).filter(Boolean))].sort()
    const types = [...new Set(issues.flatMap(i => i.issueTypes || []))].sort()
    return { projects: byField(i => `${i.projectNo || ''}${i.projectName ? ' — ' + i.projectName : ''}`), createdBy: byField(i => i.createdBy), types }
  }, [issues])

  const sorted = useMemo(() => {
    let arr = issues.filter(i => {
      if (filters.project && `${i.projectNo || ''}${i.projectName ? ' — ' + i.projectName : ''}` !== filters.project) return false
      if (filters.status === 'open' && i.resolvedDate) return false
      if (filters.status === 'closed' && !i.resolvedDate) return false
      if (filters.createdBy && i.createdBy !== filters.createdBy) return false
      if (filters.type && !(i.issueTypes || []).includes(filters.type)) return false
      if (filters.from) { const d = i.createdAt ? new Date(i.createdAt) : null; if (!d || d < parseLocal(filters.from)) return false }
      if (filters.to) { const d = i.createdAt ? new Date(i.createdAt) : null; const end = parseLocal(filters.to); if (end) end.setHours(23,59,59,999); if (!d || d > end) return false }
      return true
    })
    const val = (i) => {
      if (sort.key === 'project') return `${i.projectNo || ''} ${i.projectName || ''}`.toLowerCase()
      if (sort.key === 'name') return (i.issueName || '').toLowerCase()
      if (sort.key === 'type') return (i.issueTypes || []).join(',').toLowerCase()
      if (sort.key === 'createdBy') return (i.createdBy || '').toLowerCase()
      if (sort.key === 'resolved') return i.resolvedDate || ''
      if (sort.key === 'required') return i.requiredDate || ''
      return i.createdAt || 0
    }
    arr = [...arr].sort((a, b) => { const av = val(a), bv = val(b); if (av < bv) return sort.dir === 'asc' ? -1 : 1; if (av > bv) return sort.dir === 'asc' ? 1 : -1; return 0 })
    return arr
  }, [issues, sort, filters])
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
      <PageHeading title="Issues" sub="Raised from the Site App. Decide whether each needs sending to the customer."
        action={<button onClick={() => setCreate(true)} style={primaryBtn}>+ Add Issue</button>} />

      {loading ? <Loading /> : issues.length === 0 ? (
        <EmptyCard title="No issues yet" body="Issues raised by operatives on the Site App will appear here." />
      ) : (
        <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14, alignItems: 'flex-end' }}>
          <FilterSel label="Project" value={filters.project} onChange={v => setF({ project: v })} options={filterOptions.projects} />
          <FilterSel label="Status" value={filters.status} onChange={v => setF({ status: v })} options={[{ v: 'open', l: 'Open' }, { v: 'closed', l: 'Closed' }]} raw />
          <FilterSel label="Created By" value={filters.createdBy} onChange={v => setF({ createdBy: v })} options={filterOptions.createdBy} />
          <FilterSel label="Issue Type" value={filters.type} onChange={v => setF({ type: v })} options={filterOptions.types} />
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Created from</div>
            <input type="date" value={filters.from} onChange={e => setF({ from: e.target.value })} style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Created to</div>
            <input type="date" value={filters.to} onChange={e => setF({ to: e.target.value })} style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5 }} />
          </div>
          {(filters.project || filters.status || filters.createdBy || filters.type || filters.from || filters.to) && (
            <button onClick={() => setFilters({ project: '', status: '', createdBy: '', type: '', from: '', to: '' })} style={{ ...ghostBtn, padding: '7px 12px' }}>Clear</button>
          )}
          <div style={{ marginLeft: 'auto', fontSize: 12.5, color: '#888', alignSelf: 'center' }}>{sorted.length} issue{sorted.length === 1 ? '' : 's'}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1250 }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              <th style={{ ...th, minWidth: 200 }}>Send to Customer?</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('project')}>Project{arrow('project')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('createdAt')}>Created{arrow('createdAt')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('createdBy')}>Created By{arrow('createdBy')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('name')}>Issue Name{arrow('name')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('type')}>Issue Type{arrow('type')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('required')}>Required Resolution{arrow('required')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('resolved')}>Resolved Date{arrow('resolved')}</th>
              <th style={th}>Internal Comments</th>
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
                      <input type="date" value={i.requiredDate || ''} onChange={e => patchIssue(i.id, { requiredDate: e.target.value })} style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid #e0e0e0', fontSize: 12 }} />
                      {i.requiredDate && !i.resolvedDate && parseLocal(i.requiredDate) < new Date(new Date().toDateString()) && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>⚠ Overdue</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <input type="date" value={i.resolvedDate || ''} onChange={e => patchIssue(i.id, { resolvedDate: e.target.value })} style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid #e0e0e0', fontSize: 12 }} />
                      {resolved && <div style={{ fontSize: 11, color: '#16a34a', marginTop: 2 }}>Resolved</div>}
                    </td>
                    <td style={{ ...td, cursor: 'pointer', maxWidth: 200 }} onClick={() => setCell({ title: 'Internal Comments', text: i.comments, editId: i.id })}>{clamp(i.comments, 50)}</td>
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

      {create && <CreateModal projects={projects} createdBy={meName} onClose={() => setCreate(false)} onSaved={() => { setCreate(false); load() }} />}
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

      <L>Internal Comments</L>
      <textarea value={f.comments || ''} onChange={e => set({ comments: e.target.value })} style={{ ...input, minHeight: 70, resize: 'vertical' }} placeholder="Internal comments" />

      <L>Required Resolution Date</L>
      <input type="date" value={f.requiredDate || ''} onChange={e => set({ requiredDate: e.target.value })} style={{ ...input, maxWidth: 200 }} />

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

// ── Create a new issue from the portal ──
function FilterSel({ label, value, onChange, options, raw }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5, fontFamily: 'inherit', minWidth: 130, maxWidth: 220 }}>
        <option value="">All</option>
        {options.map(o => raw ? <option key={o.v} value={o.v}>{o.l}</option> : <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

const ISSUE_TYPES = ['Design', 'Quality', 'Health & Safety', 'Delay / Programme', 'Deliveries / Materials', 'Water ingress', 'Damage to our works', 'Interface issue', 'Access', 'Weather', 'Customer / Main Contractor', 'Workmanship', 'Other']

function CreateModal({ projects, createdBy, onClose, onSaved }) {
  const [f, setF] = useState({ projectNo: '', projectName: '', projectAddress: '', issueName: '', issueTypes: [], issueOther: '', description: '', requiredDate: '', photos: [] })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const set = (patch) => setF(prev => ({ ...prev, ...patch }))

  function pickProject(no) {
    const p = projects.find(x => x.no === no)
    set({ projectNo: no, projectName: p?.name || '' })
  }
  function toggleType(t) { set({ issueTypes: f.issueTypes.includes(t) ? f.issueTypes.filter(x => x !== t) : [...f.issueTypes, t] }) }

  async function handleFiles(files) {
    if (!files || !files.length) return
    setUploading(true)
    const next = [...f.photos]
    for (const original of Array.from(files)) {
      const file = await compressImage(original)
      try {
        const up = await fetch('/api/upload-file', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name || `photo-${Date.now()}.jpg`), 'x-content-type': file.type || 'image/jpeg' }, body: file })
        const d = await up.json(); if (up.ok && d.url) next.push(d.url)
      } catch {}
    }
    set({ photos: next }); setUploading(false)
  }

  async function save() {
    setErr('')
    if (!f.projectNo) return setErr('Select a project.')
    if (!f.issueName.trim()) return setErr('Issue name is required.')
    if (!f.issueTypes.length) return setErr('Select at least one issue type.')
    if (f.issueTypes.includes('Other') && !f.issueOther.trim()) return setErr('Describe the other issue type.')
    if (!f.description.trim()) return setErr('Description is required.')
    if (!f.photos.length) return setErr('Attach at least one photo.')
    setSaving(true)
    try {
      const issue = { ...f, createdBy: createdBy || 'Portal user', issueOther: f.issueTypes.includes('Other') ? f.issueOther.trim() : '' }
      const r = await fetch('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issue }) })
      const d = await r.json()
      if (!r.ok || !d.issue) throw new Error(d.error || 'Save failed')
      fetch('/api/issue-notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d.issue.id }) }).catch(() => {})
      onSaved()
    } catch (e) { setErr(e.message || 'Could not save.') }
    setSaving(false)
  }

  const input = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }
  const L = ({ children }) => <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '16px 0 6px' }}>{children}<span style={{ color: '#dc2626' }}> *</span></div>

  return (
    <Modal title="Add Issue" onClose={onClose} wide>
      <L>Project</L>
      <select value={f.projectNo} onChange={e => pickProject(e.target.value)} style={input}>
        <option value="">Select project…</option>
        {projects.map(p => <option key={p.no} value={p.no}>{[p.no, p.name].filter(Boolean).join(' — ')}</option>)}
      </select>
      <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>Created: {todayISO().split('-').reverse().join('/')} · By: {createdBy || 'Portal user'}</div>

      <L>Issue Name</L>
      <input value={f.issueName} onChange={e => set({ issueName: e.target.value })} style={input} placeholder="Short title for the issue" />

      <L>Issue Type <span style={{ fontWeight: 400, color: '#999', fontSize: 12 }}>(select all that apply)</span></L>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {ISSUE_TYPES.map(t => {
          const on = f.issueTypes.includes(t)
          return <button key={t} onClick={() => toggleType(t)} style={{ padding: '8px 13px', borderRadius: 20, border: on ? `2px solid ${GOLD}` : '1px solid #d9d5cc', background: on ? '#fffbeb' : '#fff', color: on ? '#92400e' : '#555', fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: 'pointer' }}>{on ? '✓ ' : ''}{t}</button>
        })}
      </div>
      {f.issueTypes.includes('Other') && <input value={f.issueOther} onChange={e => set({ issueOther: e.target.value })} style={{ ...input, marginTop: 10 }} placeholder="Describe the other issue type" />}

      <L>Issue Description</L>
      <textarea value={f.description} onChange={e => set({ description: e.target.value })} style={{ ...input, minHeight: 90, resize: 'vertical' }} placeholder="Describe the issue" />

      <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '16px 0 6px' }}>Required Resolution Date</div>
      <input type="date" value={f.requiredDate} onChange={e => set({ requiredDate: e.target.value })} style={{ ...input, maxWidth: 200 }} />

      <L>Photos</L>
      <label style={{ display: 'inline-block', padding: '10px 16px', border: '2px dashed #d9d5cc', borderRadius: 10, cursor: 'pointer', color: '#666', fontSize: 13 }}>
        {uploading ? 'Uploading…' : '📷 Add photos'}
        <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
      </label>
      {f.photos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {f.photos.map((p, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={p} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid #eee' }} />
              <button onClick={() => set({ photos: f.photos.filter((_, j) => j !== i) })} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: '20px', padding: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}

      {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 14 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, borderTop: '1px solid #eee', paddingTop: 18 }}>
        <button onClick={onClose} style={ghostBtn}>Cancel</button>
        <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Create Issue'}</button>
      </div>
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
