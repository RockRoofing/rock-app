import { useState, useEffect, useMemo } from 'react'
import AdminShell from '../../components/AdminShell'

const fmt = (t) => t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

// Admin › Problem Reports — a table of app issues with a Status column (Open /
// Resolved). Resolved issues drop out of the default view. Filters: User + Status.
export default function ProblemReportsPage() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [fUser, setFUser] = useState('')
  const [fStatus, setFStatus] = useState('open')   // default Open (resolved hidden)

  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/report-problem').then(r => r.json()); setReports(d.reports || []) } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function setStatus(id, status) {
    setReports(rs => rs.map(r => r.id === id ? { ...r, status } : r))
    try { await fetch('/api/report-problem', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }) } catch {}
  }

  const users = useMemo(() => [...new Set(reports.map(r => r.userName).filter(Boolean))].sort(), [reports])
  const rows = reports
    .filter(r => !fUser || r.userName === fUser)
    .filter(r => fStatus === 'all' ? true : (r.status || 'open') === fStatus)

  return (
    <AdminShell active="/admin/problem-reports">
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, color: '#1a1a19', margin: '0 0 4px' }}>Problem Reports</h1>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 16px' }}>Issues reported by users from the Portal and Site App.</p>

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
          <div style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>{rows.length} report{rows.length === 1 ? '' : 's'}</div>
        </div>

        {loading ? <div style={{ color: '#aaa', padding: 30, textAlign: 'center' }}>Loading…</div>
          : !rows.length ? <div style={{ background: '#fff', border: '1px dashed #ddd', borderRadius: 12, padding: 30, textAlign: 'center', color: '#999' }}>No {fStatus === 'all' ? '' : fStatus} reports.</div>
          : (
            <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                <thead><tr style={{ background: '#faf9f7', textAlign: 'left' }}>
                  <th style={th}>Date</th><th style={th}>User</th><th style={th}>Where</th><th style={th}>Page</th><th style={th}>Problem</th><th style={th}>Status</th><th style={th}></th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid #f0f0f0', verticalAlign: 'top' }}>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: '#888' }}>{fmt(r.createdAt)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>{r.userName}</td>
                      <td style={td}><span style={{ background: r.platform === 'Site App' ? '#eef2ff' : '#f0fdf4', color: r.platform === 'Site App' ? '#3730a3' : '#166534', borderRadius: 12, padding: '1px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.platform}</span></td>
                      <td style={{ ...td, color: '#666', maxWidth: 140 }}>{r.page || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'pre-wrap', maxWidth: 320 }}>{r.description}</td>
                      <td style={td}><span style={{ color: (r.status || 'open') === 'resolved' ? '#16a34a' : '#c2410c', fontWeight: 600, fontSize: 12.5 }}>{(r.status || 'open') === 'resolved' ? 'Resolved' : 'Open'}</span></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <button onClick={() => setStatus(r.id, (r.status || 'open') === 'resolved' ? 'open' : 'resolved')} style={{ background: 'none', border: 'none', color: (r.status || 'open') === 'resolved' ? '#888' : '#16a34a', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>
                          {(r.status || 'open') === 'resolved' ? 'Reopen' : 'Mark resolved'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </AdminShell>
  )
}

const sel = { padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', minWidth: 160 }
const ghost = { padding: '8px 14px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', cursor: 'pointer', color: '#555' }
const th = { padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#555' }
const td = { padding: '10px 12px', fontSize: 13, color: '#1a1a19' }
