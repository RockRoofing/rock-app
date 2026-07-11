import { useEffect, useState, useRef } from 'react'
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

  return (
    <Shell onLogout={logout} user={user}>
      <FormsHomeMenu user={user} />
    </Shell>
  )
}

// ── Home: choose Complete a Form or View Project Details ─────────────────────
function FormsHomeMenu({ user }) {
  const router = useRouter()
  const [mode, setMode] = useState('menu')  // menu | forms | details
  const isCM = user?.accessLevel === 'contracts-manager'
  if (mode === 'forms') return <FormsList user={user} onBack={() => setMode('menu')} />
  if (mode === 'details') return <ProjectDetailsView onBack={() => setMode('menu')} />
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <h2 style={{ fontSize: 20, color: INK, margin: '8px 0 4px' }}>Hi {(user.name || '').split(' ')[0] || 'there'} 👋</h2>
      <p style={{ color: '#777', fontSize: 14, margin: '0 0 20px' }}>What would you like to do?{isCM && <span style={{ marginLeft: 8, background: '#eef2ff', color: '#3730a3', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>Contracts Manager</span>}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button onClick={() => setMode('forms')} style={homeCard}>
          <div style={{ fontSize: 30 }}>📝</div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 17, fontWeight: 700, color: INK }}>Complete a Form</div><div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>Site diaries, checklists, reports</div></div>
          <div style={{ color: BRAND, fontSize: 24 }}>›</div>
        </button>
        <button onClick={() => setMode('details')} style={homeCard}>
          <div style={{ fontSize: 30 }}>📁</div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 17, fontWeight: 700, color: INK }}>View Project Details</div><div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>Drawings & RAMS for your project</div></div>
          <div style={{ color: BRAND, fontSize: 24 }}>›</div>
        </button>
        <button onClick={() => router.push('/forms/issue')} style={homeCard}>
          <div style={{ fontSize: 30 }}>⚠️</div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 17, fontWeight: 700, color: INK }}>Raise an Issue</div><div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>Report a site issue with photos</div></div>
          <div style={{ color: BRAND, fontSize: 24 }}>›</div>
        </button>
        {/* Contracts Manager-only options appear here. */}
      </div>
    </div>
  )
}

// ── Project details for operatives: pick a live project, view Drawings & RAMS ──
function ProjectDetailsView({ onBack }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [proj, setProj] = useState(null)
  const [tab, setTab] = useState('drawings')
  const [files, setFiles] = useState([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [viewer, setViewer] = useState(null)

  useEffect(() => { (async () => {
    try {
      const r = await fetch('/api/ops-projects'); const d = await r.json()
      setProjects((d.projects || []).filter(p => p.status === 'active').sort((a, b) => (a.projectNo || '').localeCompare(b.projectNo || '')))
    } catch {}
    setLoading(false)
  })() }, [])

  useEffect(() => {
    if (!proj) return
    setFilesLoading(true)
    ;(async () => {
      try {
        const cat = tab === 'drawings' ? 'drawing' : 'rams'
        const r = await fetch(`/api/project-files?no=${encodeURIComponent(proj.projectNo)}&cat=${cat}`)
        const d = await r.json()
        let list = d.files || []
        // API returns newest-first. RAMS: operatives only ever see the CURRENT
        // revision, so keep just the most recent.
        if (tab === 'rams' && list.length > 1) list = [list[0]]
        setFiles(list)
      } catch {}
      setFilesLoading(false)
    })()
  }, [proj, tab])

  const isImage = (f) => (f.contentType || '').startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(f.name)

  if (loading) return <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading…</div>

  if (!proj) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <button onClick={onBack} style={backLink}>‹ Back</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 16px' }}>Select a project</h2>
        {!projects.length ? <div style={{ color: '#999', fontSize: 14 }}>No live projects.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {projects.map(p => (
              <button key={p.projectNo} onClick={() => { setProj(p); setTab('drawings') }} style={homeCard}>
                <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, color: INK }}>{p.projectNo}</div><div style={{ fontSize: 13, color: '#888' }}>{p.projectName}</div></div>
                <div style={{ color: BRAND, fontSize: 22 }}>›</div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <button onClick={() => setProj(null)} style={backLink}>‹ All projects</button>
      <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 2px' }}>{proj.projectNo} — {proj.projectName}</h2>
      <div style={{ display: 'flex', gap: 8, margin: '14px 0' }}>
        {[['drawings', 'Drawings'], ['rams', 'RAMS']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid ' + (tab === k ? BRAND : '#e3e0d9'), background: tab === k ? BRAND : '#fff', color: tab === k ? '#fff' : INK, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>
      {filesLoading ? <div style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>Loading…</div>
        : !files.length ? <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>No {tab === 'drawings' ? 'drawings' : 'RAMS'} uploaded for this project yet.</div>
        : tab === 'drawings' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
            {files.map(f => (
              <div key={f.id} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div onClick={() => setViewer(f)} style={{ height: 120, background: '#f7f6f4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {isImage(f) ? <img src={f.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <SitePdfThumb url={f.url} />}
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: INK, wordBreak: 'break-word', lineHeight: 1.3 }}>{f.name}</div>
                  <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
                    <button onClick={() => setViewer(f)} style={{ background: 'transparent', border: 'none', color: BRAND, fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: 0 }}>View</button>
                    <a href={f.url} download={f.name} target="_blank" rel="noreferrer" style={{ color: '#666', fontSize: 13, textDecoration: 'none' }}>Download</a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {files.map(f => (
              <div key={f.id} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 24 }}>{isImage(f) ? '🖼️' : '📄'}</div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 600, color: INK, wordBreak: 'break-word' }}>{f.name}</div><div style={{ fontSize: 12, color: '#16a34a', marginTop: 2 }}>Current revision</div></div>
                <button onClick={() => setViewer(f)} style={{ background: 'transparent', border: 'none', color: BRAND, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>View</button>
                <a href={f.url} download={f.name} target="_blank" rel="noreferrer" style={{ color: '#666', fontSize: 14, textDecoration: 'none' }}>Download</a>
              </div>
            ))}
          </div>
        )}
      {viewer && (
        <div onClick={() => setViewer(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', color: '#fff' }}>
            <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{viewer.name}</div>
            <button onClick={() => setViewer(null)} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 28, cursor: 'pointer' }}>×</button>
          </div>
          <div onClick={e => e.stopPropagation()} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, overflow: 'auto' }}>
            {isImage(viewer) ? <img src={viewer.url} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <iframe src={viewer.url} title={viewer.name} style={{ width: '100%', height: '100%', border: 'none', background: '#fff', borderRadius: 8 }} />}
          </div>
        </div>
      )}
    </div>
  )
}

const homeCard = { display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', background: '#fff', border: '1px solid #e3e0d9', borderRadius: 16, padding: '18px', cursor: 'pointer', width: '100%' }
const backLink = { background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }

// First-page PDF thumbnail for drawing tiles (pdf.js from CDN)
function SitePdfThumb({ url }) {
  const canvasRef = useRef()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script')
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
            s.onload = resolve; s.onerror = reject; document.body.appendChild(s)
          })
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        }
        const pdf = await window.pdfjsLib.getDocument(url).promise
        const page = await pdf.getPage(1)
        if (cancelled) return
        const canvas = canvasRef.current; if (!canvas) return
        const vp0 = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: 220 / vp0.width })
        canvas.width = viewport.width; canvas.height = viewport.height
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      } catch { if (!cancelled) setFailed(true) }
    })()
    return () => { cancelled = true }
  }, [url])
  if (failed) return <div style={{ fontSize: 34, color: '#bbb' }}>📄</div>
  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
}

// ── Forms list shown immediately after login ────────────────────────────────
function FormsList({ user, onBack }) {
  const router = useRouter()
  const [forms, setForms] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/forms')
        const d = await r.json()
        // Contracts Manager Site Report is completed by managers via the portal
        // Project Report, not by operatives — hide it from the Forms App.
        const HIDDEN = ['contracts-manager-report']
        setForms((d.forms || []).filter(f => f.category === 'project' && !HIDDEN.includes(f.id)))
      } catch {}
      setLoading(false)
    })()
  }, [])

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {onBack && <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }}>‹ Back</button>}
      <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 4px' }}>Project Forms</h2>
      <p style={{ color: '#777', fontSize: 14, margin: '0 0 20px' }}>Choose a form to complete</p>
      {loading ? (
        <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading forms…</div>
      ) : !forms.length ? (
        <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>No forms available yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {forms.map(f => (
            <button key={f.id}
              onClick={() => router.push(`/forms/fill?form=${f.id}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
                background: '#fff', border: '1px solid #e3e0d9', borderRadius: 16,
                padding: '18px 18px', cursor: 'pointer', width: '100%',
              }}>
              <div style={{ fontSize: 26 }}>📝</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>{f.title}</div>
                {f.short && <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{f.short}</div>}
              </div>
              <div style={{ color: BRAND, fontSize: 22 }}>›</div>
            </button>
          ))}
        </div>
      )}
    </div>
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
          padding: '0 16px', gap: 8, position: 'sticky', top: 0, zIndex: 10, overflowX: 'auto',
        }}>
          <img src="/rock-logo.jpg" alt="" style={{ height: 32, width: 32, borderRadius: 6 }} />
          <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>Forms</span>
          <div style={{ flex: 1 }} />
          {user && (
            <>
              <a href="/forms/browse?cat=company" style={navLink}>Company Information</a>
              <span style={navDivider}>|</span>
              <a href="/forms/browse?cat=guidance" style={navLink}>Operative Guidance Docs</a>
              <span style={navDivider}>|</span>
              <button onClick={onLogout} style={{
                background: 'transparent', border: 'none', color: '#bbb',
                padding: '6px 8px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>Log out</button>
            </>
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

const navLink = {
  color: '#bbb', textDecoration: 'none', fontSize: 13,
  padding: '6px 8px', whiteSpace: 'nowrap',
}
const navDivider = { color: '#3a3a38', fontSize: 14 }
