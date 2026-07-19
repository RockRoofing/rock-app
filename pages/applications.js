import { useState, useEffect, useMemo } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import CommercialNav from '../components/CommercialNav'
import ProjectDatesModal from '../components/ProjectDatesModal'
import { computeApplicationSummary, worksValueToDate, resolveAppDates, buildAppVariations, materialLineTotal, materialValueToDate, isMeasurableWorks } from '../lib/applications'

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
  const [upcoming, setUpcoming] = useState({ dated: [], missing: [], loading: true })
  const [datesModal, setDatesModal] = useState(null) // { xeroId, jobNo, name }
  const [openId, setOpenId] = useState(null)     // application being edited
  const [msg, setMsg] = useState('')
  const [creating, setCreating] = useState(false)
  const [newMonth, setNewMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })

  const loadUpcoming = async () => {
    try {
      const [d, hiddenRes, sumRes] = await Promise.all([
        fetch('/api/dashboard').then(r => r.json()).catch(() => ({})),
        fetch('/api/hidden-projects').then(r => r.json()).catch(() => ({})),
        fetch('/api/applications?upcoming=1').then(r => r.json()).catch(() => ({})),
      ])
      const hidden = new Set((hiddenRes.hidden || []).map(String))
      const summary = sumRes.summary || {}
      const inProgress = (d.projects || []).filter(p => p.status === 'INPROGRESS' && !hidden.has(String(p.xeroId)))
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const horizon = new Date(today); horizon.setDate(horizon.getDate() + 31)
      const getDateForMonth = (project, dayField, year, month, overrideField) => {
        const monthKey = `${year}-${String(month).padStart(2, '0')}`
        const ov = (project.dateOverrides || {})[monthKey]?.[overrideField]
        if (ov) return ov
        const day = parseInt(project[dayField]); if (!day || isNaN(day)) return null
        const dim = new Date(year, month, 0).getDate()
        return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, dim)).padStart(2, '0')}`
      }
      const statusOf = (s, monthKey) => {
        const crStatus = s.crStatus || 'ok'
        const nextSeq = s.hasDraft ? s.draftSeq : (s.nextSeq || 1)
        let status = s.hasDraft ? 'draft' : 'upcoming'
        if (monthKey && (s.dismissed || []).includes(monthKey)) status = 'dismissed'
        return { crStatus, nextSeq, status }
      }
      const dated = [], missing = []
      for (const p of inProgress) {
        const s = summary[String(p.xeroId)] || {}
        const hasDays = !!(parseInt(p.applicationDay) || Object.keys(p.dateOverrides || {}).length)

        // An overdue draft (an application not yet marked as sent, whose application
        // date has passed) should still show even though it's outside the 31-day
        // forward window. Use the draft's stored date, else recompute it from the
        // draft's month + the project's day settings.
        let draftAppIso = s.hasDraft ? (s.draftAppDate || '') : ''
        let draftValIso = s.hasDraft ? (s.draftValDate || '') : ''
        if (s.hasDraft && !draftAppIso && s.draftMonthKey) {
          const [dy, dm] = String(s.draftMonthKey).split('-').map(Number)
          if (dy && dm) {
            draftAppIso = getDateForMonth(p, 'applicationDay', dy, dm, 'applicationDate') || ''
            draftValIso = draftValIso || getDateForMonth(p, 'valuationDay', dy, dm, 'valuationDate') || ''
          }
        }
        const draftOverdue = !!(draftAppIso && new Date(draftAppIso + 'T00:00:00') < today)

        if (!hasDays && !draftOverdue) { missing.push({ xeroId: String(p.xeroId), jobNo: p.jobNo, name: p.name }); continue }

        // Find the next application date within the horizon (this month / next).
        let found = null
        for (let i = 0; i <= 1; i++) {
          const dt = new Date(today.getFullYear(), today.getMonth() + i, 1)
          const iso = getDateForMonth(p, 'applicationDay', dt.getFullYear(), dt.getMonth() + 1, 'applicationDate')
          if (!iso) continue
          if (new Date(iso + 'T00:00:00') > horizon) continue
          const valIso = getDateForMonth(p, 'valuationDay', dt.getFullYear(), dt.getMonth() + 1, 'valuationDate')
          const cand = { iso, valIso, monthKey: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` }
          if (!found || iso < found.iso) found = cand
        }

        // An overdue draft surfaces with its own dates.
        if (draftOverdue) {
          const mk = s.draftMonthKey || (draftAppIso ? draftAppIso.slice(0, 7) : '')
          dated.push({ xeroId: String(p.xeroId), jobNo: p.jobNo, name: p.name, appDate: draftAppIso, valDate: draftValIso, monthKey: mk, ...statusOf(s, mk) })
          continue
        }
        if (!found) continue
        dated.push({ xeroId: String(p.xeroId), jobNo: p.jobNo, name: p.name, appDate: found.iso, valDate: found.valIso || '', monthKey: found.monthKey, ...statusOf(s, found.monthKey) })
      }
      dated.sort((a, b) => (a.appDate || '').localeCompare(b.appDate || ''))
      setUpcoming({ dated, missing, loading: false })
    } catch { setUpcoming({ dated: [], missing: [], loading: false }) }
  }

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
    loadUpcoming()
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
  // Customer-facing application number: the permanent appNumber once sent, else the
  // NEXT number for a never-sent draft = (highest sent number) + 1.
  const maxSentNumber = useMemo(() => apps.reduce((m, a) => (a.appNumber ? Math.max(m, a.appNumber) : m), 0), [apps])
  const appNumberFor = (a) => a && a.appNumber ? a.appNumber : (maxSentNumber + 1)

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
    if (!confirm(`Delete draft application ${appNumberFor(a)} (${a.monthLabel || monthLabel(a.monthKey)})? This cannot be undone.`)) return
    try {
      const d = await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', projectId, id: a.id }) }).then(r => r.json())
      if (d.ok) setApps(d.applications || [])
    } catch { setMsg('Could not delete.') }
  }

  return (
    <>
      <Head><title>Rock Roofing — Applications · v23</title></Head>
      <div style={{ minHeight: '100vh', background: '#f5f6f8' }}>
        <CommercialNav active="/applications" />
        <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Select Project — Upcoming Applications</label>
            <select value={projectId} onChange={e => pickProject(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #d5d9e0', borderRadius: 8, fontSize: 13, minWidth: 340, background: '#fff' }}>
              <option value="">— Select a project —</option>
              {projects.map(p => <option key={p.xeroId} value={p.xeroId}>{[p.jobNo, p.name].filter(Boolean).join(' — ')}</option>)}
            </select>
            {selProject && <Link href={`/contracted-rates`} style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>Contracted Rates →</Link>}
          </div>

          {!projectId && upcoming.missing.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
              <span style={{ fontWeight: 700, marginRight: 8 }}>⚠ Missing dates:</span>
              {upcoming.missing.map((r, i) => (
                <span key={r.xeroId}>
                  <button onClick={() => setDatesModal({ xeroId: r.xeroId, jobNo: r.jobNo, name: r.name })} style={{ background: 'none', border: 'none', color: '#92400e', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0 }}>{[r.jobNo, r.name].filter(Boolean).join(' — ')}</button>
                  {i < upcoming.missing.length - 1 ? <span style={{ margin: '0 6px', color: '#b45309' }}>·</span> : null}
                </span>
              ))}
            </div>
          )}

          {!projectId ? (
            <UpcomingTable rows={upcoming.dated} loading={upcoming.loading} onOpen={pickProject} onDismissed={(id) => setUpcoming(u => ({ ...u, dated: u.dated.map(x => x.xeroId === id ? { ...x, status: 'dismissed' } : x) }))} />
          ) : loading ? (
            <div style={{ background: '#fff', borderRadius: 12, padding: 48, textAlign: 'center', color: '#888' }}>Loading…</div>
          ) : openApp ? (
            <ApplicationEditor
              app={openApp}
              appNumber={appNumberFor(openApp)}
              prevGross={prevGrossFor(openApp)}
              projectId={projectId}
              me={me}
              settings={settings}
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
                            <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 700 }}>{appNumberFor(a)}</td>
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
      {datesModal && <ProjectDatesModal project={datesModal} onClose={() => setDatesModal(null)} onSaved={() => { setDatesModal(null); setUpcoming(u => ({ ...u, loading: true })); loadUpcoming() }} />}
    </>
  )
}

function prevGrossForApp(sortedApps, app) {
  let prev = null
  for (const a of sortedApps) { if ((a.seq || 0) < (app.seq || 0)) prev = a }
  return prev ? computeApplicationSummary(prev, 0).grossCurrent : 0
}

// Landing table: the NEXT application per project, colour-coded by due date.
// Next application per in-progress project, within 31 days, colour-coded by due
// date. Mirrors the Application Calendar: uses the dashboard's in-progress
// projects and each project's day-of-month settings to compute the next date.
// Projects with NO dates set show at the TOP.
// Set the recurring application/valuation/payment day-of-month for a project —
// the same date-entry the Application Calendar's banner opens.
function UpcomingTable({ rows, loading, onOpen, onDismissed }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dueInfo = (iso) => {
    if (!iso) return { color: '#9ca3af', bg: '#f3f4f6', days: null }
    const d = new Date(iso + 'T00:00:00'); d.setHours(0, 0, 0, 0)
    const days = Math.round((d - today) / 86400000)
    if (days < 0) return { color: '#dc2626', bg: '#fee2e2', days }
    if (days === 0) return { color: '#16a34a', bg: '#dcfce7', days }
    if (days <= 3) return { color: '#c2410c', bg: '#ffedd5', days }
    return { color: '#6b7280', bg: '#f3f4f6', days }
  }
  const fmtD = (s) => { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  const KeyDot = ({ c, label }) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555' }}><span style={{ width: 12, height: 12, borderRadius: 3, background: c, display: 'inline-block' }} />{label}</span>

  return (
    <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 16px', borderBottom: '1px solid #eee', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Upcoming Applications</div>
        <div style={{ flex: 1 }} />
        <KeyDot c="#f3f4f6" label="Not yet due" />
        <KeyDot c="#ffedd5" label="Within 3 days" />
        <KeyDot c="#dcfce7" label="Due today" />
        <KeyDot c="#fee2e2" label="Overdue" />
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#aaa' }}>Loading…</div>
      ) : (rows || []).length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888', fontSize: 14 }}>No applications due in the next 31 days.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
            {['Project', 'Next app', 'Application due', 'Valuation date', 'Status', ''].map((h, i) => (
              <th key={i} style={{ padding: '9px 14px', textAlign: i === 5 ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {(rows || []).map(r => {
              const needsCR = r.crStatus && r.crStatus !== 'ok'
              const di = dueInfo(r.appDate)
              async function dismiss() {
                if (!confirm(`Are you sure you don't have an application for works completed on site for this project this month?\n\n${[r.jobNo, r.name].filter(Boolean).join(' — ')}`)) return
                try {
                  await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dismiss-month', projectId: r.xeroId, monthKey: r.monthKey || (r.appDate ? r.appDate.slice(0, 7) : '') }) })
                  if (onDismissed) onDismissed(r.xeroId)
                } catch {}
              }
              return (
                <tr key={r.xeroId} style={{ borderBottom: '1px solid #f0f0f0', opacity: r.status === 'dismissed' ? 0.55 : 1 }}>
                  <td style={{ padding: '9px 14px', fontSize: 13, fontWeight: 600 }}>{[r.jobNo, r.name].filter(Boolean).join(' — ') || r.xeroId}</td>
                  <td style={{ padding: '9px 14px', fontSize: 13 }}>{needsCR ? '—' : r.nextSeq}</td>
                  <td style={{ padding: '9px 14px' }}>
                    {needsCR ? (
                      <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 6, fontSize: 12.5, fontWeight: 700, background: '#fee2e2', color: '#dc2626' }}>Contracted Rates required</span>
                    ) : (
                      <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 6, fontSize: 12.5, fontWeight: 700, background: di.bg, color: di.color }}>
                        {fmtD(r.appDate)}{di.days != null && di.days !== 0 ? ` (${di.days < 0 ? `${-di.days}d overdue` : `in ${di.days}d`})` : di.days === 0 ? ' (today)' : ''}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '9px 14px', fontSize: 13, color: '#374151' }}>{needsCR ? '—' : fmtD(r.valDate)}</td>
                  <td style={{ padding: '9px 14px', fontSize: 12 }}>
                    {needsCR ? <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 11 }}>{r.crStatus === 'none' ? 'CR not set up' : 'CR not locked'}</span>
                      : r.status === 'dismissed' ? <span style={{ padding: '2px 8px', borderRadius: 5, fontWeight: 700, fontSize: 11, background: '#f3f4f6', color: '#6b7280' }}>Dismissed</span>
                      : <span style={{ padding: '2px 8px', borderRadius: 5, fontWeight: 700, fontSize: 11, background: r.status === 'draft' ? '#fef9c3' : '#eef2ff', color: r.status === 'draft' ? '#a16207' : '#4f46e5' }}>{r.status === 'draft' ? 'Draft ready' : 'Due to raise'}</span>}
                  </td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {needsCR
                      ? <a href={`/contracted-rates?projectId=${encodeURIComponent(r.xeroId)}`} style={{ display: 'inline-block', background: '#f0f2f5', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#374151', fontWeight: 600, textDecoration: 'none' }}>Set up</a>
                      : <button onClick={() => onOpen(r.xeroId)} style={{ background: '#f0f2f5', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#374151', fontWeight: 600 }}>Open</button>}
                    {!needsCR && r.status !== 'dismissed' && r.status !== 'draft' && <button onClick={dismiss} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', color: '#6b7280', marginLeft: 6 }}>Dismiss month</button>}
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
function ApplicationEditor({ app, appNumber, prevGross, projectId, me, settings = {}, trackerVariations = [], projectPOs = [], hiddenPOs = [], onHiddenPOsChange, onBack, onSaved, onVariationChange }) {
  const [rows, setRows] = useState(() => app.contractWorks.map(r => ({ ...r })))
  // Per-application variation data (pct + attachments), keyed by varKey.
  const [variationData, setVariationData] = useState(() => ({ ...(app.variationData || {}) }))
  const [mats, setMats] = useState(() => (app.materials || []).map(m => ({ ...m })))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [showAddMat, setShowAddMat] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [showSend, setShowSend] = useState(false)
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
  // Add a single line. Manual lines (no PO) stay ungrouped; PO lines go under a
  // supplier/PO group header — created if this PO isn't already on the application,
  // otherwise appended to its existing group.
  const addMaterial = (m) => {
    if (!m.poNumber) {
      setMats(l => [...l, { id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, kind: 'item', pctComplete: 100, ...m }]); setDirty(true); return
    }
    setMats(l => {
      let group = l.find(x => x.kind === 'group' && x.poNumber === m.poNumber)
      const out = [...l]
      let gid
      if (!group) {
        gid = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
        out.push({ id: gid, kind: 'group', supplier: m.supplier || '', poNumber: m.poNumber, attachments: [] })
      } else { gid = group.id }
      out.push({ id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, kind: 'item', groupId: gid, pctComplete: 100, description: m.description, poNumber: m.poNumber, qty: m.qty, unit: m.unit, rate: m.rate, markupPct: m.markupPct || 0 })
      return out
    })
    setDirty(true)
  }
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
  // Remove a PO line from the application by its (poNumber|description) key — used
  // by the picker's Remove button. Also drops the group header if it's left empty.
  const removeMaterialByKey = (key) => {
    setMats(l => {
      const [po, desc] = key.split('|')
      const target = l.find(m => m.kind === 'item' && m.poNumber === po && (m.description || '').trim() === (desc || '').trim())
      if (!target) return l
      let out = l.filter(m => m.id !== target.id)
      if (target.groupId && !out.some(m => m.groupId === target.groupId)) out = out.filter(m => m.id !== target.groupId)
      return out
    })
    setDirty(true)
  }
  // PO numbers currently on the application (via a supplier group) — used to block
  // adding the same PO twice at once, and to show it ticked/green in the picker.
  const addedPONumbers = mats.filter(m => m.kind === 'group' && m.poNumber).map(m => m.poNumber)
  // Which individual PO lines are already on the app (poNumber|description), so the
  // picker can mark them added and prevent adding the same line twice.
  const addedLineKeys = mats.filter(m => m.kind === 'item' && m.poNumber).map(m => `${m.poNumber}|${(m.description || '').trim()}`)
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

  // Collect warnings to surface before sending.
  function collectWarnings() {
    const w = []
    const num2 = (x) => { const n = parseFloat(x); return isNaN(n) ? 0 : n }
    const matItems = mats.filter(m => m.kind !== 'group')
    const noMk = matItems.filter(m => !num2(m.markupPct))
    if (noMk.length) w.push(`${noMk.length} material line${noMk.length === 1 ? ' has' : 's have'} no mark-up applied`)
    const zeroMats = matItems.filter(m => num2(m.total != null ? m.total : num2(m.qty) * num2(m.rate)) === 0)
    if (zeroMats.length) w.push(`${zeroMats.length} material line${zeroMats.length === 1 ? ' has' : 's have'} a £0 value`)
    const zeroWorks = rows.filter(r => r.kind === 'item' && (r.qty != null || String(r.unit || '').trim() !== '') && (r.total == null || num2(r.total) === 0))
    if (zeroWorks.length) w.push(`${zeroWorks.length} contract-works line${zeroWorks.length === 1 ? ' has' : 's have'} a £0 value`)
    return w
  }
  function trySubmit() {
    const w = collectWarnings()
    const base = 'Mark this application as sent? Variations will be frozen as they are now, and it will be locked (double-click to edit later).'
    if (w.length) {
      if (!confirm(`Are you sure you want to submit? The following need attention:\n\n• ${w.join('\n• ')}\n\n${base}`)) return
    } else {
      if (!confirm(base)) return
    }
    save(true)
  }

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
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>Application {appNumber} — {app.monthLabel || monthLabel(app.monthKey)}</div>
        <span style={{ padding: '2px 8px', borderRadius: 5, fontWeight: 700, fontSize: 11, background: isSent ? '#dcfce7' : '#fef9c3', color: isSent ? '#16a34a' : '#a16207' }}>{isSent ? (unlocked ? 'Sent — editing' : 'Sent') : 'Draft'}</span>
        <div style={{ flex: 1 }} />
        {isSent && !unlocked && <button onClick={() => { if (confirm('Are you sure you want to edit an application that has already been issued to the customer?\n\nEditing will move it back to draft — you will need to send it (or mark it as sent) again. Its application number stays the same.')) setUnlocked(true) }} style={{ background: '#fff', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Edit application</button>}
        {isSent && unlocked && <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>Editing an issued application — re-send when done</span>}
        <a href={`/api/application-pdf?projectId=${encodeURIComponent(projectId)}&appId=${encodeURIComponent(app.id)}&download=1`} target="_blank" rel="noreferrer" style={{ background: '#f0f2f5', border: '1px solid #e5e7eb', color: '#374151', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Download PDF</a>
        <button onClick={() => { if (dirty) { setMsg('Save your changes before sending.'); return } setShowSend(true) }} style={{ background: '#0369a1', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Send to customer</button>
        {!locked && <button onClick={() => save(false)} disabled={saving || !dirty} style={{ background: dirty ? '#0f766e' : '#e5e7eb', color: dirty ? '#fff' : '#9ca3af', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: dirty ? 'pointer' : 'default' }}>{saving ? 'Saving…' : 'Save'}</button>}
        {!locked && !isSent && <button onClick={trySubmit} disabled={saving} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>Mark as sent</button>}
      </div>

      {showSend && <SendApplicationModal app={app} appNumber={appNumber} projectId={projectId} settings={settings} me={me} isSent={isSent} onClose={() => setShowSend(false)} onSent={(updated) => { setShowSend(false); if (updated) onSaved(updated); setMsg('Application sent.') }} />}

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
                // A line only carries a Total / % Complete / Value to date when it is a
                // complete measurable item (has qty, unit, rate and total). Otherwise
                // it behaves like a text/sub-line and those cells stay blank.
                const measurable = isMeasurableWorks(r)
                const zeroWorks = r.kind === 'item' && (r.qty != null || String(r.unit || '').trim() !== '') && (r.total == null || Number(r.total) === 0)
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0', background: zeroWorks ? '#fef2f2' : 'transparent' }}>
                    <td style={{ ...td, color: '#6b7280', fontWeight: 600 }}>{r.code}</td>
                    <td style={{ ...td, minWidth: 240, whiteSpace: 'normal', ...fs }}>{zeroWorks && <span title="This line has a £0 value" style={{ color: '#dc2626', fontWeight: 700, marginRight: 5 }}>⚠</span>}{r.description}</td>
                    <td style={tdR}>{r.qty ?? ''}</td>
                    <td style={td}>{r.unit || ''}</td>
                    <td style={tdR}>{r.rate != null ? Number(r.rate).toLocaleString('en-GB', { minimumFractionDigits: 2 }) : ''}</td>
                    <td style={tdR}>{measurable ? fmt(r.total) : ''}</td>
                    <td style={tdR}>
                      {!measurable ? '' : locked ? `${r.pctComplete || 0}%` : (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                          <input type="number" min="0" max="100" value={r.pctComplete ?? 0} onChange={e => setPct(r.id, e.target.value)} style={{ width: 58, padding: '4px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 12.5, textAlign: 'right' }} />
                          <button title="Mark 100% complete" onClick={() => setPct(r.id, 100)} style={{ background: (r.pctComplete === 100) ? '#16a34a' : '#f0f2f5', color: (r.pctComplete === 100) ? '#fff' : '#16a34a', border: '1px solid ' + ((r.pctComplete === 100) ? '#16a34a' : '#d1fae5'), borderRadius: 5, padding: '3px 7px', fontSize: 12, cursor: 'pointer', lineHeight: 1 }}>✓</button>
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{measurable ? fmt(worksValueToDate(r)) : ''}</td>
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
                const noMarkup = !num(m.markupPct)
                const zeroLine = num(netTotal) === 0
                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid #f0f0f0', background: zeroLine ? '#fef2f2' : 'transparent' }}>
                    <td style={{ ...td, minWidth: 180, whiteSpace: 'normal' }}>{zeroLine && <span title="This line has a £0 value" style={{ color: '#dc2626', fontWeight: 700, marginRight: 5 }}>⚠</span>}{m.description}</td>
                    <td style={{ ...td, color: '#6b7280' }}>{m.poNumber || '—'}</td>
                    <td style={tdR}>{locked ? (m.qty ?? '') : <input type="number" value={m.qty ?? ''} onChange={e => setMatField(m.id, 'qty', e.target.value === '' ? null : parseFloat(e.target.value))} style={{ width: 52, padding: '4px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 12.5, textAlign: 'right' }} />}</td>
                    <td style={td}>{m.unit || ''}</td>
                    <td style={tdR}>{locked ? fmt(m.rate || 0) : <input type="number" value={m.rate ?? ''} onChange={e => setMatField(m.id, 'rate', e.target.value === '' ? null : parseFloat(e.target.value))} style={{ width: 72, padding: '4px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 12.5, textAlign: 'right' }} />}</td>
                    <td style={{ ...tdR, ...(zeroLine ? { color: '#dc2626', fontWeight: 700 } : {}) }}>{fmt(netTotal)}</td>
                    <td style={{ ...tdR, background: noMarkup ? '#fee2e2' : '#fff7ed' }} title={noMarkup ? 'No mark-up applied to this line' : 'Internal only — hidden on the customer copy'}>{locked ? `${m.markupPct || 0}%` : (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        {noMarkup && <span title="No mark-up applied" style={{ color: '#dc2626', fontWeight: 700 }}>⚠</span>}
                        <input type="number" value={m.markupPct ?? 0} onChange={e => setMatField(m.id, 'markupPct', e.target.value === '' ? 0 : parseFloat(e.target.value))} style={{ width: 52, padding: '4px 6px', border: '1px solid ' + (noMarkup ? '#dc2626' : '#fdba74'), borderRadius: 5, fontSize: 12.5, textAlign: 'right', background: '#fff' }} />
                      </div>
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

      {showAddMat && <AddMaterialsModal pos={projectPOs} addedPONumbers={addedPONumbers} addedLineKeys={addedLineKeys} hiddenPOs={hiddenPOs} onToggleHide={toggleHidePO} onClose={() => setShowAddMat(false)} onAdd={addMaterial} onAddGroup={addMaterialGroup} onRemove={removeMaterialByKey} />}
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
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}><td style={{ padding: '8px 12px', fontSize: 13 }}>Variations</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}></td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.variationsToDate)}</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.variationsFinal)}</td></tr>
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}><td style={{ padding: '8px 12px', fontSize: 13 }}>Materials On Site</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}></td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.materialsOnSite)}</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}></td></tr>
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
function AddMaterialsModal({ pos, addedPONumbers = [], addedLineKeys = [], hiddenPOs = [], onToggleHide, onClose, onAdd, onAddGroup, onRemove }) {
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
    const lineKey = (li) => `${p.poNumber}|${(li.description || '').trim()}`
    const lines = p.lineItems || []
    const addedCount = lines.filter(li => addedLineKeys.includes(lineKey(li))).length
    const fullyAdded = lines.length > 0 && addedCount === lines.length
    const someAdded = addedCount > 0
    return (
      <div key={p.poNumber || pi} style={{ border: '1px solid ' + (fullyAdded ? '#86efac' : someAdded ? '#bbf7d0' : '#e5e7eb'), borderRadius: 10, overflow: 'hidden', background: fullyAdded ? '#f0fdf4' : '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: fullyAdded ? '#dcfce7' : '#f8f9fa', padding: '10px 12px', flexWrap: 'wrap' }}>
          {fullyAdded && <span style={{ color: '#16a34a', fontWeight: 700 }}>✓</span>}
          <div style={{ fontWeight: 700, fontSize: 13 }}>{p.poNumber || '(no PO no.)'}</div>
          <div style={{ fontSize: 12, color: '#666' }}>{p.supplier}</div>
          <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 5, background: p.delivered ? '#dcfce7' : '#fef9c3', color: p.delivered ? '#16a34a' : '#a16207' }}>{p.delivered ? 'Delivered' : 'Not delivered'}</span>
          {fullyAdded ? <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>All added</span>
            : someAdded ? <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>{addedCount}/{lines.length} added</span> : null}
          <div style={{ flex: 1 }} />
          <label style={{ fontSize: 11, color: '#c2410c', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            Mark-up
            <input type="number" value={markups[p.poNumber] ?? ''} placeholder="0" onChange={e => setMarkups(s => ({ ...s, [p.poNumber]: e.target.value }))} style={{ width: 54, padding: '4px 6px', border: '1px solid #fdba74', borderRadius: 5, fontSize: 12, textAlign: 'right' }} />%
          </label>
          <button disabled={fullyAdded} onClick={() => onAddGroup({ supplier: p.supplier, poNumber: p.poNumber, markupPct: m, lines: lines.filter(li => !addedLineKeys.includes(lineKey(li))) })} title="Add the remaining lines from this PO" style={{ background: fullyAdded ? '#e5e7eb' : '#0f766e', color: fullyAdded ? '#9ca3af' : '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 11.5, fontWeight: 700, cursor: fullyAdded ? 'default' : 'pointer' }}>{fullyAdded ? 'Added' : someAdded ? 'Add remaining' : 'Add all lines'}</button>
          <button onClick={() => onToggleHide(p.poNumber)} title={isHidden(p.poNumber) ? 'Unhide' : 'Hide this PO from the list'} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 9px', fontSize: 11, cursor: 'pointer', color: '#6b7280' }}>{isHidden(p.poNumber) ? 'Unhide' : 'Hide'}</button>
        </div>
        {!fullyAdded && (
          <div style={{ padding: '6px 0' }}>
            {lines.length === 0 && <div style={{ fontSize: 12, color: '#aaa', padding: '4px 12px' }}>No line items on this PO.</div>}
            {lines.map((li, li2) => {
              const net = (parseFloat(li.quantity) || 0) * (parseFloat(li.rate) || 0)
              const lineAdded = addedLineKeys.includes(lineKey(li))
              return (
                <div key={li2} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderTop: li2 ? '1px solid #f3f4f6' : 'none', background: lineAdded ? '#f0fdf4' : 'transparent' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5 }}>{lineAdded && <span style={{ color: '#16a34a', fontWeight: 700, marginRight: 5 }}>✓</span>}{li.description || '(no description)'}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{li.quantity != null ? `qty ${li.quantity}${li.unit ? ' ' + li.unit : ''}` : ''}{li.rate != null ? ` · ${money(li.rate)}` : ''}{net ? ` · net ${money(net)}` : ''}{m ? ` · +${m}% → ${money(net * factor)}` : ''}</div>
                  </div>
                  {lineAdded ? (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11.5, color: '#16a34a', fontWeight: 700 }}>✓ Added</span>
                      <button onClick={() => onRemove(`${p.poNumber}|${(li.description || '').trim()}`)} title="Remove this line from the application" style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer', color: '#dc2626', fontWeight: 600 }}>Remove</button>
                    </div>
                  ) : (
                    <button onClick={() => onAdd({ supplier: p.supplier, description: li.description, poNumber: p.poNumber, qty: li.quantity, unit: li.unit, rate: li.rate, markupPct: m })} style={{ background: '#f0f2f5', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer', color: '#374151', fontWeight: 600 }}>Add</button>
                  )}
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

// Send the Application PDF to the customer.
// - To: exactly ONE recipient (customer contact or Rock Roofing portal user).
// - CC: any number (customer contacts and/or portal users), plus free-text.
// - Message from an editable template with placeholders filled in.
function SendApplicationModal({ app, appNumber, projectId, settings = {}, me, isSent, onClose, onSent }) {
  const [portalUsers, setPortalUsers] = useState([])
  useEffect(() => { (async () => {
    try { const d = await fetch('/api/portal-auth?action=directory').then(r => r.json()); setPortalUsers(d.users || []) } catch {}
  })() }, [])

  // Build the pick lists (deduped by email).
  const custContacts = []
  const seenC = new Set()
  const pushC = (name, email) => { const e = (email || '').trim(); if (!e || seenC.has(e.toLowerCase())) return; seenC.add(e.toLowerCase()); custContacts.push({ name: name || e, email: e, group: 'Customer' }) }
  ;(settings.customerContacts || []).forEach(c => pushC(c.name || c.title, c.email))
  pushC(settings.customerName, settings.customerEmail)
  const users = (portalUsers || []).map(u => ({ name: u.name || u.email, email: u.email, phone: u.phone || '', group: 'Rock Roofing' }))
  const everyone = [...custContacts, ...users]
  const byEmail = (e) => everyone.find(x => x.email.toLowerCase() === (e || '').toLowerCase())

  const [to, setTo] = useState(() => custContacts[0]?.email || '')
  // Auto-CC the sending portal user (yourself) by default.
  const [ccSel, setCcSel] = useState(() => (me?.email ? { [me.email]: true } : {}))
  const [ccExtra, setCcExtra] = useState('')
  const [markSent, setMarkSent] = useState(!isSent)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')

  // Template placeholders.
  const now = new Date()
  const monthName = now.toLocaleString('en-GB', { month: 'long' })
  const year = now.getFullYear()
  const appNo = appNumber || app.appNumber || app.seq || ''
  const custName = (custContacts[0]?.name || settings.customerName || 'there').split(' ')[0] || 'there'
  const signer = { name: me?.name || '', email: me?.email || '', phone: me?.phone || '' }

  const defaultSubject = `Application for Payment ${appNo} - ${monthName} ${year}`
  const defaultBody =
    `Hi ${custName},\n\n` +
    `Please find attached our application for payment ${appNo} for ${monthName}.\n\n` +
    `Feel free to call if there is anything you would like to discuss.\n\n` +
    `Kind Regards,\n\n` +
    `${signer.name}\n` +
    `${signer.email}\n` +
    `${signer.phone}\n` +
    `Rock Roofing Ltd`

  const [subject, setSubject] = useState(defaultSubject)
  const [body, setBody] = useState(defaultBody)
  const resetTemplate = () => { setSubject(defaultSubject); setBody(defaultBody) }

  async function send() {
    if (!to) { setErr('Choose one "To" recipient.'); return }
    if (isSent && !confirm('Are you sure you want to send this application to the customer again?')) return
    const ccChosen = Object.keys(ccSel).filter(e => ccSel[e])
    const ccExtras = ccExtra.split(/[;,\s]+/).map(s => s.trim()).filter(Boolean)
    // Always copy in the sending portal user.
    const forced = signer.email ? [signer.email] : []
    const cc = [...new Set([...ccChosen, ...ccExtras, ...forced])].filter(e => e.toLowerCase() !== to.toLowerCase())
    setSending(true); setErr('')
    try {
      const d = await fetch('/api/application-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, appId: app.id, to: [to], cc, replyTo: signer.email || settings.qsEmail || undefined, subject, text: body, markSent, author: me?.name || '' }),
      }).then(r => r.json())
      if (!d.ok) { setErr(d.error || 'Send failed.'); setSending(false); return }
      onSent(d.application || null)
    } catch { setErr('Send failed.'); setSending(false) }
  }

  const optGroups = [
    { label: 'Customer contacts', items: custContacts },
    { label: 'Rock Roofing portal users', items: users },
  ]

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, width: 640, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e', marginBottom: 4 }}>Send application to customer</div>
        <div style={{ fontSize: 12.5, color: '#777', marginBottom: 14 }}>The customer-copy PDF (mark-up hidden) is attached. Variation and supplier documents are appended to the PDF.</div>

        {/* To (one only) */}
        <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 6 }}>TO (one recipient)</div>
        <select value={to} onChange={e => setTo(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #d5d9e0', borderRadius: 7, fontSize: 13, marginBottom: 14, background: '#fff', boxSizing: 'border-box' }}>
          <option value="">— Select a recipient —</option>
          {optGroups.map(g => g.items.length ? (
            <optgroup key={g.label} label={g.label}>
              {g.items.map(x => <option key={x.email} value={x.email}>{x.name} — {x.email}</option>)}
            </optgroup>
          ) : null)}
        </select>

        {/* CC (many) */}
        <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 6 }}>CC (optional)</div>
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 8, maxHeight: 180, overflowY: 'auto' }}>
          {optGroups.map(g => g.items.length ? (
            <div key={g.label} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', marginBottom: 4 }}>{g.label}</div>
              {g.items.map(x => (
                <label key={x.email} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: x.email === to ? 'not-allowed' : 'pointer', opacity: x.email === to ? 0.45 : 1, padding: '2px 0' }}>
                  <input type="checkbox" disabled={x.email === to} checked={!!ccSel[x.email]} onChange={e => setCcSel(s => ({ ...s, [x.email]: e.target.checked }))} />
                  <span style={{ fontWeight: 600 }}>{x.name}</span><span style={{ color: '#888' }}>{x.email}</span>
                </label>
              ))}
            </div>
          ) : null)}
          {everyone.length === 0 && <div style={{ fontSize: 12.5, color: '#aaa' }}>No contacts on file — add emails below.</div>}
        </div>
        <input value={ccExtra} onChange={e => setCcExtra(e.target.value)} placeholder="Add more CC emails (comma separated)" style={{ width: '100%', padding: '8px 10px', border: '1px solid #d5d9e0', borderRadius: 7, fontSize: 12.5, marginBottom: 14, boxSizing: 'border-box' }} />

        {/* Message */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888' }}>SUBJECT</div>
          <div style={{ flex: 1 }} />
          <button onClick={resetTemplate} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 11.5, cursor: 'pointer' }}>Reset to template</button>
        </div>
        <input value={subject} onChange={e => setSubject(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #d5d9e0', borderRadius: 7, fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }} />
        <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 6 }}>MESSAGE</div>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={11} style={{ width: '100%', padding: '10px', border: '1px solid #d5d9e0', borderRadius: 7, fontSize: 12.5, marginBottom: 12, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />

        {!isSent && <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 12 }}><input type="checkbox" checked={markSent} onChange={e => setMarkSent(e.target.checked)} />Mark this application as sent (freezes variations, locks it)</label>}
        {err && <div style={{ fontSize: 12.5, color: '#dc2626', marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={send} disabled={sending} style={{ flex: 1, background: sending ? '#ccc' : '#0369a1', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 700, cursor: sending ? 'default' : 'pointer' }}>{sending ? 'Sending…' : 'Send email'}</button>
          <a href={`/api/application-pdf?projectId=${encodeURIComponent(projectId)}&appId=${encodeURIComponent(app.id)}&download=1`} target="_blank" rel="noreferrer" style={{ background: '#f0f2f5', border: '1px solid #e5e7eb', color: '#374151', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Download PDF</a>
          <button onClick={onClose} style={{ background: '#fff', color: '#666', border: '1px solid #e5e5e5', borderRadius: 8, padding: '10px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
