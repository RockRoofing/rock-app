import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import { Shell, bigBtn } from './index'

const INK = '#1a1a19'
const BRAND = '#ca8a04'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// Operative Deliveries schedule (mobile). Pick a project, then see its deliveries.
// Editable on mobile: Actual Delivery Date, Comments, Attachments (proof: photo or note).
// A warning shows if no attachment is added, but the operative can still save.
export default function DeliveriesView() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [deliveries, setDeliveries] = useState([])
  const [loading, setLoading] = useState(true)
  const [projectNo, setProjectNo] = useState('')
  const [open, setOpen] = useState(null)   // delivery being edited

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    setReady(true)
    load()
  }, [])

  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/deliveries').then(r => r.json()); setDeliveries(d.deliveries || []) } catch {}
    setLoading(false)
  }

  // Projects that actually have deliveries, for the picker.
  const projects = useMemo(() => {
    const map = {}
    for (const d of deliveries) {
      const key = d.projectNo || d.projectName || ''
      if (!key) continue
      if (!map[key]) map[key] = { key, projectNo: d.projectNo || '', projectName: d.projectName || '' }
    }
    return Object.values(map).sort((a, b) => (a.projectNo || a.projectName).localeCompare(b.projectNo || b.projectName, undefined, { numeric: true }))
  }, [deliveries])

  const rows = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const in2wk = new Date(now.getTime() + 14 * 86400000)
    return deliveries
      .filter(d => (d.projectNo || d.projectName || '') === projectNo)
      // Show only deliveries NOT yet marked delivered, OR due within the next 2 weeks.
      .filter(d => {
        if (!d.actualDeliveryDate) {
          if (!d.requiredDeliveryDate) return true          // undated & undelivered -> still show
          const req = new Date(d.requiredDeliveryDate); req.setHours(0, 0, 0, 0)
          return req <= in2wk                                // due within 2 weeks (incl. overdue)
        }
        // delivered: only show if it was due within the last/next 2 weeks window
        const req = d.requiredDeliveryDate ? new Date(d.requiredDeliveryDate) : null
        if (req) { req.setHours(0, 0, 0, 0); return req >= now && req <= in2wk }
        return false
      })
      .sort((a, b) => (a.requiredDeliveryDate || '').localeCompare(b.requiredDeliveryDate || ''))
  }, [deliveries, projectNo])

  const selProject = projects.find(p => p.key === projectNo)

  if (!ready) return <Shell user={user}><div style={{ textAlign: 'center', color: '#999', paddingTop: 40 }}>Loading…</div></Shell>

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }}>‹ Home</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 4px' }}>Deliveries</h2>

        {/* Project picker first */}
        {!projectNo ? (
          <>
            <p style={{ color: '#777', fontSize: 14, margin: '0 0 16px' }}>Select a project to see its deliveries.</p>
            {loading ? <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading…</div>
              : !projects.length ? <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>No deliveries scheduled yet.</div>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {projects.map(p => (
                    <button key={p.key} onClick={() => setProjectNo(p.key)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: '#fff', border: '1px solid #e3e0d9', borderRadius: 14, padding: '16px', cursor: 'pointer', width: '100%' }}>
                      <div style={{ fontSize: 22 }}>📦</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{p.projectNo}{p.projectName && p.projectName !== p.projectNo ? ` — ${p.projectName}` : ''}</div>
                      </div>
                      <div style={{ color: BRAND, fontSize: 20 }}>›</div>
                    </button>
                  ))}
                </div>
              )}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 14px' }}>
              <button onClick={() => setProjectNo('')} style={{ background: '#f2f2f0', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: '#555' }}>‹ Projects</button>
              <div style={{ fontWeight: 700, color: INK, fontSize: 15 }}>{selProject?.projectNo}{selProject?.projectName && selProject.projectName !== selProject.projectNo ? ` — ${selProject.projectName}` : ''}</div>
            </div>

            {!rows.length ? <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>No deliveries for this project.</div>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {rows.map(d => (
                    <div key={d.id} onClick={() => setOpen(d)}
                      style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 14, padding: 14, cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontWeight: 700, color: INK, fontSize: 14 }}>{d.poNumber || '—'}</div>
                        <div style={{ fontSize: 12, color: d.actualDeliveryDate ? '#16a34a' : '#999' }}>{d.actualDeliveryDate ? `✓ Delivered ${fmtDate(d.actualDeliveryDate)}` : (d.requiredDeliveryDate ? `Due ${fmtDate(d.requiredDeliveryDate)}` : '')}</div>
                      </div>
                      <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>{d.supplier || '—'}</div>
                      {d.requiredDeliveryDate && <div style={{ fontSize: 12, color: '#777', marginTop: 4 }}>Required delivery: <strong>{fmtDate(d.requiredDeliveryDate)}</strong></div>}
                      <ItemList items={d.lineItems || []} />
                      {d.comments && <div style={{ fontSize: 12, color: '#666', marginTop: 6, fontStyle: 'italic' }}>“{d.comments}”</div>}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, marginTop: 8 }}>
                        <div style={{ fontSize: 12, color: (d.attachments || []).length ? '#16a34a' : '#c2410c', fontWeight: (d.attachments || []).length ? 400 : 600, lineHeight: 1.35 }}>
                          {(d.attachments || []).length ? `📎 ${(d.attachments || []).length} attachment${(d.attachments || []).length === 1 ? '' : 's'}` : '⚠ No proof of delivery attached. Delivery needs confirming arrived.'}
                        </div>
                        <div style={{ color: BRAND, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>Update ›</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </>
        )}
      </div>

      {open && <DeliveryEditor delivery={open} onClose={() => setOpen(null)} onSaved={(d) => { setDeliveries(prev => prev.map(x => x.id === d.id ? { ...x, ...d } : x)); setOpen(null) }} />}
    </Shell>
  )
}

// ── Editor: only Actual Delivery Date, Comments, Attachments are editable ──────
function DeliveryEditor({ delivery, onClose, onSaved }) {
  const [actualDeliveryDate, setActualDeliveryDate] = useState(delivery.actualDeliveryDate || '')
  const [comments, setComments] = useState(delivery.comments || '')
  const [note, setNote] = useState('')   // free-text delivery note (added to attachments as a note)
  const [attachments, setAttachments] = useState(Array.isArray(delivery.attachments) ? delivery.attachments : [])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [warn, setWarn] = useState(false)
  const [err, setErr] = useState('')
  const cameraRef = useRef(); const galleryRef = useRef()

  const photoCount = attachments.filter(a => a.type !== 'note').length
  const noteCount = attachments.filter(a => a.type === 'note').length

  async function handleFiles(files) {
    if (!files || !files.length) return
    setUploading(true); setErr('')
    let failed = 0
    for (const file of Array.from(files)) {
      try {
        const fd = new FormData(); fd.append('file', file)
        const up = await fetch('/api/upload-file', { method: 'POST', body: fd })
        const ud = await up.json()
        if (!up.ok || !ud.url) { failed++; continue }
        setAttachments(prev => [...prev, { type: 'photo', url: ud.url, name: file.name || 'photo' }])
      } catch { failed++ }
    }
    if (failed) setErr(`${failed} file${failed > 1 ? 's' : ''} failed to upload — please try again.`)
    setUploading(false)
  }

  function addNote() {
    const t = note.trim(); if (!t) return
    setAttachments(prev => [...prev, { type: 'note', text: t, addedAt: Date.now() }])
    setNote('')
  }

  async function doSave() {
    setSaving(true); setErr('')
    try {
      const r = await fetch('/api/deliveries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery: { id: delivery.id, actualDeliveryDate, comments, attachments } }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Save failed'); setSaving(false); return }
      onSaved({ id: delivery.id, actualDeliveryDate, comments, attachments })
    } catch (e) { setErr(e?.message || 'Save failed'); setSaving(false) }
  }

  function attemptSave() {
    // Warn (but allow) if no proof — a photo or a delivery note — is attached.
    if (!attachments.length && !warn) { setWarn(true); return }
    doSave()
  }

  const items = delivery.lineItems || []
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 640, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ position: 'sticky', top: 0, background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #eee' }}>
          <div style={{ fontWeight: 700, color: INK, fontSize: 16 }}>{delivery.poNumber || 'Delivery'}</div>
          <button onClick={onClose} style={{ fontSize: 24, border: 'none', background: 'none', cursor: 'pointer', color: '#999' }}>×</button>
        </div>

        <div style={{ padding: '16px 18px 28px' }}>
          {/* Read-only details */}
          <Detail label="Supplier" value={delivery.supplier || '—'} />
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: '#999' }}>Items</div>
            <ItemList items={items} />
          </div>
          {delivery.requiredDeliveryDate && <Detail label="Required delivery date" value={fmtDate(delivery.requiredDeliveryDate)} />}

          {/* Editable */}
          <div style={{ marginTop: 16 }}>
            <Lbl>Actual delivery date</Lbl>
            <input type="date" value={actualDeliveryDate} onChange={e => setActualDeliveryDate(e.target.value)} style={inp} />
          </div>
          <div style={{ marginTop: 14 }}>
            <Lbl>Comments</Lbl>
            <textarea value={comments} onChange={e => setComments(e.target.value)} rows={3} placeholder="Any comments about this delivery…" style={{ ...inp, resize: 'vertical' }} />
          </div>

          {/* Proof: photo or note */}
          <div style={{ marginTop: 16 }}>
            <Lbl>Proof of delivery (photo or delivery note)</Lbl>
            {attachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {attachments.map((a, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    {a.type === 'note'
                      ? <div style={{ background: '#f2efe8', borderRadius: 10, padding: '8px 10px', fontSize: 12, color: '#555', maxWidth: 180 }}>📝 {a.text}</div>
                      : <img src={a.url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10 }} />}
                    <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                      style={{ position: 'absolute', top: -6, right: -6, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 12 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
            <input ref={galleryRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => cameraRef.current?.click()} disabled={uploading} style={smallBtn}>📷 Take photo</button>
              <button onClick={() => galleryRef.current?.click()} disabled={uploading} style={smallBtn}>🖼️ Choose photo</button>
            </div>
            {uploading && <div style={{ fontSize: 13, color: '#888', marginTop: 6 }}>Uploading…</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="…or type a delivery note" style={{ ...inp, flex: 1 }} />
              <button onClick={addNote} disabled={!note.trim()} style={{ ...smallBtn, opacity: note.trim() ? 1 : 0.5 }}>Add note</button>
            </div>
            <div style={{ fontSize: 11.5, color: '#999', marginTop: 6 }}>{photoCount} photo{photoCount === 1 ? '' : 's'} · {noteCount} note{noteCount === 1 ? '' : 's'}</div>
          </div>

          {warn && !attachments.length && (
            <div style={{ marginTop: 14, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#92400e' }}>
              ⚠️ Please attach a delivery note or photos. If not available, tap “Save anyway”.
            </div>
          )}
          {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 12 }}>{err}</div>}

          <button onClick={attemptSave} disabled={saving} style={{ ...bigBtn(saving), marginTop: 18 }}>
            {saving ? 'Saving…' : (warn && !attachments.length ? 'Save anyway' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  )
}

const Detail = ({ label, value }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ fontSize: 11, color: '#999' }}>{label}</div>
    <div style={{ fontSize: 14, color: INK }}>{value}</div>
  </div>
)
// Each PO line item on its own bulleted line.
const ItemList = ({ items }) => {
  const list = (items || []).map(li => `${li.description || li.item || ''}${li.quantity ? ` ×${li.quantity}` : ''}`.trim()).filter(Boolean)
  if (!list.length) return <div style={{ fontSize: 14, color: '#999', marginTop: 2 }}>—</div>
  return (
    <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13, color: '#555' }}>
      {list.map((t, i) => <li key={i} style={{ marginBottom: 2 }}>{t}</li>)}
    </ul>
  )
}
const Lbl = ({ children }) => <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 6 }}>{children}</div>
const inp = { width: '100%', boxSizing: 'border-box', padding: '12px 12px', border: '2px solid #e3e0d9', borderRadius: 12, fontSize: 15, fontFamily: 'inherit', outline: 'none' }
const smallBtn = { background: '#fff', border: '2px solid #e3e0d9', borderRadius: 12, padding: '10px 14px', fontSize: 14, cursor: 'pointer', color: INK }
