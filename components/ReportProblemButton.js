import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'

// Floating "Report a problem" button shown on every PORTAL page (top-right).
// Hidden on the Site App (/forms*) which has its own in-app button.
export default function ReportProblemButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [userName, setUserName] = useState('')
  const [page, setPage] = useState('')
  const [description, setDescription] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => { if (d?.user?.name) setUserName(d.user.name) }).catch(() => {})
  }, [])

  // Don't render on the Site App.
  if ((router.pathname || '').startsWith('/forms')) return null

  async function submit() {
    if (!description.trim()) { setErr('Please describe the problem.'); return }
    setSending(true); setErr('')
    try {
      const r = await fetch('/api/report-problem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName, platform: 'Portal', page: page || router.asPath, description }),
      })
      let d = {}; try { d = await r.json() } catch {}
      if (!r.ok) { setErr(d.error || 'Could not submit'); setSending(false); return }
      setDone(true); setSending(false)
    } catch (e) { setErr(e?.message || 'Could not submit'); setSending(false) }
  }

  function openModal() {
    setPage(router.asPath || ''); setDescription(''); setDone(false); setErr(''); setOpen(true)
  }

  return (
    <>
      <button onClick={openModal} title="Report a problem with the app"
        style={{ position: 'fixed', top: 12, right: 14, zIndex: 900, background: '#fff', border: '1px solid #e0dcd2', borderRadius: 20, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, color: '#9a3412', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>⚠</span> Report a problem
      </button>

      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, padding: '20px 20px 24px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#1a1a19' }}>Report a problem</div>
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
                <Field label="Describe the problem"><textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} style={{ ...inp, resize: 'vertical' }} placeholder="What went wrong? What were you trying to do?" /></Field>
                {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{err}</div>}
                <button onClick={submit} disabled={sending} style={{ ...btnPrimary, opacity: sending ? 0.6 : 1 }}>{sending ? 'Sending…' : 'Send report'}</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
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
