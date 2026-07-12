import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Shell, bigBtn } from '../index'
import { INK, BRAND, fmtDateTime, useMyProjects, ProjectPicker, ProjectHeader, inp } from '../../../lib/cmSiteApp'
import SubmissionModal from '../../../components/SubmissionModal'

const PSN_FORM_ID = 'pre-start-notification'

// CM › Pre-Start Notifications — project-first. Then: complete a new PSN, or view
// completed ones (dates table -> view portal). From a completed PSN you can send
// it to the customer (contacts pre-filled from Project Details, add/delete).
export default function CmPreStart() {
  const router = useRouter()
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false)
  const [proj, setProj] = useState(null)
  const [mode, setMode] = useState('choose')   // choose | completed
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(null)       // submission being viewed
  const [sendFor, setSendFor] = useState(null) // submission being sent to customer

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    setReady(true)
  }, [])

  const { myProjects, loading: projLoading } = useMyProjects(user)

  function pick(p) { setProj(p); setMode('choose') }

  async function loadCompleted(p) {
    setMode('completed'); setLoading(true); setSubs([])
    try {
      const d = await fetch('/api/submissions').then(r => r.json())
      const mine = (d.submissions || []).filter(s => s.formId === PSN_FORM_ID &&
        ((s.projectName || '') === (p.projectName || '') || (s.projectName || '') === (p.projectNo || '') || (s.projectName || '').includes(p.projectNo || '__x__')))
      setSubs(mine)
    } catch {}
    setLoading(false)
  }

  if (!ready) return <Shell user={user}><Loading /></Shell>

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={backLink}>‹ Home</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 10px' }}>Pre-Start Notifications</h2>

        {!proj ? (
          projLoading ? <Loading /> : <ProjectPicker projects={myProjects} onPick={pick} subtitle="Select a project first." />
        ) : mode === 'choose' ? (
          <>
            <ProjectHeader project={proj} onBack={() => setProj(null)} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button onClick={() => router.push(`/forms/fill?form=${PSN_FORM_ID}&project=${encodeURIComponent(proj.projectNo)}&sendCustomer=1`)} style={choiceCard}>
                <div style={{ fontSize: 26 }}>➕</div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Complete a new PSN</div><div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>Fill in and send to the customer</div></div>
                <div style={{ color: BRAND, fontSize: 22 }}>›</div>
              </button>
              <button onClick={() => loadCompleted(proj)} style={choiceCard}>
                <div style={{ fontSize: 26 }}>📄</div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, color: INK }}>View completed PSNs</div><div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>See and re-send previous notifications</div></div>
                <div style={{ color: BRAND, fontSize: 22 }}>›</div>
              </button>
            </div>
          </>
        ) : (
          <>
            <ProjectHeader project={proj} onBack={() => setMode('choose')} backLabel="‹ Back" />
            {loading ? <Loading /> : !subs.length ? <Empty>No completed Pre-Start Notifications for this project.</Empty> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e3e0d9' }}>
                <thead><tr style={{ background: '#faf9f7' }}>
                  <th style={thc}>Date completed</th><th style={thc}>By</th><th style={{ ...thc, textAlign: 'right' }}></th>
                </tr></thead>
                <tbody>
                  {subs.map(s => (
                    <tr key={s.id} style={{ borderTop: '1px solid #f2f2f2' }}>
                      <td style={tdc}>{fmtDateTime(s.submittedAt)}</td>
                      <td style={tdc}>{s.operative || '—'}</td>
                      <td style={{ ...tdc, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => setOpen(s)} style={linkA}>View</button>
                        <button onClick={() => setSendFor(s)} style={{ ...linkA, color: BRAND }}>Send</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {open && <SubmissionModal sub={open} onClose={() => setOpen(null)} onSaved={() => setOpen(null)} />}
      {sendFor && <SendToCustomer submission={sendFor} project={proj} onClose={() => setSendFor(null)} />}
    </Shell>
  )
}

// Customer-send modal: contacts pre-filled from Project Details (siteContacts +
// customerEmail), with add/delete, then emails the PSN PDF.
function SendToCustomer({ submission, project, onClose }) {
  const [emails, setEmails] = useState([])
  const [newEmail, setNewEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const d = await fetch(`/api/ops-projects?no=${encodeURIComponent(project.projectNo)}`).then(r => r.json())
        const data = d?.project?.data || {}
        const found = []
        for (const c of (data.siteContacts || [])) if (c.email) found.push({ name: c.name || c.title || '', email: c.email })
        if (data.customerEmail && !found.some(f => f.email.toLowerCase() === data.customerEmail.toLowerCase())) found.push({ name: data.customerContact || 'Customer', email: data.customerEmail })
        setEmails(found)
      } catch {}
      setLoading(false)
    })()
  }, [project])

  const addEmail = () => { const e = newEmail.trim(); if (e && !emails.some(x => x.email.toLowerCase() === e.toLowerCase())) { setEmails([...emails, { name: '', email: e }]); setNewEmail('') } }
  const rmEmail = (i) => setEmails(emails.filter((_, j) => j !== i))

  async function send() {
    if (!emails.length) { setErr('Add at least one recipient.'); return }
    setSending(true); setErr('')
    try {
      const r = await fetch('/api/pre-start-notify-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId: submission.id, emails: emails.map(e => e.email) }) })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Send failed'); setSending(false); return }
      setDone(true); setSending(false)
    } catch (e) { setErr(e?.message || 'Send failed'); setSending(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', padding: '20px 18px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Send to customer</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        {done ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 15, color: INK, fontWeight: 600 }}>Pre-Start Notification sent.</div>
            <button onClick={onClose} style={{ ...bigBtn(false), marginTop: 18 }}>Done</button>
          </div>
        ) : loading ? <Loading /> : (
          <>
            <p style={{ fontSize: 13, color: '#777', margin: '0 0 12px' }}>Recipients (from Project Details — add or remove as needed):</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {emails.length === 0 && <div style={{ fontSize: 13, color: '#aaa' }}>No customer contacts on file — add one below.</div>}
              {emails.map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#faf9f7', border: '1px solid #eee', borderRadius: 10, padding: '8px 10px' }}>
                  <div style={{ flex: 1, fontSize: 13, color: INK }}>{e.name ? <strong>{e.name}</strong> : null} {e.email}</div>
                  <button onClick={() => rmEmail(i)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Add email address" style={{ ...inp, flex: 1 }} onKeyDown={e => e.key === 'Enter' && addEmail()} />
              <button onClick={addEmail} disabled={!newEmail.trim()} style={{ ...smallBtn, opacity: newEmail.trim() ? 1 : 0.5 }}>Add</button>
            </div>
            {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 10 }}>{err}</div>}
            <button onClick={send} disabled={sending} style={bigBtn(sending)}>{sending ? 'Sending…' : 'Send Pre-Start Notification'}</button>
          </>
        )}
      </div>
    </div>
  )
}

const choiceCard = { display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', background: '#fff', border: '1px solid #e3e0d9', borderRadius: 16, padding: '18px', cursor: 'pointer', width: '100%' }
const thc = { textAlign: 'left', padding: '10px 12px', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 }
const tdc = { padding: '10px 12px', fontSize: 13.5, color: INK }
const linkA = { background: 'none', border: 'none', color: '#2a78d6', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginLeft: 10 }
const smallBtn = { background: '#fff', border: `2px solid ${BRAND}`, color: BRAND, borderRadius: 10, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const backLink = { background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }
const Loading = () => <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading…</div>
const Empty = ({ children }) => <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>{children}</div>
