import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/router'
import { Shell } from '../index'
import { INK, BRAND, fmtDate, useMyProjects } from '../../../lib/cmSiteApp'

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// CM › Pre-Start Notifications — up-and-coming projects that need a Pre-Start.
// Uses the forms-missing engine (which already applies the "starts/returns within
// 14 days" rule) filtered to this CM's projects and the Pre-Start form only.
export default function CmPreStart() {
  const router = useRouter()
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    setReady(true)
    ;(async () => {
      const now = new Date()
      const from = iso(now)
      const to = iso(new Date(now.getTime() + 21 * 86400000))  // look ~3 weeks ahead
      try { setData(await fetch(`/api/forms-missing?from=${from}&to=${to}`).then(r => r.json())) } catch {}
      setLoading(false)
    })()
  }, [])

  const { myProjects, loading: projLoading } = useMyProjects(user)
  const myNos = useMemo(() => new Set(myProjects.map(p => p.projectNo)), [myProjects])

  const rows = useMemo(() => {
    if (!data?.rows) return []
    return data.rows
      .filter(r => myNos.has(r.projectNo) && /pre-?start/i.test(r.formType) && !r.done)
      .sort((a, b) => (a.week || '').localeCompare(b.week || ''))
  }, [data, myNos])

  if (!ready) return <Shell user={user}><Loading /></Shell>

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={backLink}>‹ Home</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 4px' }}>Pre-Start Notifications</h2>
        <p style={{ color: '#777', fontSize: 13, margin: '0 0 14px' }}>Up-and-coming projects that need a Pre-Start.</p>

        {(loading || projLoading) ? <Loading /> : !rows.length ? <Empty>No pre-starts due on your projects. 🎉</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map((r, i) => (
              <button key={i} onClick={() => router.push('/forms/fill?form=pre-start-notification')} style={{ textAlign: 'left', background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 14, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontWeight: 700, color: INK, fontSize: 15 }}>{r.projectNo}{r.projectName && r.projectName !== r.projectNo ? ` — ${r.projectName}` : ''}</div>
                  <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>Pre-Start due</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#777', marginTop: 4 }}>Starts / returns W/C {fmtDate(r.week)}</div>
                <div style={{ fontSize: 12.5, color: BRAND, fontWeight: 600, marginTop: 8 }}>Complete Pre-Start ›</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

const backLink = { background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }
const Loading = () => <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading…</div>
const Empty = ({ children }) => <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>{children}</div>
