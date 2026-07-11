import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/router'
import { Shell, bigBtn } from './index'

const INK = '#1a1a19'
const BRAND = '#ca8a04'
const fmtTs = (ts) => ts ? new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const SEND_OPTS = [
  { v: '', label: 'Select…' },
  { v: 'send', label: 'Yes — Send' },
  { v: 'edits', label: 'No — Requires edits' },
  { v: 'nosend', label: 'No — Do not send' },
]

export default function IssuesLog() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [issues, setIssues] = useState([])
  const [projectFilter, setProjectFilter] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    let u = null; try { u = JSON.parse(s) } catch {}
    setUser(u); setReady(true)
    if (u?.accessLevel === 'contracts-manager') load()
  }, [])

  async function load() {
    try { const d = await fetch('/api/issues').then(r => r.json()); setIssues(d.issues || []) } catch {}
  }
  // Deep link from the email
  useEffect(() => {
    const id = router.query.issue
    if (id && issues.length) { const f = issues.find(i => i.id === id); if (f) setOpen(f) }
  }, [router.query, issues])

  const projects = useMemo(() => [...new Set(issues.map(i => `${i.projectNo || ''}${i.projectName ? ' — ' + i.projectName : ''}`).filter(Boolean))].sort(), [issues])
  const rows = useMemo(() => issues.filter(i => {
    if (!showClosed && i.resolvedDate) return false
    if (projectFilter && `${i.projectNo || ''}${i.projectName ? ' — ' + i.projectName : ''}` !== projectFilter) return false
    return true
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [issues, projectFilter, showClosed])

  if (!ready) return <Shell user={user}><div style={{ textAlign: 'center', color: '#999', paddingTop: 40 }}>Loading…</div></Shell>

  if (user?.accessLevel !== 'contracts-manager') return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ textAlign: 'center', padding: '48px 16px' }}>
        <div style={{ fontSize: 44 }}>🔒</div>
        <h2 style={{ color: INK, margin: '12px 0 4px' }}>Contracts Managers only</h2>
        <p style={{ color: '#777', fontSize: 14 }}>The Issues Log is available to Contracts Managers.</p>
        <button onClick={() => router.push('/forms')} style={{ ...bigBtn(false), marginTop: 20 }}>Back to home</button>
      </div>
    </Shell>
  )

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={{ background: 'none', border: 'none', color: BRAND, fontSize: 14, cursor: 'pointer', padding: '8px 0' }}>‹ Back</button>
        <h1 style={{ fontSize: 22, color: INK, margin: '4px 0 2px' }}>Issues Log</h1>
        <p style={{ color: '#888', fontSize: 13, margin: '0 0 14px' }}>Assess site issues, decide whether to send to the customer, and update the record.</p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} style={{ flex: 1, minWidth: 160, padding: '10px', borderRadius: 10, border: '1px solid #d9d5cc', fontSize: 14 }}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={() => setShowClosed(s => !s)} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #d9d5cc', background: showClosed ? '#fffbeb' : '#fff', color: showClosed ? '#92400e' : '#555', fontSize: 13, fontWeight: 600 }}>
            {showClosed ? 'Showing closed' : 'Open only'}
          </button>
        </div>

        {rows.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>No issues to show.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map(i => {
              const resolved = !!i.resolvedDate
              return (
                <button key={i.id} onClick={() => setOpen(i)} style={{ textAlign: 'left', background: resolved ? '#ecfdf5' : '#fff', border: '1px solid #e8e4db', borderRadius: 12, padding: 14, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 700, color: INK, fontSize: 15 }}>{i.issueName || '(no name)'}</div>
                    <div style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>{fmtTs(i.createdAt)}</div>
                  </div>
                  <div style={{ fontSize: 12.5, color: '#666', marginTop: 3 }}>{i.projectNo}{i.projectName ? ` — ${i.projectName}` : ''}</div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{[...(i.issueTypes || []), ...(i.issueOther ? ['Other'] : [])].join(', ')}</div>
                  <div style={{ marginTop: 8 }}>{statusChip(i)}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {open && <IssueSheet issue={open} onClose={() => setOpen(null)} onChanged={() => { load() }} />}
    </Shell>
  )
}

function statusChip(i) {
  if (i.resolvedDate) return <Chip c="#16a34a" bg="#dcfce7">✓ Resolved</Chip>
  if (!i.sendToCustomer) return <Chip c="#b45309" bg="#fef3c7">⚠ Needs actioning</Chip>
  if (i.sendToCustomer === 'send') {
    if (i.sentToCustomer || i.sentManually) return <Chip c="#16a34a" bg="#dcfce7">✓ Sent to customer</Chip>
    return <Chip c="#dc2626" bg="#fee2e2">⚠ Not sent yet</Chip>
  }
  if (i.sendToCustomer === 'edits') return <Chip c="#888" bg="#f3f4f6">Requires edits</Chip>
  return <Chip c="#888" bg="#f3f4f6">Not being sent</Chip>
}
function Chip({ children, c, bg }) { return <span style={{ fontSize: 11.5, color: c, background: bg, padding: '3px 10px', borderRadius: 12, fontWeight: 600 }}>{children}</span> }

// ── Full issue sheet: amend, set send-to-customer (with contacts), resolve ──
function IssueSheet({ issue, onClose, onChanged }) {
  const [f, setF] = useState(issue)
  const [saving, setSaving] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const set = (patch) => setF(prev => ({ ...prev, ...patch }))

  async function persist(patch) {
    const updated = { ...f, ...patch }
    setF(updated)
    await fetch('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issue: updated }) }).catch(() => {})
    onChanged()
  }
  async function saveAll() {
    setSaving(true)
    await fetch('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issue: f }) }).catch(() => {})
    setSaving(false); onChanged(); onClose()
  }

  const input = { width: '100%', boxSizing: 'border-box', padding: '11px', border: '1px solid #d9d5cc', borderRadius: 10, fontSize: 14, fontFamily: 'inherit' }
  const L = ({ children }) => <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '16px 0 6px' }}>{children}</div>

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 640, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ position: 'sticky', top: 0, background: '#fff', padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '18px 18px 0 0' }}>
          <div style={{ fontWeight: 700, color: INK, fontSize: 16 }}>{f.issueId || 'Issue'}</div>
          <button onClick={onClose} style={{ fontSize: 26, border: 'none', background: 'none', color: '#999' }}>×</button>
        </div>
        <div style={{ padding: '4px 20px 28px' }}>
          <div style={{ fontSize: 13, color: '#666' }}>{f.projectNo}{f.projectName ? ` — ${f.projectName}` : ''} · {fmtTs(f.createdAt)} · {f.createdBy || ''}</div>

          <L>Issue name</L>
          <input value={f.issueName || ''} onChange={e => set({ issueName: e.target.value })} style={input} />

          <L>Type</L>
          <div style={{ fontSize: 13.5, color: '#333' }}>{[...(f.issueTypes || []), ...(f.issueOther ? [`Other: ${f.issueOther}`] : [])].join(', ') || '—'}</div>

          <L>Description</L>
          <textarea value={f.description || ''} onChange={e => set({ description: e.target.value })} style={{ ...input, minHeight: 90, resize: 'vertical' }} />

          {(f.photos || []).length > 0 && <>
            <L>Photos</L>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {f.photos.map((p, i) => <a key={i} href={p} target="_blank" rel="noreferrer"><img src={p} alt="" style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 10, border: '1px solid #eee' }} /></a>)}
            </div>
          </>}

          <L>Comments</L>
          <textarea value={f.comments || ''} onChange={e => set({ comments: e.target.value })} style={{ ...input, minHeight: 70, resize: 'vertical' }} placeholder="Add a comment" />

          <L>Required resolution date</L>
          <input type="date" value={f.requiredDate || ''} onChange={e => set({ requiredDate: e.target.value })} style={{ ...input, maxWidth: 220 }} />

          <L>Resolved date</L>
          <input type="date" value={f.resolvedDate || ''} onChange={e => set({ resolvedDate: e.target.value })} style={{ ...input, maxWidth: 220 }} />
          {f.resolvedDate && <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4 }}>Marked resolved.</div>}

          <L>Send to customer?</L>
          <select value={f.sendToCustomer || ''} onChange={e => {
            const v = e.target.value
            if (v === 'send') { set({ sendToCustomer: v }); setSendOpen(true) } else set({ sendToCustomer: v })
          }} style={input}>
            {SEND_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <div style={{ marginTop: 8 }}>{statusChip(f)}</div>
          {f.sendToCustomer === 'send' && !f.sentToCustomer && !f.sentManually && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button onClick={() => setSendOpen(true)} style={{ padding: '9px 14px', borderRadius: 10, border: 'none', background: BRAND, color: '#fff', fontSize: 13, fontWeight: 600 }}>Send to customer</button>
              <button onClick={() => persist({ sentManually: true })} style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid #d9d5cc', background: '#fff', color: '#16a34a', fontSize: 13, fontWeight: 600 }}>Sent manually</button>
            </div>
          )}

          <button onClick={saveAll} disabled={saving} style={{ ...bigBtn(saving), marginTop: 22 }}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>

      {sendOpen && <SendSheet issue={f} onClose={() => setSendOpen(false)} onSent={() => { setSendOpen(false); persist({ sentToCustomer: true, sentAt: Date.now() }) }} />}
    </div>
  )
}

function SendSheet({ issue, onClose, onSent }) {
  const [emails, setEmails] = useState([])
  const [newEmail, setNewEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  useEffect(() => { (async () => {
    try {
      const r = await fetch(`/api/ops-projects?no=${encodeURIComponent(issue.projectNo)}`).then(r => r.json())
      const contacts = (r?.project?.data?.siteContacts || [])
      setEmails([...new Set(contacts.map(c => c.email).filter(Boolean))])
    } catch {}
    setLoading(false)
  })() }, [issue])

  function add() { const e = newEmail.trim(); if (e && /\S+@\S+\.\S+/.test(e) && !emails.includes(e)) { setEmails([...emails, e]); setNewEmail('') } }
  async function send() {
    if (!emails.length) { alert('Add at least one email.'); return }
    setSending(true)
    try {
      const d = await fetch('/api/issue-send-customer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: issue.id, emails }) }).then(r => r.json())
      if (d.sent > 0) { alert(`Sent to ${d.sent} recipient(s).`); onSent() } else alert(`Could not send: ${d.error || 'error'}`)
    } catch { alert('Send failed.') }
    setSending(false)
  }
  const input = { flex: 1, padding: '11px', border: '1px solid #d9d5cc', borderRadius: 10, fontSize: 14 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontWeight: 700, color: INK, fontSize: 16 }}>Send to customer</div>
          <button onClick={onClose} style={{ fontSize: 26, border: 'none', background: 'none', color: '#999' }}>×</button>
        </div>
        <p style={{ fontSize: 13, color: '#666', margin: '0 0 12px' }}>Customer contacts from this project's IHM. They'll receive a PDF of the issue.</p>
        {loading ? <div style={{ color: '#999' }}>Loading…</div> : (
          <>
            {emails.length === 0 && <div style={{ fontSize: 13, color: '#999', marginBottom: 10 }}>No IHM contacts found — add one below.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {emails.map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#faf9f7', borderRadius: 10 }}>
                  <span style={{ flex: 1, fontSize: 13.5 }}>{e}</span>
                  <button onClick={() => setEmails(emails.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', color: '#dc2626', fontSize: 13, fontWeight: 600 }}>Remove</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Add email…" type="email" style={input} />
              <button onClick={add} style={{ padding: '11px 16px', borderRadius: 10, border: '1px solid #d9d5cc', background: '#fff', fontWeight: 600 }}>Add</button>
            </div>
            <button onClick={send} disabled={sending || !emails.length} style={{ ...bigBtn(sending || !emails.length), marginTop: 18 }}>{sending ? 'Sending…' : `Send to ${emails.length || 0}`}</button>
          </>
        )}
      </div>
    </div>
  )
}
