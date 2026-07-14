import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, th, td, Loading, EmptyCard, primaryBtn, ghostBtn, linkBtn } from '../../../components/opsUI'

const clamp = (s, n = 80) => { if (!s) return '—'; const t = String(s); return t.length > n ? t.slice(0, n) + '…' : t }
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const parseLocal = (d) => { if (!d) return null; const [y, m, day] = d.split('-').map(Number); return new Date(y, (m || 1) - 1, day || 1) }
const fmtLocal = (d) => { const dt = parseLocal(d); return dt ? dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' }
const emptySrat = () => ({ projectNo: '', projectName: '', date: todayISO(), situation: '', roadblocks: '', actionsText: '', actionTaskIds: [], timeline: '' })
const PAGE_SIZE = 50
const cellTd = { padding: '8px 10px', fontSize: 12, borderBottom: '1px solid #f0f0f0', verticalAlign: 'top', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }
const filterInp = { padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', minWidth: 150 }

export default function SratsPage() {
  const [srats, setSrats] = useState([])
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState(null)    // read-only large view
  const [edit, setEdit] = useState(null)    // add/edit modal
  const [cell, setCell] = useState(null)    // { title, text } single-cell popout
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })
  const [fProject, setFProject] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')

  async function load() {
    setLoading(true)
    try {
      const [s, p, t, tk] = await Promise.all([
        fetch('/api/srats').then(r => r.json()).catch(() => ({})),
        fetch('/api/ops-projects').then(r => r.json()).catch(() => ({})),
        fetch('/api/team').then(r => r.json()).catch(() => ({})),
        fetch('/api/tasks').then(r => r.json()).catch(() => ({})),
      ])
      setSrats(s.srats || [])
      setProjects((p.projects || []).map(x => ({ no: x.projectNo, name: x.projectName || x.name || '' })).filter(x => x.no))
      setUsers((t.members || []).filter(u => u.active !== false))
      setTasks(tk.tasks || [])
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function toggleSort(key) { setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }) }
  const arrow = (key) => sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''
  const filtered = useMemo(() => {
    const dOf = (s) => s.date || (s.createdAt ? new Date(s.createdAt).toISOString().slice(0, 10) : '')
    return srats.filter(s => {
      if (fProject && s.projectNo !== fProject) return false
      const d = dOf(s)
      if (fFrom && (!d || d < fFrom)) return false
      if (fTo && (!d || d > fTo)) return false
      return true
    })
  }, [srats, fProject, fFrom, fTo])
  useEffect(() => { setPage(0) }, [fProject, fFrom, fTo])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const val = (s) => {
      if (sort.key === 'project') return `${s.projectNo || ''} ${s.projectName || ''}`.toLowerCase()
      if (sort.key === 'date') return s.date || ''
      if (sort.key === 'situation') return (s.situation || '').toLowerCase()
      if (sort.key === 'roadblocks') return (s.roadblocks || '').toLowerCase()
      if (sort.key === 'timeline') return (s.timeline || '').toLowerCase()
      return s.createdAt || 0
    }
    arr.sort((a, b) => { const av = val(a), bv = val(b); if (av < bv) return sort.dir === 'asc' ? -1 : 1; if (av > bv) return sort.dir === 'asc' ? 1 : -1; return 0 })
    return arr
  }, [filtered, sort])
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  useEffect(() => { if (page >= pageCount) setPage(0) }, [pageCount, page])

  async function deleteSrat(s) {
    if (!confirm('Delete this SRAT?')) return
    await fetch('/api/srats', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id }) })
    load()
  }

  return (
    <OperationsShell active="pm:srat" section="pm" title="SRATs" wide>
      <PageHeading title="SRATs" sub="Situation, Roadblocks, Actions, Timeline — one per project update."
        action={<button onClick={() => setEdit(emptySrat())} style={primaryBtn}>+ Add new</button>} />

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Project</div>
          <select value={fProject} onChange={e => setFProject(e.target.value)} style={filterInp}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p.no} value={p.no}>{[p.no, p.name].filter(Boolean).join(' — ')}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>From</div>
          <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} style={filterInp} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>To</div>
          <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} style={filterInp} />
        </div>
        {(fProject || fFrom || fTo) && <button onClick={() => { setFProject(''); setFFrom(''); setFTo('') }} style={ghostBtn}>Reset</button>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>{filtered.length} SRAT{filtered.length === 1 ? '' : 's'}</div>
      </div>

      {loading ? <Loading /> : srats.length === 0 ? (
        <EmptyCard title="No SRATs yet" body="Click “Add new” to create the first SRAT." />
      ) : filtered.length === 0 ? (
        <EmptyCard title="No SRATs match these filters" body="Try adjusting the project or date range." />
      ) : (
        <>
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 1100 }}>
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead><tr style={{ background: '#faf9f7' }}>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('project')}>Project{arrow('project')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('date')}>Date{arrow('date')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('situation')}>Situation{arrow('situation')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('roadblocks')}>Roadblocks{arrow('roadblocks')}</th>
              <th style={th}>Actions</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('timeline')}>Timeline{arrow('timeline')}</th>
              <th style={{ ...th, textAlign: 'right' }}></th>
            </tr></thead>
            <tbody>
              {pageRows.map(s => {
                const nTasks = (s.actionTaskIds || []).length
                return (
                  <tr key={s.id} style={{ borderTop: '1px solid #f0f0f0', verticalAlign: 'top' }}>
                    <td style={{ ...td, overflow: 'hidden' }}><strong>{s.projectNo || '—'}</strong>{s.projectName ? <div style={{ fontSize: 11, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.projectName}</div> : null}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{s.date ? fmtLocal(s.date) : '—'}</td>
                    <td style={cellTd} onClick={() => s.situation && setCell({ title: 'Situation', text: s.situation })}>{clamp(s.situation)}</td>
                    <td style={cellTd} onClick={() => s.roadblocks && setCell({ title: 'Roadblocks', text: s.roadblocks })}>{clamp(s.roadblocks)}</td>
                    <td style={cellTd} onClick={() => s.actionsText && setCell({ title: 'Actions', text: s.actionsText })}>{clamp(s.actionsText)}{nTasks ? <div style={{ fontSize: 11, color: '#ca8a04', marginTop: 2 }}>{nTasks} task{nTasks === 1 ? '' : 's'}</div> : null}</td>
                    <td style={cellTd} onClick={() => s.timeline && setCell({ title: 'Timeline', text: s.timeline })}>{clamp(s.timeline, 50)}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => setView(s)} style={linkBtn}>View</button>
                      <button onClick={() => setEdit({ ...s })} style={linkBtn}>Edit</button>
                      <button onClick={() => deleteSrat(s)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
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

      {cell && <Modal onClose={() => setCell(null)} title={cell.title}><div style={{ fontSize: 14, color: '#333', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{cell.text}</div></Modal>}
      {view && <ViewModal srat={view} tasks={tasks} onClose={() => setView(null)} />}
      {edit && <EditModal initial={edit} projects={projects} users={users} tasks={tasks} setTasks={setTasks} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </OperationsShell>
  )
}

// ---- Large read-only view ----
function ViewModal({ srat, tasks, onClose }) {
  const myTasks = tasks.filter(t => (srat.actionTaskIds || []).includes(t.id))
  const Row = ({ label, children }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 13.5, color: '#333', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{children}</div>
    </div>
  )
  return (
    <Modal onClose={onClose} title={`SRAT — ${srat.projectNo || ''} ${srat.projectName || ''}`}>
      <Row label="Date">{srat.date ? fmtLocal(srat.date) : '—'}</Row>
      <Row label="Situation">{srat.situation || '—'}</Row>
      <Row label="Roadblocks">{srat.roadblocks || '—'}</Row>
      <Row label="Actions">{srat.actionsText || '—'}</Row>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 6 }}>Action tasks</div>
        {myTasks.length === 0 ? <div style={{ fontSize: 13, color: '#999' }}>No tasks.</div> : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {myTasks.map(t => <li key={t.id} style={{ fontSize: 13.5, color: t.closed ? '#16a34a' : '#333', marginBottom: 4 }}>{t.closed ? '✓ ' : ''}{t.description}{t.assignee ? ` — ${t.assignee}` : ''}</li>)}
          </ul>
        )}
      </div>
      <Row label="Timeline">{srat.timeline || '—'}</Row>
    </Modal>
  )
}

// ---- Add / edit ----
function EditModal({ initial, projects, users, tasks, setTasks, onClose, onSaved }) {
  const [f, setF] = useState(() => ({ ...initial, date: initial.date || todayISO() }))
  const [saving, setSaving] = useState(false)
  const set = (patch) => setF(prev => ({ ...prev, ...patch }))
  const userName = (u) => u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email
  const myTasks = tasks.filter(t => (f.actionTaskIds || []).includes(t.id))

  function pickProject(no) {
    const p = projects.find(x => x.no === no)
    set({ projectNo: no, projectName: p?.name || '' })
  }

  // One-way push to Live Project Tasks: create the task, keep its id, but no live sync.
  async function addTask() {
    const task = { projectNo: f.projectNo, projectName: f.projectName, description: '', assignee: '', closed: false, comments: '', attachments: [], sourceSrat: true }
    const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task }) }).then(r => r.json())
    if (res.id) {
      setTasks(ts => [{ ...task, id: res.id, createdAt: Date.now() }, ...ts])
      set({ actionTaskIds: [...(f.actionTaskIds || []), res.id] })
    } else {
      alert('Could not add the task. Please try again.')
    }
  }
  async function patchTask(id, patch) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t))
    const current = tasks.find(t => t.id === id) || {}
    await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: { ...current, ...patch, id } }) })
  }
  function removeTaskLink(id) {
    // one-way: just unlink from this SRAT (leave the Live Task in place)
    set({ actionTaskIds: (f.actionTaskIds || []).filter(x => x !== id) })
  }

  async function save() {
    if (!f.projectNo) { alert('Please select a project.'); return }
    setSaving(true)
    try {
      await fetch('/api/srats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ srat: f }) })
      onSaved()
    } catch { alert('Could not save.') }
    setSaving(false)
  }

  const input = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }
  const L = ({ children }) => <div style={{ fontSize: 12.5, fontWeight: 600, color: INK, margin: '16px 0 6px' }}>{children}</div>

  return (
    <Modal onClose={onClose} title={f.id ? 'Edit SRAT' : 'New SRAT'}>
      <L>Project</L>
      <select value={f.projectNo || ''} onChange={e => pickProject(e.target.value)} style={input}>
        <option value="">Select a project…</option>
        {projects.map(p => <option key={p.no} value={p.no}>{[p.no, p.name].filter(Boolean).join(' — ')}</option>)}
      </select>

      <L>Date</L>
      <input type="date" value={f.date || ''} onChange={e => set({ date: e.target.value })} style={{ ...input, maxWidth: 200 }} />

      <L>Situation</L>
      <textarea value={f.situation || ''} onChange={e => set({ situation: e.target.value })} style={{ ...input, minHeight: 80, resize: 'vertical' }} />

      <L>Roadblocks</L>
      <textarea value={f.roadblocks || ''} onChange={e => set({ roadblocks: e.target.value })} style={{ ...input, minHeight: 80, resize: 'vertical' }} />

      <L>Actions</L>
      <textarea value={f.actionsText || ''} onChange={e => set({ actionsText: e.target.value })} placeholder="Describe the actions" style={{ ...input, minHeight: 70, resize: 'vertical' }} />
      <div style={{ fontSize: 11.5, color: '#9ca3af', margin: '10px 0 6px' }}>Action tasks below are added to Live Project Tasks (one-way — they won't sync back here after saving).</div>
      <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr style={{ background: '#faf9f7' }}>
            <th style={{ ...th, fontSize: 11 }}>Task</th>
            <th style={{ ...th, fontSize: 11, width: 190 }}>Assignee</th>
            <th style={{ ...th, fontSize: 11, width: 90 }}>Resolved?</th>
            <th style={{ ...th, width: 40 }}></th>
          </tr></thead>
          <tbody>
            {myTasks.length === 0 && <tr><td colSpan={4} style={{ ...td, color: '#aaa', fontSize: 12 }}>No tasks yet.</td></tr>}
            {myTasks.map(t => (
              <tr key={t.id} style={{ borderTop: '1px solid #f2f2f2', background: t.closed ? '#ecfdf5' : '#fff' }}>
                <td style={td}><input value={t.description || ''} onChange={e => patchTask(t.id, { description: e.target.value })} placeholder="Insert task..." style={{ ...input, padding: '6px 8px' }} /></td>
                <td style={td}>
                  <select value={t.assignee || ''} onChange={e => patchTask(t.id, { assignee: e.target.value })} style={{ ...input, padding: '6px 8px' }}>
                    <option value="">—</option>
                    {users.map(u => <option key={u.id} value={userName(u)}>{userName(u)}</option>)}
                  </select>
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <select value={t.closed ? 'yes' : 'no'} onChange={e => patchTask(t.id, { closed: e.target.value === 'yes' })} style={{ ...input, padding: '6px 8px' }}>
                    <option value="no">No</option><option value="yes">Yes</option>
                  </select>
                </td>
                <td style={{ ...td, textAlign: 'center' }}><button onClick={() => removeTaskLink(t.id)} title="Remove from this SRAT" style={{ ...linkBtn, color: '#dc2626' }}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={addTask} disabled={!f.projectNo} style={{ ...ghostBtn, marginTop: 8 }}>+ Add new</button>

      <L>Timeline</L>
      <textarea value={f.timeline || ''} onChange={e => set({ timeline: e.target.value })} style={{ ...input, minHeight: 60, resize: 'vertical' }} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24, borderTop: '1px solid #eee', paddingTop: 18 }}>
        <button onClick={onClose} style={ghostBtn}>Cancel</button>
        <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save SRAT'}</button>
      </div>
    </Modal>
  )
}

// Shared large modal shell
function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3vh 2vw', overflowY: 'auto' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 900, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff', borderRadius: '14px 14px 0 0', zIndex: 2 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: INK }}>{title}</h2>
          <button onClick={onClose} style={{ fontSize: 24, border: 'none', background: 'none', cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        <div style={{ padding: '8px 28px 28px' }}>{children}</div>
      </div>
    </div>
  )
}
