import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'

const DEPT_LABEL = { estimating: 'Estimating', commercial: 'Commercial', operations: 'Operations', accounting: 'Accounting', sales: 'Sales' }
const DEPT_COLOR = { estimating: '#7c3aed', commercial: '#ca8a04', operations: '#0d9488', accounting: '#ea580c', sales: '#2563eb' }
const MONTHNAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SECTIONS = [
  { key: 'wins', label: 'Wins this month', hint: 'Wins as a business / special learnings (James / Carl)' },
  { key: 'kpi', label: 'General performance / KPIs', hint: 'Main KPI data points vs targets (Dori)' },
  { key: 'upcoming', label: 'Up and coming news', hint: 'James / Carl / Nathan' },
  { key: 'focus', label: 'Big focus for next month', hint: 'James / Carl / Nathan' },
]

export default function LessonsLearnt() {
  const [tab, setTab] = useState('table')
  return (
    <>
      <Head><title>Rock Roofing - Lessons Learnt</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none' }}>&larr; Portal</a>
          <span style={{ color: '#3a3a38' }}>|</span>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>Lessons Learnt</span>
        </div>
        <div style={{ background: '#fff', borderBottom: '1px solid #ececec', padding: '0 24px', display: 'flex', gap: 4, height: 46, alignItems: 'center' }}>
          {[['table', 'Lessons table'], ['minutes', 'Monthly minutes']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ background: 'none', border: 'none', fontSize: 13, padding: '8px 14px', cursor: 'pointer', color: tab === k ? '#1a1a19' : '#888', fontWeight: tab === k ? 600 : 400, borderBottom: tab === k ? '2px solid #ca8a04' : '2px solid transparent' }}>{l}</button>
          ))}
        </div>
        <div style={{ padding: '22px 24px 60px' }}>
          {tab === 'table' ? <LessonsTable /> : <MinutesArea />}
        </div>
      </div>
    </>
  )
}

function LessonsTable() {
  const [lessons, setLessons] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ item: '', detail: '', depts: [] })
  const [isAdmin, setIsAdmin] = useState(false)
  const [selected, setSelected] = useState(() => new Set())

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/lessons-learnt?view=lessons').then(r => r.json()); setLessons(d.lessons || []); setIsAdmin(!!d.isAdmin) } catch {}
    setSelected(new Set())
    setLoading(false)
  }
  async function addLesson() {
    if (!draft.item.trim() && !draft.detail.trim()) return
    const r = await fetch('/api/lessons-learnt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add-lesson', item: draft.item, detail: draft.detail, depts: draft.depts }) })
    if (r.ok) { setDraft({ item: '', detail: '', depts: [] }); setAdding(false); load() }
  }
  async function updateDepts(id, depts) {
    await fetch('/api/lessons-learnt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update-lesson', id, depts }) })
    setLessons(ls => ls.map(l => l.id === id ? { ...l, depts } : l))
  }
  async function del(id) {
    if (!confirm('Delete this lesson?')) return
    const r = await fetch('/api/lessons-learnt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-lesson', id }) })
    if (r.ok) setLessons(ls => ls.filter(l => l.id !== id)); else alert('Only admins can delete lessons.')
  }
  async function delSelected() {
    if (!selected.size) return
    if (!confirm(`Delete ${selected.size} selected lesson(s)?`)) return
    const ids = [...selected]
    const r = await fetch('/api/lessons-learnt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-lessons', ids }) })
    if (r.ok) { setLessons(ls => ls.filter(l => !selected.has(l.id))); setSelected(new Set()) } else alert('Only admins can delete lessons.')
  }
  const toggleSel = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleSelAll = (rows) => setSelected(s => { const allSel = rows.length > 0 && rows.every(r => s.has(r.id)); return allSel ? new Set() : new Set(rows.map(r => r.id)) })

  const shown = lessons.filter(l =>
    (!filter || (l.depts || []).includes(filter)) &&
    (!q || (l.item || '').toLowerCase().includes(q.toLowerCase()) || (l.detail || '').toLowerCase().includes(q.toLowerCase()) || (l.monthLabel || '').toLowerCase().includes(q.toLowerCase())))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 2px', fontSize: 22, color: '#1a1a2e' }}>Lessons Learnt</h1>
          <div style={{ fontSize: 13, color: '#8a857c' }}>Collected from the monthly minutes. Each lesson has an item, the detail, and the department(s) it is for. Search or filter below.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && <button onClick={async () => { if (confirm('Clear ALL lessons from the table? This cannot be undone. (Minutes are not affected.)')) { const r = await fetch('/api/lessons-learnt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear-lessons' }) }); if (r.ok) load(); else alert('Only admins can clear the table.') } }} style={{ ...ghost, color: '#dc2626', borderColor: '#f3c0c0' }}>Clear table</button>}
          <button onClick={() => setAdding(a => !a)} style={primary}>{adding ? 'Cancel' : '+ Add lesson'}</button>
        </div>
      </div>

      {adding && (
        <div style={{ background: '#fff', border: '1px solid #ece9f5', borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <Lbl>Lessons Learnt item</Lbl>
          <input value={draft.item} onChange={e => setDraft(d => ({ ...d, item: e.target.value }))} placeholder="Short name for the lesson" style={inp} />
          <div style={{ height: 8 }} />
          <Lbl>Lessons Learnt (detail)</Lbl>
          <textarea value={draft.detail} onChange={e => setDraft(d => ({ ...d, detail: e.target.value }))} rows={3} placeholder="What happened, the context, and what we learnt..." style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={{ height: 8 }} />
          <Lbl>Who is this for?</Lbl>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 10px' }}>
            {Object.keys(DEPT_LABEL).map(d => <DeptChip key={d} d={d} on={draft.depts.includes(d)} onClick={() => setDraft(x => ({ ...x, depts: x.depts.includes(d) ? x.depts.filter(y => y !== d) : [...x.depts, d] }))} />)}
          </div>
          <button onClick={addLesson} style={primary}>Add</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search lessons..." style={{ ...inp, maxWidth: 320 }} />
        <button onClick={() => setFilter('')} style={filter === '' ? deptActive('#555') : deptGhost}>All</button>
        {Object.keys(DEPT_LABEL).map(d => (
          <button key={d} onClick={() => setFilter(filter === d ? '' : d)} style={filter === d ? deptActive(DEPT_COLOR[d]) : deptGhost}>{DEPT_LABEL[d]}</button>
        ))}
        <span style={{ fontSize: 12, color: '#aaa', marginLeft: 'auto' }}>{shown.length} lesson{shown.length === 1 ? '' : 's'}</span>
      </div>

      {isAdmin && selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 14px', marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: '#b91c1c', fontWeight: 600 }}>{selected.size} selected</span>
          <button onClick={delSelected} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Delete selected</button>
          <button onClick={() => setSelected(new Set())} style={ghost}>Clear selection</button>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? <div style={{ padding: 24, color: '#999' }}>Loading...</div> : shown.length === 0 ? <div style={{ padding: 24, color: '#aaa' }}>No lessons yet. They appear here when a meeting is marked complete, or add one manually above.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              {isAdmin && <th style={{ ...th, width: 34, textAlign: 'center' }}><input type="checkbox" title="Select all" checked={shown.length > 0 && shown.every(r => selected.has(r.id))} onChange={() => toggleSelAll(shown)} /></th>}
              <th style={{ ...th, width: 110 }}>Month</th>
              <th style={{ ...th, width: 220 }}>Lessons Learnt item</th>
              <th style={th}>Lessons Learnt</th>
              <th style={{ ...th, width: 250 }}>Who it's for</th>
              {isAdmin && <th style={{ ...th, width: 40 }}></th>}
            </tr></thead>
            <tbody>
              {shown.map(l => (
                <tr key={l.id} style={{ borderTop: '1px solid #f0f0f0', background: selected.has(l.id) ? '#fff7f7' : '#fff' }}>
                  {isAdmin && <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSel(l.id)} /></td>}
                  <td style={{ ...td, color: '#8a857c', whiteSpace: 'nowrap' }}>{l.monthLabel}</td>
                  <td style={{ ...td, fontWeight: 600, color: '#1a1a2e' }}>{l.item || <span style={{ color: '#bbb', fontWeight: 400 }}>-</span>}</td>
                  <td style={td}>{l.detail}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {Object.keys(DEPT_LABEL).map(d => <DeptChip key={d} d={d} small on={(l.depts || []).includes(d)} onClick={() => updateDepts(l.id, (l.depts || []).includes(d) ? l.depts.filter(x => x !== d) : [...(l.depts || []), d])} />)}
                    </div>
                  </td>
                  {isAdmin && <td style={{ ...td, textAlign: 'right' }}><button onClick={() => del(l.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 15 }}>&times;</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function MinutesArea() {
  const [minutes, setMinutes] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/lessons-learnt?view=minutes').then(r => r.json()); setMinutes(d.minutes || []); setUsers(d.users || []) } catch {}
    setLoading(false)
  }

  function newMeeting() {
    const now = new Date()
    setOpenId({ id: '', year: now.getFullYear(), month: now.getMonth() + 1, title: '', meetingDate: '', status: 'draft', sections: {}, actions: [] })
  }

  if (openId !== null) return <MinutesEditor initial={openId} users={users} onClose={() => { setOpenId(null); load() }} />

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 2px', fontSize: 22, color: '#1a1a2e' }}>Monthly minutes</h1>
          <div style={{ fontSize: 13, color: '#8a857c' }}>One set of minutes per month. Drafts auto-save; mark complete after the meeting to lock and feed the lessons table.</div>
        </div>
        <button onClick={newMeeting} style={primary}>+ New meeting</button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? <div style={{ padding: 24, color: '#999' }}>Loading...</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              <th style={th}>Month</th><th style={{ ...th, width: 160 }}>Meeting date</th><th style={{ ...th, width: 120 }}>Status</th><th style={{ ...th, width: 100 }}>Actions</th><th style={{ ...th, width: 80 }}></th>
            </tr></thead>
            <tbody>
              {minutes.map(m => (
                <tr key={m.id} style={{ borderTop: '1px solid #f0f0f0', cursor: 'pointer' }} onClick={() => setOpenId(m)}>
                  <td style={{ ...td, fontWeight: 600 }}>{m.title || `${MONTHNAMES[m.month]} ${m.year}`}</td>
                  <td style={td}>{m.meetingDate ? new Date(m.meetingDate).toLocaleDateString('en-GB') : <span style={{ color: '#bbb' }}>-</span>}</td>
                  <td style={td}>{m.status === 'complete'
                    ? <span style={{ background: '#dcfce7', color: '#16a34a', borderRadius: 20, padding: '2px 10px', fontSize: 11.5, fontWeight: 700 }}>Complete</span>
                    : <span style={{ background: '#fef9c3', color: '#a16207', borderRadius: 20, padding: '2px 10px', fontSize: 11.5, fontWeight: 700 }}>Draft</span>}</td>
                  <td style={{ ...td, color: '#8a857c' }}>{(m.actions || []).length}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#7c3aed', fontWeight: 600 }}>Open</td>
                </tr>
              ))}
              {minutes.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#aaa', padding: 26 }}>No minutes yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function MinutesEditor({ initial, users = [], onClose }) {
  const [m, setM] = useState(() => ({ ...initial, sections: { ...(initial.sections || {}) }, lessonRows: (initial.lessonRows || []).map(r => ({ ...r })), actions: (initial.actions || []).map(a => ({ ...a })) }))
  const [savedAt, setSavedAt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const dirtyRef = useRef(false)
  const locked = m.status === 'complete'

  const setSection = (key, val) => { setM(x => ({ ...x, sections: { ...x.sections, [key]: val } })); dirtyRef.current = true }
  const setField = (key, val) => { setM(x => ({ ...x, [key]: val })); dirtyRef.current = true }

  const save = useCallback(async (override) => {
    const payload = override || m
    setSaving(true)
    try {
      const r = await fetch('/api/lessons-learnt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-minutes', minutes: payload }) })
      const d = await r.json()
      if (r.ok) { setM(x => ({ ...x, id: d.minutes.id })); setSavedAt(new Date()); dirtyRef.current = false }
    } catch {}
    setSaving(false)
  }, [m])

  useEffect(() => {
    if (locked) return
    if (!dirtyRef.current) return
    const t = setTimeout(() => { save() }, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, locked])

  async function complete() {
    if (!confirm('Mark this meeting complete? This locks the minutes and adds the lessons to the table.')) return
    await save({ ...m })
    const r = await fetch('/api/lessons-learnt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'complete', id: m.id || `${m.year}-${String(m.month).padStart(2, '0')}` }) })
    const d = await r.json()
    if (r.ok) { setM(x => ({ ...x, status: 'complete', actions: (x.actions || []).map(a => a.action ? { ...a, pushed: true } : a) })); setMsg(`Meeting complete. ${d.lessonsAdded} lesson(s) added to the table${d.actionsPushed ? `, ${d.actionsPushed} action(s) sent to live tasks` : ''}.`) }
    else setMsg(d.error || 'Could not complete.')
  }

  const setAction = (i, patch) => { setM(x => ({ ...x, actions: x.actions.map((a, j) => j === i ? { ...a, ...patch } : a) })); dirtyRef.current = true }
  const addAction = () => { setM(x => ({ ...x, actions: [...x.actions, { id: `act_${Date.now()}`, action: '', person: '', pushed: false }] })); dirtyRef.current = true }
  const removeAction = (i) => { setM(x => ({ ...x, actions: x.actions.filter((_, j) => j !== i) })); dirtyRef.current = true }

  const setLesson = (i, patch) => { setM(x => ({ ...x, lessonRows: x.lessonRows.map((r, j) => j === i ? { ...r, ...patch } : r) })); dirtyRef.current = true }
  const addLessonRow = () => { setM(x => ({ ...x, lessonRows: [...(x.lessonRows || []), { id: `lr_${Date.now()}`, item: '', detail: '', depts: [] }] })); dirtyRef.current = true }
  const removeLessonRow = (i) => { setM(x => ({ ...x, lessonRows: x.lessonRows.filter((_, j) => j !== i) })); dirtyRef.current = true }
  const toggleLessonDept = (i, d) => { setM(x => ({ ...x, lessonRows: x.lessonRows.map((r, j) => j === i ? { ...r, depts: (r.depts || []).includes(d) ? r.depts.filter(y => y !== d) : [...(r.depts || []), d] } : r) })); dirtyRef.current = true }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onClose} style={ghost}>&larr; Back</button>
          <h1 style={{ margin: 0, fontSize: 20, color: '#1a1a2e' }}>{MONTHNAMES[m.month]} {m.year}{locked ? '' : ' (draft)'}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!locked && <span style={{ fontSize: 12, color: '#aaa' }}>{saving ? 'Saving...' : savedAt ? `Saved ${savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>}
          {locked
            ? <span style={{ background: '#dcfce7', color: '#16a34a', borderRadius: 20, padding: '4px 14px', fontSize: 12.5, fontWeight: 700 }}>Complete</span>
            : <button onClick={complete} style={{ ...primary, background: '#16a34a' }}>Meeting complete</button>}
        </div>
      </div>

      {msg && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14, maxWidth: 560 }}>
        <div><Lbl>Month</Lbl><select disabled={locked} value={m.month} onChange={e => setField('month', parseInt(e.target.value))} style={inp}>{MONTHNAMES.slice(1).map((n, i) => <option key={i} value={i + 1}>{n}</option>)}</select></div>
        <div><Lbl>Year</Lbl><input disabled={locked} type="number" value={m.year} onChange={e => setField('year', parseInt(e.target.value) || m.year)} style={inp} /></div>
        <div><Lbl>Meeting date</Lbl><input disabled={locked} type="date" value={m.meetingDate || ''} onChange={e => setField('meetingDate', e.target.value)} style={inp} /></div>
      </div>

      {SECTIONS.map(s => (
        <div key={s.key} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e' }}>{s.label}</div>
          <div style={{ fontSize: 11.5, color: '#aaa', marginBottom: 8 }}>{s.hint}</div>
          <textarea disabled={locked} value={m.sections[s.key] || ''} onChange={e => setSection(s.key, e.target.value)} rows={4}
            style={{ ...inp, resize: 'vertical', fontFamily: 'inherit', background: locked ? '#faf9f7' : '#fff' }} />
        </div>
      ))}

      {/* Lessons Learnt - structured rows (item + detail + who it's for). These feed the table. */}
      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e' }}>Lessons Learnt</div>
            <div style={{ fontSize: 11.5, color: '#aaa' }}>Add each lesson as an item + detail, and pick who it's for. These populate the Lessons Learnt table when the meeting is completed.</div>
          </div>
          {!locked && <button onClick={addLessonRow} style={ghost}>+ Add lesson</button>}
        </div>

        {/* Historical free-text (old seeded minutes only) */}
        {m.sections.lessons && (
          <div style={{ background: '#faf9f7', border: '1px solid #eee', borderRadius: 8, padding: '8px 12px', margin: '8px 0', whiteSpace: 'pre-wrap', fontSize: 12.5, color: '#666' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Recorded notes (historical)</div>
            {m.sections.lessons}
          </div>
        )}

        {(m.lessonRows || []).length === 0 && <div style={{ color: '#bbb', fontSize: 13, marginTop: 8 }}>No lessons added.</div>}
        {(m.lessonRows || []).map((r, i) => (
          <div key={r.id || i} style={{ border: '1px solid #eee', borderRadius: 10, padding: 12, marginTop: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px' }}>
                <Lbl>Lessons Learnt item</Lbl>
                <input disabled={locked} value={r.item || ''} onChange={e => setLesson(i, { item: e.target.value })} placeholder="Short name" style={inp} />
              </div>
              <div style={{ flex: '2 1 320px' }}>
                <Lbl>Lessons Learnt</Lbl>
                <textarea disabled={locked} value={r.detail || ''} onChange={e => setLesson(i, { detail: e.target.value })} rows={2} placeholder="The detail / context / what we learnt..." style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              {!locked && <button onClick={() => removeLessonRow(i)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16, marginTop: 22 }}>&times;</button>}
            </div>
            <div style={{ marginTop: 8 }}>
              <Lbl>Who is this for?</Lbl>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.keys(DEPT_LABEL).map(d => <DeptChip key={d} d={d} small on={(r.depts || []).includes(d)} onClick={() => !locked && toggleLessonDept(i, d)} />)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div><div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e' }}>Meeting actions</div>
            <div style={{ fontSize: 11.5, color: '#aaa' }}>Action + person responsible (a portal user). On "Meeting complete" these are added to the Operations live tasks list under "Lessons Learnt".</div></div>
          {!locked && <button onClick={addAction} style={ghost}>+ Add action</button>}
        </div>
        {(m.actions || []).length === 0 && <div style={{ color: '#bbb', fontSize: 13 }}>No actions.</div>}
        {(m.actions || []).map((a, i) => (
          <div key={a.id || i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <input disabled={locked} value={a.action} onChange={e => setAction(i, { action: e.target.value })} placeholder="Action" style={{ ...inp, flex: 2 }} />
            <select disabled={locked} value={a.person || ''} onChange={e => setAction(i, { person: e.target.value, personName: users.find(u => u.id === e.target.value)?.name || '' })} style={{ ...inp, flex: 1 }}>
              <option value="">Person responsible...</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              {/* keep any legacy free-text person that isn't a portal user */}
              {a.person && !users.some(u => u.id === a.person) && <option value={a.person}>{a.personName || a.person}</option>}
            </select>
            {a.pushed && <span title="Added to live tasks" style={{ fontSize: 11, color: '#16a34a', fontWeight: 700, whiteSpace: 'nowrap' }}>&#10003; task</span>}
            {!locked && <button onClick={() => removeAction(i)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16 }}>&times;</button>}
          </div>
        ))}
      </div>
    </div>
  )
}

function DeptChip({ d, on, small, onClick }) {
  const c = DEPT_COLOR[d]
  return <button onClick={onClick} style={{ border: `1px solid ${on ? c : '#ddd'}`, background: on ? c : '#fff', color: on ? '#fff' : '#999', borderRadius: 20, padding: small ? '1px 8px' : '3px 10px', fontSize: small ? 11 : 12, fontWeight: 600, cursor: 'pointer' }}>{DEPT_LABEL[d]}</button>
}
function Lbl({ children }) { return <div style={{ fontSize: 12, color: '#666', fontWeight: 600, marginBottom: 4 }}>{children}</div> }
const th = { textAlign: 'left', padding: '10px 12px', fontSize: 11.5, color: '#8a857c', fontWeight: 600 }
const td = { padding: '10px 12px', verticalAlign: 'top' }
const inp = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13.5 }
const primary = { background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const ghost = { background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer' }
const deptGhost = { background: '#fff', border: '1px solid #ddd', borderRadius: 20, padding: '4px 12px', fontSize: 12.5, cursor: 'pointer', color: '#666' }
const deptActive = (c) => ({ background: c, border: `1px solid ${c}`, borderRadius: 20, padding: '4px 12px', fontSize: 12.5, cursor: 'pointer', color: '#fff', fontWeight: 600 })
