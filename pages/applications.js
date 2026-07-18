import { useState, useEffect, useMemo } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import CommercialNav from '../components/CommercialNav'
import { computeApplicationSummary, worksValueToDate, resolveAppDates, buildAppVariations } from '../lib/applications'

const fmt = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s) => { if (!s) return '—'; const d = new Date(s + (s.length === 10 ? 'T00:00:00' : '')); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
const monthLabel = (key) => { const [y, m] = String(key).split('-').map(Number); if (!y) return key; return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) }

export default function ApplicationsPage() {
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(false)
  const [apps, setApps] = useState([])
  const [cr, setCr] = useState(null)
  const [settings, setSettings] = useState({})
  const [trackerVariations, setTrackerVariations] = useState([])
  const [undeliveredPOs, setUndeliveredPOs] = useState([])
  const [openId, setOpenId] = useState(null)     // application being edited
  const [msg, setMsg] = useState('')
  const [creating, setCreating] = useState(false)
  const [newMonth, setNewMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })

  useEffect(() => { (async () => {
    try {
      const [d, m] = await Promise.all([
        fetch('/api/dashboard').then(r => r.json()).catch(() => ({})),
        fetch('/api/portal-auth?action=me').then(r => r.json()).catch(() => null),
      ])
      const ps = (d.projects || []).map(p => ({ xeroId: String(p.xeroId), jobNo: p.jobNo || '', name: p.name || '' }))
        .sort((a, b) => (a.jobNo || '').localeCompare(b.jobNo || '', undefined, { numeric: true }))
      setProjects(ps)
      if (m && m.user) setMe(m.user)
    } catch {}
  })() }, [])

  async function load(pid) {
    if (!pid) return
    setLoading(true); setMsg('')
    try {
      const d = await fetch(`/api/applications?projectId=${encodeURIComponent(pid)}`).then(r => r.json())
      setApps(d.applications || [])
      setCr(d.contractedRates || null)
      setSettings(d.settings || {})
      setTrackerVariations(d.variations || [])
      setUndeliveredPOs(d.undeliveredPOs || [])
    } catch { setMsg('Could not load applications.') }
    setLoading(false)
  }
  function pickProject(pid) { setProjectId(pid); setOpenId(null); load(pid) }

  // Sorted, and previous-gross lookup (by seq) for carry-forward.
  const sortedApps = useMemo(() => [...apps].sort((a, b) => (a.seq || 0) - (b.seq || 0)), [apps])
  function prevGrossFor(app) {
    // previous = the application with the highest seq below this one's seq
    let prev = null
    for (const a of sortedApps) { if ((a.seq || 0) < (app.seq || 0)) prev = a }
    if (!prev) return 0
    return computeApplicationSummary(prev, 0).grossCurrent
  }

  const newDates = useMemo(() => resolveAppDates(newMonth, settings), [newMonth, settings])

  async function createApp() {
    if (!projectId) return
    setCreating(true); setMsg('')
    try {
      const body = {
        action: 'create', projectId,
        monthKey: newMonth, monthLabel: monthLabel(newMonth),
        ...newDates,
        mcdPct: settings.mcdPct != null ? settings.mcdPct : 0,
        retentionPct: settings.retentionPct != null ? settings.retentionPct * 100 : 5,
        author: me?.name || '',
      }
      const d = await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
      if (!d.ok) { setMsg(d.error || 'Could not create application.'); setCreating(false); return }
      setApps(d.applications || [])
      setOpenId(d.application.id)
    } catch { setMsg('Could not create application.') }
    setCreating(false)
  }

  const openApp = sortedApps.find(a => a.id === openId)
  const selProject = projects.find(p => p.xeroId === projectId)

  async function deleteApp(a) {
    if (a.status && a.status !== 'draft') { alert('Only draft applications can be deleted.'); return }
    if (!confirm(`Delete draft application ${a.seq} (${a.monthLabel || monthLabel(a.monthKey)})? This cannot be undone.`)) return
    try {
      const d = await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', projectId, id: a.id }) }).then(r => r.json())
      if (d.ok) setApps(d.applications || [])
    } catch { setMsg('Could not delete.') }
  }

  return (
    <>
      <Head><title>Rock Roofing — Applications · v4</title></Head>
      <div style={{ minHeight: '100vh', background: '#f5f6f8' }}>
        <CommercialNav active="/applications" />
        <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Project</label>
            <select value={projectId} onChange={e => pickProject(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #d5d9e0', borderRadius: 8, fontSize: 13, minWidth: 340, background: '#fff' }}>
              <option value="">— Select a project —</option>
              {projects.map(p => <option key={p.xeroId} value={p.xeroId}>{[p.jobNo, p.name].filter(Boolean).join(' — ')}</option>)}
            </select>
            {selProject && <Link href={`/contracted-rates`} style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>Contracted Rates →</Link>}
          </div>

          {!projectId ? (
            <div style={{ background: '#fff', borderRadius: 12, padding: 48, textAlign: 'center', color: '#888', fontSize: 14 }}>Select a project to view or create applications for payment.</div>
          ) : loading ? (
            <div style={{ background: '#fff', borderRadius: 12, padding: 48, textAlign: 'center', color: '#888' }}>Loading…</div>
          ) : openApp ? (
            <ApplicationEditor
              app={openApp}
              prevGross={prevGrossFor(openApp)}
              projectId={projectId}
              me={me}
              trackerVariations={trackerVariations}
              undeliveredPOs={undeliveredPOs}
              onBack={() => { setOpenId(null); load(projectId) }}
              onSaved={(updated) => setApps(a => a.map(x => x.id === updated.id ? updated : x))}
              onVariationChange={(vs) => setTrackerVariations(vs || [])}
            />
          ) : (
            <>
              {msg && <div style={{ fontSize: 12.5, color: msg.includes('Could not') || msg.includes('No ') ? '#dc2626' : '#0f766e', marginBottom: 12 }}>{msg}</div>}

              {/* Create */}
              <div style={{ background: '#fff', borderRadius: 12, padding: 18, marginBottom: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', marginBottom: 10 }}>New application</div>
                {!cr ? (
                  <div style={{ fontSize: 13, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px' }}>
                    No contracted rates for this project yet. <Link href="/contracted-rates" style={{ color: '#b45309', fontWeight: 600 }}>Upload &amp; lock them</Link> first.
                  </div>
                ) : !cr.locked ? (
                  <div style={{ fontSize: 13, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px' }}>
                    The contracted rates aren't locked yet. <Link href="/contracted-rates" style={{ color: '#b45309', fontWeight: 600 }}>Lock them</Link> to base an application on them.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div>
                      <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Application month</label>
                      <input type="month" value={newMonth} onChange={e => setNewMonth(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #d5d9e0', borderRadius: 8, fontSize: 13 }} />
                    </div>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      <div>App date: <strong>{fmtDate(newDates.appDate)}</strong> · Val: <strong>{fmtDate(newDates.valDate)}</strong></div>
                      <div>Payment due: <strong>{fmtDate(newDates.paymentDate)}</strong> · Final: <strong>{fmtDate(newDates.finalDate)}</strong></div>
                      {(!settings.applicationDay && !settings.valuationDay) && <div style={{ color: '#b45309' }}>⚠ Set application/valuation/payment days in Project Details for auto dates.</div>}
                    </div>
                    <div style={{ flex: 1 }} />
                    <button onClick={createApp} disabled={creating} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: creating ? 'default' : 'pointer', opacity: creating ? 0.6 : 1 }}>{creating ? 'Creating…' : 'Create application'}</button>
                  </div>
                )}
              </div>

              {/* Previous applications table */}
              <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ padding: '12px 16px', fontSize: 14, fontWeight: 700, color: '#1a1a2e', borderBottom: '1px solid #eee' }}>Applications</div>
                {sortedApps.length === 0 ? (
                  <div style={{ padding: 24, color: '#aaa', fontSize: 13 }}>No applications yet.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
                        {['App No.', 'Month', 'App date', 'Status', 'Gross to date', 'This cert (net)', ''].map((h, i) => (
                          <th key={i} style={{ padding: '9px 12px', textAlign: i >= 4 && i <= 5 ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedApps.map(a => {
                        const sum = computeApplicationSummary(a, prevGrossForApp(sortedApps, a))
                        return (
                          <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 700 }}>{a.seq}</td>
                            <td style={{ padding: '9px 12px', fontSize: 13 }}>{a.monthLabel || monthLabel(a.monthKey)}</td>
                            <td style={{ padding: '9px 12px', fontSize: 13 }}>{fmtDate(a.appDate)}</td>
                            <td style={{ padding: '9px 12px', fontSize: 12 }}>
                              <span style={{ padding: '2px 8px', borderRadius: 5, fontWeight: 700, fontSize: 11, background: (a.status && a.status !== 'draft') ? '#dcfce7' : '#fef9c3', color: (a.status && a.status !== 'draft') ? '#16a34a' : '#a16207' }}>{(a.status && a.status !== 'draft') ? 'Sent' : 'Draft'}</span>
                            </td>
                            <td style={{ padding: '9px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.grossCurrent)}</td>
                            <td style={{ padding: '9px 12px', fontSize: 13, textAlign: 'right', fontWeight: 700 }}>{fmt(sum.thisCert.total)}</td>
                            <td style={{ padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button onClick={() => setOpenId(a.id)} style={{ background: '#f0f2f5', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#374151', fontWeight: 600 }}>{(a.status && a.status !== 'draft') ? 'View' : 'Open'}</button>
                              {(!a.status || a.status === 'draft') && <button onClick={() => deleteApp(a)} style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', color: '#dc2626', fontWeight: 600, marginLeft: 6 }}>Delete</button>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function prevGrossForApp(sortedApps, app) {
  let prev = null
  for (const a of sortedApps) { if ((a.seq || 0) < (app.seq || 0)) prev = a }
  return prev ? computeApplicationSummary(prev, 0).grossCurrent : 0
}

// ── Application editor ────────────────────────────────────────────────────────
function ApplicationEditor({ app, prevGross, projectId, me, trackerVariations = [], undeliveredPOs = [], onBack, onSaved, onVariationChange }) {
  const [rows, setRows] = useState(() => app.contractWorks.map(r => ({ ...r })))
  // Per-application variation data (pct + attachments), keyed by varKey.
  const [variationData, setVariationData] = useState(() => ({ ...(app.variationData || {}) }))
  const [mats, setMats] = useState(() => (app.materials || []).map(m => ({ ...m })))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [showAddMat, setShowAddMat] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const isSent = !!app.status && app.status !== 'draft'
  const locked = isSent && !unlocked

  // The variation list: live from the tracker for drafts, frozen for sent apps.
  const vars = useMemo(() => buildAppVariations({ ...app, variationData }, trackerVariations), [app, variationData, trackerVariations])

  const workApp = { ...app, contractWorks: rows, variations: vars, materials: mats }
  const sum = useMemo(() => computeApplicationSummary(workApp, prevGross), [rows, vars, mats, prevGross, app.mcdPct, app.retentionPct])

  const setPct = (id, v) => {
    const n = v === '' ? 0 : Math.max(0, Math.min(100, parseFloat(v) || 0))
    setRows(list => list.map(r => r.id === id ? { ...r, pctComplete: n } : r)); setDirty(true)
  }
  // Variations
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
  const varValue = (v) => num(v.materials) + num(v.labour) + num(v.profit)
  const setVarData = (key, patch) => { setVariationData(m => ({ ...m, [key]: { ...(m[key] || {}), ...patch } })); setDirty(true) }
  const setVarPct = (key, v) => { const n = v === '' ? 0 : Math.max(0, Math.min(100, parseFloat(v) || 0)); setVarData(key, { pctComplete: n }) }
  async function attachToVar(key, file) {
    try {
      const { upload } = await import('@vercel/blob/client')
      const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/blob-upload', contentType: file.type || undefined })
      setVarData(key, { attachments: [...((variationData[key] || {}).attachments || []), { name: file.name, url: blob.url, at: Date.now() }] })
    } catch (e) { setMsg('Attachment upload failed: ' + (e?.message || e)) }
  }
  const removeAttachment = (key, url) => setVarData(key, { attachments: ((variationData[key] || {}).attachments || []).filter(a => a.url !== url) })

  // Mark a variation instructed/not from the application — writes to the tracker.
  async function setInstructed(v, value) {
    try {
      const d = await fetch('/api/applications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-variation-instructed', projectId, varNumber: v.varNumber, description: v.description, instructed: value }),
      }).then(r => r.json())
      if (!d.ok) { setMsg(d.error || 'Could not update the variation.'); return }
      setMsg(`Variation ${v.varNumber || ''} marked ${value ? 'instructed' : 'not instructed'} (tracker + budgets updated).`)
      if (onVariationChange) onVariationChange(d.variations)
    } catch { setMsg('Could not update the variation.') }
  }

  // Materials on site
  const addMaterial = (m) => { setMats(l => [...l, { id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, ...m }]); setDirty(true); setShowAddMat(false) }
  const removeMat = (id) => { setMats(l => l.filter(x => x.id !== id)); setDirty(true) }
  const setMatField = (id, field, v) => { setMats(l => l.map(x => x.id === id ? { ...x, [field]: v } : x)); setDirty(true) }

  async function save(submit) {
    setSaving(true); setMsg('')
    try {
      const d = await fetch('/api/applications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', projectId, allowSubmittedEdit: unlocked, application: { ...app, contractWorks: rows, variationData, materials: mats } }),
      }).then(r => r.json())
      if (!d.ok) { setMsg(d.error || 'Save failed.'); setSaving(false); return }
      onSaved(d.application); setDirty(false)
      if (submit) {
        const s = await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', projectId, id: app.id, author: me?.name || '' }) }).then(r => r.json())
        if (s.ok) { onSaved(s.application); setUnlocked(false); setMsg('Marked as sent.') }
      } else setMsg('Saved.')
    } catch { setMsg('Save failed.') }
    setSaving(false)
  }

  const th = { padding: '9px 10px', textAlign: 'left', fontWeight: 700, color: '#6b7280', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }
  const thR = { ...th, textAlign: 'right' }
  const td = { padding: '7px 10px', fontSize: 12.5, verticalAlign: 'middle' }
  const tdR = { ...td, textAlign: 'right' }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 13, cursor: 'pointer' }}>‹ All applications</button>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>Application {app.seq} — {app.monthLabel || monthLabel(app.monthKey)}</div>
        <span style={{ padding: '2px 8px', borderRadius: 5, fontWeight: 700, fontSize: 11, background: isSent ? '#dcfce7' : '#fef9c3', color: isSent ? '#16a34a' : '#a16207' }}>{isSent ? (unlocked ? 'Sent — editing' : 'Sent') : 'Draft'}</span>
        <div style={{ flex: 1 }} />
        {isSent && !unlocked && <span onDoubleClick={() => setUnlocked(true)} title="Double-click to edit" style={{ fontSize: 12, color: '#6b7280', cursor: 'pointer', userSelect: 'none' }}>Double-click here to edit this sent application</span>}
        {!locked && <button onClick={() => save(false)} disabled={saving || !dirty} style={{ background: dirty ? '#0f766e' : '#e5e7eb', color: dirty ? '#fff' : '#9ca3af', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: dirty ? 'pointer' : 'default' }}>{saving ? 'Saving…' : 'Save'}</button>}
        {!locked && !isSent && <button onClick={() => { if (confirm('Mark this application as sent? Variations will be frozen as they are now, and it will be locked (double-click to edit later).')) save(true) }} disabled={saving} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>Mark as sent</button>}
      </div>

      {msg && <div style={{ fontSize: 12.5, color: msg.includes('fail') ? '#dc2626' : '#0f766e', marginBottom: 12 }}>{msg}</div>}

      {/* Dates */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        {[['Application date', app.appDate], ['Valuation date', app.valDate], ['Payment due', app.paymentDate], ['Final date for payment', app.finalDate]].map(([l, v]) => (
          <div key={l} style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{l}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>{fmtDate(v)}</div>
          </div>
        ))}
      </div>

      {/* Contract Works */}
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 16 }}>
        <div style={{ padding: '12px 16px', fontSize: 14, fontWeight: 700, color: '#1a1a2e', borderBottom: '1px solid #eee' }}>Contract Works</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
                <th style={th}>Item</th><th style={th}>Description</th><th style={thR}>Qty</th><th style={th}>Unit</th><th style={thR}>Rate</th><th style={thR}>Total</th><th style={thR}>% Complete</th><th style={thR}>Value to date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                if (r.kind === 'heading') {
                  const hs = r.plainHeading ? { fontWeight: 400 } : { fontWeight: 700, textDecoration: 'underline' }
                  return <tr key={r.id} style={{ background: '#fafafa' }}><td style={td}></td><td style={{ ...td, ...hs, ...(r.red ? { color: '#dc2626' } : {}) }} colSpan={7}>{r.description}</td></tr>
                }
                const fs = { ...(r.bold ? { fontWeight: 700 } : {}), ...(r.underline ? { textDecoration: 'underline' } : {}), ...(r.red ? { color: '#dc2626' } : {}) }
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ ...td, color: '#6b7280', fontWeight: 600 }}>{r.code}</td>
                    <td style={{ ...td, minWidth: 240, whiteSpace: 'normal', ...fs }}>{r.description}</td>
                    <td style={tdR}>{r.qty ?? ''}</td>
                    <td style={td}>{r.unit || ''}</td>
                    <td style={tdR}>{r.rate != null ? Number(r.rate).toLocaleString('en-GB', { minimumFractionDigits: 2 }) : ''}</td>
                    <td style={tdR}>{fmt(r.total)}</td>
                    <td style={tdR}>
                      {locked ? `${r.pctComplete || 0}%` : (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                          <input type="number" min="0" max="100" value={r.pctComplete ?? 0} onChange={e => setPct(r.id, e.target.value)} style={{ width: 58, padding: '4px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 12.5, textAlign: 'right' }} />
                          <button title="Mark 100% complete" onClick={() => setPct(r.id, 100)} style={{ background: (r.pctComplete === 100) ? '#16a34a' : '#f0f2f5', color: (r.pctComplete === 100) ? '#fff' : '#16a34a', border: '1px solid ' + ((r.pctComplete === 100) ? '#16a34a' : '#d1fae5'), borderRadius: 5, padding: '3px 7px', fontSize: 12, cursor: 'pointer', lineHeight: 1 }}>✓</button>
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{fmt(worksValueToDate(r))}</td>
                  </tr>
                )
              })}
              <tr style={{ background: '#f0fdfa', fontWeight: 700, borderTop: '2px solid #99f6e4' }}>
                <td style={td}></td><td style={{ ...td, color: '#0f766e' }} colSpan={4}>TOTAL</td>
                <td style={{ ...tdR, color: '#0f766e' }}>{fmt(sum.measuredContractSum)}</td>
                <td style={td}></td>
                <td style={{ ...tdR, color: '#0f766e' }}>{fmt(sum.measuredToDate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Variations */}
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #eee' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Variations</div>
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 10 }}>All project variations. Not-instructed are shown for information only and don't total.</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
              <th style={th}>VO</th><th style={th}>Description</th><th style={th}>Status</th><th style={thR}>Final value</th><th style={thR}>% Complete</th><th style={thR}>Value to date</th><th style={th}>Docs</th>
            </tr></thead>
            <tbody>
              {vars.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#aaa' }}>No variations on this project.</td></tr>}
              {vars.map(v => {
                const val = varValue(v)
                const instructed = !!v.instructed
                const vtd = instructed ? val * num(v.pctComplete) / 100 : 0
                const greyLine = instructed ? {} : { color: '#9ca3af' }
                return (
                  <tr key={v.key || v.varNumber} style={{ borderBottom: '1px solid #f0f0f0', background: instructed ? '#fff' : '#fbfbfb' }}>
                    <td style={{ ...td, fontWeight: 600, ...(instructed ? { color: '#6b7280' } : greyLine) }}>{v.varNumber || '—'}</td>
                    <td style={{ ...td, minWidth: 240, whiteSpace: 'pre-wrap', ...greyLine }}>{v.description || '—'}</td>
                    <td style={td}>
                      {locked ? (
                        <span style={{ padding: '2px 8px', borderRadius: 5, fontWeight: 700, fontSize: 11, background: instructed ? '#dcfce7' : '#f3f4f6', color: instructed ? '#16a34a' : '#9ca3af' }}>{instructed ? 'Instructed' : 'Not instructed'}</span>
                      ) : (
                        <button onClick={() => setInstructed(v, !instructed)} title="Click to toggle — updates the tracker & budgets"
                          style={{ padding: '3px 9px', borderRadius: 5, fontWeight: 700, fontSize: 11, cursor: 'pointer', border: '1px solid ' + (instructed ? '#86efac' : '#e5e7eb'), background: instructed ? '#dcfce7' : '#f3f4f6', color: instructed ? '#16a34a' : '#9ca3af' }}>
                          {instructed ? 'Instructed' : 'Not instructed'}
                        </button>
                      )}
                    </td>
                    <td style={{ ...tdR, ...greyLine }}>{fmt(val)}</td>
                    <td style={tdR}>
                      {!instructed ? <span style={{ color: '#cbd5e1' }}>—</span> : locked ? `${v.pctComplete || 0}%` : (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                          <input type="number" min="0" max="100" value={v.pctComplete ?? 0} onChange={e => setVarPct(v.key, e.target.value)} style={{ width: 58, padding: '4px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 12.5, textAlign: 'right' }} />
                          <button title="100%" onClick={() => setVarPct(v.key, 100)} style={{ background: v.pctComplete === 100 ? '#16a34a' : '#f0f2f5', color: v.pctComplete === 100 ? '#fff' : '#16a34a', border: '1px solid ' + (v.pctComplete === 100 ? '#16a34a' : '#d1fae5'), borderRadius: 5, padding: '3px 7px', fontSize: 12, cursor: 'pointer', lineHeight: 1 }}>✓</button>
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdR, fontWeight: 600, ...(instructed ? {} : { color: '#cbd5e1', fontWeight: 400 }) }}>{instructed ? fmt(vtd) : 'N/A'}</td>
                    <td style={td}>
                      {(v.attachments || []).map(a => (
                        <div key={a.url} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                          <a href={a.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</a>
                          {!locked && <button onClick={() => removeAttachment(v.key, a.url)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12 }}>×</button>}
                        </div>
                      ))}
                      {!locked && <label style={{ fontSize: 11, color: '#0f766e', cursor: 'pointer' }}>+ Attach<input type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attachToVar(v.key, f) }} /></label>}
                    </td>
                  </tr>
                )
              })}
              <tr style={{ background: '#f8f9fa', fontWeight: 700 }}>
                <td style={td}></td><td style={td} colSpan={2}>TOTAL (instructed only)</td>
                <td style={tdR}>{fmt(sum.variationsFinal)}</td><td style={td}></td>
                <td style={tdR}>{fmt(sum.variationsToDate)}</td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Materials on Site */}
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #eee' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Materials on Site</div>
          <div style={{ flex: 1 }} />
          {!locked && <button onClick={() => setShowAddMat(true)} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>+ Add from POs</button>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
              <th style={th}>Description</th><th style={th}>PO</th><th style={thR}>Qty</th><th style={th}>Unit</th><th style={thR}>Rate</th><th style={thR}>Total</th><th style={thR}></th>
            </tr></thead>
            <tbody>
              {mats.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#aaa' }}>No materials on site added.</td></tr>}
              {mats.map(m => {
                const total = m.total != null ? m.total : (num(m.qty) * num(m.rate))
                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ ...td, minWidth: 220, whiteSpace: 'normal' }}>{m.description}</td>
                    <td style={{ ...td, color: '#6b7280' }}>{m.poNumber || '—'}</td>
                    <td style={tdR}>{locked ? (m.qty ?? '') : <input type="number" value={m.qty ?? ''} onChange={e => setMatField(m.id, 'qty', e.target.value === '' ? null : parseFloat(e.target.value))} style={{ width: 60, padding: '4px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 12.5, textAlign: 'right' }} />}</td>
                    <td style={td}>{m.unit || ''}</td>
                    <td style={tdR}>{locked ? fmt(m.rate || 0) : <input type="number" value={m.rate ?? ''} onChange={e => setMatField(m.id, 'rate', e.target.value === '' ? null : parseFloat(e.target.value))} style={{ width: 80, padding: '4px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 12.5, textAlign: 'right' }} />}</td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{fmt(total)}</td>
                    <td style={tdR}>{!locked && <button onClick={() => removeMat(m.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12 }}>Remove</button>}</td>
                  </tr>
                )
              })}
              <tr style={{ background: '#f8f9fa', fontWeight: 700 }}>
                <td style={td} colSpan={5}>TOTAL</td>
                <td style={tdR}>{fmt(sum.materialsOnSite)}</td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <SummaryBlock sum={sum} app={app} />

      {showAddMat && <AddMaterialsModal pos={undeliveredPOs} onClose={() => setShowAddMat(false)} onAdd={addMaterial} />}
    </>
  )
}

function SummaryBlock({ sum, app }) {
  const row = (label, c) => (
    <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
      <td style={{ padding: '8px 12px', fontSize: 13 }}>{label}</td>
      <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(c.gross ?? c)}</td>
      <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(c.mcd ?? 0)}</td>
      <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(c.subTotal ?? 0)}</td>
      <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(c.retention ?? 0)}</td>
      <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right', fontWeight: 700 }}>{fmt(c.total ?? 0)}</td>
    </tr>
  )
  const th = { padding: '9px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      {/* top block */}
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <div style={{ padding: '12px 16px', fontSize: 14, fontWeight: 700, color: '#1a1a2e', borderBottom: '1px solid #eee' }}>Summary</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f8f9fa' }}><th style={{ ...th, textAlign: 'left' }}></th><th style={th}>Contract Sum</th><th style={th}>Application Total</th><th style={th}>Proj. Final Account</th></tr></thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}><td style={{ padding: '8px 12px', fontSize: 13 }}>Measured Work</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.measuredContractSum)}</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.measuredToDate)}</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.measuredContractSum)}</td></tr>
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}><td style={{ padding: '8px 12px', fontSize: 13 }}>Variations</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>—</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.variationsToDate)}</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.variationsFinal)}</td></tr>
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}><td style={{ padding: '8px 12px', fontSize: 13 }}>Materials On Site</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>—</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.materialsOnSite)}</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>—</td></tr>
            <tr style={{ background: '#f8f9fa', fontWeight: 700 }}><td style={{ padding: '8px 12px', fontSize: 13 }}>Application Total</td><td style={{ padding: '8px 12px' }}></td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.applicationTotal)}</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.anticipatedFinalAccount)}</td></tr>
          </tbody>
        </table>
      </div>
      {/* certificate block */}
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <div style={{ padding: '12px 16px', fontSize: 14, fontWeight: 700, color: '#1a1a2e', borderBottom: '1px solid #eee' }}>Certificate</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f8f9fa' }}><th style={{ ...th, textAlign: 'left' }}></th><th style={th}>Current</th><th style={th}>Previously Cert</th><th style={th}>This Cert</th></tr></thead>
          <tbody>
            {[['Gross', 'gross'], [`MCD @ ${app.mcdPct}%`, 'mcd'], ['Sub-Total', 'subTotal'], [`Retention @ ${app.retentionPct}%`, 'retention'], ['Total', 'total']].map(([label, key]) => (
              <tr key={key} style={{ borderBottom: '1px solid #f0f0f0', ...(key === 'total' ? { background: '#f8f9fa', fontWeight: 700 } : {}) }}>
                <td style={{ padding: '8px 12px', fontSize: 13 }}>{label}</td>
                <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.current[key])}</td>
                <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.previously[key])}</td>
                <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right', fontWeight: 700 }}>{fmt(sum.thisCert[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Pick variations from the project's tracker to add to the application.
function AddMaterialsModal({ pos, onClose, onAdd }) {
  const money = (v) => '£' + (Number(v) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const flat = []
  ;(pos || []).forEach((p, pi) => (p.lineItems || []).forEach((li, li2) => flat.push({ key: `${pi}_${li2}`, poNumber: p.poNumber, supplier: p.supplier, description: li.description, qty: li.quantity, unit: li.unit, rate: li.rate })))
  const [manual, setManual] = useState({ description: '', qty: '', unit: '', rate: '' })
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: 640, maxWidth: '100%', maxHeight: '86vh', overflow: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e', marginBottom: 4 }}>Add materials on site</div>
        <div style={{ fontSize: 12.5, color: '#777', marginBottom: 14 }}>From purchase orders not yet delivered. Click one to add it, or enter a manual line.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {flat.length === 0 && <div style={{ fontSize: 13, color: '#aaa' }}>No undelivered PO lines found for this project.</div>}
          {flat.map(f => (
            <button key={f.key} onClick={() => onAdd({ description: f.description, poNumber: f.poNumber, qty: f.qty, unit: f.unit, rate: f.rate })} style={{ textAlign: 'left', background: '#f8f9fa', border: '1px solid #eee', borderRadius: 8, padding: 10, cursor: 'pointer' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{f.description || '(no description)'}</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{f.poNumber} · {f.supplier}{f.qty ? ` · qty ${f.qty}${f.unit ? ' ' + f.unit : ''}` : ''}{f.rate ? ` · ${money(f.rate)}` : ''}</div>
            </button>
          ))}
        </div>
        <div style={{ borderTop: '1px solid #eee', paddingTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 8 }}>OR ADD MANUALLY</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.7fr 0.7fr 0.9fr', gap: 8, marginBottom: 10 }}>
            <input value={manual.description} onChange={e => setManual(m => ({ ...m, description: e.target.value }))} placeholder="Description" style={{ padding: '7px 9px', border: '1px solid #d5d9e0', borderRadius: 6, fontSize: 12.5 }} />
            <input value={manual.qty} onChange={e => setManual(m => ({ ...m, qty: e.target.value }))} placeholder="Qty" type="number" style={{ padding: '7px 9px', border: '1px solid #d5d9e0', borderRadius: 6, fontSize: 12.5 }} />
            <input value={manual.unit} onChange={e => setManual(m => ({ ...m, unit: e.target.value }))} placeholder="Unit" style={{ padding: '7px 9px', border: '1px solid #d5d9e0', borderRadius: 6, fontSize: 12.5 }} />
            <input value={manual.rate} onChange={e => setManual(m => ({ ...m, rate: e.target.value }))} placeholder="Rate" type="number" style={{ padding: '7px 9px', border: '1px solid #d5d9e0', borderRadius: 6, fontSize: 12.5 }} />
          </div>
          <button onClick={() => { if (manual.description) onAdd({ description: manual.description, qty: manual.qty === '' ? null : parseFloat(manual.qty), unit: manual.unit, rate: manual.rate === '' ? null : parseFloat(manual.rate) }) }} disabled={!manual.description} style={{ background: manual.description ? '#0f766e' : '#e5e7eb', color: manual.description ? '#fff' : '#9ca3af', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: manual.description ? 'pointer' : 'default' }}>Add manual line</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} style={{ background: '#fff', color: '#666', border: '1px solid #e5e5e5', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>Done</button>
        </div>
      </div>
    </div>
  )
}
