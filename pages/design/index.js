import { useState } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useDesignAuth, designHref, PURPLE, INK } from '../../lib/designShell'

export default function DesignHome() {
  const router = useRouter()
  const auth = useDesignAuth()
  const [q, setQ] = useState('')

  if (!auth.ready) return null

  const term = q.trim().toLowerCase()
  const projects = !term ? auth.projects : auth.projects.filter(p =>
    String(p.projectNo).toLowerCase().includes(term) ||
    (p.name || '').toLowerCase().includes(term) ||
    (p.customer || '').toLowerCase().includes(term) ||
    (p.location || '').toLowerCase().includes(term)
  )
  // First page each project opens on.
  const openProject = (no) => router.push(designHref(no, 'rfis'))

  return (
    <>
      <Head><title>Design Portal - Rock Roofing</title></Head>
      <div style={{ background: '#1a1a19', padding: '0 20px', display: 'flex', alignItems: 'center', height: 52 }}>
        <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 30, width: 30, borderRadius: 4, marginRight: 8 }} />
        {!auth.isExternal && <>
          <a href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>&lt;- Portal</a>
          <span style={{ color: '#3a3a38', padding: '0 2px' }}>|</span>
        </>}
        <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, padding: '4px 10px' }}>Design</span>
      </div>

      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '24px 28px 60px' }}>
        <h1 style={{ margin: '0 0 2px', color: INK, fontSize: 26 }}>Design Portal</h1>
        <p style={{ color: '#8a857c', fontSize: 14, marginTop: 2 }}>Select a project to open its drawings, RFIs, submissions, certificates and documents.</p>

        <div style={{ margin: '18px 0 20px' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects by number, name, customer or location..."
            style={{ width: '100%', maxWidth: 520, boxSizing: 'border-box', padding: '11px 14px', border: '1px solid #ddd', borderRadius: 10, fontSize: 14.5 }} />
          <div style={{ fontSize: 12.5, color: '#aaa', marginTop: 6 }}>{projects.length} project{projects.length === 1 ? '' : 's'}{term ? ' matching' : ''}</div>
        </div>

        {projects.length === 0 ? (
          <div style={{ color: '#aaa', fontSize: 14, padding: 40, textAlign: 'center', background: '#faf9fd', borderRadius: 12 }}>
            {auth.projects.length === 0 ? 'No projects available.' : 'No projects match your search.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
            {projects.map(p => (
              <button key={p.projectNo} onClick={() => openProject(p.projectNo)}
                style={{ textAlign: 'left', background: '#fff', border: '1px solid #ece9f5', borderLeft: `3px solid ${PURPLE}`, borderRadius: 12, padding: '16px 18px', cursor: 'pointer' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>{p.projectNo}</div>
                <div style={{ fontSize: 13.5, color: '#555', marginTop: 3 }}>{p.name || '-'}</div>
                {(p.customer || p.location) && <div style={{ fontSize: 12.5, color: '#8a857c', marginTop: 6 }}>{[p.customer, p.location].filter(Boolean).join(' - ')}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
