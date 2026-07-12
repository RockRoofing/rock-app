import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Shell } from '../index'
import { INK, BRAND, useMyProjects, ProjectPicker, ProjectHeader } from '../../../lib/cmSiteApp'

const money = (n) => (n || n === 0) ? `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'

// CM › Variations — project-first, read-only. Shows Variation number, Description,
// Instructed, Total for the selected project.
export default function CmVariations() {
  const router = useRouter()
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false)
  const [proj, setProj] = useState(null)
  const [variations, setVariations] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    setReady(true)
  }, [])

  const { myProjects, loading: projLoading } = useMyProjects(user)

  async function pick(p) {
    setProj(p); setVariations(null); setLoading(true)
    try {
      let d = await fetch('/api/dashboard').then(r => r.json())
      let row = (d.projects || []).find(x => String(x.projectNo) === String(p.projectNo))
      // If the cached dashboard didn't include this project (or had no variations), force a sync.
      if (!row || !('variations' in row)) {
        d = await fetch('/api/dashboard?sync=true').then(r => r.json())
        row = (d.projects || []).find(x => String(x.projectNo) === String(p.projectNo))
      }
      setVariations(row?.variations || [])
    } catch { setVariations([]) }
    setLoading(false)
  }

  if (!ready) return <Shell user={user}><Loading /></Shell>

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={backLink}>‹ Home</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 10px' }}>Variations</h2>

        {!proj ? (
          projLoading ? <Loading /> : <ProjectPicker projects={myProjects} onPick={pick} subtitle="Select one of your projects." />
        ) : (
          <>
            <ProjectHeader project={proj} onBack={() => setProj(null)} />
            {loading ? <Loading /> : !variations?.length ? (
              <Empty>No variations for this project.</Empty>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {variations.map((v, i) => (
                  <div key={i} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ fontWeight: 700, color: INK, fontSize: 14 }}>Variation {v.varNumber || i + 1}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: v.instructed ? '#16a34a' : '#c2410c' }}>{v.instructed ? 'Instructed' : 'Not instructed'}</div>
                    </div>
                    {v.description && <div style={{ fontSize: 13, color: '#555', marginTop: 6 }}>{v.description}</div>}
                    <div style={{ fontSize: 14, color: INK, marginTop: 8, fontWeight: 600 }}>{money(v.total)}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}

const backLink = { background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }
const Loading = () => <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading…</div>
const Empty = ({ children }) => <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>{children}</div>
