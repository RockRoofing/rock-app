import { useState, useEffect, useMemo } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import CommercialNav from '../components/CommercialNav'
import { computeApplicationSummary, worksValueToDate, resolveAppDates, buildAppVariations, materialLineTotal, materialValueToDate } from '../lib/applications'

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
  const [projectPOs, setProjectPOs] = useState([])
  const [hiddenPOs, setHiddenPOs] = useState([])
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
      setProjectPOs(d.projectPOs || [])
      setHiddenPOs(d.hiddenPOs || [])
    } catch { setMsg('Could not load applications.') }
    setLoading(false)
  }
  function pickProject(pid) { setProjectId(pid); setOpenId(null); load(pid) }

  // Sorted, and previous-gross lookup (by seq) for carry-forward.
  const sortedApps = useMemo(() => [...apps].sort((a, b) => (a.seq || 0) - (b.seq || 0)), [apps])

  // Default the new-application month to the month AFTER the latest application.
  useEffect(() => {
    if (!sortedApps.length) return
    const last = sortedApps[sortedApps.length - 1]
    if (!last.monthKey) return
    const [y, m] = last.monthKey.split('-').map(Number)
    if (!y || !m) return
    const d = new Date(y, m, 1) // next month
    setNewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }, [sortedApps])
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
      <Head><title>Rock Roofing — Applications · v8</title></Head>
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
            <UpcomingTable onOpen={pickProject} />
          ) : loading ? (
            <div style={{ background: '#fff', borderRadius: 12, padding: 48, textAlign: 'center', color: '#888' }}>Loading…</div>
          ) : openApp ? (
            <ApplicationEditor
              app={openApp}
              prevGross={prevGrossFor(openApp)}
              projectId={projectId}
              me={me}
              trackerVariations={trackerVariations}
              projectPOs={projectPOs}
              hiddenPOs={hiddenPOs}
              onHiddenPOsChange={setHiddenPOs}
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

// Landing table: the NEXT application per project, colour-coded by due date.
function UpcomingTable({ onOpen }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { (async () => {
    try { const d = await fetch('/api/applications?upcoming=1').then(r => r.json()); setRows(d.upcoming || []) }
    catch { setRows([]) }
  })() }, [])

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dueInfo = (iso) => {
    if (!iso) return { label: '—', color: '#9ca3af', bg: '#f3f4f6', days: null }
    const d = new Date(iso + 'T00:00:00'); d.setHours(0, 0, 0, 0)
    const days = Math.round((d - today) / 86400000)
    if (days < 0) return { color: '#dc2626', bg: '#fee2e2', days }        // overdue - red
    if (days === 0) return { color: '#16a34a', bg: '#dcfce7', days }      // due today - green
    if (days <= 3) return { color: '#c2410c', bg: '#ffedd5', days }       // within 3 days - orange
    return { color: '#6b7280', bg: '#f3f4f6', days }                      // not yet due - grey
  }
  const fmtD = (s) => { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }

  const KeyDot = ({ c, label }) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555' }}><span style={{ width: 12, height: 12, borderRadius: 3, background: c, display: 'inline-block' }} />{label}</span>

  return (
    <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 16px', borderBottom: '1px solid #eee', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Upcoming applications</div>
        <div style={{ flex: 1 }} />
        <KeyDot c="#f3f4f6" label="Not yet due" />
        <KeyDot c="#ffedd5" label="Within 3 days" />
        <KeyDot c="#dcfce7" label="Due today" />
        <KeyDot c="#fee2e2" label="Overdue" />
      </div>
      {rows === null ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#aaa' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888', fontSize: 14 }}>No applications yet. Select a project above to create one.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
            {['Project', 'Next app', 'Month', 'Application date', 'Status', ''].map((h, i) => (
              <th key={i} style={{ padding: '9px 14px', textAlign: i === 5 ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const di = dueInfo(r.nextDate)
              return (
                <tr key={r.xeroId} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '9px 14px', fontSize: 13, fontWeight: 600 }}>{[r.jobNo, r.name].filter(Boolean).join(' — ') || r.xeroId}</td>
                  <td style={{ padding: '9px 14px', fontSize: 13 }}>{r.nextSeq}</td>
                  <td style={{ padding: '9px 14px', fontSize: 13 }}>{r.nextMonthLabel || '—'}</td>
                  <td style={{ padding: '9px 14px' }}>
                    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 6, fontSize: 12.5, fontWeight: 700, background: di.bg, color: di.color }}>
                      {fmtD(r.nextDate)}{di.days != null && di.days !== 0 ? ` (${di.days < 0 ? `${-di.days}d overdue` : `in ${di.days}d`})` : di.days === 0 ? ' (today)' : ''}
                    </span>
                  </td>
                  <td style={{ padding: '9px 14px', fontSize: 12 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 5, fontWeight: 700, fontSize: 11, background: r.status === 'draft' ? '#fef9c3' : '#eef2ff', color: r.status === 'draft' ? '#a16207' : '#4f46e5' }}>{r.status === 'draft' ? 'Draft ready' : 'Due to raise'}</span>
                  </td>
                  <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                    <button onClick={() => onOpen(r.xeroId)} style={{ background: '#f0f2f5', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#374151', fontWeight: 600 }}>Open</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Application editor ────────────────────────────────────────────────────────
function ApplicationEditor({ app, prevGross, projectId, me, trackerVariations = [], projectPOs = [], hiddenPOs = [], onHiddenPOsChange, onBack, onSaved, onVariationChange }) {
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
  const addMaterial = (m) => { setMats(l => [...l, { id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, kind: 'item', pctComplete: 100, ...m }]); setDirty(true) }
  // Add a whole PO group: a supplier heading row + its item lines beneath it.
  const addMaterialGroup = ({ supplier, poNumber, markupPct, lines }) => {
    const gid = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
    const group = { id: gid, kind: 'group', supplier: supplier || '', poNumber: poNumber || '', attachments: [] }
    const items = (lines || []).map((li, i) => ({ id: `mat_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 4)}`, kind: 'item', groupId: gid, pctComplete: 100, description: li.description, poNumber, qty: li.quantity, unit: li.unit, rate: li.rate, markupPct: markupPct || 0 }))
    setMats(l => [...l, group, ...items]); setDirty(true)
  }
  async function attachToGroup(gid, file) {
    try {
      const { upload } = await import('@vercel/blob/client')
      const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/blob-upload', contentType: file.type || undefined })
      setMats(l => l.map(x => x.id === gid ? { ...x, attachments: [...(x.attachments || []), { name: file.name, url: blob.url, at: Date.now() }] } : x)); setDirty(true)
    } catch (e) { setMsg('Attachment upload failed: ' + (e?.message || e)) }
  }
  const removeGroupAttachment = (gid, url) => { setMats(l => l.map(x => x.id === gid ? { ...x, attachments: (x.attachments || []).filter(a => a.url !== url) } : x)); setDirty(true) }
  const removeGroup = (gid) => { setMats(l => l.filter(x => x.id !== gid && x.groupId !== gid)); setDirty(true) }
  // PO numbers currently on the application (via a supplier group) — used to block
  // adding the same PO twice at once, and to show it ticked/green in the picker.
  const addedPONumbers = mats.filter(m => m.kind === 'group' && m.poNumber).map(m => m.poNumber)
  // Hide/unhide a PO from the picker (persisted per project).
  async function toggleHidePO(poNumber) {
    const next = hiddenPOs.includes(poNumber) ? hiddenPOs.filter(x => x !== poNumber) : [...hiddenPOs, poNumber]
    if (onHiddenPOsChange) onHiddenPOsChange(next)
    try { await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-hidden-pos', projectId, hiddenPOs: next }) }) } catch {}
  }
  const removeMat = (id) => { setMats(l => l.filter(x => x.id !== id)); setDirty(true) }
  const setMatField = (id, field, v) => { setMats(l => l.map(x => x.id === id ? { ...x, [field]: v } : x)); setDirty(true) }
  const setMatPct = (id, v) => { const n = v === '' ? 0 : Math.max(0, Math.min(100, parseFloat(v) || 0)); setMatField(id, 'pctComplete', n) }
  // Apply one mark-up % to ALL material lines at once.
  const bulkMarkupAll = (v) => { const n = v === '' ? 0 : parseFloat(v) || 0; setMats(l => l.map(x => ({ ...x, markupPct: n }))); setDirty(true) }

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
                        <span style={{ padding: '2px 8px', borderRadius: 5, fontWeight: 700, fontSize: 11, background: instructed ? '#dcfce7' : '#ffedd5', color: instructed ? '#16a34a' : '#c2410c' }}>{instructed ? 'Instructed' : 'Not instructed'}</span>
                      ) : (
                        <button onClick={() => setInstructed(v, !instructed)} title="Click to toggle — updates the tracker & budgets"
                          style={{ padding: '3px 9px', borderRadius: 5, fontWeight: 700, fontSize: 11, cursor: 'pointer', border: '1px solid ' + (instructed ? '#86efac' : '#fdba74'), background: instructed ? '#dcfce7' : '#ffedd5', color: instructed ? '#16a34a' : '#c2410c' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #eee', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Materials on Site</div>
          <div style={{ flex: 1 }} />
          {!locked && mats.length > 0 && (
            <label style={{ fontSize: 12, color: '#c2410c', display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 7, padding: '5px 10px' }}>
              Mark-up all
              <input type="number" placeholder="%" onChange={e => bulkMarkupAll(e.target.value)} style={{ width: 60, padding: '4px 6px', border: '1px solid #fdba74', borderRadius: 5, fontSize: 12.5, textAlign: 'right' }} />%
            </label>
          )}
          {!locked && <button onClick={() => setShowAddMat(true)} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>+ Add from POs</button>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
              <th style={th}>Description</th><th style={th}>PO</th><th style={thR}>Qty</th><th style={th}>Unit</th><th style={thR}>Rate</th><th style={thR}>Net</th><th style={thR} title="Internal only — hidden on the customer copy">Mark-up %</th><th style={thR}>Total</th><th style={thR}>% Claimed</th><th style={thR}>Value to date</th><th style={thR}></th>
            </tr></thead>
            <tbody>
              {mats.length === 0 && <tr><td colSpan={11} style={{ ...td, color: '#aaa' }}>No materials on site added.</td></tr>}
              {mats.map(m => {
                if (m.kind === 'group') {
                  return (
                    <tr key={m.id} style={{ background: '#f0f9ff', borderTop: '2px solid #bae6fd' }}>
                      <td colSpan={11} style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: '#0369a1' }}>{m.supplier || 'Supplier'}</span>
                          {m.poNumber && <span style={{ fontSize: 11, color: '#6b7280' }}>{m.poNumber}</span>}
                          {(m.attachments || []).map(a => (
                            <span key={a.url} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                              <a href={a.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none' }}>📎 {a.name}</a>
                              {!locked && <button onClick={() => removeGroupAttachment(m.id, a.url)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12 }}>×</button>}
                            </span>
                          ))}
                          {!locked && <label style={{ fontSize: 11, color: '#0f766e', cursor: 'pointer' }}>+ Attach doc<input type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attachToGroup(m.id, f) }} /></label>}
                          <div style={{ flex: 1 }} />
                          {!locked && <button onClick={() => removeGroup(m.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11 }}>Remove group</button>}
                        </div>
                      </td>
                    </tr>
                  )
                }
                const netTotal = m.total != null ? num(m.total) : (num(m.qty) * num(m.rate))
                const total = materialLineTotal(m)
                const pct = m.pctComplete == null ? 100 : m.pctComplete
                const vtd = materialValueToDate(m)
                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ ...td, minWidth: 180, whiteSpace: 'normal' }}>{m.description}</td>
                    <td style={{ ...td, color: '#6b7280' }}>{m.poNumber || '—'}</td>
                    <td style={tdR}>{locked ? (m.qty ?? '') : <input type="number" value={m.qty ?? ''} onChange={e => setMatField(m.id, 'qty', e.target.value === '' ? null : parseFloat(e.target.value))} style={{ width: 52, padding: '4px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 12.5, textAlign: 'right' }} />}</td>
                    <td style={td}>{m.unit || ''}</td>
                    <td style={tdR}>{locked ? fmt(m.rate || 0) : <input type="number" value={m.rate ?? ''} onChange={e => setMatField(m.id, 'rate', e.target.value === '' ? null : parseFloat(e.target.value))} style={{ width: 72, padding: '4px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 12.5, textAlign: 'right' }} />}</td>
                    <td style={tdR}>{fmt(netTotal)}</td>
                    <td style={{ ...tdR, background: '#fff7ed' }} title="Internal only — hidden on the customer copy">{locked ? `${m.markupPct || 0}%` : (
                      <input type="number" value={m.markupPct ?? 0} onChange={e => setMatField(m.id, 'markupPct', e.target.value === '' ? 0 : parseFloat(e.target.value))} style={{ width: 52, padding: '4px 6px', border: '1px solid #fdba74', borderRadius: 5, fontSize: 12.5, textAlign: 'right', background: '#fff' }} />
                    )}</td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{fmt(total)}</td>
                    <td style={tdR}>{locked ? `${pct}%` : (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                        <input type="number" min="0" max="100" value={pct} onChange={e => setMatPct(m.id, e.target.value)} style={{ width: 52, padding: '4px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 12.5, textAlign: 'right' }} />
                        <button title="100%" onClick={() => setMatPct(m.id, 100)} style={{ background: pct === 100 ? '#16a34a' : '#f0f2f5', color: pct === 100 ? '#fff' : '#16a34a', border: '1px solid ' + (pct === 100 ? '#16a34a' : '#d1fae5'), borderRadius: 5, padding: '3px 7px', fontSize: 12, cursor: 'pointer', lineHeight: 1 }}>✓</button>
                      </div>
                    )}</td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{fmt(vtd)}</td>
                    <td style={tdR}>{!locked && <button onClick={() => removeMat(m.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12 }}>Remove</button>}</td>
                  </tr>
                )
              })}
              <tr style={{ background: '#f8f9fa', fontWeight: 700 }}>
                <td style={td} colSpan={7}>TOTAL</td>
                <td style={tdR}>{fmt(sum.materialsFinal)}</td>
                <td style={td}></td>
                <td style={tdR}>{fmt(sum.materialsOnSite)}</td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', padding: '8px 16px' }}>The mark-up column (shaded) is internal only — it won't appear on the copy sent to the customer, but the marked-up Total will. "Value to date" (% claimed × total) is what's certified this application.</div>
      </div>

      {/* Summary */}
      <SummaryBlock sum={sum} app={app} />

      {showAddMat && <AddMaterialsModal pos={projectPOs} addedPONumbers={addedPONumbers} hiddenPOs={hiddenPOs} onToggleHide={toggleHidePO} onClose={() => setShowAddMat(false)} onAdd={addMaterial} onAddGroup={addMaterialGroup} />}
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
function AddMaterialsModal({ pos, addedPONumbers = [], hiddenPOs = [], onToggleHide, onClose, onAdd, onAddGroup }) {
  const money = (v) => '£' + (Number(v) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const [markups, setMarkups] = useState({})
  const [manual, setManual] = useState({ description: '', qty: '', unit: '', rate: '', markupPct: '' })
  const [showHidden, setShowHidden] = useState(false)
  const mk = (poNumber) => (markups[poNumber] === '' || markups[poNumber] == null) ? 0 : parseFloat(markups[poNumber]) || 0
  const isAdded = (po) => addedPONumbers.includes(po)
  const isHidden = (po) => hiddenPOs.includes(po)
  const visiblePos = (pos || []).filter(p => !isHidden(p.poNumber))
  const hiddenList = (pos || []).filter(p => isHidden(p.poNumber))

  const renderPO = (p, pi) => {
    const m = mk(p.poNumber)
    const factor = 1 + m / 100
    const added = isAdded(p.poNumber)
    return (
      <div key={p.poNumber || pi} style={{ border: '1px solid ' + (added ? '#86efac' : '#e5e7eb'), borderRadius: 10, overflow: 'hidden', background: added ? '#f0fdf4' : '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: added ? '#dcfce7' : '#f8f9fa', padding: '10px 12px', flexWrap: 'wrap' }}>
          {added && <span style={{ color: '#16a34a', fontWeight: 700 }}>✓</span>}
          <div style={{ fontWeight: 700, fontSize: 13 }}>{p.poNumber || '(no PO no.)'}</div>
          <div style={{ fontSize: 12, color: '#666' }}>{p.supplier}</div>
          <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 5, background: p.delivered ? '#dcfce7' : '#fef9c3', color: p.delivered ? '#16a34a' : '#a16207' }}>{p.delivered ? 'Delivered' : 'Not delivered'}</span>
          {added && <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>Added</span>}
          <div style={{ flex: 1 }} />
          <label style={{ fontSize: 11, color: '#c2410c', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            Mark-up
            <input type="number" value={markups[p.poNumber] ?? ''} placeholder="0" onChange={e => setMarkups(s => ({ ...s, [p.poNumber]: e.target.value }))} style={{ width: 54, padding: '4px 6px', border: '1px solid #fdba74', borderRadius: 5, fontSize: 12, textAlign: 'right' }} />%
          </label>
          <button disabled={added} onClick={() => onAddGroup({ supplier: p.supplier, poNumber: p.poNumber, markupPct: m, lines: (p.lineItems || []) })} style={{ background: added ? '#e5e7eb' : '#0f766e', color: added ? '#9ca3af' : '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 11.5, fontWeight: 700, cursor: added ? 'default' : 'pointer' }}>{added ? 'Added' : 'Add all lines'}</button>
          <button onClick={() => onToggleHide(p.poNumber)} title={isHidden(p.poNumber) ? 'Unhide' : 'Hide this PO from the list'} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 9px', fontSize: 11, cursor: 'pointer', color: '#6b7280' }}>{isHidden(p.poNumber) ? 'Unhide' : 'Hide'}</button>
        </div>
        {!added && (
          <div style={{ padding: '6px 0' }}>
            {(p.lineItems || []).length === 0 && <div style={{ fontSize: 12, color: '#aaa', padding: '4px 12px' }}>No line items on this PO.</div>}
            {(p.lineItems || []).map((li, li2) => {
              const net = (parseFloat(li.quantity) || 0) * (parseFloat(li.rate) || 0)
              return (
                <div key={li2} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderTop: li2 ? '1px solid #f3f4f6' : 'none' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5 }}>{li.description || '(no description)'}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{li.quantity != null ? `qty ${li.quantity}${li.unit ? ' ' + li.unit : ''}` : ''}{li.rate != null ? ` · ${money(li.rate)}` : ''}{net ? ` · net ${money(net)}` : ''}{m ? ` · +${m}% → ${money(net * factor)}` : ''}</div>
                  </div>
                  <button onClick={() => onAdd({ description: li.description, poNumber: p.poNumber, qty: li.quantity, unit: li.unit, rate: li.rate, markupPct: m })} style={{ background: '#f0f2f5', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer', color: '#374151', fontWeight: 600 }}>Add</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: 760, maxWidth: '100%', maxHeight: '88vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>Add materials on site</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Done</button>
        </div>
        <div style={{ fontSize: 12.5, color: '#777', margin: '4px 0 14px' }}>All POs for this project (latest first). Add whole POs or individual lines — the window stays open so you can add several. Added POs show green with a tick. Hide POs you've finished with; they stay hidden next time.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {visiblePos.length === 0 && <div style={{ fontSize: 13, color: '#aaa' }}>No purchase orders to show{hiddenList.length ? ' (all hidden).' : ' for this project.'}</div>}
          {visiblePos.map((p, pi) => renderPO(p, pi))}
        </div>

        {hiddenList.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <button onClick={() => setShowHidden(s => !s)} style={{ background: '#f8f9fa', border: '1px solid #e5e7eb', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#6b7280' }}>{showHidden ? '▲ Hide' : `▼ Show ${hiddenList.length} hidden PO${hiddenList.length === 1 ? '' : 's'}`}</button>
            {showHidden && <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>{hiddenList.map((p, pi) => renderPO(p, `h${pi}`))}</div>}
          </div>
        )}

        <div style={{ borderTop: '1px solid #eee', paddingTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 8 }}>OR ADD MANUALLY</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.6fr 0.6fr 0.8fr 0.7fr', gap: 8, marginBottom: 10 }}>
            <input value={manual.description} onChange={e => setManual(m => ({ ...m, description: e.target.value }))} placeholder="Description" style={{ padding: '7px 9px', border: '1px solid #d5d9e0', borderRadius: 6, fontSize: 12.5 }} />
            <input value={manual.qty} onChange={e => setManual(m => ({ ...m, qty: e.target.value }))} placeholder="Qty" type="number" style={{ padding: '7px 9px', border: '1px solid #d5d9e0', borderRadius: 6, fontSize: 12.5 }} />
            <input value={manual.unit} onChange={e => setManual(m => ({ ...m, unit: e.target.value }))} placeholder="Unit" style={{ padding: '7px 9px', border: '1px solid #d5d9e0', borderRadius: 6, fontSize: 12.5 }} />
            <input value={manual.rate} onChange={e => setManual(m => ({ ...m, rate: e.target.value }))} placeholder="Rate" type="number" style={{ padding: '7px 9px', border: '1px solid #d5d9e0', borderRadius: 6, fontSize: 12.5 }} />
            <input value={manual.markupPct} onChange={e => setManual(m => ({ ...m, markupPct: e.target.value }))} placeholder="MU %" type="number" style={{ padding: '7px 9px', border: '1px solid #fdba74', borderRadius: 6, fontSize: 12.5 }} />
          </div>
          <button onClick={() => { if (manual.description) { onAdd({ description: manual.description, qty: manual.qty === '' ? null : parseFloat(manual.qty), unit: manual.unit, rate: manual.rate === '' ? null : parseFloat(manual.rate), markupPct: manual.markupPct === '' ? 0 : parseFloat(manual.markupPct) }); setManual({ description: '', qty: '', unit: '', rate: '', markupPct: '' }) } }} disabled={!manual.description} style={{ background: manual.description ? '#0f766e' : '#e5e7eb', color: manual.description ? '#fff' : '#9ca3af', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: manual.description ? 'pointer' : 'default' }}>Add manual line</button>
        </div>
      </div>
    </div>
  )
}
