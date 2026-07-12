import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/router'
import { Shell } from '../index'
import { INK, BRAND, fmtDate, useMyProjects } from '../../../lib/cmSiteApp'

const DAY = 86400000
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; return new Date(x.getTime() - wd * DAY) }

// CM › Missing Forms — the CM's own projects only. Uses the SAME forms-missing
// engine as the portal, defaulting to this week + next week (2-week forward
// visibility, snapped to Mondays) so past weeks don't show stale requirements.
export default function CmMissingForms() {
  const router = useRouter()
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    setReady(true)
    // Default: this week (Mon) .. next week (Mon) — matches the portal's forward-looking view.
    const thisMon = mondayOf(new Date())
    const nextMon = new Date(thisMon.getTime() + 7 * DAY)
    setFrom(iso(thisMon)); setTo(iso(nextMon))
  }, [])

  const { myProjects, loading: projLoading } = useMyProjects(user)
  const myNos = useMemo(() => new Set(myProjects.map(p => p.projectNo)), [myProjects])

  useEffect(() => {
    if (!from || !to) return
    (async () => {
      setLoading(true)
      // Snap the requested range to Mondays, exactly like the portal.
      const f = iso(mondayOf(new Date(from)))
      const t = iso(mondayOf(new Date(to)))
      try { setData(await fetch(`/api/forms-missing?from=${f}&to=${t}`).then(r => r.json())) } catch {}
      setLoading(false)
    })()
  }, [from, to])

  // Only this CM's projects; only missing (not done).
  const rows = useMemo(() => {
    if (!data?.rows) return []
    return data.rows.filter(r => myNos.has(r.projectNo) && !r.done)
  }, [data, myNos])

  const summary = useMemo(() => {
    if (!data?.rows) return { required: 0, completed: 0, pct: 0 }
    const mine = data.rows.filter(r => myNos.has(r.projectNo))
    const required = mine.length
    const completed = mine.filter(r => r.done).length
    return { required, completed, pct: required ? Math.round((completed / required) * 100) : 100 }
  }, [data, myNos])

  if (!ready) return <Shell user={user}><Loading /></Shell>

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={backLink}>‹ Home</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 4px' }}>Missing Forms</h2>
        <p style={{ color: '#777', fontSize: 13, margin: '0 0 12px' }}>Outstanding forms across your projects.</p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#666' }}>From<br /><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={dateInp} /></label>
          <label style={{ fontSize: 12, color: '#666' }}>To<br /><input type="date" value={to} onChange={e => setTo(e.target.value)} style={dateInp} /></label>
        </div>

        {/* Metrics */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <Metric label="Required" value={summary.required} />
          <Metric label="Completed" value={summary.completed} />
          <Metric label="Completion" value={`${summary.pct}%`} accent={summary.pct === 100 ? '#16a34a' : summary.pct >= 70 ? '#ca8a04' : '#dc2626'} />
        </div>

        {(loading || projLoading) ? <Loading /> : !rows.length ? <Empty>No missing forms in this period. 🎉</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontWeight: 700, color: INK, fontSize: 14 }}>{r.formType}</div>
                  <span style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>Missing</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#777', marginTop: 4 }}>
                  {r.projectNo}{r.projectName && r.projectName !== r.projectNo ? ` — ${r.projectName}` : ''}
                </div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                  W/C {fmtDate(r.week)} · Responsible: {r.responsible || '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

const Metric = ({ label, value, accent = INK }) => (
  <div style={{ flex: 1, background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: '12px 10px', textAlign: 'center' }}>
    <div style={{ fontSize: 22, fontWeight: 800, color: accent }}>{value}</div>
    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{label}</div>
  </div>
)
const dateInp = { padding: '8px 10px', border: '2px solid #e3e0d9', borderRadius: 10, fontSize: 14, marginTop: 3 }
const backLink = { background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }
const Loading = () => <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading…</div>
const Empty = ({ children }) => <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>{children}</div>
