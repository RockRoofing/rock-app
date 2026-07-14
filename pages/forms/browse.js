import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Shell } from './index'
import { AttachmentViewer } from '../../components/RowAttachments'

const INK = '#1a1a19', BRAND = '#ca8a04'

export default function Browse() {
  const router = useRouter()
  const { cat } = router.query
  const [user, setUser] = useState(null)
  const [forms, setForms] = useState([])
  const [projects, setProjects] = useState([])
  const [docs, setDocs] = useState({ company: [], guidance: [], project: [] })
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const s = sessionStorage.getItem('ops_operative')
      if (!s) { router.replace('/forms'); return }
      setUser(JSON.parse(s))
    } catch { router.replace('/forms') }
  }, [])

  useEffect(() => {
    if (!cat) return
    ;(async () => {
      setLoading(true)
      try {
        if (cat === 'project') {
          const [rf, rp] = await Promise.all([fetch('/api/forms'), fetch('/api/dashboard')])
          const df = await rf.json(); const dp = await rp.json()
          setForms((df.forms || []).filter(f => f.category === 'project'))
          let u = null; try { u = JSON.parse(sessionStorage.getItem('ops_operative') || 'null') } catch {}
          const pa = u?.projectAccess
          const allowed = (p) => pa == null || pa === 'all' || (Array.isArray(pa) && pa.map(String).includes(String(p.jobNo)))
          setProjects((dp.projects || [])
            .filter(p => p.status === 'INPROGRESS')
            .filter(allowed)
            .map(p => ({ id: p.xeroId, jobNo: p.jobNo, name: p.name, customer: p.customer })))
        } else {
          const r = await fetch('/api/ops-docs'); const d = await r.json()
          setDocs(d.docs || { company: [], guidance: [], project: [] })
        }
      } catch (e) { console.error(e) }
      setLoading(false)
    })()
  }, [cat])

  const catLabel = { company: 'Company Information', guidance: 'Operative Guidance Documents', project: 'Project Forms' }[cat] || ''

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={backBtn}>‹ Home</button>
        <h2 style={{ fontSize: 19, color: INK, margin: '10px 0 18px' }}>{catLabel}</h2>

        {loading && <Muted>Loading…</Muted>}

        {/* Document categories */}
        {!loading && (cat === 'company' || cat === 'guidance') && (
          docs[cat]?.length
            ? <DocList docs={docs[cat]} />
            : <Empty>No documents here yet. The office can add them from the Ops portal.</Empty>
        )}

        {/* Project forms: pick project, then form */}
        {!loading && cat === 'project' && !project && (
          projects.length
            ? <>
                <Muted>Select your project</Muted>
                <List>
                  {projects.map(p => (
                    <Row key={p.id} onClick={() => setProject(p)}
                      title={`${p.jobNo ? p.jobNo + ' — ' : ''}${p.name}`} sub={p.customer} />
                  ))}
                </List>
              </>
            : <Empty>No live projects found.</Empty>
        )}

        {!loading && cat === 'project' && project && (
          <>
            <div style={{
              background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12,
              padding: '12px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#999' }}>Project</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>
                  {project.jobNo ? project.jobNo + ' — ' : ''}{project.name}
                </div>
              </div>
              <button onClick={() => setProject(null)} style={changeBtn}>Change</button>
            </div>
            <Muted>Choose a form</Muted>
            <List>
              {forms.map(f => (
                <Row key={f.id}
                  onClick={() => router.push(`/forms/fill?form=${f.id}&project=${project.id}&pname=${encodeURIComponent((project.jobNo ? project.jobNo + ' — ' : '') + project.name)}`)}
                  title={f.title} sub={f.short} />
              ))}
            </List>
          </>
        )}
      </div>
    </Shell>
  )
}

function DocList({ docs }) {
  const [viewIdx, setViewIdx] = useState(null)
  // Map docs to the viewer's file shape (name/url/type).
  const files = docs.map(d => ({ name: d.title || d.url, url: d.url, type: d.contentType || '' }))
  return (
    <>
      <List>
        {docs.map((d, i) => (
          <Row key={d.id} title={d.title} sub="Tap to view" onClick={() => setViewIdx(i)} />
        ))}
      </List>
      {viewIdx != null && files[viewIdx] && (
        <AttachmentViewer files={files} index={viewIdx} onIndex={setViewIdx} onClose={() => setViewIdx(null)} />
      )}
    </>
  )
}

const List = ({ children }) => <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>{children}</div>
const Row = ({ title, sub, onClick }) => (
  <button onClick={onClick} style={{
    display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', width: '100%',
    background: '#fff', border: '1px solid #e3e0d9', borderRadius: 14, padding: '16px 16px', cursor: 'pointer',
  }}>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>{sub}</div>}
    </div>
    <div style={{ color: BRAND, fontSize: 20 }}>›</div>
  </button>
)
const Muted = ({ children }) => <div style={{ fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0' }}>{children}</div>
const Empty = ({ children }) => <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>{children}</div>
const backBtn = { background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }
const changeBtn = { background: '#f2efe8', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, color: '#555', cursor: 'pointer' }
