import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import ProjectDatesModal from '../components/ProjectDatesModal'

function getDateForProject(project, field, year, month) {
  const dayField = field === 'applicationDate' ? 'applicationDay' : field === 'valuationDate' ? 'valuationDay' : 'paymentDay'
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const overrides = project.dateOverrides || {}
  const override = overrides[monthKey]?.[field]
  if (override) return override
  const day = parseInt(project[dayField])
  if (!day || isNaN(day)) return null
  const daysInMonth = new Date(year, month, 0).getDate()
  const actualDay = Math.min(day, daysInMonth)
  return `${year}-${String(month).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`
}

function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function CalendarMonth({ year, month, projects, onProjectClick }) {
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' })
  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const startOffset = firstDay === 0 ? 6 : firstDay - 1

  const dayMap = {}
  for (const p of projects) {
    const appDate = getDateForProject(p, 'applicationDate', year, month)
    const valDate = getDateForProject(p, 'valuationDate', year, month)
    const payDate = getDateForProject(p, 'paymentDate', year, month)
    const missingAny = !appDate || !valDate || !payDate

    if (appDate) {
      const d = parseInt(appDate.split('-')[2])
      if (!dayMap[d]) dayMap[d] = []
      dayMap[d].push({ project: p, type: 'application', appDate, valDate, payDate, missingAny })
    }
    if (missingAny && !appDate) {
      if (!dayMap[0]) dayMap[0] = []
      dayMap[0].push({ project: p, type: 'warning', appDate, valDate, payDate, missingAny: true })
    }
  }

  const days = []
  for (let i = 0; i < startOffset; i++) days.push(null)
  for (let d = 1; d <= daysInMonth; d++) days.push(d)

  const today = new Date()
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month
  const todayDay = today.getDate()

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e', marginBottom: 12, textAlign: 'center' }}>{monthName}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: '#e5e5e5', borderRadius: 8, overflow: 'hidden' }}>
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
          <div key={d} style={{ background: '#1a1a2e', color: '#aaa', fontSize: 11, fontWeight: 600, textAlign: 'center', padding: '6px 0' }}>{d}</div>
        ))}
        {dayMap[0]?.length > 0 && (
          <div style={{ gridColumn: '1 / -1', background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '6px 10px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#92400e', fontWeight: 600 }}>⚠ Missing dates:</span>
            {dayMap[0].map((e, i) => (
              <span key={i} onClick={() => onProjectClick(e)}
                style={{ fontSize: 11, color: '#92400e', cursor: 'pointer', textDecoration: 'underline' }}>
                {e.project.jobNo} — {e.project.name}
              </span>
            ))}
          </div>
        )}
        {days.map((d, i) => {
          const events = d ? (dayMap[d] || []) : []
          const isToday = isCurrentMonth && d === todayDay
          const MAX_SHOW = 2
          const shown = events.slice(0, MAX_SHOW)
          const overflow = events.length - MAX_SHOW

          return (
            <div key={i} style={{
              background: isToday ? '#dcfce7' : '#fff',
              minHeight: 90,
              padding: '4px 5px',
            }}>
              {d && (
                <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? '#15803d' : '#888', marginBottom: 3 }}>{d}</div>
              )}
              {shown.map((e, ei) => (
                <div key={ei} onClick={() => onProjectClick(e)}
                  style={{
                    background: e.type === 'warning' ? '#fef3c7' : '#dbeafe',
                    border: `1px solid ${e.type === 'warning' ? '#fbbf24' : '#93c5fd'}`,
                    borderRadius: 4, padding: '3px 5px', marginBottom: 2,
                    cursor: 'pointer', fontSize: 10, lineHeight: 1.4,
                  }}>
                  <div style={{ fontWeight: 600, color: '#1e3a5f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.type === 'warning' ? '⚠ ' : ''}{e.project.jobNo}
                  </div>
                  <div style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.project.name}</div>
                  {e.valDate && <div style={{ color: '#6b7280' }}>Val: {fmtDate(e.valDate)}</div>}
                  {e.payDate && <div style={{ color: '#6b7280' }}>Pay: {fmtDate(e.payDate)}</div>}
                </div>
              ))}
              {overflow > 0 && (
                <div onClick={() => onProjectClick({ project: null, overflow: events.slice(MAX_SHOW), day: d, month, year })}
                  style={{ fontSize: 10, color: '#6b7280', cursor: 'pointer', textAlign: 'center', padding: '2px 0' }}>
                  +{overflow} more
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ApplicationCalendar() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editDates, setEditDates] = useState({})
  const [dayFields, setDayFields] = useState({ applicationDay: '', valuationDay: '', paymentDay: '' })
  const [monthOverrides, setMonthOverrides] = useState({})
  const [showManualMonths, setShowManualMonths] = useState(false)
  const [modalLoading, setModalLoading] = useState(false)

  const now = new Date()
  const [leftYear, setLeftYear] = useState(now.getFullYear())
  const [leftMonth, setLeftMonth] = useState(now.getMonth() + 1)

  const rightMonth = leftMonth === 12 ? 1 : leftMonth + 1
  const rightYear = leftMonth === 12 ? leftYear + 1 : leftYear

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard')
      const data = await res.json()
      let hiddenIds = []
      try { hiddenIds = (await fetch('/api/hidden-projects').then(r => r.json())).hidden || [] } catch {}
      const hiddenSet = new Set(hiddenIds.map(String))
      setProjects((data.projects || []).filter(p => p.status === 'INPROGRESS' && !hiddenSet.has(String(p.xeroId))))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  function goLeft() {
    if (leftMonth === 1) { setLeftMonth(12); setLeftYear(y => y - 1) }
    else setLeftMonth(m => m - 1)
  }

  function goRight() {
    if (leftMonth === 12) { setLeftMonth(1); setLeftYear(y => y + 1) }
    else setLeftMonth(m => m + 1)
  }

  async function openModal(e) {
    setModal(e)
    setShowManualMonths(false)
    if (e.project) {
      setEditDates({ appDate: e.appDate || '', valDate: e.valDate || '', payDate: e.payDate || '' })
      // Pull the project's current recurring day settings + any manual overrides.
      setModalLoading(true)
      try {
        const res = await fetch(`/api/project/${e.project.xeroId}`)
        const data = await res.json()
        const s = data.settings || {}
        setDayFields({
          applicationDay: s.applicationDay || '',
          valuationDay: s.valuationDay || '',
          paymentDay: s.paymentDay || '',
        })
        setMonthOverrides(s.dateOverrides || {})
      } catch { setDayFields({ applicationDay: '', valuationDay: '', paymentDay: '' }); setMonthOverrides({}) }
      setModalLoading(false)
    }
  }

  async function saveDates() {
    if (!modal?.project) return
    setSaving(true)
    try {
      const p = modal.project
      const res = await fetch(`/api/project/${p.xeroId}`)
      const data = await res.json()
      const settings = data.settings || {}

      const updatedSettings = {
        ...settings,
        // Recurring fixed day-of-month for each date type.
        applicationDay: dayFields.applicationDay || undefined,
        valuationDay: dayFields.valuationDay || undefined,
        paymentDay: dayFields.paymentDay || undefined,
        // Manual per-month overrides (identical model to Project Details).
        dateOverrides: monthOverrides,
      }

      await fetch(`/api/project/${p.xeroId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings),
      })

      // Update local project state so the calendar reflects it immediately.
      setProjects(prev => prev.map(proj => proj.xeroId === p.xeroId
        ? { ...proj, applicationDay: updatedSettings.applicationDay, valuationDay: updatedSettings.valuationDay, paymentDay: updatedSettings.paymentDay, dateOverrides: updatedSettings.dateOverrides }
        : proj
      ))
      setModal(null)
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  return (
    <>
      <Head><title>Rock Roofing — Application Calendar</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#f0f2f5' }}>

        <div style={{ background: '#1a1a19', padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', height: 56, gap: 8, overflowX: 'auto' }}>
            <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
            <Link href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>← Portal</Link>
            <span style={{ color: '#444' }}>|</span>
            <Link href="/commercial" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Project Financials</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/outstanding-invoices" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Outstanding Invoices</Link>
            <span style={{ color: '#444' }}>|</span>
            <Link href="/retention" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Retention</Link>
            <span style={{ color: '#444' }}>|</span>
            <Link href="/variations" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Variations</Link>
            <span style={{ color: '#444' }}>|</span>
            <Link href="/contracted-rates" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Contracted Rates</Link>
            <span style={{ color: '#444' }}>|</span>
            <Link href="/applications" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Applications</Link>
            <span style={{ color: '#444' }}>|</span>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Application Calendar</span>
            <span style={{ color: '#444' }}>|</span>
            <Link href="/wip" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>WIP</Link>
            <span style={{ color: '#444' }}>|</span>
            <Link href="/commercial-scorecard" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Commercial Scorecard</Link>
            <div style={{ flex: 1 }} />
            <button onClick={() => window.dispatchEvent(new CustomEvent('open-report-problem'))}
              style={{ background: 'none', border: 'none', color: '#ca8a04', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>⚠ Report app improvement</button>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1a1a2e' }}>Application Calendar</h1>
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#555', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 12, height: 12, borderRadius: 2, background: '#dbeafe', border: '1px solid #93c5fd', display: 'inline-block' }} /> Application date
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 12, height: 12, borderRadius: 2, background: '#dcfce7', border: '1px solid #86efac', display: 'inline-block' }} /> Today
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 12, height: 12, borderRadius: 2, background: '#fef3c7', border: '1px solid #fbbf24', display: 'inline-block' }} /> Missing dates
              </span>
            </div>
          </div>

          {/* Navigation arrows */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 16 }}>
            <button onClick={goLeft} style={{ fontSize: 20, background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
            <span style={{ fontSize: 13, color: '#555', minWidth: 200, textAlign: 'center' }}>
              {new Date(leftYear, leftMonth - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' })} &nbsp;→&nbsp; {new Date(rightYear, rightMonth - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' })}
            </span>
            <button onClick={goRight} style={{ fontSize: 20, background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading...</div>
          ) : (
            <div style={{ display: 'flex', gap: 20 }}>
              <CalendarMonth year={leftYear} month={leftMonth} projects={projects} onProjectClick={openModal} />
              <CalendarMonth year={rightYear} month={rightMonth} projects={projects} onProjectClick={openModal} />
            </div>
          )}
        </div>

        {/* Modal */}
        {modal && modal.overflow && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setModal(null)}>
            <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: '100%', maxWidth: 620, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: '#1a1a2e' }}>{`${modal.day}/${modal.month}/${modal.year} — All projects`}</h3>
                <button onClick={() => setModal(null)} style={{ fontSize: 20, border: 'none', background: 'none', cursor: 'pointer', color: '#888' }}>×</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {modal.overflow.map((e, i) => (
                  <div key={i} style={{ background: '#f8f9fa', borderRadius: 8, padding: '12px 14px', cursor: 'pointer' }} onClick={() => openModal(e)}>
                    <div style={{ fontWeight: 600, color: '#1a1a2e', marginBottom: 6 }}>{e.project.jobNo} — {e.project.name}</div>
                    <div style={{ fontSize: 12, color: '#888', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                      <div>App: {fmtDate(e.appDate)}</div>
                      <div>Val: {fmtDate(e.valDate)}</div>
                      <div>Pay: {fmtDate(e.payDate)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {modal && !modal.overflow && modal.project && (
          <ProjectDatesModal
            project={modal.project}
            onClose={() => setModal(null)}
            onSaved={(updatedSettings) => {
              setProjects(prev => prev.map(proj => proj.xeroId === modal.project.xeroId
                ? { ...proj, applicationDay: updatedSettings.applicationDay, valuationDay: updatedSettings.valuationDay, paymentDay: updatedSettings.paymentDay, dateOverrides: updatedSettings.dateOverrides }
                : proj))
              setModal(null)
            }}
          />
        )}
      </div>
    </>
  )
}
