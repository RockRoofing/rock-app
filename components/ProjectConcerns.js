import { useState, useEffect, useMemo, useCallback } from 'react'
import { INK, GOLD, th, td, Loading, EmptyCard, primaryBtn, ghostBtn, linkBtn, fmtDate } from './opsUI'
import ExpandableText from './ExpandableText'

const ISSUE_OPTIONS = [
  "Customer's financial standing",
  'Managing customer expectations',
  'Anticipated Contra Charges',
  'Achieving project programme',
  'Quality',
  'Water ingress',
  'Delay',
  'Interface issue',
  'Damage to our works',
  'H&S concern',
  'Gross profit margin <20%',
]

const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
// Parse an ISO date (YYYY-MM-DD) as a LOCAL calendar date, not UTC, so it never
// shifts by a day across timezones.
const parseLocal = (d) => { if (!d) return null; const [y, m, day] = d.split('-').map(Number); return new Date(y, (m || 1) - 1, day || 1) }
const isPast = (d) => { const dt = parseLocal(d); if (!dt) return false; const t = new Date(); return dt < new Date(t.getFullYear(), t.getMonth(), t.getDate()) }
const fmtLocal = (d) => { const dt = parseLocal(d); return dt ? dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' }

const emptyMeeting = (projectNo, projectName) => ({
  projectNo, projectName,
  date: todayISO(),
  attendees: [],
  recordingLink: '',
  issues: [],
  issueOther: '',
  description: '',
  mitigation: '',
  actionTaskIds: [],
  riskIds: [],
  anotherMeeting: 'no',
  nextMeetingDate: '',
  nextMeetingTime: '09:00',
  nextMeetingDismissed: false,
})

export default function ProjectConcerns({ projectNo, projectName }) {
  const [meetings, setMeetings] = useState([])
  const [users, setUsers] = useState([])
  const [allTasks, setAllTasks] = useState([])
  const [allRisks, setAllRisks] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)   // meeting being viewed/edited (object) or null
  const [saving, setSaving] = useState(false)
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [m, t, tk, rk] = await Promise.all([
        fetch(`/api/project-concerns?projectNo=${encodeURIComponent(projectNo)}`).then(r => r.json()).catch(() => ({})),
        fetch('/api/team').then(r => r.json()).catch(() => ({})),
        fetch('/api/tasks').then(r => r.json()).catch(() => ({})),
        fetch('/api/risks').then(r => r.json()).catch(() => ({})),
      ])
      setMeetings(m.meetings || [])
      setUsers((t.members || []).filter(u => u.active !== false))
      setAllTasks(tk.tasks || [])
      setAllRisks(rk.risks || [])
    } catch {}
    setLoading(false)
  }, [projectNo])
  useEffect(() => { if (projectNo) load() }, [projectNo, load])

  // Banner: only ever reflects the MOST RECENTLY ADDED meeting. Older meetings'
  // next-dates are superseded and ignored. (meetings[] is newest-first.)
  const banner = useMemo(() => {
    const latest = meetings[0]
    if (!latest) return null
    if (latest.anotherMeeting !== 'yes') return null
    if (!latest.nextMeetingDate) return null
    if (latest.nextMeetingDismissed) return null
    return latest
  }, [meetings])

  function toggleSort(key) { setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }) }
  const sortedMeetings = useMemo(() => {
    const arr = [...meetings]
    const val = (m) => {
      if (sort.key === 'issues') return (m.issues || []).length + (m.issueOther ? 1 : 0)
      if (sort.key === 'project') return (m.projectName || projectName || '').toLowerCase()
      if (sort.key === 'number') return (m.projectNo || projectNo || '').toLowerCase()
      if (sort.key === 'date') return m.date || ''
      return ''
    }
    arr.sort((a, b) => { const av = val(a), bv = val(b); if (av < bv) return sort.dir === 'asc' ? -1 : 1; if (av > bv) return sort.dir === 'asc' ? 1 : -1; return 0 })
    return arr
  }, [meetings, sort, projectName, projectNo])
  const arrow = (key) => sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''

  async function dismissBanner(m) {
    await fetch('/api/project-concerns', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectNo, meeting: { ...m, nextMeetingDismissed: true } }) })
    load()
  }

  function openNew() { setOpen(emptyMeeting(projectNo, projectName)) }
  function openView(m) { setOpen({ ...m }) }

  async function saveMeeting(meeting) {
    setSaving(true)
    try {
      const prev = meetings.find(m => m.id === meeting.id) || {}
      const resp = await fetch('/api/project-concerns', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectNo, meeting }) }).then(r => r.json())
      const meetingId = meeting.id || resp.id

      // Decide calendar invite action:
      //  - now wants a meeting with a date, and none sent yet OR date/time changed -> REQUEST (send/update)
      //  - previously sent an invite but now no meeting/date -> CANCEL
      const wantsMeeting = meeting.anotherMeeting === 'yes' && meeting.nextMeetingDate
      const hadInvite = !!prev.inviteUid
      const dateChanged = prev.inviteSentDate !== meeting.nextMeetingDate || prev.inviteSentTime !== (meeting.nextMeetingTime || '09:00')
      // New attendees added since the last invite?
      const prevInvited = prev.invitedAttendees || []
      const newAttendees = (meeting.attendees || []).some(id => !prevInvited.includes(id))
      let inviteMsg = ''
      if (wantsMeeting && (!hadInvite || dateChanged || newAttendees)) {
        const r = await fetch('/api/concern-invite', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectNo, meetingId, method: 'REQUEST' }) }).then(x => x.json()).catch(() => ({}))
        if (r.sent) inviteMsg = hadInvite ? `Invite update sent to ${r.sent} attendee(s).` : `Invite sent to ${r.sent} attendee(s).`
        else if (r.error && r.error !== 'No new attendees to invite') inviteMsg = `Meeting saved, but invite not sent: ${r.error}.`
      } else if (!wantsMeeting && hadInvite) {
        await fetch('/api/concern-invite', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectNo, meetingId, method: 'CANCEL' }) }).catch(() => {})
        inviteMsg = 'Meeting saved; previous invite cancelled.'
      }
      await load()
      setOpen(null)
      if (inviteMsg) setTimeout(() => alert(inviteMsg), 100)
    } catch { alert('Could not save meeting.') }
    setSaving(false)
  }

  async function deleteMeeting(m) {
    if (!confirm('Delete this project concern meeting? (Tasks and risks it created will remain on their pages.)')) return
    await fetch('/api/project-concerns', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectNo, id: m.id }) })
    load()
  }

  if (loading) return <Loading />

  return (
    <div>
      {/* Banner */}
      {banner && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 16px', borderRadius: 10,
          background: isPast(banner.nextMeetingDate) ? '#fef2f2' : '#eff6ff',
          border: `1px solid ${isPast(banner.nextMeetingDate) ? '#fecaca' : '#bfdbfe'}`,
        }}>
          <span style={{ fontSize: 14, color: isPast(banner.nextMeetingDate) ? '#b91c1c' : '#1e40af', fontWeight: 600 }}>
            {isPast(banner.nextMeetingDate)
              ? <>⚠ Project Concern scheduled for {fmtLocal(banner.nextMeetingDate)}. This has now passed.</>
              : <>Next Project Concern meeting: {fmtLocal(banner.nextMeetingDate)}</>}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={() => dismissBanner(banner)} title="Dismiss" style={{ ...linkBtn, color: '#888', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: '#777' }}>{meetings.length} meeting{meetings.length === 1 ? '' : 's'} on record</div>
        <button onClick={openNew} style={primaryBtn}>+ Add new</button>
      </div>

      {meetings.length === 0 ? (
        <EmptyCard title="No project concerns" body="No project concern meetings have been held for this project yet. Click “Add new” to record one." />
      ) : (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('project')}>Project{arrow('project')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('number')}>Number{arrow('number')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('date')}>Date{arrow('date')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('issues')}>Issues{arrow('issues')}</th>
              <th style={{ ...th, textAlign: 'right' }}></th>
            </tr></thead>
            <tbody>
              {sortedMeetings.map(m => (
                <tr key={m.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={td}>{m.projectName || projectName || '—'}</td>
                  <td style={td}>{m.projectNo || projectNo}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{m.date ? fmtLocal(m.date) : "—"}</td>
                  <td style={td}>{(m.issues || []).length + (m.issueOther ? 1 : 0)} noted</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => openView(m)} style={linkBtn}>View</button>
                    <button onClick={() => deleteMeeting(m)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <MeetingModal
          initial={open}
          users={users}
          projectNo={projectNo}
          projectName={projectName}
          allTasks={allTasks}
          allRisks={allRisks}
          saving={saving}
          onClose={() => setOpen(null)}
          onSave={saveMeeting}
          reloadLinks={load}
        />
      )}
    </div>
  )
}

// ---- Large meeting modal ----
function MeetingModal({ initial, users, projectNo, projectName, allTasks, allRisks, saving, onClose, onSave, reloadLinks }) {
  const [f, setF] = useState(() => ({ ...initial, date: initial.date || todayISO() }))
  const [tasks, setTasks] = useState(allTasks)
  const [risks, setRisks] = useState(allRisks)
  const set = (patch) => setF(prev => ({ ...prev, ...patch }))

  // Live task/risk records this meeting references
  const myTasks = tasks.filter(t => (f.actionTaskIds || []).includes(t.id))
  // Risk Log for THIS project (spec: bring project's risk log into view)
  const projectRisks = risks.filter(r => r.projectNo === projectNo)

  const userName = (u) => u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email

  function toggleIssue(opt) {
    const has = (f.issues || []).includes(opt)
    set({ issues: has ? f.issues.filter(i => i !== opt) : [...(f.issues || []), opt] })
  }
  function toggleAttendee(id) {
    const has = (f.attendees || []).includes(id)
    set({ attendees: has ? f.attendees.filter(a => a !== id) : [...(f.attendees || []), id] })
  }

  // --- Meeting Actions <-> Live Tasks (two-way) ---
  async function addAction() {
    const task = { projectNo, projectName, description: '', assignee: '', closed: false, comments: '', attachments: [], sourceConcern: projectNo }
    const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task }) }).then(r => r.json())
    if (res.id) {
      const newTask = { ...task, id: res.id, createdAt: Date.now() }
      setTasks(ts => [newTask, ...ts])
      set({ actionTaskIds: [...(f.actionTaskIds || []), res.id] })
    } else {
      alert('Could not add the action. Please try again.')
    }
  }
  async function patchTask(id, patch) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t))
    const current = tasks.find(t => t.id === id) || {}
    await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: { ...current, ...patch, id } }) })
  }
  async function removeAction(id) {
    if (!confirm('Remove this action? It will be deleted from Live Project Tasks too.')) return
    await fetch('/api/tasks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setTasks(ts => ts.filter(t => t.id !== id))
    set({ actionTaskIds: (f.actionTaskIds || []).filter(x => x !== id) })
  }

  // --- Add Risk -> Risk Log (two-way; new risks show live in project risk log) ---
  async function addRisk() {
    const risk = { projectNo, projectName, description: '', mitigation: '', assignee: '', closed: false, comments: '', attachments: [], sourceConcern: projectNo }
    const res = await fetch('/api/risks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ risk }) }).then(r => r.json())
    if (res.id) {
      setRisks(rs => [{ ...risk, id: res.id, createdAt: Date.now() }, ...rs])
      set({ riskIds: [...(f.riskIds || []), res.id] })
    }
  }
  async function patchRisk(id, patch) {
    setRisks(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
    const current = risks.find(r => r.id === id) || {}
    await fetch('/api/risks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ risk: { ...current, ...patch, id } }) })
  }

  function submit() {
    if (!f.date) { alert('Please set the meeting date.'); return }
    onSave({ ...f, projectNo, projectName })
  }

  const L = ({ children }) => <div style={{ fontSize: 12.5, fontWeight: 600, color: INK, margin: '18px 0 6px' }}>{children}</div>
  const grey = { fontSize: 11.5, color: '#9ca3af', fontWeight: 400, marginBottom: 6 }
  const input = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3vh 2vw', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 1000, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff', borderRadius: '14px 14px 0 0', zIndex: 2 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: INK }}>Project Concern Meeting</h2>
          <button onClick={onClose} style={{ fontSize: 24, border: 'none', background: 'none', cursor: 'pointer', color: '#999' }}>×</button>
        </div>

        <div style={{ padding: '8px 28px 28px' }}>
          {/* Project (auto) + date */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <L>Project Name</L>
              <div style={{ ...input, background: '#f9fafb', color: '#555' }}>{projectName || '—'}</div>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <L>Project Number</L>
              <div style={{ ...input, background: '#f9fafb', color: '#555' }}>{projectNo || '—'}</div>
            </div>
            <div style={{ minWidth: 170 }}>
              <L>Date</L>
              <input type="date" value={f.date || ''} onChange={e => set({ date: e.target.value })} style={input} />
            </div>
          </div>

          {/* Attendees */}
          <L>Meeting Attendees</L>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {users.length === 0 && <div style={{ fontSize: 12.5, color: '#999' }}>No portal users found.</div>}
            {users.map(u => {
              const on = (f.attendees || []).includes(u.id)
              return (
                <button key={u.id} onClick={() => toggleAttendee(u.id)}
                  style={{ fontSize: 12.5, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', border: `1px solid ${on ? GOLD : '#e0e0e0'}`, background: on ? '#fffbeb' : '#fff', color: on ? '#92400e' : '#555', fontWeight: on ? 600 : 400 }}>
                  {on ? '✓ ' : ''}{userName(u)}
                </button>
              )
            })}
          </div>

          {/* Recording link */}
          <L>Meeting Recording Link</L>
          <input value={f.recordingLink || ''} onChange={e => set({ recordingLink: e.target.value })} placeholder="Paste the Teams recording link" style={input} />

          {/* Issues */}
          <L>What is / are the issues faced?</L>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6 }}>
            {ISSUE_OPTIONS.map(opt => {
              const on = (f.issues || []).includes(opt)
              return (
                <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: on ? '#fffbeb' : 'transparent' }}>
                  <input type="checkbox" checked={on} onChange={() => toggleIssue(opt)} /> {opt}
                </label>
              )
            })}
          </div>
          <div style={{ marginTop: 8 }}>
            <input value={f.issueOther || ''} onChange={e => set({ issueOther: e.target.value })} placeholder="If other, name here" style={input} />
          </div>

          {/* Description + mitigation */}
          <L>Describe the current and / or potential issue/s</L>
          <textarea value={f.description || ''} onChange={e => set({ description: e.target.value })} style={{ ...input, minHeight: 90, resize: 'vertical' }} />
          <L>How do we plan to mitigate or remove the risk?</L>
          <textarea value={f.mitigation || ''} onChange={e => set({ mitigation: e.target.value })} style={{ ...input, minHeight: 90, resize: 'vertical' }} />

          {/* Meeting Actions -> Live Tasks */}
          <L>Meeting Actions</L>
          <div style={grey}>Meeting actions automatically add to Live Project Tasks. Edits here and on the Live Tasks page stay in sync.</div>
          <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ background: '#faf9f7' }}>
                <th style={{ ...th, fontSize: 11 }}>Action</th>
                <th style={{ ...th, fontSize: 11, width: 200 }}>Person Responsible</th>
                <th style={{ ...th, fontSize: 11, width: 90 }}>Done?</th>
                <th style={{ ...th, width: 40 }}></th>
              </tr></thead>
              <tbody>
                {myTasks.length === 0 && <tr><td colSpan={4} style={{ ...td, color: '#aaa', fontSize: 12 }}>No actions yet.</td></tr>}
                {myTasks.map(t => (
                  <tr key={t.id} style={{ borderTop: '1px solid #f2f2f2', background: t.closed ? '#ecfdf5' : '#fff' }}>
                    <td style={td}><input value={t.description || ''} onChange={e => patchTask(t.id, { description: e.target.value })} placeholder="Insert action..." style={{ ...input, padding: '6px 8px' }} /></td>
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
                    <td style={{ ...td, textAlign: 'center' }}><button onClick={() => removeAction(t.id)} style={{ ...linkBtn, color: '#dc2626' }}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={addAction} style={{ ...ghostBtn, marginTop: 8 }}>+ Add Task</button>

          {/* Risk Log (this project) */}
          <L>Risk Log</L>
          <div style={grey}>The project’s Risk Log. Risks added here automatically populate the Risk Log page (and stay in sync).</div>
          <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ background: '#faf9f7' }}>
                <th style={{ ...th, fontSize: 11 }}>Risk</th>
                <th style={{ ...th, fontSize: 11 }}>Mitigation</th>
                <th style={{ ...th, fontSize: 11, width: 90 }}>Resolved?</th>
              </tr></thead>
              <tbody>
                {projectRisks.length === 0 && <tr><td colSpan={3} style={{ ...td, color: '#aaa', fontSize: 12 }}>No risks logged for this project.</td></tr>}
                {projectRisks.map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid #f2f2f2', background: r.closed ? '#ecfdf5' : '#fff' }}>
                    <td style={td}><input value={r.description || ''} onChange={e => patchRisk(r.id, { description: e.target.value })} placeholder="Insert risk..." style={{ ...input, padding: '6px 8px' }} /></td>
                    <td style={td}><input value={r.mitigation || ''} onChange={e => patchRisk(r.id, { mitigation: e.target.value })} placeholder="Insert mitigation..." style={{ ...input, padding: '6px 8px' }} /></td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <select value={r.closed ? 'yes' : 'no'} onChange={e => patchRisk(r.id, { closed: e.target.value === 'yes' })} style={{ ...input, padding: '6px 8px' }}>
                        <option value="no">No</option><option value="yes">Yes</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={addRisk} style={{ ...ghostBtn, marginTop: 8 }}>+ Add Risk</button>

          {/* Another meeting */}
          <L>Do we require another meeting?</L>
          <div style={grey}>If risks are still to be mitigated and not yet actioned, another meeting is mandatory.</div>
          <select value={f.anotherMeeting || 'no'} onChange={e => set({ anotherMeeting: e.target.value })} style={{ ...input, maxWidth: 160 }}>
            <option value="no">No</option><option value="yes">Yes</option>
          </select>
          {f.anotherMeeting === 'yes' && (
            <div style={{ marginTop: 12 }}>
              <L>Date & time of next meeting</L>
              <div style={grey}>Saving with a date & time automatically sends a calendar invite to the meeting attendees (listing the risks, mitigations and actions). Changing the date/time later sends an updated invite; attendees can then edit it in their own calendar.</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="date" value={f.nextMeetingDate || ''} onChange={e => set({ nextMeetingDate: e.target.value, nextMeetingDismissed: false })} style={{ ...input, maxWidth: 180 }} />
                <input type="time" value={f.nextMeetingTime || '09:00'} onChange={e => set({ nextMeetingTime: e.target.value })} style={{ ...input, maxWidth: 130 }} />
                {f.nextMeetingDate && <button onClick={() => set({ nextMeetingDate: '' })} style={linkBtn}>Clear</button>}
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 28, borderTop: '1px solid #eee', paddingTop: 18 }}>
            <button onClick={onClose} style={ghostBtn}>Cancel</button>
            <button onClick={submit} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save meeting'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
