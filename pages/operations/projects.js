import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading, SubTabs, ComingSoon } from '../../components/OperationsShell'
import { INK, GOLD, fmtDateTime, th, td, Loading, EmptyCard, linkBtn } from '../../components/opsUI'

const SUB_TABS = [
  { key: 'drawings', label: 'Drawings' },
  { key: 'rams', label: 'RAMS' },
  { key: 'submissions', label: 'Forms Submissions' },
  { key: 'images', label: 'Project Images' },
]

export default function ProjectsPage() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [project, setProject] = useState(null)
  const [sub, setSub] = useState('drawings')

  useEffect(() => { (async () => {
    try {
      const r = await fetch('/api/dashboard'); const d = await r.json()
      setProjects((d.projects || [])
        .filter(p => p.status === 'INPROGRESS')
        .map(p => ({ id: p.xeroId, jobNo: p.jobNo, name: p.name, customer: p.customer })))
    } catch {}
    setLoading(false)
  })() }, [])

  if (loading) return <OperationsShell active="projects" title="Projects"><Loading /></OperationsShell>

  // Project picker
  if (!project) {
    return (
      <OperationsShell active="projects" title="Projects">
        <PageHeading title="Projects" sub="Select a project to view its drawings, RAMS, submissions and images" />
        {!projects.length ? <EmptyCard title="No live projects found" /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
            {projects.map(p => (
              <button key={p.id} onClick={() => { setProject(p); setSub('drawings') }} style={{
                textAlign: 'left', background: '#fff', border: '1px solid #ececec', borderRadius: 14,
                padding: 18, cursor: 'pointer',
              }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{p.jobNo ? p.jobNo + ' — ' : ''}{p.name}</div>
                <div style={{ fontSize: 13, color: '#999', marginTop: 4 }}>{p.customer || ''}</div>
              </button>
            ))}
          </div>
        )}
      </OperationsShell>
    )
  }

  return (
    <OperationsShell active="projects" title="Projects" wide>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={() => setProject(null)} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }}>‹ All projects</button>
      </div>
      <PageHeading title={`${project.jobNo ? project.jobNo + ' — ' : ''}${project.name}`} sub={project.customer} />
      <SubTabs tabs={SUB_TABS} active={sub} onChange={setSub} />

      {sub === 'drawings' && <ComingSoon title="Drawings" note="Project drawings — viewable on phone via the Forms App, managed here. We'll wire this to SharePoint/OneDrive links or uploads next." />}
      {sub === 'rams' && <ComingSoon title="RAMS" note="RAMS for this project — generated in the RAMS Builder and stored against the project." />}
      {sub === 'submissions' && <ProjectSubmissions project={project} />}
      {sub === 'images' && <ProjectImages project={project} />}
    </OperationsShell>
  )
}

// Forms submissions filtered to this project
function ProjectSubmissions({ project }) {
  const [subs, setSubs] = useState([]); const [loading, setLoading] = useState(true)
  useEffect(() => { (async () => {
    try {
      const r = await fetch('/api/submissions'); const d = await r.json()
      setSubs((d.submissions || []).filter(s => s.projectId === project.id || s.projectName?.includes(project.name)))
    } catch {}
    setLoading(false)
  })() }, [project])

  if (loading) return <Loading />
  if (!subs.length) return <EmptyCard title="No submissions for this project yet" />
  return (
    <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ background: '#faf9f7' }}>{['Form', 'Operative', 'Submitted', 'Flags'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {subs.map(s => (
            <tr key={s.id} style={{ borderTop: '1px solid #f0f0f0' }}>
              <td style={td}><strong>{s.formTitle}</strong></td>
              <td style={td}>{s.operative || '—'}</td>
              <td style={{ ...td, color: '#999' }}>{fmtDateTime(s.submittedAt)}</td>
              <td style={td}>{s.flagCount > 0 ? <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 20, padding: '2px 10px', fontSize: 12 }}>⚠ {s.flagCount}</span> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Gallery timeline of all photos from this project's submissions, newest first,
// each downloadable.
function ProjectImages({ project }) {
  const [images, setImages] = useState([]); const [loading, setLoading] = useState(true)

  useEffect(() => { (async () => {
    try {
      const r = await fetch('/api/submissions'); const d = await r.json()
      const mine = (d.submissions || []).filter(s => s.projectId === project.id || s.projectName?.includes(project.name))
      // Fetch full submissions to get photo URLs
      const full = await Promise.all(mine.map(async s => {
        try { const rr = await fetch(`/api/submissions?id=${s.id}`); const dd = await rr.json(); return dd.submission } catch { return null }
      }))
      const imgs = []
      for (const sub of full.filter(Boolean)) {
        for (const [, v] of Object.entries(sub.answers || {})) {
          if (Array.isArray(v) && typeof v[0] === 'string' && /^https?:|^data:/.test(v[0])) {
            v.forEach(url => imgs.push({ url, formTitle: sub.formTitle, operative: sub.operative, at: sub.submittedAt }))
          }
        }
      }
      imgs.sort((a, b) => b.at - a.at)  // newest first
      setImages(imgs)
    } catch {}
    setLoading(false)
  })() }, [project])

  if (loading) return <Loading />
  if (!images.length) return <EmptyCard title="No images for this project yet" body="Photos uploaded within forms for this project will appear here as a timeline." />

  return (
    <div>
      <div style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>{images.length} images · newest first</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 14 }}>
        {images.map((img, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden' }}>
            <a href={img.url} target="_blank" rel="noreferrer">
              <img src={img.url} alt="" style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }} />
            </a>
            <div style={{ padding: '8px 10px' }}>
              <div style={{ fontSize: 12, color: INK, fontWeight: 500 }}>{img.formTitle}</div>
              <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{img.operative} · {fmtDateTime(img.at)}</div>
              <a href={img.url} download target="_blank" rel="noreferrer" style={{ ...linkBtn, padding: 0, fontSize: 12, display: 'inline-block', marginTop: 4 }}>Download</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
