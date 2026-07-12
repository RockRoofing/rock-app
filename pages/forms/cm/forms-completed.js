import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Shell } from '../index'
import { INK, BRAND, fmtDateTime, useMyProjects, ProjectPicker, ProjectHeader } from '../../../lib/cmSiteApp'
import SubmissionModal from '../../../components/SubmissionModal'

// CM › Forms Completed — pick a project, then see submitted forms:
// Form, Operative, Submitted, Flags. Tap a row to view the full submission.
export default function CmFormsCompleted() {
  const router = useRouter()
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false)
  const [proj, setProj] = useState(null)
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    setReady(true)
  }, [])

  const { myProjects, loading: projLoading } = useMyProjects(user)

  async function pick(p) {
    setProj(p); setLoading(true); setSubs([])
    try {
      const d = await fetch('/api/submissions').then(r => r.json())
      const mine = (d.submissions || []).filter(s =>
        (s.projectName || '') === (p.projectName || '') ||
        (s.projectName || '') === (p.projectNo || '') ||
        (s.projectName || '').includes(p.projectNo || '__nope__'))
      setSubs(mine)
    } catch {}
    setLoading(false)
  }

  if (!ready) return <Shell user={user}><Loading /></Shell>

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={backLink}>‹ Home</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 10px' }}>Forms Completed</h2>

        {!proj ? (
          projLoading ? <Loading /> : <ProjectPicker projects={myProjects} onPick={pick} subtitle="Select one of your projects." />
        ) : (
          <>
            <ProjectHeader project={proj} onBack={() => setProj(null)} />
            {loading ? <Loading /> : !subs.length ? <Empty>No completed forms for this project.</Empty> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {subs.map(s => (
                  <button key={s.id} onClick={() => setOpen(s)} style={{ textAlign: 'left', background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 14, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ fontWeight: 700, color: INK, fontSize: 14 }}>{s.formTitle}</div>
                      {(s.flags || []).length > 0 && <span style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>⚑ {s.flags.length}</span>}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#777', marginTop: 4 }}>{s.operative || '—'} · {fmtDateTime(s.submittedAt)}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {open && <SubmissionModal sub={open} onClose={() => setOpen(null)} onSaved={(u) => { setSubs(prev => prev.map(x => x.id === u.id ? { ...x, ...u } : x)); setOpen(null) }} />}
    </Shell>
  )
}

const backLink = { background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }
const Loading = () => <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading…</div>
const Empty = ({ children }) => <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>{children}</div>
