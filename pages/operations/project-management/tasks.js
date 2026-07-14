import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, th, td, Loading, EmptyCard, Modal, Lbl, inp2, primaryBtn, ghostBtn, linkBtn, fmtDate } from '../../../components/opsUI'
import RowAttachments from '../../../components/RowAttachments'
import ExpandableText from '../../../components/ExpandableText'
import { dateCellStyle, DateColourKey } from '../../../components/pmShared'

const PAGE_SIZE = 100

export default function LiveTasks() {
  const [tasks, setTasks] = useState([])
  const [team, setTeam] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(null)
  const [page, setPage] = useState(0)

  const [fProject, setFProject] = useState('')
  const [fMember, setFMember] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [fResolved, setFResolved] = useState('no')
  const [sort, setSort] = useState({ key: 'closeOutDate', dir: 'asc' })

  useEffect(() => { load() }, [])
  async function load() {
    try {
      const [tk, t, p] = await Promise.all([
        fetch('/api/tasks').then(x => x.json()),
        fetch('/api/team').then(x => x.json()),
        fetch('/api/ops-projects').then(x => x.json()).catch(() => ({})),
      ])
      setTasks(tk.tasks || [])
      setTeam((t.members || []).filter(m => m.active !== false))
      setProjects((p.projects || []).map(x => ({ no: x.projectNo, name: x.projectName || x.name || '' })))
    } catch {}
    setLoading(false)
  }

  const memberNames = useMemo(() => team.map(m => m.name).filter(Boolean), [team])
  const projectOptions = useMemo(() => {
    const fromRows = tasks.map(r => ({ no: r.projectNo, name: r.projectName }))
    const all = [...projects, ...fromRows].filter(p => p.no || p.name)
    const seen = new Set(); const out = []
    for (const p of all) { const k = `${p.no}|${p.name}`; if (!seen.has(k)) { seen.add(k); out.push(p) } }
    return out.sort((a, b) => (a.no || '').localeCompare(b.no || ''))
  }, [tasks, projects])

  const filtered = useMemo(() => {
    let out = tasks.filter(r => {
      if (fProject && `${r.projectNo}|${r.projectName}` !== fProject) return false
      if (fMember && r.assignee !== fMember) return false
      if (fResolved === 'no' && r.closed) return false
      if (fResolved === 'yes' && !r.closed) return false
      if (fFrom && (!r.closeOutDate || r.closeOutDate < fFrom)) return false
      if (fTo && (!r.closeOutDate || r.closeOutDate > fTo)) return false
      return true
    })
    const { key, dir } = sort
    out = [...out].sort((a, b) => {
      let av = a[key] ?? '', bv = b[key] ?? ''
      if (key === 'closed') { av = a.closed ? 1 : 0; bv = b.closed ? 1 : 0 }
      if (av < bv) return dir === 'asc' ? -1 : 1
      if (av > bv) return dir === 'asc' ? 1 : -1
      return 0
    })
    return out
  }, [tasks, fProject, fMember, fFrom, fTo, fResolved, sort])

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const hasFilters = fProject || fMember || fFrom || fTo || fResolved !== 'no'

  function toggleSort(key) { setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }); setPage(0) }

  async function saveTask(task) {
    await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task }) })
    setEdit(null); load()
  }
  async function patchTask(id, patch) {
    const r = tasks.find(x => x.id === id); if (!r) return
    const updated = { ...r, ...patch }
    setTasks(rs => rs.map(x => x.id === id ? updated : x))
    await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: updated }) })
  }
  async function delTask(id) {
    if (!confirm('Delete this task?')) return
    await fetch('/api/tasks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }

  const cols = [
    { key: 'projectNo', label: 'Project' },
    { key: 'description', label: 'Task' },
    { key: 'assignee', label: 'Responsible' },
    { key: 'createdAt', label: 'Date Added' },
    { key: 'closeOutDate', label: 'Target Completion' },
    { key: 'closed', label: 'Resolved?' },
  ]

  return (
    <OperationsShell active="pm:tasks" section="pm" title="Live Project Tasks" wide>
      <PageHeading title="Live Project Tasks" sub="Open tasks across all projects. Resolved tasks are hidden by default."
        action={<button onClick={() => setEdit({ projectNo: '', projectName: '', description: '', assignee: '', closeOutDate: '', closed: false, comments: '', attachments: [] })} style={primaryBtn}>+ Add task</button>} />

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <F label="Project"><select value={fProject} onChange={e => { setFProject(e.target.value); setPage(0) }} style={sel}><option value="">All projects</option>{projectOptions.map(p => <option key={`${p.no}|${p.name}`} value={`${p.no}|${p.name}`}>{[p.no, p.name].filter(Boolean).join(' — ')}</option>)}</select></F>
        <F label="Team member"><select value={fMember} onChange={e => { setFMember(e.target.value); setPage(0) }} style={sel}><option value="">All</option>{memberNames.map(m => <option key={m} value={m}>{m}</option>)}</select></F>
        <F label="Target from"><input type="date" value={fFrom} onChange={e => { setFFrom(e.target.value); setPage(0) }} style={sel} /></F>
        <F label="Target to"><input type="date" value={fTo} onChange={e => { setFTo(e.target.value); setPage(0) }} style={sel} /></F>
        <F label="Resolved?"><select value={fResolved} onChange={e => { setFResolved(e.target.value); setPage(0) }} style={sel}><option value="no">No (open)</option><option value="yes">Yes (resolved)</option><option value="all">All</option></select></F>
        {hasFilters && <button onClick={() => { setFProject(''); setFMember(''); setFFrom(''); setFTo(''); setFResolved('no'); setPage(0) }} style={ghostBtn}>Reset</button>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>{filtered.length} task{filtered.length === 1 ? '' : 's'}</div>
      </div>

      <DateColourKey />

      {loading ? <Loading /> : !filtered.length ? (
        <EmptyCard title="No tasks to show" body={hasFilters ? 'Try adjusting the filters.' : 'Tasks from Internal Handover Minutes and manually-added tasks appear here.'} />
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead><tr style={{ background: '#faf9f7' }}>
                {cols.map(c => <th key={c.key} onClick={() => toggleSort(c.key)} style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap' }}>{c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>)}
                <th style={th}>Comments</th><th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr></thead>
              <tbody>
                {pageRows.map(r => {
                  const resolved = !!r.closed
                  const greenCell = resolved ? { background: '#ecfdf5' } : {}
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid #f0f0f0', verticalAlign: 'top', ...greenCell }}>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...greenCell }}><strong>{r.projectNo}</strong>{r.projectName ? <div style={{ fontSize: 11, color: '#999' }}>{r.projectName}</div> : null}</td>
                      <td style={{ ...td, ...greenCell, minWidth: 260 }}><ExpandableText value={r.description} onSave={v => patchTask(r.id, { description: v })} label="Task" width="100%" /></td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...greenCell }}>{r.assignee || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...greenCell, color: '#888', fontSize: 12.5 }}>{r.createdAt ? fmtDate(r.createdAt) : '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...(resolved ? greenCell : dateCellStyle(r.closeOutDate)) }}>
                        <input type="date" value={r.closeOutDate || ''} onChange={e => patchTask(r.id, { closeOutDate: e.target.value })} style={{ ...sel, minWidth: 140, padding: '5px 8px', background: 'transparent', border: '1px solid #e0e0e0' }} />
                        {!r.closeOutDate && <div style={{ color: '#c2410c', fontWeight: 600, fontSize: 11, marginTop: 3 }}>Target Completion Date Required</div>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...greenCell }}>
                        <select value={resolved ? 'yes' : 'no'} onChange={e => patchTask(r.id, { closed: e.target.value === 'yes' })} style={{ ...sel, minWidth: 80, padding: '5px 8px' }}>
                          <option value="no">No</option><option value="yes">Yes</option>
                        </select>
                      </td>
                      <td style={{ ...td, minWidth: 260, ...greenCell }}><ExpandableText value={r.comments} onSave={v => patchTask(r.id, { comments: v })} label="Comments" width="100%" /></td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', ...greenCell }}>
                        <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                          <RowAttachments files={r.attachments || []} onChange={files => patchTask(r.id, { attachments: files })} />
                          <button onClick={() => setEdit(r)} style={linkBtn}>Edit</button>
                          <button onClick={() => delTask(r.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16, alignItems: 'center' }}>
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={ghostBtn}>‹ Prev</button>
              <span style={{ fontSize: 13, color: '#666' }}>Page {page + 1} of {pageCount}</span>
              <button disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)} style={ghostBtn}>Next ›</button>
            </div>
          )}
        </>
      )}

      {edit && <TaskModal task={edit} team={team} projectOptions={projectOptions} onClose={() => setEdit(null)} onSave={saveTask} />}
    </OperationsShell>
  )
}

function InlineComment({ value, onSave }) {
  const [v, setV] = useState(value || '')
  useEffect(() => setV(value || ''), [value])
  return <textarea value={v} onChange={e => setV(e.target.value)} onBlur={() => v !== (value || '') && onSave(v)} placeholder="—" style={{ width: 180, minHeight: 34, border: '1px solid #eee', borderRadius: 6, padding: '5px 7px', fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical' }} />
}

function TaskModal({ task, team, projectOptions, onClose, onSave }) {
  const [f, setF] = useState({ ...task })
  const setProj = (val) => { const [no, name] = val.split('|'); setF({ ...f, projectNo: no, projectName: name }) }
  return (
    <Modal onClose={onClose} title={f.id ? 'Edit task' : 'Add task'} wide>
      <Lbl>Project</Lbl>
      <select value={`${f.projectNo || ''}|${f.projectName || ''}`} onChange={e => setProj(e.target.value)} style={inp2}>
        <option value="|">Select project…</option>
        {projectOptions.map(p => <option key={`${p.no}|${p.name}`} value={`${p.no}|${p.name}`}>{[p.no, p.name].filter(Boolean).join(' — ')}</option>)}
      </select>
      <Lbl>Task</Lbl><textarea value={f.description || ''} onChange={e => setF({ ...f, description: e.target.value })} style={{ ...inp2, minHeight: 60 }} />
      <Lbl>Team member responsible</Lbl>
      <select value={f.assignee || ''} onChange={e => setF({ ...f, assignee: e.target.value })} style={inp2}><option value="">—</option>{team.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}</select>
      <Lbl>Target completion date</Lbl><input type="date" value={f.closeOutDate || ''} onChange={e => setF({ ...f, closeOutDate: e.target.value })} style={inp2} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 14 }}><input type="checkbox" checked={!!f.closed} onChange={e => setF({ ...f, closed: e.target.checked })} /> Resolved</label>
      <Lbl>Comments</Lbl><textarea value={f.comments || ''} onChange={e => setF({ ...f, comments: e.target.value })} style={{ ...inp2, minHeight: 50 }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button onClick={() => onSave(f)} style={primaryBtn} disabled={!f.description || !f.projectNo}>Save</button>
        <button onClick={onClose} style={ghostBtn}>Cancel</button>
      </div>
    </Modal>
  )
}

const F = ({ label, children }) => <div><div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{label}</div>{children}</div>
const sel = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', minWidth: 150 }
