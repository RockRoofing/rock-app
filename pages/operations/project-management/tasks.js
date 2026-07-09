import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, th, td, Loading, EmptyCard, Modal, Lbl, inp2, primaryBtn, ghostBtn, linkBtn } from '../../../components/opsUI'

export default function LiveTasks() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(null)
  const [fProject, setFProject] = useState('')
  const [fMember, setFMember] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [sort, setSort] = useState({ key: 'projectNo', dir: 'asc' })

  useEffect(() => { load() }, [])
  async function load() {
    try { const r = await fetch('/api/tasks'); const d = await r.json(); setTasks(d.tasks || []) } catch {}
    setLoading(false)
  }

  const projects = useMemo(() => [...new Set(tasks.map(t => t.projectName).filter(Boolean))].sort(), [tasks])
  const members = useMemo(() => [...new Set(tasks.map(t => t.assignee).filter(Boolean))].sort(), [tasks])

  const filtered = useMemo(() => {
    let out = tasks.filter(t => {
      if (fProject && t.projectName !== fProject) return false
      if (fMember && t.assignee !== fMember) return false
      if (fStatus && t.status !== fStatus) return false
      return true
    })
    const { key, dir } = sort
    out = [...out].sort((a, b) => {
      const av = a[key] ?? '', bv = b[key] ?? ''
      if (av < bv) return dir === 'asc' ? -1 : 1
      if (av > bv) return dir === 'asc' ? 1 : -1
      return 0
    })
    return out
  }, [tasks, fProject, fMember, fStatus, sort])

  function toggleSort(key) { setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }) }

  async function save() {
    if (!edit.description?.trim()) { alert('Add a description.'); return }
    await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: edit }) })
    setEdit(null); load()
  }
  async function del(id) {
    if (!confirm('Delete this task?')) return
    await fetch('/api/tasks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }
  async function quickStatus(t) {
    await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: { id: t.id, status: t.status === 'Open' ? 'Complete' : 'Open' } }) })
    load()
  }

  const hasFilters = fProject || fMember || fStatus
  const cols = [
    { key: 'projectNo', label: 'Project No.' },
    { key: 'projectName', label: 'Project' },
    { key: 'description', label: 'Description' },
    { key: 'assignee', label: 'Responsible' },
    { key: 'status', label: 'Status' },
    { key: 'comments', label: 'Comments' },
  ]

  return (
    <OperationsShell active="pm:tasks" section="pm" title="Live Project Tasks" wide>
      <PageHeading title="Live Project Tasks" sub="Auto-populated from Internal Handover Minutes, plus manually added"
        action={<button onClick={() => setEdit({ projectNo: '', projectName: '', description: '', assignee: '', status: 'Open', comments: '' })} style={primaryBtn}>+ Add task</button>} />

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <F label="Project"><select value={fProject} onChange={e => setFProject(e.target.value)} style={sel}><option value="">All projects</option>{projects.map(p => <option key={p}>{p}</option>)}</select></F>
        <F label="Responsible"><select value={fMember} onChange={e => setFMember(e.target.value)} style={sel}><option value="">All members</option>{members.map(m => <option key={m}>{m}</option>)}</select></F>
        <F label="Status"><select value={fStatus} onChange={e => setFStatus(e.target.value)} style={sel}><option value="">All</option><option>Open</option><option>Complete</option></select></F>
        {hasFilters && <button onClick={() => { setFProject(''); setFMember(''); setFStatus('') }} style={{ background: '#f2f2f0', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, color: '#555', cursor: 'pointer' }}>Reset</button>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>{filtered.length} tasks · {filtered.filter(t => t.status === 'Open').length} open</div>
      </div>

      {loading ? <Loading /> : !filtered.length ? (
        <EmptyCard title={hasFilters ? 'No tasks match your filters' : 'No tasks yet'}
          body={hasFilters ? 'Try clearing filters.' : 'Tasks from Internal Handover Minutes appear here, or add one manually.'} />
      ) : (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 950 }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              {cols.map(c => <th key={c.key} onClick={() => toggleSort(c.key)} style={{ ...th, cursor: 'pointer', userSelect: 'none' }}>{c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>)}
              <th style={th}></th>
            </tr></thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} style={{ borderTop: '1px solid #f0f0f0', verticalAlign: 'top', background: t.status === 'Complete' ? '#fafefb' : '#fff' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><strong>{t.projectNo || '—'}</strong></td>
                  <td style={td}>{t.projectName || '—'}</td>
                  <td style={{ ...td, maxWidth: 320 }}>{t.description}</td>
                  <td style={td}>{t.assignee || <span style={{ color: '#ccc' }}>Unassigned</span>}</td>
                  <td style={td}><button onClick={() => quickStatus(t)} style={{ cursor: 'pointer', border: 'none', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600,
                    background: t.status === 'Complete' ? '#ecfdf5' : '#fef3c7', color: t.status === 'Complete' ? '#065f46' : '#92400e' }}>{t.status}</button>
                    {t.sourceIhm && <span title="From Internal Handover Minutes" style={{ marginLeft: 6, fontSize: 10, color: '#aaa' }}>IHM</span>}
                  </td>
                  <td style={{ ...td, maxWidth: 220, color: '#555' }}>{t.comments || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setEdit({ ...t })} style={linkBtn}>Edit</button>
                    <button onClick={() => del(t.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <Modal onClose={() => setEdit(null)} title={edit.id ? 'Edit task' : 'Add task'}>
          <Lbl>Project number</Lbl>
          <input value={edit.projectNo} onChange={e => setEdit({ ...edit, projectNo: e.target.value })} style={inp2} placeholder="e.g. J247" />
          <Lbl>Project name</Lbl>
          <input value={edit.projectName} onChange={e => setEdit({ ...edit, projectName: e.target.value })} style={inp2} />
          <Lbl>Description</Lbl>
          <textarea value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} rows={2} style={{ ...inp2, resize: 'vertical' }} />
          <Lbl>Team member responsible</Lbl>
          <input value={edit.assignee} onChange={e => setEdit({ ...edit, assignee: e.target.value })} style={inp2} />
          <Lbl>Status</Lbl>
          <select value={edit.status || 'Open'} onChange={e => setEdit({ ...edit, status: e.target.value })} style={inp2}><option>Open</option><option>Complete</option></select>
          <Lbl>Comments</Lbl>
          <textarea value={edit.comments || ''} onChange={e => setEdit({ ...edit, comments: e.target.value })} rows={2} style={{ ...inp2, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button onClick={save} style={primaryBtn}>Save</button>
            <button onClick={() => setEdit(null)} style={ghostBtn}>Cancel</button>
          </div>
        </Modal>
      )}
    </OperationsShell>
  )
}

const F = ({ label, children }) => (<div><div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{label}</div>{children}</div>)
const sel = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', minWidth: 140 }
