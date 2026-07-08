import { useEffect, useState } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'

// forms.rockroofing.co.uk — operative-facing app.
// Mobile-first, big tap targets, one decision per screen. No portal access.
const BRAND = '#ca8a04'          // Operations gold, ties to the portal tile
const INK = '#1a1a19'
const BG = '#f6f5f2'

export default function FormsHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // Restore session (sessionStorage is fine here — this is the forms app,
  // not an artifact; it runs as a real deployed page).
  useEffect(() => {
    try {
      const s = sessionStorage.getItem('ops_operative')
      if (s) setUser(JSON.parse(s))
    } catch {}
  }, [])

  async function login() {
    if (!pin) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/ops-users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', pin }),
      })
      const d = await r.json()
      if (d.ok) {
        setUser(d.user)
        sessionStorage.setItem('ops_operative', JSON.stringify(d.user))
      } else {
        setErr('PIN not recognised. Check with the office.')
      }
    } catch { setErr('Something went wrong. Try again.') }
    setBusy(false)
  }

  function logout() {
    sessionStorage.removeItem('ops_operative')
    setUser(null); setPin('')
  }

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!user) {
    return (
      <Shell>
        <div style={{ maxWidth: 380, margin: '0 auto', paddingTop: 40 }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 64, width: 64, borderRadius: 12 }} />
            <h1 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: '16px 0 4px' }}>Rock Roofing Forms</h1>
            <p style={{ color: '#777', fontSize: 14, margin: 0 }}>Enter your PIN to start</p>
          </div>
          <input
            inputMode="numeric" pattern="[0-9]*" type="password"
            value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && login()}
            placeholder="••••"
            style={{
              width: '100%', boxSizing: 'border-box', textAlign: 'center',
              fontSize: 32, letterSpacing: 8, padding: '18px 0',
              border: '2px solid #e3e0d9', borderRadius: 14, background: '#fff',
              outline: 'none', marginBottom: 14,
            }}
          />
          {err && <div style={{ color: '#dc2626', fontSize: 14, textAlign: 'center', marginBottom: 12 }}>{err}</div>}
          <button onClick={login} disabled={busy || !pin} style={bigBtn(busy || !pin)}>
            {busy ? 'Checking…' : 'Log in'}
          </button>
        </div>
      </Shell>
    )
  }

  // ── Logged-in home: three doors ───────────────────────────────────────────
  const doors = [
    { key: 'company', label: 'Company Information', desc: 'Policies, insurances & standard documents', icon: '📄' },
    { key: 'guidance', label: 'Operative Guidance Documents', desc: 'How-to guides & best practice', icon: '📘' },
    { key: 'project', label: 'Project Forms', desc: 'Site diaries, reports & handovers', icon: '📝' },
  ]

  return (
    <Shell onLogout={logout} user={user}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 4px' }}>Hi {(user.name || '').split(' ')[0] || 'there'} 👋</h2>
        <p style={{ color: '#777', fontSize: 14, margin: '0 0 20px' }}>What do you need?</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {doors.map(d => (
            <button key={d.key}
              onClick={() => router.push(`/forms/browse?cat=${d.key}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left',
                background: '#fff', border: '1px solid #e3e0d9', borderRadius: 16,
                padding: '20px 18px', cursor: 'pointer', width: '100%',
              }}>
              <div style={{ fontSize: 30 }}>{d.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>{d.label}</div>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{d.desc}</div>
              </div>
              <div style={{ color: BRAND, fontSize: 22 }}>›</div>
            </button>
          ))}
        </div>
      </div>
    </Shell>
  )
}

// ── Shared shell ────────────────────────────────────────────────────────────
export function Shell({ children, onLogout, user }) {
  return (
    <>
      <Head>
        <title>Rock Roofing Forms</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="theme-color" content="#1a1a19" />
      </Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: BG }}>
        <div style={{
          background: INK, height: 56, display: 'flex', alignItems: 'center',
          padding: '0 16px', gap: 10, position: 'sticky', top: 0, zIndex: 10,
        }}>
          <img src="/rock-logo.jpg" alt="" style={{ height: 32, width: 32, borderRadius: 6 }} />
          <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>Rock Roofing Forms</span>
          <div style={{ flex: 1 }} />
          {user && (
            <button onClick={onLogout} style={{
              background: 'transparent', border: '1px solid #3a3a38', color: '#bbb',
              borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer',
            }}>Log out</button>
          )}
        </div>
        <div style={{ padding: '24px 16px 64px' }}>{children}</div>
      </div>
    </>
  )
}

export function bigBtn(disabled) {
  return {
    width: '100%', padding: '16px 0', fontSize: 16, fontWeight: 600,
    color: '#fff', background: disabled ? '#c9c4ba' : '#ca8a04',
    border: 'none', borderRadius: 14, cursor: disabled ? 'default' : 'pointer',
  }
}
