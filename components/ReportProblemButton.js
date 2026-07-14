import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'

// "Report app improvement" — modal only. The trigger link lives in each area's
// nav / top bar (portal home, OperationsNav, PreContractNav, commercial nav) and
// opens this modal via the 'open-report-problem' window event. The Site App has
// its own in-app button. This component renders nothing on /forms.
export default function ReportProblemButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [page, setPage] = useState('')
  const [description, setDescription] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => { if (d?.user?.name) setUserName(d.user.name); if (d?.user?.email) setUserEmail(d.user.email) }).catch(() => {})
  }, [])

  useEffect(() => {
    const h = () => { setPage(router.asPath || ''); setDescription(''); setDone(false); setErr(''); setOpen(true) }
    window.addEventListener('open-report-problem', h)
    return () => window.removeEventListener('open-report-problem', h)
  }, [router.asPath])

  if ((router.pathname || '').startsWith('/forms')) return null
  if (!open) return null

  async function submit() {
    if (!description.trim()) { setErr('Please describe the improvement.'); return }
    setSending(true); setErr('')
    try {
      const r = await fetch('/api/report-problem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName, userEmail, platform: 'Portal', page: page || router.asPath, description }),
      })
      let d = {}; try { d = await r.json() } catch {}
      if (!r.ok) { setErr(d.error || 'Could not submit'); setSending(false); return }
      setDone(true); setSending(false)
    } catch (e) { setErr(e?.message || 'Could not submit'); setSending(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setOpen(false)}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, padding: '20px 20px 24px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#1a1a19' }}>Report app improvement</div>
          <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        {done ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 15, color: '#1a1a19', fontWeight: 600 }}>Thanks — your report has been sent.</div>
            <button onClick={() => setOpen(false)} style={btnPrimary}>Close</button>
          </div>
        ) : (
          <>
            <Field label="Your name"><input value={userName} onChange={e => setUserName(e.target.value)} style={inp} placeholder="Your name" /></Field>
            <Field label="Where"><input value="Portal" readOnly style={{ ...inp, background: '#f7f6f3', color: '#888' }} /></Field>
            <Field label="Page where the issue happened"><input value={page} onChange={e => setPage(e.target.value)} style={inp} placeholder="e.g. Operations › Live Tasks" /></Field>
            <Field label="Describe the improvement / problem"><textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} style={{ ...inp, resize: 'vertical' }} placeholder="What would you like improved, or what went wrong?" /></Field>
            {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{err}</div>}
            <button onClick={submit} disabled={sending} style={{ ...btnPrimary, opacity: sending ? 0.6 : 1 }}>{sending ? 'Sending…' : 'Send'}</button>
          </>
        )}
      </div>
    </div>
  )
}

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 12 }}>
    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#555', marginBottom: 5 }}>{label}</div>
    {children}
  </div>
)
const inp = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none' }
const btnPrimary = { width: '100%', marginTop: 6, padding: '12px', fontSize: 15, fontWeight: 700, borderRadius: 10, border: 'none', background: '#ca8a04', color: '#fff', cursor: 'pointer' }
