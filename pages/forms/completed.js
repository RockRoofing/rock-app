import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Shell } from './index'
import SubmissionModal from '../../components/SubmissionModal'

const INK = '#1a1a19', BRAND = '#ca8a04'
const fmtDateTime = (t) => t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

// Operative "Completed Forms" browser — view and edit previously submitted forms
// from inside the Site App. Filterable by project.
export default function CompletedForms() {
  const router = useRouter()
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false)
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [projectFilter, setProjectFilter] = useState('')
  const [open, setOpen] = useState(null)

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    setReady(true)
    ;(async () => {
      try { const d = await fetch('/api/submissions').then(r => r.json()); setSubs(d.submissions || []) } catch {}
      setLoading(false)
    })()
  }, [])

  const projects = [...new Set(subs.map(s => s.projectName).filter(Boolean))].sort()
  const rows = subs.filter(s => !projectFilter || s.projectName === projectFilter)

  if (!ready) return <Shell user={user}><Loading /></Shell>

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={backLink}>‹ Home</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 10px' }}>Completed Forms</h2>

        <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} style={{ width: '100%', padding: '11px 12px', border: '2px solid #e3e0d9', borderRadius: 12, fontSize: 15, marginBottom: 14 }}>
          <option value="">All projects</option>
          {projects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        {loading ? <Loading /> : !rows.length ? <Empty>No completed forms yet.</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map(s => (
              <button key={s.id} onClick={() => setOpen(s)} style={{ textAlign: 'left', background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 14, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontWeight: 700, color: INK, fontSize: 14 }}>{s.formTitle}</div>
                  {(s.flags || []).length > 0 && <span style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>⚑ {s.flags.length}</span>}
                </div>
                <div style={{ fontSize: 12.5, color: '#777', marginTop: 4 }}>{s.projectName || '—'}</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{s.operative || '—'} · {fmtDateTime(s.submittedAt)}</div>
                <div style={{ fontSize: 12.5, color: BRAND, fontWeight: 600, marginTop: 8 }}>View / Edit ›</div>
              </button>
            ))}
          </div>
        )}
      </div>
      {open && <SubmissionModal sub={open} onClose={() => setOpen(null)} onSaved={(u) => { setSubs(prev => prev.map(x => x.id === u.id ? { ...x, ...u } : x)); setOpen(null) }} />}
    </Shell>
  )
}

const backLink = { background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }
const Loading = () => <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading…</div>
const Empty = ({ children }) => <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>{children}</div>
