import { useEffect, useState } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'

// forms.rockroofing.co.uk — operative-facing app.
// Mobile-first, big tap targets, one decision per screen. No portal access.
const BRAND = '#ca8a04'          // Operations gold, ties to the portal tile
const INK = '#1a1a19'
const BG = '#f6f5f2'
const pinInput = {
  width: '100%', boxSizing: 'border-box', textAlign: 'center',
  fontSize: 28, letterSpacing: 6, padding: '16px 0',
  border: '2px solid #e3e0d9', borderRadius: 14, background: '#fff', outline: 'none',
}

export default function FormsHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [rememberedPhone, setRememberedPhone] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetUser, setResetUser] = useState(null)  // user who must set a new PIN
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')

  // Restore session + remembered mobile.
  useEffect(() => {
    try {
      const s = sessionStorage.getItem('ops_operative')
      if (s) setUser(JSON.parse(s))
      const savedPhone = localStorage.getItem('ops_phone')
      if (savedPhone) { setRememberedPhone(savedPhone); setPhone(savedPhone) }
    } catch {}
  }, [])

  async function login() {
    if (!phone || !pin) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/ops-users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', phone, pin }),
      })
      const d = await r.json()
      if (d.ok) {
        try { localStorage.setItem('ops_phone', phone) } catch {}
        if (d.mustResetPin) {
          setResetUser(d.user); setPin('')
        } else {
          setUser(d.user)
          sessionStorage.setItem('ops_operative', JSON.stringify(d.user))
        }
      } else {
        setErr(d.error || 'Mobile or PIN not recognised.')
      }
    } catch { setErr('Something went wrong. Try again.') }
    setBusy(false)
  }

  function forgetDevice() {
    try { localStorage.removeItem('ops_phone') } catch {}
    setRememberedPhone(''); setPhone(''); setPin('')
  }

  async function submitNewPin() {
    setErr('')
    if (!/^\d{4,6}$/.test(newPin)) { setErr('Choose a 4–6 digit PIN.'); return }
    if (newPin !== confirmPin) { setErr('PINs don’t match.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/ops-users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-pin', id: resetUser.id, pin: newPin }),
      })
      const d = await r.json()
      if (d.ok) {
        setUser(d.user)
        sessionStorage.setItem('ops_operative', JSON.stringify(d.user))
        setResetUser(null); setNewPin(''); setConfirmPin('')
      } else {
        setErr(d.error || 'Could not set PIN.')
      }
    } catch { setErr('Something went wrong. Try again.') }
    setBusy(false)
  }

  function logout() {
    sessionStorage.removeItem('ops_operative')
    setUser(null); setPin(''); setResetUser(null)
  }

  // ── Login screen ──────────────────────────────────────────────────────────
  // ── First-login: operative must set their own PIN ──────────────────────────
  if (resetUser && !user) {
    return (
      <Shell>
        <div style={{ maxWidth: 380, margin: '0 auto', paddingTop: 40 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 56, width: 56, borderRadius: 12 }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, margin: '16px 0 4px' }}>Set your PIN</h1>
            <p style={{ color: '#777', fontSize: 14, margin: 0 }}>Hi {resetUser.name?.split(' ')[0] || 'there'} — choose a 4–6 digit PIN you'll remember.</p>
          </div>
          <input inputMode="numeric" type="password" value={newPin}
            onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
            placeholder="New PIN" style={pinInput} />
          <input inputMode="numeric" type="password" value={confirmPin}
            onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && submitNewPin()}
            placeholder="Confirm PIN" style={{ ...pinInput, marginTop: 12 }} />
          {err && <div style={{ color: '#dc2626', fontSize: 14, textAlign: 'center', margin: '12px 0' }}>{err}</div>}
          <button onClick={submitNewPin} disabled={busy || !newPin || !confirmPin} style={{ ...bigBtn(busy || !newPin || !confirmPin), marginTop: 14 }}>
            {busy ? 'Saving…' : 'Save PIN & continue'}
          </button>
        </div>
      </Shell>
    )
  }

  if (!user) {
    return (
      <Shell>
        <div style={{ maxWidth: 380, margin: '0 auto', paddingTop: 40 }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 64, width: 64, borderRadius: 12 }} />
            <h1 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: '16px 0 4px' }}>Rock Roofing Forms</h1>
            <p style={{ color: '#777', fontSize: 14, margin: 0 }}>
              {rememberedPhone ? 'Enter your PIN to start' : 'Log in with your mobile and PIN'}
            </p>
          </div>

          {rememberedPhone ? (
            <div style={{ textAlign: 'center', marginBottom: 14, fontSize: 14, color: '#555' }}>
              {rememberedPhone}
              <button onClick={forgetDevice} style={{ background: 'none', border: 'none', color: BRAND, cursor: 'pointer', fontSize: 13, marginLeft: 8 }}>Not you?</button>
            </div>
          ) : (
            <input
              inputMode="tel" type="tel"
              value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="Mobile number"
              style={{ ...pinInput, fontSize: 20, letterSpacing: 1, textAlign: 'center', marginBottom: 12 }}
            />
          )}

          <input
            inputMode="numeric" pattern="[0-9]*" type="password"
            value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && login()}
            placeholder="••••"
            style={{ ...pinInput, marginBottom: 14 }}
          />
          {err && <div style={{ color: '#dc2626', fontSize: 14, textAlign: 'center', marginBottom: 12 }}>{err}</div>}
          <button onClick={login} disabled={busy || !phone || !pin} style={bigBtn(busy || !phone || !pin)}>
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
