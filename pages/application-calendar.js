import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'

function getDateForProject(project, field, year, month) {
  // field: 'applicationDate' | 'valuationDate' | 'paymentDate'
  const dayField = field === 'applicationDate' ? 'applicationDay' : field === 'valuationDate' ? 'valuationDay' : 'paymentDay'
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const overrides = project.dateOverrides || {}
  const override = overrides[monthKey]?.[field]
  if (override) return override
  const day = parseInt(project[dayField])
  if (!day || isNaN(day)) return null
  // Clamp day to valid days in month
  const daysInMonth = new Date(year, month, 0).getDate()
  const actualDay = Math.min(day, daysInMonth)
  return `${year}-${String(month).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`
}

function CalendarMonth({ year, month, projects, onProjectClick }) {
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' })
  const firstDay = new Date(year, month - 1, 1).getDay() // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate()
  const startOffset = firstDay === 0 ? 6 : firstDay - 1 // Mon=0

  // Build day -> events map
  const dayMap = {}
  for (const p of projects) {
    const appDate = getDateForProject(p, 'applicationDate', year, month)
    const valDate = getDateForProject(p, 'valuationDate', year, month)
    const payDate = getDateForProject(p, 'paymentDate', year, month)
    const missingAny = !appDate || !valDate || !payDate

    // Application event
    if (appDate) {
      const d = parseInt(appDate.split('-')[2])
      if (!dayMap[d]) dayMap[d] = []
      dayMap[d].push({ project: p, type: 'application', appDate, valDate, payDate, missingAny })
    }
    // Warning for missing dates — show on day 1 of month
    if (missingAny && !appDate) {
      if (!dayMap[0]) dayMap[0] = []
      dayMap[0].push({ project: p, type: 'warning', appDate, valDate, payDate, missingAny: true })
    }
  }

  const days = []
  // Empty cells before month starts
  for (let i = 0; i < startOffset; i++) days.push(null)
  // Actual days
  for (let d = 1; d <= daysInMonth; d++) days.push(d)

  const today = new Date()
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month
  const todayDay = today.getDate()

  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e', marginBottom: 12, textAlign: 'center' }}>{monthName}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: '#e5e5e5', borderRadius: 8, overflow: 'hidden' }}>
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
          <div key={d} style={{ background: '#1a1a2e', color: '#aaa', fontSize: 11, fontWeight: 600, textAlign: 'center', padding: '6px 0' }}>{d}</div>
        ))}
        {/* Warning row for missing dates */}
        {dayMap[0]?.length > 0 && (
          <div style={{ gridColumn: '1 / -1', background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '6px 10px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#92400e', fontWeight: 600 }}>⚠ Projects missing dates:</span>
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
              background: isToday ? '#eef2ff' : '#fff',
              minHeight: 90,
              padding: '4px 5px',
              position: 'relative',
            }}>
              {d && (
                <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? '#4f46e5' : '#888', marginBottom: 3 }}>{d}</div>
              )}
              {shown.map((e, ei) => (
                <div key={ei} onClick={() => onProjectClick(e)}
                  style={{
                    background: e.type === 'warning' ? '#fef3c7' : '#dbeafe',
                    border: `1px solid ${e.type === 'warning' ? '#fbbf24' : '#93c5fd'}`,
                    borderRadius: 4,
                    padding: '3px 5px',
                    marginBottom: 2,
                    cursor: 'pointer',
                    fontSize: 10,
                    lineHeight: 1.4,
                  }}>
                  <div style={{ fontWeight: 600, color: '#1e3a5f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.type === 'warning' ? '⚠ ' : ''}{e.project.jobNo}
                  </div>
                  <div style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.project.name}</div>
                  {e.valDate && <div style={{ color: '#6b7280' }}>Val: {e.valDate.split('-').slice(1).reverse().join('/')}</div>}
                  {e.payDate && <div style={{ color: '#6b7280' }}>Pay: {e.payDate.split('-').slice(1).reverse().join('/')}</div>}
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

  const now = new Date()
  const thisYear = now.getFullYear()
  const thisMonth = now.getMonth() + 1
  const nextMonth = thisMonth === 12 ? 1 : thisMonth + 1
  const nextYear = thisMonth === 12 ? thisYear + 1 : thisYear

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard')
      const data = await res.json()
      setProjects((data.projects || []).filter(p => p.status === 'INPROGRESS'))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  function fmtDate(d) {
    if (!d) return '—'
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }

  return (
    <>
      <Head><title>Rock Roofing — Application Calendar</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#f0f2f5' }}>

        {/* Nav */}
        <div style={{ background: '#1a1a2e', padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', height: 56, gap: 8 }}>
            <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
            <Link href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>← Portal</Link>
            <span style={{ color: '#444' }}>|</span>
            <Link href="/commercial" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Project Financials</Link>
            <span style={{ color: '#444' }}>|</span>
            <Link href="/retention" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Retention</Link>
            <span style={{ color: '#444' }}>|</span>
            <Link href="/variations" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Variations</Link>
            <span style={{ color: '#444' }}>|</span>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Application Calendar</span>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1a1a2e' }}>Application Calendar</h1>
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#555', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 12, height: 12, borderRadius: 2, background: '#dbeafe', border: '1px solid #93c5fd', display: 'inline-block' }} /> Application date
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 12, height: 12, borderRadius: 2, background: '#fef3c7', border: '1px solid #fbbf24', display: 'inline-block' }} /> Missing dates
              </span>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading...</div>
          ) : (
            <div style={{ display: 'flex', gap: 20 }}>
              <CalendarMonth year={thisYear} month={thisMonth} projects={projects} onProjectClick={setModal} />
              <CalendarMonth year={nextYear} month={nextMonth} projects={projects} onProjectClick={setModal} />
            </div>
          )}
        </div>

        {/* Modal */}
        {modal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setModal(null)}>
            <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: '#1a1a2e' }}>
                  {modal.overflow ? `${modal.day}/${modal.month}/${modal.year} — All projects` : modal.project?.name}
                </h3>
                <button onClick={() => setModal(null)} style={{ fontSize: 20, border: 'none', background: 'none', cursor: 'pointer', color: '#888' }}>×</button>
              </div>

              {modal.overflow ? (
                // Show all overflow projects
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {modal.overflow.map((e, i) => (
                    <div key={i} style={{ background: '#f8f9fa', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontWeight: 600, color: '#1a1a2e', marginBottom: 6 }}>
                        <Link href={`/project/${e.project.xeroId}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{e.project.jobNo}</Link> — {e.project.name}
                      </div>
                      <div style={{ fontSize: 13, color: '#555', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        <div><div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Application</div>{fmtDate(e.appDate)}</div>
                        <div><div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Valuation</div>{fmtDate(e.valDate)}</div>
                        <div><div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Payment due</div>{fmtDate(e.payDate)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                // Single project
                <div>
                  {modal.missingAny && (
                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
                      ⚠ This project is missing one or more dates. Please update in Project Details.
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 13, color: '#888' }}>Project</span>
                    <Link href={`/project/${modal.project?.xeroId}`} style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}>
                      {modal.project?.jobNo} ↗
                    </Link>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    {[
                      { label: 'Application date', value: modal.appDate, color: '#1e40af', bg: '#dbeafe' },
                      { label: 'Valuation date', value: modal.valDate, color: '#065f46', bg: '#d1fae5' },
                      { label: 'Payment due', value: modal.payDate, color: '#92400e', bg: '#fef3c7' },
                    ].map(item => (
                      <div key={item.label} style={{ background: item.bg, borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: item.color, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' }}>{item.label}</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: item.color }}>
                          {item.value ? fmtDate(item.value) : <span style={{ color: '#e63946', fontSize: 13 }}>⚠ Not set</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                    <Link href={`/project/${modal.project?.xeroId}`}
                      style={{ flex: 1, textAlign: 'center', background: '#1a1a2e', color: '#fff', borderRadius: 8, padding: '9px', fontSize: 13, textDecoration: 'none', fontWeight: 500 }}>
                      View Project
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
