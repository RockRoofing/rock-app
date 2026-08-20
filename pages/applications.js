import { useState, useEffect, useMemo } from 'react'
import { projectLabel } from '../lib/variationInstruct'
import Head from 'next/head'
import Link from 'next/link'
import CommercialNav from '../components/CommercialNav'
import ProjectSearchSelect from '../components/ProjectSearchSelect'
import ProjectDatesModal from '../components/ProjectDatesModal'
import { describeApplication, computeApplicationSummary, worksValueToDate, resolveAppDates, buildAppVariations, materialLineTotal, materialValueToDate, isMeasurableWorks } from '../lib/applications'

const fmt = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s) => { if (!s) return '—'; const d = new Date(s + (s.length === 10 ? 'T00:00:00' : '')); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
const monthLabel = (key) => {
  const [monthPart, periodNo] = String(key).split('#')
  const [y, m] = monthPart.split('-').map(Number)
  if (!y) return key
  const base = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  return periodNo ? `${base} \u2013 period ${periodNo}` : base
}

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

  // REFRESH THE UPCOMING TABLE WHEN YOU COME BACK TO IT.
  //
  // loadUpcoming() ran once, on mount. Contracted rates are locked on a DIFFERENT page,
  // so returning here showed the state as it was when this page first loaded - "CR not
  // locked" on a project whose rates you had just locked, and no way to clear it short of
  // a hard reload.
  //
  // Refreshed on focus and when the tab becomes visible again, which covers coming back
  // from Contracted Rates in the same tab or another one.
  useEffect(() => {
    const refresh = () => { if (!document.hidden) loadUpcoming() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  // Display order: latest application first.
  const displayApps = useMemo(() => [...apps].sort((a, b) => (b.seq || 0) - (a.seq || 0)), [apps])

  // Default the new-application month to the month AFTER the latest application.
  useEffect(() => {
    if (!sortedApps.length) return
    const last = sortedApps[sortedApps.length - 1]
    if (!last.monthKey) return
    const [lastMonth] = String(last.monthKey).split('#')
    const [y, m] = lastMonth.split('-').map(Number)
    if (!y || !m) return

    // NEXT PERIOD, not always next month.
    //
    // If Project Details holds an unused extra period in the current month - the "#2"
    // rows a fortnightly project sets up - offer that before rolling on to next month.
    // Otherwise the default was always a month ahead and the dates had to be retyped
    // for every second application.
    const used = new Set(sortedApps.map(a => String(a.monthKey)))
    const ovKeys = Object.keys(settings.dateOverrides || {})
      .filter(k => k.startsWith(lastMonth + '#') || k === lastMonth)
      .sort()
    const nextInMonth = ovKeys.find(k => !used.has(k))
    if (nextInMonth) { setNewMonth(nextInMonth); return }

    const d = new Date(y, m, 1) // next month
    setNewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }, [sortedApps, settings])
  function prevAppFor(app) {
    let prev = null
    for (const a of sortedApps) { if ((a.seq || 0) < (app.seq || 0)) prev = a }
    return prev
  }
  function prevGrossFor(app) {
    const prev = prevAppFor(app)
    if (!prev) return 0
    return computeApplicationSummary(prev, 0).grossCurrent
  }
  // Customer-facing application numbers. An app that has been sent gets a permanent
  // number; a never-sent draft shows the NEXT number = (highest sent) + 1.
  // Older apps sent before appNumber existed have no stored number — so we derive
  // numbers from SENT ORDER (by seq) as a fallback: the Nth sent app is N.
  const appNumberMap = useMemo(() => {
    const map = {}
    let maxSent = 0
    const sentInOrder = apps
      .filter(a => a.status && a.status !== 'draft')
      .sort((a, b) => (a.seq || 0) - (b.seq || 0))
    let n = 0
    for (const a of sentInOrder) {
      n = a.appNumber ? a.appNumber : n + 1   // prefer stored number, else next in order
      map[a.id] = n
      if (n > maxSent) maxSent = n
    }
    // Drafts: a draft reverted from sent keeps its stored number, else it's next.
    for (const a of apps) {
      if (map[a.id]) continue
      map[a.id] = a.appNumber || (maxSent + 1)
    }
    return map
  }, [apps])
  const appNumberFor = (a) => (a && appNumberMap[a.id]) || 1

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

  async function deleteApp(a, { fromEditor } = {}) {
    const isSent = a.status && a.status !== 'draft'
    const label = `application ${appNumberFor(a)} (${a.monthLabel || monthLabel(a.monthKey)})`
    const msg = isSent
      ? `This application has been ISSUED to the customer. Are you sure you want to permanently delete ${label}? This cannot be undone.`
      : `Delete draft ${label}? This cannot be undone.`
    if (!confirm(msg)) return
    try {
      const d = await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', projectId, id: a.id, allowSent: isSent }) }).then(r => r.json())
      if (d.ok) { setApps(d.applications || []); if (fromEditor) setOpenId(null) }
    } catch { setMsg('Could not delete.') }
  }

  return (
    <>
      <Head><title>Rock Roofing — Applications · v29</title></Head>
      <div style={{ minHeight: '100vh', background: '#f5f6f8' }}>
        <CommercialNav active="/applications" />
        {/* Full width. 1280 was fine when this was two blocks side by side; with three
            it squeezed the tables until the figures wrapped. Capped at 2000 so the
            columns do not stretch absurdly on a very wide monitor. */}
        <div style={{ padding: 24, maxWidth: 2000, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Select Project — Upcoming Applications</label>
            <ProjectSearchSelect projects={projects} value={projectId} onPick={(pid) => pickProject(pid)} minWidth={340} />
            {false && (
            <select value={projectId} onChange={e => pickProject(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #d5d9e0', borderRadius: 8, fontSize: 13, minWidth: 340, background: '#fff' }}>
              <option value="">— Select a project —</option>
              {projects.map(p => <option key={p.xeroId} value={p.xeroId}>{projectLabel(p.jobNo, p.name)}</option>)}
            </select>
            )}
            {selProject && <Link href={`/contracted-rates`} style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>Contracted Rates →</Link>}
          </div>

          {!projectId && upcoming.missing.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
              <span style={{ fontWeight: 700, marginRight: 8 }}>⚠ Missing dates:</span>
              {upcoming.missing.map((r, i) => (
                <span key={r.xeroId}>
                  <button onClick={() => setDatesModal({ xeroId: r.xeroId, jobNo: r.jobNo, name: r.name })} style={{ background: 'none', border: 'none', color: '#92400e', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0 }}>{projectLabel(r.jobNo, r.name)}</button>
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
              isFirstApp={sortedApps.length > 0 && sortedApps[0].id === openApp.id}
              prevGross={prevGrossFor(openApp)}
              prevReleases={prevAppFor(openApp)}
              projectId={projectId}
              me={me}
              settings={settings}
              trackerVariations={trackerVariations}
              projectPOs={projectPOs}
              hiddenPOs={hiddenPOs}
              onHiddenPOsChange={setHiddenPOs}
              onBack={() => { setOpenId(null); load(projectId) }}
              onDelete={() => deleteApp(openApp, { fromEditor: true })}
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
                  // Twelve columns need somewhere to go. width:100% alone makes a table
                  // SHRINK to fit rather than overflow, so the figures would squeeze until
                  // they wrapped - the same fault the retention register had. A minimum
                  // width forces the overflow and gives it a scrollbar.
                  <div style={{ overflowX: 'auto' }}>
                  <table style={{ minWidth: 1100, width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
                        {/* The whole certificate, left to right, ending at what the
                            customer owes for that application. Reading it off the list is
                            the common question - "what is due on app 12" - and it meant
                            opening each one. */}
                        {[
                          ['App No.', 'left'], ['Month', 'left'], ['App date', 'left'], ['Status', 'left'],
                          ['Gross to date', 'right'], ['MCD', 'right'], ['Retention', 'right'],
                          ['Ret. released', 'right'], ['Prev. cert', 'right'],
                          ['This cert (net)', 'right'], ['Payment due', 'left'], ['', 'left'],
                        ].map(([h, align], i) => (
                          <th key={i} style={{ padding: '9px 12px', textAlign: align, fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayApps.map(a => {
                        const isFirst = sortedApps.length > 0 && sortedApps[0].id === a.id
                        const prevApp = prevAppForApp(sortedApps, a)
                        const prevCert = isFirst ? 0 : (a.prevCertGross != null ? a.prevCertGross : prevGrossForApp(sortedApps, a))
                        // VARIATIONS AND RELEASES, same as the editor.
                        //
                        // This computed from `a` straight off the record, which was wrong
                        // twice over:
                        //
                        //   VARIATIONS are only FROZEN onto the application when it is
                        //   sent. Until then a.variations is empty, so a draft's gross
                        //   here excluded them - the list showed the same gross for two
                        //   applications that differ by £2,387 of variations, and a
                        //   different "this cert" from the one on the application itself.
                        //
                        //   RELEASES need the previous application, or a half claimed
                        //   last month is counted again in this cert.
                        //
                        // Built the same way the editor builds it, so the two agree.
                        const listApp = { ...a, variations: buildAppVariations(a, trackerVariations) }
                        const sum = computeApplicationSummary(listApp, prevCert, prevApp)
                        return (
                          <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 700 }}>{appNumberFor(a)}</td>
                            <td style={{ padding: '9px 12px', fontSize: 13 }}>
                              {a.monthLabel || monthLabel(a.monthKey)}
                              {/* Markers in the list, so a final account or a retention
                                  release can be picked out without opening every
                                  application to find which one it was. Same wording as
                                  the PDF and the email, from the same function. */}
                              {describeApplication(a, { prevReleases: prevApp }).tags.map(t => (
                                <span key={t} style={{
                                  marginLeft: 6, padding: '1px 7px', borderRadius: 10, fontSize: 10.5, fontWeight: 700,
                                  background: t === 'FINAL ACCOUNT' ? '#ccfbf1' : '#e0e7ff',
                                  color: t === 'FINAL ACCOUNT' ? '#0f766e' : '#4338ca',
                                }}>{t}</span>
                              ))}
                            </td>
                            <td style={{ padding: '9px 12px', fontSize: 13 }}>{fmtDate(a.appDate)}</td>
                            <td style={{ padding: '9px 12px', fontSize: 12 }}>
                              <span style={{ padding: '2px 8px', borderRadius: 5, fontWeight: 700, fontSize: 11, background: (a.status && a.status !== 'draft') ? '#dcfce7' : '#fef9c3', color: (a.status && a.status !== 'draft') ? '#16a34a' : '#a16207' }}>{(a.status && a.status !== 'draft') ? 'Sent' : 'Draft'}</span>
                            </td>
                            <td style={{ padding: '9px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.grossCurrent)}</td>
                            {/* Cumulative figures, matching the certificate's Current column. */}
                            <td style={{ padding: '9px 12px', fontSize: 13, textAlign: 'right', color: '#b91c1c' }}>{sum.current.mcd ? `(${fmt(sum.current.mcd)})` : '—'}</td>
                            <td style={{ padding: '9px 12px', fontSize: 13, textAlign: 'right', color: '#b91c1c' }}>{sum.current.retention ? `(${fmt(sum.current.retention)})` : '—'}</td>
                            <td style={{ padding: '9px 12px', fontSize: 13, textAlign: 'right', color: '#166534' }}>{sum.current.released ? fmt(sum.current.released) : '—'}</td>
                            <td style={{ padding: '9px 12px', fontSize: 13, textAlign: 'right', color: '#6b7280' }}>{fmt(sum.previously.total)}</td>
                            <td style={{ padding: '9px 12px', fontSize: 13, textAlign: 'right', fontWeight: 700 }}>{fmt(sum.thisCert.total)}</td>
                            <td style={{ padding: '9px 12px', fontSize: 12.5, whiteSpace: 'nowrap', color: '#374151' }}>{a.paymentDate ? fmtDate(a.paymentDate) : '—'}</td>
                            <td style={{ padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button onClick={() => setOpenId(a.id)} style={{ background: '#f0f2f5', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#374151', fontWeight: 600 }}>{(a.status && a.status !== 'draft') ? 'View' : 'Open'}</button>
                              {(!a.status || a.status === 'draft') && <button onClick={() => deleteApp(a)} style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', color: '#dc2626', fontWeight: 600, marginLeft: 6 }}>Delete</button>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  </div>
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

// The application before this one, by seq. Needed by the list badges as well as the
// gross, so it is its own function rather than buried inside prevGrossForApp.
function prevAppForApp(sortedApps, app) {
  let prev = null
  for (const a of sortedApps) { if ((a.seq || 0) < (app.seq || 0)) prev = a }
  return prev
}
function prevGrossForApp(sortedApps, app) {
  const prev = prevAppForApp(sortedApps, app)
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
                if (!confirm(`Are you sure you don't have an application for works completed on site for this project this month?\n\n${projectLabel(r.jobNo, r.name)}`)) return
                try {
                  await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dismiss-month', projectId: r.xeroId, monthKey: r.monthKey || (r.appDate ? r.appDate.slice(0, 7) : '') }) })
                  if (onDismissed) onDismissed(r.xeroId)
                } catch {}
              }
              return (
                <tr key={r.xeroId} style={{ borderBottom: '1px solid #f0f0f0', opacity: r.status === 'dismissed' ? 0.55 : 1 }}>
                  <td style={{ padding: '9px 14px', fontSize: 13, fontWeight: 600 }}>{projectLabel(r.jobNo, r.name) || r.xeroId}</td>
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
                    {/* A stale warning here BLOCKS the row, so there has to be a way to
                        clear it without reloading the page. The table is fetched once on
                        mount and rates are locked on another page - if you have just
                        locked them, Recheck is the honest answer. */}
                    {needsCR ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 11 }}>{r.crStatus === 'none' ? 'CR not set up' : 'CR not locked'}</span>
                        <button onClick={() => { setUpcoming(u => ({ ...u, loading: true })); loadUpcoming() }}
                          title="Re-check. If you have just locked the rates, this picks it up."
                          style={{ background: 'none', border: 'none', padding: 0, color: '#2563eb', fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Recheck</button>
                      </span>
                    )
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
// Percentage input that accepts DECIMALS.
//
// The old inputs coerced to a number on every keystroke, so typing "12." became
// parseFloat("12.") = 12, the field re-rendered as "12" and the decimal point could never
// be typed. Starting with "0" was worse: 0 is falsy, so `value={pct ? pct : ''}` blanked
// the field before you could type "0.5".
//
// Fix: hold the RAW TEXT while the field is being edited so the point survives, while
// still committing the parsed number on every keystroke so totals stay live. The draft is
// dropped on blur, so the field then shows the clamped, canonical value.
function PctInput({ value, onCommit, width = 58, max = 100, style }) {
  const [draft, setDraft] = useState(null)
  const shown = draft !== null ? draft : (value === '' || value == null ? '' : String(value))

  function change(raw) {
    // Digits and a single decimal point only.
    let t = String(raw).replace(/[^0-9.]/g, '')
    const bits = t.split('.')
    if (bits.length > 2) t = bits[0] + '.' + bits.slice(1).join('')
    setDraft(t)
    if (t === '' || t === '.') { onCommit(0); return }
    const n = parseFloat(t)
    if (isNaN(n)) { onCommit(0); return }
    onCommit(Math.max(0, Math.min(max, n)))
  }

  return (
    <input type="text" inputMode="decimal" value={shown}
      onChange={e => change(e.target.value)}
      onBlur={() => setDraft(null)}
      style={{ width, padding: '4px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 12.5, textAlign: 'right', ...(style || {}) }} />
  )
}

function ApplicationEditor({ app: appProp, appNumber, prevGross, prevReleases, isFirstApp, projectId, me, settings = {}, trackerVariations = [], projectPOs = [], hiddenPOs = [], onHiddenPOsChange, onBack, onDelete, onSaved, onVariationChange }) {
  // The application is now EDITABLE state, not a read-only prop. Its dates and period
  // were fixed at creation, so getting the month wrong meant deleting a finished
  // application and doing the whole thing again.
  const [app, setApp] = useState(() => ({ ...appProp }))
  const [editDates, setEditDates] = useState(false)
  // Months to choose from: 6 back, 12 ahead, plus any period Project Details has dates
  // for (including the "#2" rows a fortnightly project uses), plus whatever this
  // application is already on so its own value is never missing from the list.
  const periodOptions = useMemo(() => {
    const keys = new Set()
    for (let i = -6; i <= 12; i++) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i)
      keys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    for (const k of Object.keys(settings.dateOverrides || {})) keys.add(k)
    if (appProp.monthKey) keys.add(appProp.monthKey)
    return [...keys].sort()
  }, [settings, appProp.monthKey])
  // Follow the prop when a genuinely different application is opened, but do NOT clobber
  // in-progress edits when the same one is re-rendered after a save.
  useEffect(() => { setApp(a => (a.id === appProp.id ? a : { ...appProp })) }, [appProp.id])
  // STATUS IS THE SERVER'S TO SET, NOT THE EDITOR'S.
  //
  // The guard above deliberately ignores the prop for the application already open, which
  // is right for the fields you are typing into - a save coming back must not overwrite
  // them. But it also ignored the status, so sending an application left the badge saying
  // Draft until the page was reloaded.
  //
  // Only these fields are taken from the prop: nothing here is user-editable, so there is
  // no edit to lose.
  useEffect(() => {
    setApp(a => {
      if (a.id !== appProp.id) return a
      if (a.status === appProp.status && a.sentAt === appProp.sentAt && a.appNumber === appProp.appNumber) return a
      return { ...a, status: appProp.status, sentAt: appProp.sentAt, sentBy: appProp.sentBy, appNumber: appProp.appNumber }
    })
  }, [appProp.status, appProp.sentAt, appProp.appNumber, appProp.id])
  const [rows, setRows] = useState(() => appProp.contractWorks.map(r => ({ ...r })))
  // Per-application variation data (pct + attachments), keyed by varKey.
  const [variationData, setVariationData] = useState(() => ({ ...(app.variationData || {}) }))
  const [mats, setMats] = useState(() => (app.materials || []).map(m => ({ ...m })))
  const [dirty, setDirty] = useState(false)
  const [appNoEdit, setAppNoEdit] = useState(() => String(app.appNumber || appNumber || ''))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [showAddMat, setShowAddMat] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [viewer, setViewer] = useState(null)   // { title, items, key?, canRemove }
  // "Previously certified" gross is entered MANUALLY (blank until typed). The first
  // application has no prior, so it's fixed at £0.
  const [prevCertGross, setPrevCertGross] = useState(() => (isFirstApp ? '0' : (app.prevCertGross != null ? String(app.prevCertGross) : '')))
  // The previous application's GROSS, shown beside the field as a prompt. This is the
  // figure that belongs there, and having it on screen is worth more than any wording -
  // it is only typed by hand when the app cannot work it out, which is exactly when
  // somebody is reading off a paper certificate and reaches for the wrong line.
  //
  // Built the same way the editor builds its own summary, variations included, so a draft
  // predecessor gives the right number rather than one missing its variations.
  const prevAppGross = useMemo(() => {
    if (isFirstApp || !prevReleases) return null
    try {
      const built = { ...prevReleases, variations: buildAppVariations(prevReleases, trackerVariations) }
      const g = computeApplicationSummary(built, 0).grossCurrent
      return (g != null && isFinite(g) && g > 0) ? g : null
    } catch { return null }
  }, [prevReleases, trackerVariations, isFirstApp])

  const prevCertEntered = isFirstApp || (prevCertGross !== '' && prevCertGross != null && !isNaN(parseFloat(prevCertGross)))
  const prevCertValue = isFirstApp ? 0 : (prevCertEntered ? parseFloat(prevCertGross) : 0)
  const isSent = !!app.status && app.status !== 'draft'
  const locked = isSent && !unlocked

  // The variation list: live from the tracker for drafts, frozen for sent apps.
  const vars = useMemo(() => buildAppVariations({ ...app, variationData }, trackerVariations), [app, variationData, trackerVariations])

  const workApp = { ...app, contractWorks: rows, variations: vars, materials: mats }
  const sum = useMemo(() => computeApplicationSummary(workApp, prevCertValue, prevReleases), [rows, vars, mats, prevCertValue, app.mcdPct, app.retentionPct, app.retentionRelease1, app.retentionRelease2, prevReleases])

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
    if (!prevCertEntered) { setMsg('Enter the "Previously certified" amount before marking as sent.'); alert('Please insert the Previously Certified amount before submitting this application.'); return }
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
        body: JSON.stringify({ action: 'save', projectId, allowSubmittedEdit: unlocked, application: { ...app, appNumber: appNoEdit === '' ? app.appNumber : (parseInt(appNoEdit, 10) || app.appNumber), contractWorks: rows, variationData, materials: mats, prevCertGross: isFirstApp ? 0 : (prevCertEntered ? prevCertValue : null) } }),
      }).then(r => r.json())
      if (!d.ok) { setMsg(d.error || 'Save failed.'); setSaving(false); return }
      onSaved(d.application); setDirty(false)
      if (submit) {
        const s = await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', projectId, id: app.id, author: me?.name || '' }) }).then(r => r.json())
        if (s.ok) {
          onSaved(s.application)
          // The editor keeps its OWN copy of the application (so a save cannot clobber
          // what you are typing), and that copy is only refreshed when a DIFFERENT
          // application is opened. Without this line the badge at the top stayed on
          // "Draft" after sending, because the parent's list had updated and the
          // editor's copy had not.
          setApp(a => ({ ...a, ...s.application }))
          setUnlocked(false)
          setDirty(false)
          setMsg('Marked as sent.')
          // Back to the list, so the action is visibly done. Deferred a tick so the
          // "Marked as sent." message renders before the view changes.
          setTimeout(() => onBack && onBack(), 400)
        }
      } else setMsg('Saved.')
    } catch { setMsg('Save failed.') }
    setSaving(false)
  }

  // Auto-save drafts as you work (debounced). Sent apps only auto-save while unlocked
  // for editing. Never auto-submits - sending stays a manual action.
  useEffect(() => {
    if (!dirty || locked) return
    const t = setTimeout(() => { save(false) }, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, rows, variationData, mats, appNoEdit, prevCertGross])

  const th = { padding: '9px 10px', textAlign: 'left', fontWeight: 700, color: '#6b7280', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }
  const thR = { ...th, textAlign: 'right' }
  const td = { padding: '7px 10px', fontSize: 12.5, verticalAlign: 'middle' }
  const tdR = { ...td, textAlign: 'right' }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 13, cursor: 'pointer' }}>‹ All applications</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>
          <span>Application</span>
          <input type="text" inputMode="numeric" disabled={locked} value={appNoEdit}
            onChange={e => { setAppNoEdit(e.target.value); setDirty(true) }}
            title="Application number (auto-assigned; edit to override)"
            style={{ width: 46, padding: '3px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 15, fontWeight: 700, textAlign: 'center' }} />
          {/* PERIOD - changeable. Picking the wrong month at creation used to mean
              deleting the application and rebuilding it from scratch. */}
          <span>&mdash;</span>
          <select
            disabled={locked}
            value={app.monthKey || ''}
            onChange={e => {
              const mk = e.target.value
              const d = resolveAppDates(mk, settings)
              // Take the period's own dates where Project Details has them; keep what is
              // already on the application where it does not, so a manual date entered
              // above is not wiped by changing the month.
              setApp(a => ({
                ...a, monthKey: mk, monthLabel: monthLabel(mk),
                appDate: d.appDate || a.appDate,
                valDate: d.valDate || a.valDate,
                paymentDate: d.paymentDate || a.paymentDate,
                finalDate: d.finalDate || a.finalDate,
              }))
              setDirty(true)
            }}
            title="The month (or period) this application is for"
            style={{ padding: '3px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', background: '#fff' }}>
            {periodOptions.map(k => <option key={k} value={k}>{monthLabel(k)}</option>)}
          </select>
          {/* FINAL ACCOUNT. A flag on the application, not a different kind of document -
              it keeps its number, its period and its dates, and only how it presents
              itself changes. Marking it any other way would break the numbering. */}
          <label title="Mark this as the final account. The number, period and dates stay as they are; the PDF and email are titled &quot;Proposed Final Account and Interim Application for Payment&quot;."
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 10, padding: '3px 10px', borderRadius: 14, border: `1px solid ${app.isFinalAccount ? '#0f766e' : '#d5d9e0'}`, background: app.isFinalAccount ? '#ccfbf1' : '#fff', cursor: locked ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 700, color: app.isFinalAccount ? '#0f766e' : '#666', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={!!app.isFinalAccount} disabled={locked}
              onChange={(e) => { setApp(a => ({ ...a, isFinalAccount: e.target.checked })); setDirty(true) }} />
            Final Account
          </label>
        </div>
        <span style={{ padding: '2px 8px', borderRadius: 5, fontWeight: 700, fontSize: 11, background: isSent ? '#dcfce7' : '#fef9c3', color: isSent ? '#16a34a' : '#a16207' }}>{isSent ? (unlocked ? 'Sent — editing' : 'Sent') : 'Draft'}</span>
        <div style={{ flex: 1 }} />
        {isSent && !unlocked && <button onClick={() => { if (confirm('Are you sure you want to edit an application that has already been issued to the customer?\n\nEditing will move it back to draft — you will need to send it (or mark it as sent) again. Its application number stays the same.')) setUnlocked(true) }} style={{ background: '#fff', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Edit application</button>}
        {isSent && unlocked && <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>Editing an issued application — re-send when done</span>}
        <a href={`/api/application-pdf?projectId=${encodeURIComponent(projectId)}&appId=${encodeURIComponent(app.id)}&download=1`} target="_blank" rel="noreferrer" style={{ background: '#f0f2f5', border: '1px solid #e5e7eb', color: '#374151', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Download PDF</a>
        <button onClick={() => { if (!prevCertEntered) { alert('Please insert the Previously Certified amount before sending this application.'); return } if (dirty) { setMsg('Save your changes before sending.'); return } setShowSend(true) }} style={{ background: '#0369a1', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Send to customer</button>
        {!locked && <button onClick={() => save(false)} disabled={saving || !dirty} style={{ background: dirty ? '#0f766e' : '#e5e7eb', color: dirty ? '#fff' : '#9ca3af', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: dirty ? 'pointer' : 'default' }}>{saving ? 'Saving…' : 'Save'}</button>}
        {!locked && !isSent && <button onClick={trySubmit} disabled={saving} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>Mark as sent</button>}
        {onDelete && <button onClick={onDelete} style={{ background: '#fff', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Delete</button>}
      </div>

      {showSend && <SendApplicationModal app={app} appNumber={appNumber} projectId={projectId} settings={settings} me={me} isSent={isSent} prevReleases={prevReleases} onClose={() => setShowSend(false)} onSent={(updated) => {
        setShowSend(false)
        if (updated) { onSaved(updated); setApp(a => ({ ...a, ...updated })) }
        setMsg('Application sent.')
        setTimeout(() => onBack && onBack(), 400)
      }} />}

      {msg && <div style={{ fontSize: 12.5, color: msg.includes('fail') ? '#dc2626' : '#0f766e', marginBottom: 12 }}>{msg}</div>}

      {/* DATES - EDITABLE IN PLACE.
          These were read-only cards, so a wrong period meant deleting a finished
          application and starting again. They are ordinary fields now: click Edit dates,
          change what is wrong, Save. Nothing else about the application is touched. */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Dates</div>
          <button type="button" onClick={() => setEditDates(v => !v)}
            style={{ background: 'none', border: 'none', padding: 0, color: '#4f46e5', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {editDates ? 'Done' : 'Edit dates'}
          </button>
          {isSent && !unlocked && editDates && (
            <span style={{ fontSize: 11, color: '#c2410c' }}>Sent - unlock first to change these.</span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {[['Application date', 'appDate'], ['Valuation date', 'valDate'], ['Payment due', 'paymentDate'], ['Final date for payment', 'finalDate']].map(([l, field]) => (
            <div key={field} style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{l}</div>
              {editDates
                ? <input type="date" value={app[field] || ''}
                    disabled={isSent && !unlocked}
                    onChange={e => { setApp(a => ({ ...a, [field]: e.target.value })); setDirty(true) }}
                    style={{ width: '100%', fontSize: 13, padding: '4px 6px', border: '1px solid #e5e7eb', borderRadius: 6, fontFamily: 'inherit' }} />
                : <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>{fmtDate(app[field])}</div>}
            </div>
          ))}
        </div>
        {editDates && (
          <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
            Changing these does not move the application to another month on the register -
            use &ldquo;Period&rdquo; below the title for that.
          </div>
        )}
      </div>

      {/* Previously certified — entered manually (required from App 2 onwards) */}
      {!isFirstApp && (
        <div style={{ background: prevCertEntered ? '#fff' : '#fffbeb', border: '1px solid ' + (prevCertEntered ? '#e5e7eb' : '#fde68a'), borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>Previously certified (gross)</div>
            <div style={{ fontSize: 11.5, color: prevCertEntered ? '#94a3b8' : '#b45309' }}>
              {prevCertEntered ? 'Used as the "Previously Cert." column. This certificate = current − previously.' : '⚠ Insert the previously certified amount — you can’t submit or send until this is entered.'}
            </div>
            {/* GROSS, not net. The easiest mistake on this page: the number staring at you
                from the last application is its TOTAL, and putting that here computes MCD
                and retention from the wrong base - every line of this certificate comes
                out too high. Worth saying at the point of entry rather than in a manual. */}
            <div style={{ fontSize: 11.5, color: '#475569', marginTop: 4, lineHeight: 1.5 }}>
              <strong>Gross</strong> &mdash; <strong>before</strong> MCD and <strong>before</strong> retention.
              Take the <strong>Gross</strong> row from the previous application&rsquo;s certificate, not its Total.
              {prevAppGross != null && (
                <> The previous application&rsquo;s gross was <strong>{fmt(prevAppGross)}</strong>.</>
              )}
            </div>
            {/* Flag a mismatch rather than only describing the rule. The wrong figure
                looks perfectly reasonable - it is a real number off a real certificate -
                so the only way to catch it is to compare. */}
            {prevAppGross != null && prevCertEntered && Math.abs(parseFloat(prevCertGross) - prevAppGross) > 1 && (
              <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 5, lineHeight: 1.5 }}>
                &#9888; This does not match the previous application&rsquo;s gross of <strong>{fmt(prevAppGross)}</strong>.
                {' '}If you have entered its <em>Total</em> by mistake, every line of this certificate will be too high.
                {!locked && (
                  <button onClick={() => { setPrevCertGross(String(prevAppGross)); setDirty(true) }}
                    style={{ marginLeft: 8, background: 'none', border: 'none', padding: 0, color: '#2563eb', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
                    Use {fmt(prevAppGross)}
                  </button>
                )}
              </div>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 15, color: '#374151' }}>£</span>
            <input type="number" step="0.01" min="0" disabled={locked} value={prevCertGross}
              onChange={e => { setPrevCertGross(e.target.value); setDirty(true) }}
              placeholder="0.00"
              style={{ width: 160, padding: '8px 10px', border: '1px solid ' + (prevCertEntered ? '#d5d9e0' : '#f59e0b'), borderRadius: 8, fontSize: 14, textAlign: 'right', background: locked ? '#f8f9fa' : '#fff' }} />
          </div>
        </div>
      )}

      {/* Summary + Certificate (shown at the top) */}
      {/* SummaryBlock is a SEPARATE component - the Retention section and the two
          release lines live in it, so everything they touch has to be passed in. The
          crash was prevReleases being read here while only existing in the editor. */}
      <SummaryBlock sum={sum} app={app} prevReleases={prevReleases} locked={locked}
        onToggleRelease={(field, val) => { setApp(a => ({ ...a, [field]: val })); setDirty(true) }} />

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
                          <PctInput value={r.pctComplete} onCommit={(n) => setPct(r.id, n)} width={58} />
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
                          <PctInput value={v.pctComplete} onCommit={(n) => setVarPct(v.key, n)} width={58} />
                          <button title="100%" onClick={() => setVarPct(v.key, 100)} style={{ background: v.pctComplete === 100 ? '#16a34a' : '#f0f2f5', color: v.pctComplete === 100 ? '#fff' : '#16a34a', border: '1px solid ' + (v.pctComplete === 100 ? '#16a34a' : '#d1fae5'), borderRadius: 5, padding: '3px 7px', fontSize: 12, cursor: 'pointer', lineHeight: 1 }}>✓</button>
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdR, fontWeight: 600, ...(instructed ? {} : { color: '#cbd5e1', fontWeight: 400 }) }}>{instructed ? fmt(vtd) : 'N/A'}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {(v.attachments || []).length > 0 && (
                          <button onClick={() => setViewer({ title: `Variation ${v.varNumber || ''} — attachments`, items: v.attachments, key: v.key, canRemove: !locked })}
                            title={`${v.attachments.length} attachment${v.attachments.length > 1 ? 's' : ''}`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#eef2ff', border: '1px solid #c7d2fe', color: '#4338ca', borderRadius: 6, padding: '3px 8px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            📎 {v.attachments.length}
                          </button>
                        )}
                        {!locked && <label style={{ fontSize: 11, color: '#0f766e', cursor: 'pointer' }}>+ Attach<input type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attachToVar(v.key, f) }} /></label>}
                      </div>
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
                          {(m.attachments || []).length > 0 && (
                            <button onClick={() => setViewer({ title: `${m.supplier || 'Supplier'}${m.poNumber ? ' ' + m.poNumber : ''} — attachments`, items: m.attachments, groupId: m.id, canRemove: !locked })}
                              title={`${m.attachments.length} attachment${m.attachments.length > 1 ? 's' : ''}`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#eef2ff', border: '1px solid #c7d2fe', color: '#4338ca', borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                              📎 {m.attachments.length}
                            </button>
                          )}
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
                        <PctInput value={m.markupPct ?? 0} onCommit={(n) => setMatField(m.id, 'markupPct', n)} width={52} max={1000}
                          style={{ border: '1px solid ' + (noMarkup ? '#dc2626' : '#fdba74'), background: '#fff' }} />
                      </div>
                    )}</td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{fmt(total)}</td>
                    <td style={tdR}>{locked ? `${pct}%` : (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                        <PctInput value={pct} onCommit={(n) => setMatPct(m.id, n)} width={52} />
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

      {showAddMat && <AddMaterialsModal pos={projectPOs} addedPONumbers={addedPONumbers} addedLineKeys={addedLineKeys} hiddenPOs={hiddenPOs} onToggleHide={toggleHidePO} onClose={() => setShowAddMat(false)} onAdd={addMaterial} onAddGroup={addMaterialGroup} onRemove={removeMaterialByKey} />}
      {viewer && <AttachmentViewer
        title={viewer.title}
        items={(viewer.key ? ((variationData[viewer.key] || {}).attachments || []) : viewer.groupId ? ((mats.find(x => x.id === viewer.groupId) || {}).attachments || []) : viewer.items) || []}
        canRemove={viewer.canRemove}
        onRemove={(url) => { if (viewer.key) removeAttachment(viewer.key, url); else if (viewer.groupId) removeGroupAttachment(viewer.groupId, url) }}
        onClose={() => setViewer(null)}
      />}
    </>
  )
}

function SummaryBlock({ sum, app, prevReleases = null, locked = false, onToggleRelease }) {
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
    // Summary | Retention | Certificate, side by side. Retention sits in the middle
    // deliberately: it is the bridge between what has been done and what is being
    // certified, and both neighbours reference it.
    //
    // Retention is the narrowest of the three - it is two tick boxes and a total, where
    // the others are four-column tables.
    // auto-fit with a 340px minimum: three across on a wide screen, two then one as it
    // narrows. A fixed three-column grid would have crushed the tables on a laptop, which
    // is what most of these are opened on.
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginBottom: 16, alignItems: 'start' }}>
      {/* top block */}
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <div style={{ padding: '12px 16px', fontSize: 14, fontWeight: 700, color: '#1a1a2e', borderBottom: '1px solid #eee' }}>Summary</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f8f9fa' }}><th style={{ ...th, textAlign: 'left' }}></th><th style={th}>Contract Sum</th><th style={th}>Application Total</th><th style={th}>Proj. Final Account</th></tr></thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}><td style={{ padding: '8px 12px', fontSize: 13 }}>Measured Work</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.measuredContractSum)}</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.measuredToDate)}</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.measuredContractSum)}</td></tr>
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}><td style={{ padding: '8px 12px', fontSize: 13 }}>Variations</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}></td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.variationsToDate)}</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.variationsFinal)}</td></tr>
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}><td style={{ padding: '8px 12px', fontSize: 13 }}>Materials On Site</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}></td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.materialsOnSite)}</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}></td></tr>
            {/* Retention release, mirrored from the Retention section below. Shown even
                when nothing is ticked, so it is visible that the halves exist and how
                much each is worth. */}
            {[[1, sum.release1Value, sum.rel1, sum.rel1New], [2, sum.release2Value, sum.rel2, sum.rel2New]].map(([n, val, on, isNew]) => (
              <tr key={n} style={{ borderBottom: '1px solid #f0f0f0', color: on ? '#166534' : '#999' }}>
                <td style={{ padding: '8px 12px', fontSize: 13 }}>
                  {n === 1 ? '1st' : '2nd'} Release Retention
                  {!on && <span style={{ fontSize: 11, color: '#bbb' }}> — not claimed</span>}
                  {on && !isNew && <span style={{ fontSize: 11, color: '#888' }}> — released previously</span>}
                </td>
                <td style={{ padding: '8px 12px' }}></td>
                <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right', fontWeight: on ? 700 : 400 }}>{on ? fmt(val) : fmt(0)}</td>
                <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right', color: '#bbb' }}>{fmt(sum.halfRetention)}</td>
              </tr>
            ))}
            <tr style={{ background: '#f8f9fa', fontWeight: 700 }}><td style={{ padding: '8px 12px', fontSize: 13 }}>Application Total</td><td style={{ padding: '8px 12px' }}></td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.applicationTotal)}</td><td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{fmt(sum.anticipatedFinalAccount)}</td></tr>
          </tbody>
        </table>
      </div>
      {/* RETENTION - the middle column. Styled to match its two neighbours: same card,
          same radius, same header bar, so the three read as one row rather than a panel
          that wandered in. */}
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <div style={{ padding: '12px 16px', fontSize: 14, fontWeight: 700, color: '#1a1a2e', borderBottom: '1px solid #eee' }}>Retention</div>
        <div style={{ padding: 16 }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
          Retention on the final account is {fmt(sum.retentionOnFinal)} at {app.retentionPct || 0}%.
          Each half is {fmt(sum.halfRetention)}. Tick a half when it falls due and it is added to this application.
        </div>
        {[
          [1, 'retentionRelease1', '1st Half', sum.release1Value],
          [2, 'retentionRelease2', '2nd Half', sum.release2Value],
        ].map(([n, field, label, val]) => {
          // A half already claimed on an EARLIER application stays ticked and is locked -
          // unticking it here would not un-claim it, it would just make this certificate
          // wrong.
          const claimedBefore = !!(prevReleases && prevReleases[field])
          const on = !!app[field]
          return (
            <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', marginBottom: 6, borderRadius: 8, border: `1px solid ${on ? '#bbf7d0' : '#e5e7eb'}`, background: on ? '#f0fdf4' : '#fff', cursor: (locked || claimedBefore) ? 'default' : 'pointer' }}>
              <input type="checkbox" checked={on} disabled={locked || claimedBefore || !onToggleRelease}
                onChange={(e) => onToggleRelease && onToggleRelease(field, e.target.checked)} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: '#1a1a2e', minWidth: 70 }}>{label}</span>
              <span style={{ fontSize: 13, color: on ? '#166534' : '#888' }}>{fmt(sum.halfRetention)}</span>
              {claimedBefore && <span style={{ fontSize: 11, color: '#888' }}>already claimed on an earlier application</span>}
              <span style={{ flex: 1 }} />
              {on && !claimedBefore && <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>+{fmt(val)} on this certificate</span>}
            </label>
          )
        })}
        {sum.releasedTotal > 0 && (
          <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
            Total retention released to date: <strong>{fmt(sum.releasedTotal)}</strong> of {fmt(sum.retentionOnFinal)}.
          </div>
        )}
        </div>
      </div>

      {/* certificate block */}
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <div style={{ padding: '12px 16px', fontSize: 14, fontWeight: 700, color: '#1a1a2e', borderBottom: '1px solid #eee' }}>Certificate</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f8f9fa' }}><th style={{ ...th, textAlign: 'left' }}></th><th style={th}>Current</th><th style={th}>Previously Cert</th><th style={th}>This Cert</th></tr></thead>
          <tbody>
            {/* "Retention Released" sits between the deduction and the total, which is
                where it happens: retention comes off, the released half goes back on. */}
            {/* The rows follow how MCD is applied. Discount the whole account and it reads
                as it always did. Discount the measured work only and the variations and
                materials appear BELOW the discount, with a second sub-total - which is
                the order they are actually calculated in. */}
            {(sum.mcdSplit
              ? [
                  ['Gross measured work', 'mcdBase'],
                  [`MCD @ ${app.mcdPct}%`, 'mcd'],
                  ['Sub-Total', 'subTotal'],
                  [sum.mcdOnVars ? 'Materials on site' : (sum.mcdOnMos ? 'Variations' : 'Variations & materials'), 'after'],
                  ['Sub-Total', 'netBeforeRet'],
                  [`Retention @ ${app.retentionPct}%`, 'retention'],
                  ...(sum.releasedTotal > 0 ? [['Retention Released', 'released']] : []),
                  ['Total', 'total'],
                ]
              : [
                  ['Gross', 'gross'],
                  [`MCD @ ${app.mcdPct}%`, 'mcd'],
                  ['Sub-Total', 'subTotal'],
                  [`Retention @ ${app.retentionPct}%`, 'retention'],
                  ...(sum.releasedTotal > 0 ? [['Retention Released', 'released']] : []),
                  ['Total', 'total'],
                ]
            ).map(([label, key]) => (
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
function SendApplicationModal({ app, appNumber, projectId, settings = {}, me, isSent, prevReleases = null, onClose, onSent }) {
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

  // One description for the subject, the body and the PDF - see describeApplication.
  const desc = describeApplication(app, { prevReleases })
  const defaultSubject = `${desc.titleFull} ${appNo} - ${monthName} ${year}`
  // Spelled out in the body as well as the subject. A retention release is a claim the
  // customer has to recognise and approve, and a subject line alone is easy to skim past.
  const releaseLine = desc.releases.length
    ? `This application includes the ${desc.releases.join(' and the ').toLowerCase()}.\n\n`
    : ''
  // Same care as the document: proposed, and the payment is interim.
  const finalLine = desc.isFinal
    ? `This is our proposed final account for this project. The payment claimed is interim and remains subject to agreement.\n\n`
    : ''
  const defaultBody =
    `Hi ${custName},\n\n` +
    `Please find attached our ${desc.isFinal ? 'proposed final account and interim application for payment' : 'application for payment'} ${appNo} for ${monthName}.\n\n` +
    finalLine +
    releaseLine +
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

// View a set of attachments. PDFs and images preview inline; everything else
// (emails such as .eml/.msg, Word, Excel, etc.) shows as an Open/Download link —
// browsers can't render those inline, so the person opens them in the relevant app.
function AttachmentViewer({ title, items = [], canRemove, onRemove, onClose }) {
  const list = Array.isArray(items) ? items : []
  const [sel, setSel] = useState(0)
  const cur = list[sel] || null
  const kind = (name = '', url = '') => {
    const s = (name || url || '').toLowerCase()
    if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/.test(s)) return 'image'
    if (/\.pdf(\?|$)/.test(s)) return 'pdf'
    if (/\.(eml|msg)(\?|$)/.test(s)) return 'email'
    return 'other'
  }
  const k = cur ? kind(cur.name, cur.url) : 'other'
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 900, maxWidth: '100%', height: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #eee' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>{title}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#888', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* file list */}
          <div style={{ width: 230, borderRight: '1px solid #eee', overflowY: 'auto', padding: 8 }}>
            {list.map((a, i) => (
              <div key={a.url} onClick={() => setSel(i)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: i === sel ? '#eef2ff' : 'transparent', marginBottom: 4 }}>
                <span style={{ fontSize: 13 }}>{kind(a.name, a.url) === 'image' ? '🖼️' : kind(a.name, a.url) === 'pdf' ? '📄' : kind(a.name, a.url) === 'email' ? '✉️' : '📎'}</span>
                <span style={{ fontSize: 12, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={a.name}>{a.name}</span>
                {canRemove && <button onClick={(e) => { e.stopPropagation(); onRemove(a.url); if (sel >= list.length - 1) setSel(0) }} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>×</button>}
              </div>
            ))}
            {list.length === 0 && <div style={{ fontSize: 12, color: '#aaa', padding: 10 }}>No attachments.</div>}
          </div>
          {/* preview */}
          <div style={{ flex: 1, minWidth: 0, background: '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
            {!cur ? <div style={{ color: '#aaa', fontSize: 13 }}>Select an attachment</div>
              : k === 'image' ? <img src={cur.url} alt={cur.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              : k === 'pdf' ? <iframe src={cur.url} title={cur.name} style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
              : (
                <div style={{ textAlign: 'center', color: '#555' }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>{k === 'email' ? '✉️' : '📎'}</div>
                  <div style={{ fontSize: 13, marginBottom: 4, fontWeight: 600 }}>{cur.name}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>{k === 'email' ? 'Emails open in your mail app.' : 'This file type can\u2019t preview here.'}</div>
                  <a href={cur.url} target="_blank" rel="noreferrer" download style={{ background: '#0369a1', color: '#fff', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>Open / Download</a>
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}
