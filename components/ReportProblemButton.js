import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { upload } from '@vercel/blob/client'

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
  const [priority, setPriority] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const [attachments, setAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef()

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => { if (d?.user?.name) setUserName(d.user.name); if (d?.user?.email) setUserEmail(d.user.email) }).catch(() => {})
  }, [])

  useEffect(() => {
    const h = () => { setPage(router.asPath || ''); setDescription(''); setPriority(''); setAttachments([]); setDone(false); setErr(''); setOpen(true) }
    window.addEventListener('open-report-problem', h)
    return () => window.removeEventListener('open-report-problem', h)
  }, [router.asPath])

  if ((router.pathname || '').startsWith('/forms')) return null
  if (!open) return null

  // Upload one or more files (picked, dragged or pasted) and attach them to the report.
  async function addFiles(list) {
    const files = Array.from(list || []).filter(Boolean)
    if (!files.length) return
    setUploading(true); setErr('')
    const next = []
    for (const file of files) {
      try {
        const blob = await upload(file.name || `screenshot-${Date.now()}.png`, file, { access: 'public', handleUploadUrl: '/api/blob-upload', contentType: file.type || 'application/octet-stream' })
        next.push({ name: file.name || 'Screenshot', url: blob.url, contentType: file.type || '', size: file.size || 0 })
      } catch (e) { setErr('One of the files could not be uploaded.') }
    }
    if (fileRef.current) fileRef.current.value = ''
    if (next.length) setAttachments(a => [...a, ...next])
    setUploading(false)
  }

  // Paste a screenshot straight into the window (Windows: Win+Shift+S then Ctrl+V).
  // Only image data is intercepted - pasting normal text still behaves normally.
  function onPaste(e) {
    const items = (e.clipboardData && e.clipboardData.items) || []
    const imgs = []
    for (const it of items) {
      if (it.kind === 'file' && String(it.type || '').startsWith('image/')) {
        const f = it.getAsFile()
        if (f) {
          const ext = (f.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '')
          imgs.push(new File([f], f.name && f.name !== 'image.png' ? f.name : `screenshot-${Date.now()}.${ext}`, { type: f.type }))
        }
      }
    }
    if (imgs.length) { e.preventDefault(); addFiles(imgs) }
  }

  function removeAttachment(i) { setAttachments(a => a.filter((_, j) => j !== i)) }

  async function submit() {
    if (!description.trim()) { setErr('Please describe the improvement.'); return }
    if (uploading) { setErr('Please wait for the upload to finish.'); return }
    if (!priority) { setErr('Please select a priority.'); return }
    setSending(true); setErr('')
    try {
      const r = await fetch('/api/report-problem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName, userEmail, platform: 'Portal', page: page || router.asPath, description, priority, attachments }),
      })
      let d = {}; try { d = await r.json() } catch {}
      if (!r.ok) { setErr(d.error || 'Could not submit'); setSending(false); return }
      setDone(true); setSending(false)
    } catch (e) { setErr(e?.message || 'Could not submit'); setSending(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} onPaste={onPaste} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, padding: '20px 20px 24px', maxHeight: '90vh', overflowY: 'auto' }}>
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
            <Field label="Priority">
              <div style={{ display: 'flex', gap: 8 }}>
                {[['low', 'Low', '#16a34a'], ['medium', 'Medium', '#d97706'], ['high', 'High', '#dc2626']].map(([val, lbl, col]) => (
                  <button key={val} type="button" onClick={() => setPriority(val)}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                      border: `2px solid ${priority === val ? col : '#e0e0e0'}`, background: priority === val ? col : '#fff', color: priority === val ? '#fff' : '#666' }}>{lbl}</button>
                ))}
              </div>
            </Field>
            <Field label="Describe the improvement / problem"><textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} style={{ ...inp, resize: 'vertical' }} placeholder="What would you like improved, or what went wrong? You can paste a screenshot straight in." /></Field>
            <Field label="Screenshots / attachments">
              <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
              <button type="button" onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading}
                style={{ width: '100%', padding: '10px 12px', border: '1px dashed #d4d4d4', borderRadius: 8, background: '#faf9f7', fontSize: 13.5, fontWeight: 600, color: '#666', cursor: 'pointer', opacity: uploading ? 0.6 : 1 }}>
                {uploading ? 'Uploading...' : '+ Attach a file, or paste a screenshot'}
              </button>
              {attachments.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '6px 8px', border: '1px solid #eee', borderRadius: 8 }}>
                  {String(a.contentType || '').startsWith('image/')
                    ? <img src={a.url} alt="" style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 5, border: '1px solid #eee' }} />
                    : <span style={{ width: 38, textAlign: 'center', fontSize: 18 }}>&#128206;</span>}
                  <span style={{ flex: 1, fontSize: 12.5, color: '#444', wordBreak: 'break-word' }}>{a.name}</span>
                  <button type="button" onClick={() => removeAttachment(i)} style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
                </div>
              ))}
            </Field>
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
