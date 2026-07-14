import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
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

// ── Home: Complete a Form / Drawings / RAMS / Deliveries etc. ────────────────
function FormsHomeMenu({ user }) {
  const router = useRouter()
  const [mode, setMode] = useState('menu')  // menu | forms | details
  const [myProjectCount, setMyProjectCount] = useState(0)
  const [myProjectNos, setMyProjectNos] = useState(new Set())
  const [issueActionCount, setIssueActionCount] = useState(0)
  const [overdueTaskCount, setOverdueTaskCount] = useState(0)
  const [ramsBadge, setRamsBadge] = useState(0)
  const [deliveriesBadge, setDeliveriesBadge] = useState(0)
  async function refreshBadges() {
    if (!user?.id && !user?.name) return
    try {
      const pa = user?.projectAccess
      const paParam = pa === 'all' ? 'all' : Array.isArray(pa) ? pa.join(',') : ''
      const b = await fetch(`/api/site-badges?opId=${encodeURIComponent(user?.id || '')}&projectAccess=${encodeURIComponent(paParam)}`).then(r => r.json())
      setRamsBadge(b.rams || 0)
      setDeliveriesBadge(b.deliveries || 0)
    } catch {}
  }
  // Refetch badges on mount and whenever we return to the home menu (e.g. after
  // signing a RAMS or confirming a delivery).
  useEffect(() => { if (mode === 'menu') refreshBadges() }, [user, mode])
  useEffect(() => {
    if (!user?.name) return
    (async () => {
      try {
        const d = await fetch('/api/ops-projects').then(r => r.json())
        const norm = s => (s || '').trim().toLowerCase()
        const mine = (d.projects || []).filter(p => {
          const a = norm(user.name), b = norm(p.contractsManager)
          if (!a || !b) return false
          if (a === b) return true
          const at = a.split(/\s+/), bt = b.split(/\s+/)
          if (at.length >= 2 && bt.length >= 2) return at[0] === bt[0] && at[at.length - 1] === bt[bt.length - 1]
          return false
        })
        setMyProjectCount(mine.length)
        const nos = new Set(mine.map(p => p.projectNo))
        setMyProjectNos(nos)
        // Issues needing actioning on my projects (not resolved, no send-to-customer decision yet).
        try {
          const di = await fetch('/api/issues').then(r => r.json())
          const need = (di.issues || []).filter(i => nos.has(i.projectNo) && !i.resolvedDate && !i.sendToCustomer)
          setIssueActionCount(need.length)
        } catch {}
        // Overdue Live Tasks on my projects.
        try {
          const dt = await fetch('/api/tasks').then(r => r.json())
          const td = new Date(); td.setHours(0, 0, 0, 0)
          const overdue = (dt.tasks || []).filter(t => nos.has(t.projectNo) && !t.closed && t.closeOutDate && (() => { const d = new Date(t.closeOutDate); d.setHours(0,0,0,0); return d < td })())
          setOverdueTaskCount(overdue.length)
        } catch {}
      } catch {}
    })()
  }, [user])
  // CM sections are gated by the Site App access level ONLY. Name-matching still
  // decides which projects are "theirs", but does not grant CM access.
  const isCM = user?.accessLevel === 'contracts-manager'
  if (mode === 'forms') return <FormsList user={user} onBack={() => setMode('menu')} />
  if (mode === 'drawings') return <ProjectDetailsView only="drawings" onBack={() => setMode('menu')} />
  if (mode === 'rams') return <ProjectDetailsView only="rams" onBack={() => setMode('menu')} />
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
        <button onClick={() => setMode('drawings')} style={homeCard}>
          <div style={{ fontSize: 30 }}>📁</div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 17, fontWeight: 700, color: INK }}>Drawings</div><div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>Drawings for your project</div></div>
          <div style={{ color: BRAND, fontSize: 24 }}>›</div>
        </button>
        <button onClick={() => setMode('rams')} style={homeCard}>
          <div style={{ fontSize: 30 }}>📑</div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 17, fontWeight: 700, color: INK }}>RAMS</div><div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>Sign your project RAMS</div></div>
          {ramsBadge > 0 && <span style={homeBadge('#dc2626')}>{ramsBadge}</span>}
          <div style={{ color: BRAND, fontSize: 24 }}>›</div>
        </button>
        <button onClick={() => router.push('/forms/issue')} style={homeCard}>
          <div style={{ fontSize: 30 }}>⚠️</div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 17, fontWeight: 700, color: INK }}>Report Site Issue</div><div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>Raise a Site Issue</div></div>
          <div style={{ color: BRAND, fontSize: 24 }}>›</div>
        </button>
        <button onClick={() => router.push('/forms/deliveries')} style={homeCard}>
          <div style={{ fontSize: 30 }}>🚚</div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 17, fontWeight: 700, color: INK }}>Deliveries</div><div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>Confirm deliveries & attach proof</div></div>
          {deliveriesBadge > 0 && <span style={homeBadge('#dc2626')}>{deliveriesBadge}</span>}
          <div style={{ color: BRAND, fontSize: 24 }}>›</div>
        </button>

        {/* ── Contracts Manager area ── */}
        {isCM && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: BRAND, margin: '18px 0 2px' }}>Contracts Manager</div>
            {[
              ['🏗️', 'Pre-Start Notifications', 'Up-and-coming projects to Pre-Start', '/forms/cm/pre-start', 0, null],
              ['✅', 'Forms Completed', 'Submitted forms by project', '/forms/cm/forms-completed', 0, null],
              ['📋', 'Missing Forms', 'Outstanding forms on your projects', '/forms/cm/missing-forms', 0, null],
              ['⚠️', 'Issues Log', 'Assess & action site issues', '/forms/issues-log', issueActionCount, '#f59e0b'],
              ['📝', 'SRATs', 'View & create SRATs', '/forms/cm/srats', 0, null],
              ['🗂️', 'Live Tasks', 'Manage project tasks', '/forms/cm/tasks', overdueTaskCount, '#dc2626'],
              ['💷', 'Variations', 'View project variations', '/forms/cm/variations', 0, null],
            ].map(([icon, title, sub, href, badge, badgeColour]) => (
              <button key={href} onClick={() => router.push(href)} style={homeCard}>
                <div style={{ fontSize: 30 }}>{icon}</div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 17, fontWeight: 700, color: INK }}>{title}</div><div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{sub}</div></div>
                {badge > 0 && <span style={{ background: badgeColour, color: '#fff', borderRadius: 20, minWidth: 24, height: 24, padding: '0 7px', fontSize: 13, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{badge}</span>}
                <div style={{ color: BRAND, fontSize: 24 }}>›</div>
              </button>
            ))}
          </>
        )}
      </div>

      <SiteAppReportProblem user={user} />
    </div>
  )
}

// Site App "Report a problem" — shown at the bottom of the operative menu.
function SiteAppReportProblem({ user }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState('')
  const [description, setDescription] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!description.trim()) { setErr('Please describe the problem.'); return }
    setSending(true); setErr('')
    try {
      const r = await fetch('/api/report-problem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: user?.name || '', userEmail: user?.email || '', platform: 'Site App', page, description }),
      })
      let d = {}; try { d = await r.json() } catch {}
      if (!r.ok) { setErr(d.error || 'Could not submit'); setSending(false); return }
      setDone(true); setSending(false)
    } catch (e) { setErr(e?.message || 'Could not submit'); setSending(false) }
  }

  return (
    <div style={{ marginTop: 28, textAlign: 'center' }}>
      <button onClick={() => { setPage(''); setDescription(''); setDone(false); setErr(''); setOpen(true) }}
        style={{ background: 'none', border: 'none', color: '#9a3412', fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
        ⚠ Report app improvement
      </button>

      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 520, padding: '20px 18px 28px', maxHeight: '90vh', overflowY: 'auto', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Report app improvement</div>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#999' }}>×</button>
            </div>
            {done ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 15, color: INK, fontWeight: 600 }}>Thanks — your report has been sent.</div>
                <button onClick={() => setOpen(false)} style={{ ...bigBtn(false), marginTop: 16 }}>Close</button>
              </div>
            ) : (
              <>
                <RpField label="Your name"><input value={user?.name || ''} readOnly style={{ ...rpInp, background: '#f7f6f3', color: '#888' }} /></RpField>
                <RpField label="Where"><input value="Site App" readOnly style={{ ...rpInp, background: '#f7f6f3', color: '#888' }} /></RpField>
                <RpField label="Page where the issue happened"><input value={page} onChange={e => setPage(e.target.value)} style={rpInp} placeholder="e.g. Deliveries" /></RpField>
                <RpField label="Describe the problem"><textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} style={{ ...rpInp, resize: 'vertical' }} placeholder="What went wrong?" /></RpField>
                {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{err}</div>}
                <button onClick={submit} disabled={sending} style={bigBtn(sending)}>{sending ? 'Sending…' : 'Send report'}</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
const RpField = ({ label, children }) => (
  <div style={{ marginBottom: 12 }}>
    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#555', marginBottom: 5 }}>{label}</div>
    {children}
  </div>
)
const rpInp = { width: '100%', boxSizing: 'border-box', padding: '11px 12px', border: '2px solid #e3e0d9', borderRadius: 12, fontSize: 15, fontFamily: 'inherit', outline: 'none' }
// Shared: is this file an image (used by the drawings grid and the FileViewer).
function isImage(f) {
  if (!f) return false
  if ((f.contentType || f.type || '').startsWith('image/')) return true
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif)(\?|$)/i.test(f.name || f.url || '')
}

// Renders a PDF's pages to canvases (scrollable) using pdf.js — the browser can't
// hijack this into a "download/open" prompt the way it does with an <iframe> PDF.
function PdfCanvas({ url }) {
  const holderRef = useRef()
  const [state, setState] = useState('loading')  // loading | ok | failed
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
        if (cancelled) return
        const holder = holderRef.current; if (!holder) return
        holder.innerHTML = ''
        const maxW = Math.min(holder.clientWidth || 900, 1000)
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n)
          if (cancelled) return
          const vp0 = page.getViewport({ scale: 1 })
          const scale = (maxW / vp0.width) * (window.devicePixelRatio || 1)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width; canvas.height = viewport.height
          canvas.style.width = '100%'; canvas.style.height = 'auto'
          canvas.style.marginBottom = '10px'; canvas.style.borderRadius = '6px'; canvas.style.background = '#fff'
          holder.appendChild(canvas)
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        }
        if (!cancelled) setState('ok')
      } catch { if (!cancelled) setState('failed') }
    })()
    return () => { cancelled = true }
  }, [url])
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
      {state === 'loading' && <div style={{ color: '#bbb', textAlign: 'center', paddingTop: 40 }}>Loading PDF…</div>}
      {state === 'failed' && <div style={{ color: '#bbb', textAlign: 'center', paddingTop: 40 }}>Couldn't render this PDF — use Download.</div>}
      <div ref={holderRef} style={{ maxWidth: 1000, margin: '0 auto' }} />
    </div>
  )
}

function ProjectDetailsView({ onBack, only }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [proj, setProj] = useState(null)
  const [tab, setTab] = useState(only || 'drawings')
  const [files, setFiles] = useState([])
  const [sigMap, setSigMap] = useState({})   // { [fileId]: true } if current operative signed
  const [filesLoading, setFilesLoading] = useState(false)
  const [viewerIdx, setViewerIdx] = useState(null)   // index into `files`, or null when closed
  const [signFile, setSignFile] = useState(null)     // RAMS file currently being signed

  // Called after a successful signature: flip the row to signed without a full reload.
  function markSigned(fileId) {
    setSigMap(m => ({ ...m, [fileId]: true }))
  }

  useEffect(() => { (async () => {
    try {
      const r = await fetch('/api/ops-projects'); const d = await r.json()
      let u = null; try { u = JSON.parse(sessionStorage.getItem('ops_operative') || 'null') } catch {}
      const pa = u?.projectAccess
      const allowed = (p) => pa == null || pa === 'all' || (Array.isArray(pa) && pa.map(String).includes(String(p.projectNo)))
      setProjects((d.projects || []).filter(p => p.status === 'active').filter(allowed).sort((a, b) => (a.projectNo || '').localeCompare(b.projectNo || '')))
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
        // For RAMS, look up which of these the current operative has signed.
        if (tab === 'rams' && list.length) {
          try {
            let u = null; try { u = JSON.parse(sessionStorage.getItem('ops_operative') || 'null') } catch {}
            const rs = await fetch(`/api/rams-signatures?no=${encodeURIComponent(proj.projectNo)}`).then(r => r.json())
            const sigs = rs.signatures || {}
            const mine = {}
            for (const f of list) mine[f.id] = !!(u?.id && sigs[f.id] && sigs[f.id][u.id])
            setSigMap(mine)
          } catch { setSigMap({}) }
        } else {
          setSigMap({})
        }
      } catch {}
      setFilesLoading(false)
    })()
  }, [proj, tab])

  if (loading) return <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading…</div>

  if (!proj) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <button onClick={onBack} style={backLink}>‹ Back</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 16px' }}>{only === 'rams' ? 'RAMS — select a project' : only === 'drawings' ? 'Drawings — select a project' : 'Select a project'}</h2>
        {!projects.length ? <div style={{ color: '#999', fontSize: 14 }}>No live projects.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {projects.map(p => (
              <button key={p.projectNo} onClick={() => { setProj(p); setTab(only || 'drawings') }} style={homeCard}>
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
        {(only ? [[only, only === 'drawings' ? 'Drawings' : 'RAMS']] : [['drawings', 'Drawings'], ['rams', 'RAMS']]).map(([k, label]) => (
          <button key={k} onClick={() => !only && setTab(k)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid ' + (tab === k ? BRAND : '#e3e0d9'), background: tab === k ? BRAND : '#fff', color: tab === k ? '#fff' : INK, fontWeight: 600, fontSize: 14, cursor: only ? 'default' : 'pointer' }}>{label}</button>
        ))}
      </div>
      {filesLoading ? <div style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>Loading…</div>
        : !files.length ? <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>No {tab === 'drawings' ? 'drawings' : 'RAMS'} uploaded for this project yet.</div>
        : tab === 'drawings' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
            {files.map((f, i) => (
              <div key={f.id} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div onClick={() => setViewerIdx(i)} style={{ height: 120, background: '#f7f6f4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {isImage(f) ? <img src={f.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <SitePdfThumb url={f.url} />}
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: INK, wordBreak: 'break-word', lineHeight: 1.3 }}>{f.name}</div>
                  <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
                    <button onClick={() => setViewerIdx(i)} style={{ background: 'transparent', border: 'none', color: BRAND, fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: 0 }}>View</button>
                    <a href={f.url} download={f.name} target="_blank" rel="noreferrer" style={{ color: '#666', fontSize: 13, textDecoration: 'none' }}>Download</a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {files.map((f, i) => (
              <div key={f.id} style={{ background: '#fff', border: '1px solid ' + (sigMap[f.id] ? '#e3e0d9' : '#fecaca'), borderRadius: 14, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 24 }}>{isImage(f) ? '🖼️' : '📄'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 600, color: INK, wordBreak: 'break-word' }}>{f.name}</div>
                    {sigMap[f.id]
                      ? <div style={{ fontSize: 12, color: '#16a34a', marginTop: 2, fontWeight: 600 }}>✓ Signed</div>
                      : <div style={{ fontSize: 12, color: '#dc2626', marginTop: 2, fontWeight: 700 }}>● Not signed</div>}
                  </div>
                  <button onClick={() => setViewerIdx(i)} style={{ background: 'transparent', border: 'none', color: BRAND, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>View</button>
                  <a href={f.url} download={f.name} target="_blank" rel="noreferrer" style={{ color: '#666', fontSize: 14, textDecoration: 'none' }}>Download</a>
                </div>
                {!sigMap[f.id] && (
                  <button onClick={() => setSignFile(f)} style={{ ...bigBtn(false), marginTop: 12, background: '#dc2626' }}>
                    ✍ Sign RAMS now
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      {viewerIdx != null && files[viewerIdx] && (
        <FileViewer files={files} index={viewerIdx} onIndex={setViewerIdx} onClose={() => setViewerIdx(null)} />
      )}
      {signFile && (
        <RamsSignFlow
          file={signFile}
          projectNo={proj.projectNo}
          onClose={() => setSignFile(null)}
          onSigned={(fileId) => { markSigned(fileId); setSignFile(null) }}
        />
      )}
    </div>
  )
}

// ── RAMS signing flow: read-to-bottom → confirm → finger signature ──────────
// The statement operatives sign up to (mirrored server-side in the API).
const RAMS_STATEMENT = 'I confirm I have read, fully understood and will work to this and any other documents relating to this method statement. If at any point I feel it is unsafe to continue I will stop works and contact my supervisor. Any amendments to this method statement must be made by the person who originally completed it. It must then be communicated to the relevant persons.'

function RamsSignFlow({ file, projectNo, onClose, onSigned }) {
  const [step, setStep] = useState('read')        // read | sign
  const [reachedBottom, setReachedBottom] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [sigData, setSigData] = useState('')      // signature PNG data-URL
  const holderRef = useRef()
  const scrollRef = useRef()

  // Logged-in operative (name + id auto-filled).
  const user = (() => { try { return JSON.parse(sessionStorage.getItem('ops_operative') || 'null') } catch { return null } })()
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  // Render the RAMS PDF into the scrollable holder (pdf.js, canvas — mobile-safe).
  useEffect(() => {
    if (step !== 'read') return
    let cancelled = false
    setReachedBottom(false)
    const inlineUrl = `/api/download?inline=1&url=${encodeURIComponent(file.url)}&name=${encodeURIComponent(file.name || '')}`
    ;(async () => {
      try {
        // Images: single scrollable image; bottom = scrolled to end.
        if (isImage(file)) {
          const holder = holderRef.current; if (!holder) return
          holder.innerHTML = ''
          const img = document.createElement('img')
          img.src = inlineUrl; img.style.width = '100%'; img.style.display = 'block'
          img.onerror = () => { img.src = file.url }
          holder.appendChild(img)
          return
        }
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script')
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
            s.onload = resolve; s.onerror = reject; document.body.appendChild(s)
          })
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        }
        const pdf = await window.pdfjsLib.getDocument(inlineUrl).promise
        if (cancelled) return
        const holder = holderRef.current; if (!holder) return
        holder.innerHTML = ''
        const maxW = Math.min(holder.clientWidth || 700, 900)
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n)
          if (cancelled) return
          const vp0 = page.getViewport({ scale: 1 })
          const scale = (maxW / vp0.width) * (window.devicePixelRatio || 1)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width; canvas.height = viewport.height
          canvas.style.width = '100%'; canvas.style.height = 'auto'
          canvas.style.marginBottom = '8px'; canvas.style.borderRadius = '4px'; canvas.style.background = '#fff'
          holder.appendChild(canvas)
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        }
        // If the document is short enough to not scroll, count it as read.
        if (!cancelled) requestAnimationFrame(checkBottom)
      } catch { if (!cancelled) setErr('Could not load the document. Use Download to view it, then try again.') }
    })()
    return () => { cancelled = true }
  }, [step, file])

  function checkBottom() {
    const el = scrollRef.current; if (!el) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
    if (atBottom) setReachedBottom(true)
  }

  async function submit() {
    setErr('')
    if (!sigData) { setErr('Please draw your signature.'); return }
    if (!user?.id) { setErr('Could not identify your account — please log in again.'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/rams-signatures', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectNo, fileId: file.id, opId: user.id, name: user.name || '', signatureImg: sigData, statement: RAMS_STATEMENT }),
      })
      let d = {}; try { d = await r.json() } catch {}
      if (!r.ok || !d.ok) { setErr(d.error || 'Could not save your signature.'); setSaving(false); return }
      onSigned(file.id)
    } catch (e) { setErr(e?.message || 'Could not save your signature.'); setSaving(false) }
  }

  const overlay = (
    <div style={{ position: 'fixed', inset: 0, background: '#f6f5f2', zIndex: 3500, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: INK, height: 52, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10, flexShrink: 0 }}>
        <div style={{ color: '#fff', fontWeight: 600, fontSize: 15, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {step === 'read' ? 'Read the RAMS' : 'Sign the RAMS'}
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 26, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>

      {step === 'read' ? (
        <>
          <div style={{ padding: '10px 14px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: 13, color: '#92400e', flexShrink: 0 }}>
            Please read <strong>{file.name}</strong> to the bottom, then continue to sign.
          </div>
          <div ref={scrollRef} onScroll={checkBottom} style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            {err && <div style={{ color: '#dc2626', fontSize: 14, textAlign: 'center', padding: 20 }}>{err}</div>}
            <div ref={holderRef} style={{ maxWidth: 900, margin: '0 auto' }} />
            <div style={{ textAlign: 'center', color: reachedBottom ? '#16a34a' : '#bbb', fontSize: 13, padding: '8px 0 24px', fontWeight: 600 }}>
              {reachedBottom ? '✓ You’ve reached the end' : '↓ Keep scrolling to the end'}
            </div>
          </div>
          <div style={{ padding: '12px 14px', borderTop: '1px solid #e3e0d9', background: '#fff', flexShrink: 0 }}>
            <button onClick={() => setStep('sign')} disabled={!reachedBottom} style={bigBtn(!reachedBottom)}>
              {reachedBottom ? 'I confirm I’ve read this — continue' : 'Scroll to the end to continue'}
            </button>
          </div>
        </>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            <div style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: '#444', lineHeight: 1.5 }}>{RAMS_STATEMENT}</div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#777', marginBottom: 4 }}>Name</div>
                <div style={{ background: '#f7f6f3', borderRadius: 10, padding: '11px 12px', fontSize: 15, color: INK, fontWeight: 600 }}>{user?.name || '—'}</div>
              </div>
              <div style={{ width: 150 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#777', marginBottom: 4 }}>Date</div>
                <div style={{ background: '#f7f6f3', borderRadius: 10, padding: '11px 12px', fontSize: 15, color: INK, fontWeight: 600 }}>{today}</div>
              </div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: '#777', marginBottom: 6 }}>Draw your signature below</div>
            <SignaturePad onChange={setSigData} />

            {err && <div style={{ color: '#dc2626', fontSize: 14, margin: '12px 0' }}>{err}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => setStep('read')} style={{ flex: 1, padding: '14px 0', fontSize: 15, fontWeight: 600, color: '#555', background: '#fff', border: '1px solid #e3e0d9', borderRadius: 14, cursor: 'pointer' }}>‹ Back to document</button>
              <button onClick={submit} disabled={saving || !sigData} style={{ ...bigBtn(saving || !sigData), flex: 2 }}>{saving ? 'Saving…' : 'Sign & confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
  if (typeof document === 'undefined') return null
  return createPortal(overlay, document.body)
}

// Finger/mouse signature canvas. Emits a trimmed PNG data-URL via onChange.
function SignaturePad({ onChange }) {
  const canvasRef = useRef()
  const drawing = useRef(false)
  const last = useRef(null)
  const hasInk = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'
  }, [])

  function pos(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const t = e.touches ? e.touches[0] : e
    return { x: t.clientX - rect.left, y: t.clientY - rect.top }
  }
  function start(e) { e.preventDefault(); drawing.current = true; last.current = pos(e) }
  function move(e) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = pos(e)
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    last.current = p; hasInk.current = true
  }
  function end() {
    if (!drawing.current) return
    drawing.current = false
    if (hasInk.current) onChange(canvasRef.current.toDataURL('image/png'))
  }
  function clear() {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    hasInk.current = false; onChange('')
  }

  return (
    <div>
      <canvas ref={canvasRef}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        style={{ width: '100%', height: 180, background: '#fff', border: '2px dashed #cbb994', borderRadius: 12, touchAction: 'none', display: 'block' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <button onClick={clear} style={{ background: 'none', border: 'none', color: '#9a3412', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Clear signature</button>
      </div>
    </div>
  )
}

// ── Full-screen in-app file viewer with prev/next (buttons, arrow keys, swipe) ──
function FileViewer({ files, index, onIndex, onClose }) {
  const f = files[index]
  const has = files.length > 1
  const go = (delta) => { const n = (index + delta + files.length) % files.length; onIndex(n) }
  const touch = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, files.length])

  const onTouchStart = (e) => { touch.current = e.touches[0].clientX }
  const onTouchEnd = (e) => {
    if (touch.current == null) return
    const dx = e.changedTouches[0].clientX - touch.current
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)   // swipe left = next, right = prev
    touch.current = null
  }

  const navBtn = (side) => ({
    position: 'absolute', top: '50%', transform: 'translateY(-50%)', [side]: 8, zIndex: 3,
    width: 46, height: 46, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 26, lineHeight: '46px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  })

  const inlineUrl = `/api/download?inline=1&url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name || '')}`
  const overlay = (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 3000, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', color: '#fff', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
          {has && <div style={{ fontSize: 12, color: '#bbb' }}>{index + 1} of {files.length}</div>}
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <button onClick={() => downloadDrawing(f)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>Download</button>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 28, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
      </div>

      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, overflow: 'auto' }}>
        {has && <button onClick={() => go(-1)} aria-label="Previous" style={navBtn('left')}>‹</button>}
        {isImage(f)
          ? <img key={f.url} src={inlineUrl} data-stage="proxy" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              onError={(e) => { const s = e.target.getAttribute('data-stage'); if (s === 'proxy') { e.target.setAttribute('data-stage', 'raw'); e.target.src = f.url } }} />
          : <PdfCanvas key={f.url} url={inlineUrl} />}
        {has && <button onClick={() => go(1)} aria-label="Next" style={navBtn('right')}>›</button>}
      </div>

      {has && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, padding: '10px 16px 16px' }}>
          <button onClick={() => go(-1)} style={pageNavBtn}>‹ Previous</button>
          <button onClick={() => go(1)} style={pageNavBtn}>Next ›</button>
        </div>
      )}
    </div>
  )
  if (typeof document === 'undefined') return null
  return createPortal(overlay, document.body)
}
// Download a drawing/RAMS through the proxy so it keeps its filename and doesn't navigate away.
async function downloadDrawing(f) {
  const name = f.name || 'download'
  try {
    const a = document.createElement('a')
    a.href = `/api/download?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(name)}`
    a.download = name
    document.body.appendChild(a); a.click(); a.remove()
  } catch { window.open(f.url, '_blank', 'noopener') }
}
const pageNavBtn = { background: 'rgba(255,255,255,0.14)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }

const homeCard = { display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', background: '#fff', border: '1px solid #e3e0d9', borderRadius: 16, padding: '18px', cursor: 'pointer', width: '100%' }
const homeBadge = (colour) => ({ background: colour, color: '#fff', borderRadius: 20, minWidth: 24, height: 24, padding: '0 7px', fontSize: 13, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' })
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
  const isCM = user?.accessLevel === 'contracts-manager'

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/forms')
        const d = await r.json()
        const HIDDEN = ['contracts-manager-report', 'pre-start-notification']
        setForms((d.forms || []).filter(f => f.category === 'project' && !HIDDEN.includes(f.id)))
      } catch {}
      setLoading(false)
    })()
  }, [])

  // Access gate: forms tagged accessLevel:'contracts-manager' only show to CMs.
  const visible = forms.filter(f => !f.accessLevel || f.accessLevel !== 'contracts-manager' || isCM)
  const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '')

  const isHS = f => f.group === 'hs-incidence'
  const isCMForm = f => f.accessLevel === 'contracts-manager'

  const general = visible.filter(f => !isHS(f) && !isCMForm(f)).sort(byTitle)
  const hs = visible.filter(f => isHS(f) && !isCMForm(f)).sort(byTitle)
  const cmForms = visible.filter(f => isCMForm(f)).sort(byTitle)

  const Card = f => (
    <button key={f.id}
      onClick={() => router.push(`/forms/fill?form=${f.id}`)}
      style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', background: '#fff', border: '1px solid #e3e0d9', borderRadius: 16, padding: '18px 18px', cursor: 'pointer', width: '100%' }}>
      <div style={{ fontSize: 26 }}>📝</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>{f.title}</div>
        {f.short && <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{f.short}</div>}
      </div>
      <div style={{ color: BRAND, fontSize: 22 }}>›</div>
    </button>
  )
  const SectionHead = t => <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: BRAND, margin: '22px 0 2px' }}>{t}</div>

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {onBack && <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }}>‹ Back</button>}
      <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 4px' }}>Project Forms</h2>
      <p style={{ color: '#777', fontSize: 14, margin: '0 0 8px' }}>Choose a form to complete</p>
      {loading ? (
        <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading forms…</div>
      ) : !visible.length ? (
        <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>No forms available yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {general.map(Card)}

          {hs.length > 0 && <>
            {SectionHead('H&S Incidence Reporting')}
            {hs.map(Card)}
          </>}

          {isCM && cmForms.length > 0 && <>
            {SectionHead('Contracts Manager')}
            {cmForms.map(Card)}
          </>}
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
