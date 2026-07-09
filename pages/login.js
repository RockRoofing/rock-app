import { useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetUser, setResetUser] = useState(null)
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')

  async function login(e) {
    e?.preventDefault()
    setErr(''); setBusy(true)
    try {
      const r = await fetch('/api/portal-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', email, password }) })
      const d = await r.json()
      if (!r.ok || !d.ok) { setErr(d.error || 'Login failed'); setBusy(false); return }
      if (d.mustResetPassword) { setResetUser(d.user); setBusy(false); return }
      router.replace('/')
    } catch (e) { setErr('Login failed'); setBusy(false) }
  }

  async function setPassword_(e) {
    e?.preventDefault()
    setErr('')
    if (newPw.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (newPw !== newPw2) { setErr('Passwords do not match.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/portal-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-password', password: newPw }) })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Could not set password'); setBusy(false); return }
      router.replace('/')
    } catch (e) { setErr('Could not set password'); setBusy(false) }
  }

  return (
    <>
      <Head><title>Rock Roofing — Sign in</title></Head>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a19', fontFamily: 'system-ui,-apple-system,sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: '40px 44px', width: 400, maxWidth: '90vw', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 54, borderRadius: 8 }} />
            <h1 style={{ fontSize: 20, color: '#1a1a19', margin: '14px 0 2px' }}>Rock Roofing Portal</h1>
            <div style={{ fontSize: 13, color: '#999' }}>{resetUser ? 'Set a new password to continue' : 'Sign in to continue'}</div>
          </div>

          {!resetUser ? (
            <form onSubmit={login}>
              <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inp} autoFocus autoComplete="username" /></Field>
              <Field label="Password"><input type="password" value={password} onChange={e => setPassword(e.target.value)} style={inp} autoComplete="current-password" /></Field>
              {err && <div style={errStyle}>{err}</div>}
              <button type="submit" disabled={busy} style={btn}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </form>
          ) : (
            <form onSubmit={setPassword_}>
              <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#92400e', marginBottom: 14 }}>
                Welcome, {resetUser.name?.split(' ')[0]}. Please choose a new password.
              </div>
              <Field label="New password"><input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} style={inp} autoFocus autoComplete="new-password" /></Field>
              <Field label="Confirm password"><input type="password" value={newPw2} onChange={e => setNewPw2(e.target.value)} style={inp} autoComplete="new-password" /></Field>
              {err && <div style={errStyle}>{err}</div>}
              <button type="submit" disabled={busy} style={btn}>{busy ? 'Saving…' : 'Set password & continue'}</button>
            </form>
          )}
        </div>
      </div>
    </>
  )
}

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ fontSize: 12.5, color: '#666', marginBottom: 5 }}>{label}</div>
    {children}
  </div>
)
const inp = { width: '100%', boxSizing: 'border-box', padding: '11px 13px', border: '1px solid #ddd', borderRadius: 9, fontSize: 15 }
const btn = { width: '100%', background: '#ca8a04', color: '#fff', border: 'none', borderRadius: 9, padding: '12px', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 6 }
const errStyle = { background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 12 }
