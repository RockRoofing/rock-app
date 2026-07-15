import { useEffect, useState, useRef } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'

// Tokenised, no-login RAMS approval page for the customer's Site Manager.
// URL: /rams-approve?token=...   (link emailed to the Site Manager)
const INK = '#1a1a19'
const BRAND = '#ca8a04'
const BG = '#f6f5f2'

export default function RamsApprovePage() {
  const router = useRouter()
  const { token } = router.query
  const [info, setInfo] = useState(null)     // { ok, status, projectName, fileName, fileUrl, smName }
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [rejected, setRejected] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [editNotes, setEditNotes] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) return
    (async () => {
      try {
        const d = await fetch(`/api/rams-token?token=${encodeURIComponent(token)}`).then(r => r.json())
        setInfo(d)
        if (d?.smName) setName(d.smName)
      } catch { setInfo({ ok: false, status: 'invalid' }) }
      setLoading(false)
    })()
  }, [token])

  async function approve() {
    setErr('')
    if (!name.trim()) { setErr('Please enter your name.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/rams-approvals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sm-approve', token, name: name.trim() }),
      })
      let d = {}; try { d = await r.json() } catch {}
      if (!r.ok || !d.ok) { setErr(d.error || 'Could not record your approval.'); setBusy(false); return }
      setDone(true); setBusy(false)
    } catch (e) { setErr(e?.message || 'Could not record your approval.'); setBusy(false) }
  }

  async function reject() {
    setErr('')
    if (!name.trim()) { setErr('Please enter your name.'); return }
    if (!editNotes.trim()) { setErr('Please describe the edits required.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/rams-approvals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sm-reject', token, name: name.trim(), notes: editNotes.trim() }),
      })
      let d = {}; try { d = await r.json() } catch {}
      if (!r.ok || !d.ok) { setErr(d.error || 'Could not send your response.'); setBusy(false); return }
      setRejected(true); setBusy(false)
    } catch (e) { setErr(e?.message || 'Could not send your response.'); setBusy(false) }
  }

  return (
    <>
      <Head><title>RAMS Approval — Rock Roofing</title><meta name="viewport" content="width=device-width, initial-scale=1" /></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: BG, padding: '24px 16px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 44, width: 44, borderRadius: 10 }} />
            <div style={{ fontWeight: 700, fontSize: 18, color: INK }}>Rock Roofing — RAMS Approval</div>
          </div>

          {loading ? (
            <Card><div style={{ textAlign: 'center', color: '#999', padding: 20 }}>Loading…</div></Card>
          ) : rejected ? (
            <Card>
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>✍️</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>Thank you — your feedback has been sent</div>
                <p style={{ color: '#666', fontSize: 14, marginTop: 8 }}>We've let the Rock Roofing team know the RAMS for <strong>{info?.projectName}</strong> needs edits. They'll make the changes and re-issue it for your approval. You can close this page.</p>
              </div>
            </Card>
          ) : done || info?.status === 'done' ? (
            <Card>
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>Thank you — approval recorded</div>
                <p style={{ color: '#666', fontSize: 14, marginTop: 8 }}>The RAMS for <strong>{info?.projectName}</strong> has been approved. Rock Roofing's operatives can now sign onto it. You can close this page.</p>
              </div>
            </Card>
          ) : !info?.ok || info?.status === 'invalid' ? (
            <Card>
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>This approval link is invalid or has expired</div>
                <p style={{ color: '#666', fontSize: 14, marginTop: 8 }}>If you believe this is a mistake, please contact your Rock Roofing Contracts Manager for a new link.</p>
              </div>
            </Card>
          ) : info?.status === 'not-ready' ? (
            <Card>
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>⏳</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Not ready for approval yet</div>
                <p style={{ color: '#666', fontSize: 14, marginTop: 8 }}>This RAMS is still going through Rock Roofing's internal approvals. Please check back shortly.</p>
              </div>
            </Card>
          ) : (
            <>
              <Card>
                <div style={{ fontSize: 15, color: '#444', lineHeight: 1.5 }}>
                  <p style={{ marginTop: 0 }}>You've been asked to approve the RAMS (Risk Assessment &amp; Method Statement) for:</p>
                  <p style={{ fontSize: 16, fontWeight: 700, color: INK }}>{info.projectName}</p>
                  <p>Please review the document below, then confirm your approval.</p>
                </div>
                {info.fileUrl && (
                  <div style={{ marginTop: 12 }}>
                    <PdfPreview url={`/api/download?inline=1&url=${encodeURIComponent(info.fileUrl)}&name=${encodeURIComponent(info.fileName || '')}`} rawUrl={info.fileUrl} />
                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                      <a href={`/api/download?url=${encodeURIComponent(info.fileUrl)}&name=${encodeURIComponent(info.fileName || 'RAMS.pdf')}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: BRAND, color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', padding: '10px 18px', borderRadius: 10 }}>
                        ⬇ Download RAMS
                      </a>
                    </div>
                  </div>
                )}
              </Card>

              <Card>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#777', marginBottom: 5 }}>Your name</div>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', border: '2px solid #e3e0d9', borderRadius: 12, fontSize: 16, outline: 'none' }} />
                <div style={{ fontSize: 12, color: '#999', marginTop: 6 }}>Date: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                {err && <div style={{ color: '#dc2626', fontSize: 14, marginTop: 10 }}>{err}</div>}
                <button onClick={approve} disabled={busy} style={{ width: '100%', marginTop: 14, padding: '15px 0', fontSize: 16, fontWeight: 700, color: '#fff', background: busy ? '#c9c4ba' : BRAND, border: 'none', borderRadius: 12, cursor: busy ? 'default' : 'pointer' }}>
                  {busy ? 'Recording…' : '✓ Approve this RAMS'}
                </button>
                <p style={{ fontSize: 12, color: '#999', marginTop: 10, textAlign: 'center' }}>By approving, you confirm you have reviewed the RAMS for this project.</p>

                {/* Do not approve — requires edits */}
                {!showReject ? (
                  <button onClick={() => { setShowReject(true); setErr('') }} style={{ width: '100%', marginTop: 12, padding: '15px 0', fontSize: 16, fontWeight: 700, color: '#b91c1c', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 12, cursor: 'pointer' }}>
                    Do not approve — requires edits
                  </button>
                ) : (
                  <div style={{ marginTop: 12, paddingTop: 14, borderTop: '1px solid #eee' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>Request edits</div>
                    <div style={{ fontSize: 12.5, color: '#777', marginBottom: 8 }}>Describe what needs changing (required). This will be sent to Rock Roofing's Contracts Manager and Director — the RAMS will not be approved.</div>
                    <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={4} placeholder="What needs to be changed?"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', border: '2px solid #e3e0d9', borderRadius: 12, fontSize: 15, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
                    <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                      <button onClick={() => { setShowReject(false); setEditNotes(''); setErr('') }} style={{ flex: 1, padding: '12px 0', fontSize: 15, fontWeight: 600, color: '#555', background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={reject} disabled={busy} style={{ flex: 2, padding: '12px 0', fontSize: 15, fontWeight: 700, color: '#b91c1c', background: busy ? '#f3f4f6' : '#fee2e2', border: '1px solid #fecaca', borderRadius: 12, cursor: busy ? 'default' : 'pointer' }}>{busy ? 'Sending…' : 'Send edit request'}</button>
                    </div>
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Card({ children }) {
  return <div style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 16, padding: 18, marginBottom: 14 }}>{children}</div>
}

// Simple PDF preview via pdf.js (canvas). Images render directly.
function PdfPreview({ url, rawUrl }) {
  const holderRef = useRef()
  const [state, setState] = useState('loading')
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(rawUrl || '')) {
          const holder = holderRef.current; if (!holder) return
          holder.innerHTML = ''
          const img = document.createElement('img'); img.src = url; img.style.width = '100%'; img.onerror = () => img.src = rawUrl
          holder.appendChild(img); setState('ok'); return
        }
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
        const maxW = Math.min(holder.clientWidth || 600, 800)
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n)
          if (cancelled) return
          const vp0 = page.getViewport({ scale: 1 })
          const scale = (maxW / vp0.width) * (window.devicePixelRatio || 1)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width; canvas.height = viewport.height
          canvas.style.width = '100%'; canvas.style.height = 'auto'; canvas.style.marginBottom = '8px'; canvas.style.border = '1px solid #eee'; canvas.style.borderRadius = '4px'
          holder.appendChild(canvas)
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        }
        if (!cancelled) setState('ok')
      } catch { if (!cancelled) setState('failed') }
    })()
    return () => { cancelled = true }
  }, [url, rawUrl])
  return (
    <div style={{ maxHeight: 420, overflow: 'auto', background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 8 }}>
      {state === 'loading' && <div style={{ color: '#bbb', textAlign: 'center', padding: 30 }}>Loading document…</div>}
      {state === 'failed' && <div style={{ color: '#bbb', textAlign: 'center', padding: 30 }}>Couldn't preview — please use Download.</div>}
      <div ref={holderRef} />
    </div>
  )
}
