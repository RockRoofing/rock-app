import { useState, useEffect, useRef } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, Loading, ghostBtn, primaryBtn } from '../../../components/opsUI'

// Director (Carl) approves RAMS here. Approving = confirming a safe method of
// work / properly risk-assessed AND signing onto the RAMS with the operative
// statement. Only appears for RAMS whose chain is at the Director stage.
const STATEMENT = 'I confirm I have read, fully understood and will work to this and any other documents relating to this method statement. If at any point I feel it is unsafe to continue I will stop works and contact my supervisor. Any amendments to this method statement must be made by the person who originally completed it. It must then be communicated to the relevant persons.'

export default function RamsApprovalsPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState(null)
  const [signItem, setSignItem] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const d = await fetch('/api/rams-approvals?pending=director').then(r => r.json())
      setItems(d.items || [])
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])
  useEffect(() => { fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => setMe(d.user || null)).catch(() => {}) }, [])

  if (loading) return (
    <OperationsShell active="hs:rams-approvals" section="hs" title="RAMS Approvals" wide><PageHeading title="RAMS Approvals" /><Loading /></OperationsShell>
  )

  return (
    <OperationsShell active="hs:rams-approvals" section="hs" title="RAMS Approvals" wide>
      <PageHeading title="RAMS Approvals" sub="RAMS awaiting Director approval. Approving confirms a safe method of work and signs you onto the RAMS." />

      {items.length === 0 ? (
        <div style={{ padding: 24, fontSize: 14, color: '#888', background: '#faf9f7', borderRadius: 12, textAlign: 'center' }}>
          No RAMS are currently awaiting your approval.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map(it => (
            <div key={`${it.projectNo}:${it.fileId}`} style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 26 }}>📑</div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{it.projectNo}{it.projectName ? ` — ${it.projectName}` : ''}</div>
                  <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>{it.fileName}</div>
                  <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4 }}>✓ CM approved{it.cmName ? ` by ${it.cmName}` : ''}{it.cmDate ? ` · ${it.cmDate}` : ''}</div>
                </div>
                {it.fileUrl && <a href={`/api/download?url=${encodeURIComponent(it.fileUrl)}&name=${encodeURIComponent(it.fileName || 'RAMS.pdf')}`} style={{ ...ghostBtn, textDecoration: 'none' }}>Download</a>}
                <button onClick={() => setSignItem(it)} style={primaryBtn}>Review &amp; approve</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {signItem && (
        <DirectorApproveModal item={signItem} me={me} onClose={() => setSignItem(null)} onDone={() => { setSignItem(null); load() }} />
      )}
    </OperationsShell>
  )
}

function DirectorApproveModal({ item, me, onClose, onDone }) {
  const [step, setStep] = useState('read')   // read | sign
  const [reachedBottom, setReachedBottom] = useState(false)
  const [sigData, setSigData] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const holderRef = useRef()
  const scrollRef = useRef()
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  useEffect(() => {
    if (step !== 'read') return
    let cancelled = false
    setReachedBottom(false)
    const inlineUrl = `/api/download?inline=1&url=${encodeURIComponent(item.fileUrl)}&name=${encodeURIComponent(item.fileName || '')}`
    ;(async () => {
      try {
        if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(item.fileUrl || '')) {
          const holder = holderRef.current; if (!holder) return
          holder.innerHTML = ''
          const img = document.createElement('img'); img.src = inlineUrl; img.style.width = '100%'; img.onerror = () => img.src = item.fileUrl
          holder.appendChild(img); requestAnimationFrame(check); return
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
          canvas.style.width = '100%'; canvas.style.height = 'auto'; canvas.style.marginBottom = '8px'; canvas.style.border = '1px solid #eee'; canvas.style.borderRadius = '4px'
          holder.appendChild(canvas)
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        }
        if (!cancelled) requestAnimationFrame(check)
      } catch { if (!cancelled) setErr('Could not load the document — use Download to review it.') }
    })()
    return () => { cancelled = true }
  }, [step, item])

  function check() {
    const el = scrollRef.current; if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setReachedBottom(true)
  }

  async function submit() {
    setErr('')
    if (!sigData) { setErr('Please draw your signature.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/rams-approvals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'director-approve', projectNo: item.projectNo, fileId: item.fileId, name: me?.name || '', signatureImg: sigData }),
      })
      let d = {}; try { d = await r.json() } catch {}
      if (!r.ok || !d.ok) { setErr(d.error || 'Could not approve.'); setBusy(false); return }
      onDone()
    } catch (e) { setErr(e?.message || 'Could not approve.'); setBusy(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ background: INK, padding: '14px 18px', color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, fontWeight: 600 }}>{step === 'read' ? 'Review RAMS' : 'Approve & sign'} — {item.projectNo}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 26, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {step === 'read' ? (
          <>
            <div ref={scrollRef} onScroll={check} style={{ flex: 1, overflow: 'auto', padding: 14, background: '#faf9f7' }}>
              {err && <div style={{ color: '#dc2626', fontSize: 14, textAlign: 'center', padding: 16 }}>{err}</div>}
              <div ref={holderRef} style={{ maxWidth: 900, margin: '0 auto' }} />
              <div style={{ textAlign: 'center', color: reachedBottom ? '#16a34a' : '#bbb', fontSize: 13, padding: '8px 0 20px', fontWeight: 600 }}>
                {reachedBottom ? '✓ You’ve reached the end' : '↓ Scroll to the end to continue'}
              </div>
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={onClose} style={ghostBtn}>Cancel</button>
              <button onClick={() => setStep('sign')} disabled={!reachedBottom} style={{ ...primaryBtn, opacity: reachedBottom ? 1 : 0.5, cursor: reachedBottom ? 'pointer' : 'default' }}>Continue to approve</button>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#92400e', marginBottom: 14 }}>
              By approving, you confirm this is a safe method of work and has been properly risk-assessed. You also sign onto the RAMS with the statement below.
            </div>
            <div style={{ background: '#f7f6f3', border: '1px solid #e3e0d9', borderRadius: 12, padding: 14, fontSize: 13, color: '#444', lineHeight: 1.5, marginBottom: 16 }}>{STATEMENT}</div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600, color: '#777', marginBottom: 4 }}>Name</div><div style={{ background: '#f7f6f3', borderRadius: 8, padding: '10px 12px', fontSize: 14, fontWeight: 600 }}>{me?.name || '—'}</div></div>
              <div style={{ width: 160 }}><div style={{ fontSize: 12, fontWeight: 600, color: '#777', marginBottom: 4 }}>Date</div><div style={{ background: '#f7f6f3', borderRadius: 8, padding: '10px 12px', fontSize: 14, fontWeight: 600 }}>{today}</div></div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#777', marginBottom: 6 }}>Draw your signature</div>
            <SigPad onChange={setSigData} />
            {err && <div style={{ color: '#dc2626', fontSize: 14, margin: '12px 0' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => setStep('read')} style={ghostBtn}>‹ Back</button>
              <button onClick={submit} disabled={busy || !sigData} style={{ ...primaryBtn, opacity: (busy || !sigData) ? 0.5 : 1 }}>{busy ? 'Approving…' : 'Approve & sign'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SigPad({ onChange }) {
  const canvasRef = useRef()
  const drawing = useRef(false)
  const last = useRef(null)
  const hasInk = useRef(false)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio; canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'
  }, [])
  function pos(e) { const r = canvasRef.current.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top } }
  function start(e) { e.preventDefault(); drawing.current = true; last.current = pos(e) }
  function move(e) { if (!drawing.current) return; e.preventDefault(); const ctx = canvasRef.current.getContext('2d'); const p = pos(e); ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last.current = p; hasInk.current = true }
  function end() { if (!drawing.current) return; drawing.current = false; if (hasInk.current) onChange(canvasRef.current.toDataURL('image/png')) }
  function clear() { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); hasInk.current = false; onChange('') }
  return (
    <div>
      <canvas ref={canvasRef}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        style={{ width: '100%', height: 160, background: '#fff', border: '2px dashed #cbb994', borderRadius: 12, touchAction: 'none', display: 'block' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <button onClick={clear} style={{ background: 'none', border: 'none', color: '#9a3412', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Clear signature</button>
      </div>
    </div>
  )
}
