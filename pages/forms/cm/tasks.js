import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/router'
import { Shell } from '../index'
import { INK, BRAND, fmtDate, useMyProjects, chipBtn, inp } from '../../../lib/cmSiteApp'
import RowAttachments from '../../../components/RowAttachments'

// CM › Live Tasks — filter by project / team member / date / resolved (default open).
// Columns: Task, Responsible, Target completion, Resolved, Comments, Attachments.
// Fully editable in-app.
export default function CmTasks() {
  const router = useRouter()
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [fProject, setFProject] = useState('')
  const [fMember, setFMember] = useState('')
  const [fResolved, setFResolved] = useState('open')  // open | resolved | all
  const [fFrom, setFFrom] = useState(''); const [fTo, setFTo] = useState('')

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    setReady(true)
    load()
  }, [])

  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/tasks').then(r => r.json()); setTasks(d.tasks || []) } catch {}
    setLoading(false)
  }

  const { myProjects } = useMyProjects(user)
  const myNos = useMemo(() => new Set(myProjects.map(p => p.projectNo)), [myProjects])

  async function patch(id, changes) {
    const t = tasks.find(x => x.id === id); if (!t) return
    const updated = { ...t, ...changes }
    setTasks(prev => prev.map(x => x.id === id ? updated : x))
    try { await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: updated }) }) } catch {}
  }

  const members = useMemo(() => [...new Set(tasks.map(t => t.assignee).filter(Boolean))].sort(), [tasks])

  const rows = useMemo(() => {
    return tasks
      .filter(t => myNos.has(t.projectNo))              // only this CM's projects
      .filter(t => !fProject || t.projectNo === fProject)
      .filter(t => !fMember || t.assignee === fMember)
      .filter(t => fResolved === 'all' ? true : fResolved === 'resolved' ? t.closed : !t.closed)
      .filter(t => !fFrom || (t.closeOutDate && t.closeOutDate >= fFrom))
      .filter(t => !fTo || (t.closeOutDate && t.closeOutDate <= fTo))
      .sort((a, b) => (a.closeOutDate || '').localeCompare(b.closeOutDate || ''))
  }, [tasks, myNos, fProject, fMember, fResolved, fFrom, fTo])

  if (!ready) return <Shell user={user}><Loading /></Shell>

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={backLink}>‹ Home</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 10px' }}>Live Tasks</h2>

        {/* Filters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          <select value={fProject} onChange={e => setFProject(e.target.value)} style={inp}>
            <option value="">All my projects</option>
            {myProjects.map(p => <option key={p.projectNo} value={p.projectNo}>{p.projectNo}{p.projectName ? ` — ${p.projectName}` : ''}</option>)}
          </select>
          <select value={fMember} onChange={e => setFMember(e.target.value)} style={inp}>
            <option value="">All team members</option>
            {members.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([v, l]) => (
              <button key={v} onClick={() => setFResolved(v)} style={chipBtn(fResolved === v)}>{l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ fontSize: 12, color: '#666', flex: 1 }}>Target from<br /><input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} style={{ ...inp, marginTop: 3 }} /></label>
            <label style={{ fontSize: 12, color: '#666', flex: 1 }}>to<br /><input type="date" value={fTo} onChange={e => setFTo(e.target.value)} style={{ ...inp, marginTop: 3 }} /></label>
          </div>
        </div>

        {loading ? <Loading /> : !rows.length ? <Empty>No tasks match these filters.</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map(t => (
              <div key={t.id} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 14, opacity: t.closed ? 0.7 : 1 }}>
                <div style={{ fontWeight: 700, color: INK, fontSize: 14 }}>{t.description || '—'}</div>
                <div style={{ fontSize: 12, color: '#777', marginTop: 3 }}>
                  {t.projectNo}{t.projectName && t.projectName !== t.projectNo ? ` — ${t.projectName}` : ''}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                  <label style={{ fontSize: 11, color: '#888' }}>Responsible<br />
                    <input value={t.assignee || ''} onChange={e => patch(t.id, { assignee: e.target.value })} style={{ ...miniInp, width: 150 }} />
                  </label>
                  <label style={{ fontSize: 11, color: '#888' }}>Target completion<br />
                    <input type="date" value={t.closeOutDate || ''} onChange={e => patch(t.id, { closeOutDate: e.target.value })} style={miniInp} />
                  </label>
                </div>

                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 11, color: '#888' }}>Comments</label>
                  <textarea value={t.comments || ''} onChange={e => patch(t.id, { comments: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical', marginTop: 3 }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: INK, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!t.closed} onChange={e => patch(t.id, { closed: e.target.checked })} /> Resolved
                  </label>
                  <RowAttachments files={t.attachments || []} onChange={files => patch(t.id, { attachments: files })} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

const miniInp = { padding: '8px 10px', border: '2px solid #e3e0d9', borderRadius: 10, fontSize: 14, marginTop: 3 }
const backLink = { background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }
const Loading = () => <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading…</div>
const Empty = ({ children }) => <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>{children}</div>
