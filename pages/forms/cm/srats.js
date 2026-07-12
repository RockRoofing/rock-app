import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Shell, bigBtn } from '../index'
import { INK, BRAND, fmtDate, useMyProjects, ProjectPicker, ProjectHeader, inp } from '../../../lib/cmSiteApp'

// CM › SRATs — project-first. View, create AND edit SRATs from mobile.
// Fields: Situation, Roadblocks, Actions, then Timeline (full-size, below Actions).
// Actions can be turned into Live Project Tasks, which then show on the SRAT card.
export default function CmSrats() {
  const router = useRouter()
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false)
  const [proj, setProj] = useState(null)
  const [srats, setSrats] = useState([])
  const [tasksById, setTasksById] = useState({})
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)   // srat object being created/edited, or null

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    setReady(true)
  }, [])

  const { myProjects, loading: projLoading } = useMyProjects(user)

  async function pick(p) {
    setProj(p); setLoading(true); setSrats([]); setEditing(null)
    await load(p)
    setLoading(false)
  }
  async function load(p) {
    try {
      const [ds, dt] = await Promise.all([
        fetch('/api/srats').then(r => r.json()),
        fetch('/api/tasks').then(r => r.json()),
      ])
      setSrats((ds.srats || []).filter(s => s.projectNo === p.projectNo))
      const map = {}; for (const t of (dt.tasks || [])) map[t.id] = t
      setTasksById(map)
    } catch {}
  }

  if (!ready) return <Shell user={user}><Loading /></Shell>

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={backLink}>‹ Home</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 10px' }}>SRATs</h2>

        {!proj ? (
          projLoading ? <Loading /> : <ProjectPicker projects={myProjects} onPick={pick} subtitle="Select one of your projects." />
        ) : editing ? (
          <SratForm project={proj} srat={editing.id ? editing : null}
            onCancel={() => setEditing(null)}
            onSaved={async () => { setEditing(null); setLoading(true); await load(proj); setLoading(false) }} />
        ) : (
          <>
            <ProjectHeader project={proj} onBack={() => setProj(null)} />
            <button onClick={() => setEditing({})} style={{ ...bigBtn(false), marginBottom: 16 }}>+ New SRAT</button>
            {loading ? <Loading /> : !srats.length ? <Empty>No SRATs for this project yet.</Empty> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {srats.map(s => {
                  const linked = (s.actionTaskIds || []).map(id => tasksById[id]).filter(Boolean)
                  return (
                    <div key={s.id} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ fontSize: 12, color: '#999' }}>{fmtDate(s.createdAt)}</div>
                        <button onClick={() => setEditing(s)} style={{ background: 'transparent', border: 'none', color: BRAND, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Edit</button>
                      </div>
                      <Field label="Situation" value={s.situation} />
                      <Field label="Roadblocks" value={s.roadblocks} />
                      <Field label="Actions" value={s.actionsText} />
                      <Field label="Timeline" value={s.timeline} />
                      {linked.length > 0 && (
                        <div style={{ marginTop: 10, borderTop: '1px solid #f2f2f2', paddingTop: 8 }}>
                          <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>Live Project Tasks</div>
                          {linked.map(t => (
                            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: INK, padding: '3px 0' }}>
                              <span style={{ color: t.closed ? '#16a34a' : '#c2410c' }}>{t.closed ? '✓' : '○'}</span>
                              <span style={{ flex: 1 }}>{t.description}</span>
                              {t.closeOutDate && <span style={{ fontSize: 11, color: '#888' }}>{fmtDate(t.closeOutDate)}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}

function SratForm({ project, srat, onCancel, onSaved }) {
  const [situation, setSituation] = useState(srat?.situation || '')
  const [roadblocks, setRoadblocks] = useState(srat?.roadblocks || '')
  const [actionsText, setActionsText] = useState(srat?.actionsText || '')
  const [timeline, setTimeline] = useState(srat?.timeline || '')
  const [newTasks, setNewTasks] = useState([])   // [{description, assignee, closeOutDate}]
  const [people, setPeople] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      try { const d = await fetch('/api/team').then(r => r.json()); setPeople((d.members || []).map(m => m.name).filter(Boolean).sort()) } catch {}
    })()
  }, [])

  const addTaskRow = () => setNewTasks(t => [...t, { description: '', assignee: '', closeOutDate: '' }])
  const updTask = (i, k, v) => setNewTasks(t => t.map((x, j) => j === i ? { ...x, [k]: v } : x))
  const rmTask = (i) => setNewTasks(t => t.filter((_, j) => j !== i))

  async function save() {
    if (!situation.trim()) { setErr('Please describe the situation.'); return }
    setSaving(true); setErr('')
    try {
      // Create any new Live Project Tasks first, collect their IDs.
      const createdIds = []
      for (const nt of newTasks) {
        if (!nt.description.trim()) continue
        const task = {
          id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          projectNo: project.projectNo, projectName: project.projectName || '',
          description: nt.description.trim(), assignee: nt.assignee || '', closeOutDate: nt.closeOutDate || '',
          closed: false, comments: '', attachments: [], createdAt: Date.now(),
        }
        const r = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task }) })
        if (r.ok) createdIds.push(task.id)
      }
      const merged = {
        id: srat?.id || `srat_${Date.now()}`,
        projectNo: project.projectNo, projectName: project.projectName || '',
        situation, roadblocks, actionsText, timeline,
        actionTaskIds: [...(srat?.actionTaskIds || []), ...createdIds],
        createdAt: srat?.createdAt || Date.now(),
      }
      const r2 = await fetch('/api/srats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ srat: merged }) })
      if (!r2.ok) { const d = await r2.json().catch(() => ({})); setErr(d.error || 'Save failed'); setSaving(false); return }
      onSaved()
    } catch (e) { setErr(e?.message || 'Save failed'); setSaving(false) }
  }

  return (
    <div>
      <ProjectHeader project={project} onBack={onCancel} backLabel="‹ Cancel" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div><Lbl>Situation</Lbl><textarea value={situation} onChange={e => setSituation(e.target.value)} rows={3} style={boxInp} placeholder="What's the situation?" /></div>
        <div><Lbl>Roadblocks</Lbl><textarea value={roadblocks} onChange={e => setRoadblocks(e.target.value)} rows={3} style={boxInp} placeholder="What's getting in the way?" /></div>
        <div><Lbl>Actions</Lbl><textarea value={actionsText} onChange={e => setActionsText(e.target.value)} rows={3} style={boxInp} placeholder="What actions are needed?" /></div>
        <div><Lbl>Timeline</Lbl><textarea value={timeline} onChange={e => setTimeline(e.target.value)} rows={3} style={boxInp} placeholder="Timeline / target dates" /></div>

        {/* Add Live Project Tasks */}
        <div style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
          <Lbl>Add Live Project Tasks</Lbl>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>These are added to Live Project Tasks and linked to this SRAT.</div>
          {newTasks.map((t, i) => (
            <div key={i} style={{ background: '#faf9f7', border: '1px solid #eee', borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <input value={t.description} onChange={e => updTask(i, 'description', e.target.value)} placeholder="Task description" style={{ ...inp, marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={t.assignee} onChange={e => updTask(i, 'assignee', e.target.value)} style={{ ...inp, flex: 1 }}>
                  <option value="">Responsible…</option>
                  {people.map(nm => <option key={nm} value={nm}>{nm}</option>)}
                </select>
                <input type="date" value={t.closeOutDate} onChange={e => updTask(i, 'closeOutDate', e.target.value)} style={{ ...inp, width: 150 }} />
              </div>
              <button onClick={() => rmTask(i)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12, marginTop: 6 }}>Remove</button>
            </div>
          ))}
          <button onClick={addTaskRow} style={{ background: '#fff', border: `1.5px solid ${BRAND}`, color: BRAND, borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Add task</button>
        </div>

        {err && <div style={{ color: '#dc2626', fontSize: 13 }}>{err}</div>}
        <button onClick={save} disabled={saving} style={bigBtn(saving)}>{saving ? 'Saving…' : (srat ? 'Save changes' : 'Save SRAT')}</button>
      </div>
    </div>
  )
}

const boxInp = { ...inp, resize: 'vertical', minHeight: 78 }
const Field = ({ label, value }) => value ? (
  <div style={{ marginTop: 8 }}>
    <div style={{ fontSize: 11, color: '#999' }}>{label}</div>
    <div style={{ fontSize: 14, color: INK, whiteSpace: 'pre-wrap' }}>{value}</div>
  </div>
) : null
const Lbl = ({ children }) => <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 6 }}>{children}</div>
const backLink = { background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }
const Loading = () => <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading…</div>
const Empty = ({ children }) => <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>{children}</div>
