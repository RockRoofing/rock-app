import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import PreContractNav from '../components/PreContractNav'
import HandoverDocs from '../components/HandoverDocs'

// Pre-Contract mirror of the Design portal's Handover Docs. Same files (same store),
// full upload/delete. Pick a project, then manage its handover documents.
export default function PreContractHandoverDocs() {
  const router = useRouter()
  const projectNo = router.query.project ? String(router.query.project) : ''
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/ops-projects').then(r => r.json()).then(d => { if (!cancelled) { setProjects(d.projects || []); setLoading(false) } }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const pick = (no) => router.push(`/pre-contract-handover-docs?project=${encodeURIComponent(no)}`)
  const back = () => router.push('/pre-contract-handover-docs')

  const nav = <PreContractNav active="handover-docs" />

  if (projectNo) {
    const proj = projects.find(p => String(p.projectNo) === String(projectNo))
    return (
      <>
        <Head><title>Handover Docs - Pre-Contract</title></Head>
        {nav}
        <div style={{ padding: '12px 24px 0' }}>
          <button onClick={back} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0 }}>&larr; All projects</button>
          {proj && <span style={{ marginLeft: 12, color: '#555', fontSize: 14 }}>{proj.projectName} <span style={{ color: '#aaa' }}>({projectNo})</span></span>}
        </div>
        <HandoverDocs projectNo={projectNo} nav={null} />
      </>
    )
  }

  const filtered = projects.filter(p => {
    const s = `${p.projectNo} ${p.projectName || ''}`.toLowerCase()
    return s.includes(q.toLowerCase())
  })

  return (
    <>
      <Head><title>Handover Docs - Pre-Contract</title></Head>
      {nav}
      <div style={{ width: '100%', margin: 0, padding: '22px 24px 60px', boxSizing: 'border-box' }}>
        <h1 style={{ margin: '0 0 2px', color: '#1a1a19', fontSize: 24 }}>Handover Docs</h1>
        <p style={{ color: '#8a857c', fontSize: 14, margin: '0 0 16px' }}>Pick a project to view and manage its handover documents. These are the same documents as in the Design portal.</p>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects..." style={{ width: '100%', maxWidth: 420, boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 16 }} />
        {loading ? <div style={{ color: '#999', padding: 20 }}>Loading...</div>
          : filtered.length === 0 ? <div style={{ color: '#aaa', padding: 20 }}>No projects found.</div>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {filtered.map(p => (
                <button key={p.projectNo} onClick={() => pick(p.projectNo)} style={{ textAlign: 'left', background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 16, cursor: 'pointer' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a19' }}>{p.projectName || '(no name)'}</div>
                  <div style={{ fontSize: 12.5, color: '#999', marginTop: 3 }}>{p.projectNo}</div>
                </button>
              ))}
            </div>
          )}
      </div>
    </>
  )
}
