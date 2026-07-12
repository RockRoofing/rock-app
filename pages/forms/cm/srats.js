import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Shell, bigBtn } from '../index'
import { INK, BRAND, fmtDate, useMyProjects, ProjectPicker, ProjectHeader, inp } from '../../../lib/cmSiteApp'

// CM › SRATs — project-first. View existing SRATs and create a new one from mobile.
// Fields (project shown at top): Situation, Roadblocks, Actions, Timeline.
export default function CmSrats() {
  const router = useRouter()
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false)
  const [proj, setProj] = useState(null)
  const [srats, setSrats] = useState([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    setReady(true)
  }, [])

  const { myProjects, loading: projLoading } = useMyProjects(user)

  async function pick(p) {
    setProj(p); setLoading(true); setSrats([]); setCreating(false)
    await load(p)
    setLoading(false)
  }
  async function load(p) {
    try {
      const d = await fetch('/api/srats').then(r => r.json())
      setSrats((d.srats || []).filter(s => s.projectNo === p.projectNo))
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
        ) : creating ? (
          <SratForm project={proj} onCancel={() => setCreating(false)} onSaved={async () => { setCreating(false); setLoading(true); await load(proj); setLoading(false) }} />
        ) : (
          <>
            <ProjectHeader project={proj} onBack={() => setProj(null)} />
            <button onClick={() => setCreating(true)} style={{ ...bigBtn(false), marginBottom: 16 }}>+ New SRAT</button>
            {loading ? <Loading /> : !srats.length ? <Empty>No SRATs for this project yet.</Empty> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {srats.map(s => (
                  <div key={s.id} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>{fmtDate(s.createdAt)}{s.timeline ? ` · Timeline: ${s.timeline}` : ''}</div>
                    <Field label="Situation" value={s.situation} />
                    <Field label="Roadblocks" value={s.roadblocks} />
                    <Field label="Actions" value={s.actionsText} />
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

function SratForm({ project, onCancel, onSaved }) {
  const [situation, setSituation] = useState('')
  const [roadblocks, setRoadblocks] = useState('')
  const [actionsText, setActionsText] = useState('')
  const [timeline, setTimeline] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!situation.trim()) { setErr('Please describe the situation.'); return }
    setSaving(true); setErr('')
    try {
      const srat = {
        id: `srat_${Date.now()}`, projectNo: project.projectNo, projectName: project.projectName || '',
        situation, roadblocks, actionsText, timeline, actionTaskIds: [], createdAt: Date.now(),
      }
      const r = await fetch('/api/srats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ srat }) })
      if (!r.ok) { const d = await r.json().catch(() => ({})); setErr(d.error || 'Save failed'); setSaving(false); return }
      onSaved()
    } catch (e) { setErr(e?.message || 'Save failed'); setSaving(false) }
  }

  return (
    <div>
      <ProjectHeader project={project} onBack={onCancel} backLabel="‹ Cancel" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div><Lbl>Situation</Lbl><textarea value={situation} onChange={e => setSituation(e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }} placeholder="What's the situation?" /></div>
        <div><Lbl>Roadblocks</Lbl><textarea value={roadblocks} onChange={e => setRoadblocks(e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }} placeholder="What's getting in the way?" /></div>
        <div><Lbl>Actions</Lbl><textarea value={actionsText} onChange={e => setActionsText(e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }} placeholder="What actions are needed?" /></div>
        <div><Lbl>Timeline</Lbl><input value={timeline} onChange={e => setTimeline(e.target.value)} style={inp} placeholder="e.g. by end of next week" /></div>
        {err && <div style={{ color: '#dc2626', fontSize: 13 }}>{err}</div>}
        <button onClick={save} disabled={saving} style={bigBtn(saving)}>{saving ? 'Saving…' : 'Save SRAT'}</button>
      </div>
    </div>
  )
}

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
