import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

export default function ResetPassword() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!router.isReady) return
    setToken(String(router.query.token || ''))
    setEmail(String(router.query.e || ''))
  }, [router.isReady, router.query])

  async function submit(e) {
    e?.preventDefault()
    setErr('')
    if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (pw !== pw2) { setErr('Passwords do not match.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/portal-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset-password', token, email, password: pw }) })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Could not reset password'); setBusy(false); return }
      setDone(true); setBusy(false)
    } catch (e) { setErr('Could not reset password'); setBusy(false) }
  }

  const inp = { width: '100%', boxSizing: 'border-box', padding: '11px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 15, fontFamily: 'inherit' }
  const btn = { width: '100%', padding: '12px', background: '#ca8a04', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
  const errStyle = { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#b91c1c', margin: '12px 0' }

  return (
    <>
      <Head><title>Reset password - Rock Roofing</title></Head>
      <div style={{ minHeight: '100vh', background: '#faf9f7', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui,-apple-system,sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 8px 30px rgba(0,0,0,0.08)', padding: 32, width: '100%', maxWidth: 400 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 34, width: 34, borderRadius: 6 }} />
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a19' }}>Rock Roofing</div>
          </div>
          <div style={{ fontSize: 13, color: '#999', marginBottom: 18 }}>Reset your password</div>

          {done ? (
            <div>
              <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 14px', fontSize: 14, color: '#166534', marginBottom: 16 }}>
                Your password has been reset. You can now sign in with your new password.
              </div>
              <a href="/login" style={{ ...btn, display: 'block', textAlign: 'center', textDecoration: 'none' }}>Go to sign in</a>
            </div>
          ) : !token ? (
            <div style={errStyle}>This reset link is missing information. Please use the link from your email, or request a new one from the sign-in page.</div>
          ) : (
            <form onSubmit={submit}>
              <div style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>Choose a new password for <strong>{email}</strong>.</div>
              <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>New password</label>
              <input type="password" value={pw} onChange={e => setPw(e.target.value)} style={inp} autoFocus autoComplete="new-password" />
              <label style={{ display: 'block', fontSize: 12, color: '#666', margin: '12px 0 4px' }}>Confirm password</label>
              <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} style={inp} autoComplete="new-password" />
              {err && <div style={errStyle}>{err}</div>}
              <button type="submit" disabled={busy} style={{ ...btn, marginTop: 16, opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Set new password'}</button>
            </form>
          )}
        </div>
      </div>
    </>
  )
}
