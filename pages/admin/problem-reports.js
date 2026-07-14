import { useState, useEffect, useMemo } from 'react'
import AdminShell from '../../components/AdminShell'

const fmt = (t) => t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

// Admin › App Improvements — table of suggestions with a comments box and a
// resolve action. Resolving emails the original reporter (with the comments).
// Filters: User + Status. Resolved items drop out of the default view.
export default function AppImprovementsPage() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [fUser, setFUser] = useState('')
  const [fStatus, setFStatus] = useState('open')
  const [drafts, setDrafts] = useState({})   // id -> comment text being edited
  const [busy, setBusy] = useState('')

  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/report-problem').then(r => r.json()); setReports(d.reports || []) } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const commentOf = (r) => drafts[r.id] !== undefined ? drafts[r.id] : (r.comments || '')

  async function saveComment(r) {
    setBusy(r.id)
    try { await fetch('/api/report-problem', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, comments: commentOf(r) }) }) } catch {}
    setReports(rs => rs.map(x => x.id === r.id ? { ...x, comments: commentOf(r) } : x))
    setBusy('')
  }

  async function resolve(r) {
    const comments = commentOf(r)
    const msg = r.userEmail
      ? `Mark this improvement as resolved and email ${r.userName} (${r.userEmail})${comments.trim() ? ' with your comments' : ''}?`
      : `Mark this improvement as resolved? (No email on file for ${r.userName}, so they won't be notified.)`
    if (!confirm(msg)) return
    setBusy(r.id)
    try {
      const res = await fetch('/api/report-problem', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, status: 'resolved', comments }) })
      const d = await res.json().catch(() => ({}))
      setReports(rs => rs.map(x => x.id === r.id ? { ...x, status: 'resolved', comments } : x))
      if (r.userEmail && d.emailed === false) alert('Marked resolved, but the notification email could not be sent.')
    } catch {}
    setBusy('')
  }

  async function reopen(r) {
    setBusy(r.id)
    try { await fetch('/api/report-problem', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, status: 'open' }) }) } catch {}
    setReports(rs => rs.map(x => x.id === r.id ? { ...x, status: 'open' } : x))
    setBusy('')
  }

  const users = useMemo(() => [...new Set(reports.map(r => r.userName).filter(Boolean))].sort(), [reports])
  const rows = reports
    .filter(r => !fUser || r.userName === fUser)
    .filter(r => fStatus === 'all' ? true : (r.status || 'open') === fStatus)

  return (
    <AdminShell active="/admin/problem-reports">
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, color: '#1a1a19', margin: '0 0 4px' }}>App Improvements</h1>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 16px' }}>Suggestions from the Portal and Site App. Add comments, then mark resolved to notify the person who raised it.</p>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>User</div>
            <select value={fUser} onChange={e => setFUser(e.target.value)} style={sel}>
              <option value="">All users</option>
              {users.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Status</div>
            <select value={fStatus} onChange={e => setFStatus(e.target.value)} style={sel}>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </div>
          {(fUser || fStatus !== 'open') && <button onClick={() => { setFUser(''); setFStatus('open') }} style={ghost}>Reset</button>}
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>{rows.length} improvement{rows.length === 1 ? '' : 's'}</div>
        </div>

        {loading ? <div style={{ color: '#aaa', padding: 30, textAlign: 'center' }}>Loading…</div>
          : !rows.length ? <div style={{ background: '#fff', border: '1px dashed #ddd', borderRadius: 12, padding: 30, textAlign: 'center', color: '#999' }}>No {fStatus === 'all' ? '' : fStatus} improvements.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {rows.map(r => {
                const resolved = (r.status || 'open') === 'resolved'
                return (
                  <div key={r.id} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 16, opacity: resolved ? 0.72 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <div style={{ fontSize: 13, color: '#777' }}>
                        <strong style={{ color: '#1a1a19' }}>{r.userName}</strong>
                        {r.userEmail ? <span style={{ color: '#aaa' }}> · {r.userEmail}</span> : <span style={{ color: '#c9a227' }}> · no email on file</span>}
                        {' · '}<span style={{ background: r.platform === 'Site App' ? '#eef2ff' : '#f0fdf4', color: r.platform === 'Site App' ? '#3730a3' : '#166534', borderRadius: 12, padding: '1px 8px', fontSize: 11, fontWeight: 600 }}>{r.platform}</span>
                        {' · '}{fmt(r.createdAt)}
                      </div>
                      <span style={{ color: resolved ? '#16a34a' : '#c2410c', fontWeight: 700, fontSize: 12.5 }}>{resolved ? 'Resolved' : 'Open'}</span>
                    </div>
                    {r.page && <div style={{ fontSize: 12.5, color: '#999', marginTop: 6 }}>Page: {r.page}</div>}
                    <div style={{ fontSize: 14, color: '#1a1a19', marginTop: 8, whiteSpace: 'pre-wrap' }}>{r.description}</div>

                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 5 }}>Comments {resolved ? '' : '(included in the email when you resolve)'}</div>
                      <textarea value={commentOf(r)} onChange={e => setDrafts(d => ({ ...d, [r.id]: e.target.value }))} rows={2}
                        placeholder="Add a note for the person who raised this…"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', resize: 'vertical' }} />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => saveComment(r)} disabled={busy === r.id} style={ghost}>Save comment</button>
                        {!resolved
                          ? <button onClick={() => resolve(r)} disabled={busy === r.id} style={primary}>{busy === r.id ? 'Working…' : 'Mark resolved' + (r.userEmail ? ' & notify' : '')}</button>
                          : <button onClick={() => reopen(r)} disabled={busy === r.id} style={ghost}>Reopen</button>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      </div>
    </AdminShell>
  )
}

const sel = { padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', minWidth: 160 }
const ghost = { padding: '8px 14px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', cursor: 'pointer', color: '#555', fontFamily: 'inherit' }
const primary = { padding: '8px 16px', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, background: '#16a34a', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }
