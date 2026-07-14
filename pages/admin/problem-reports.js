import { useState, useEffect } from 'react'
import AdminShell from '../../components/AdminShell'

const fmt = (t) => t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export default function ProblemReportsPage() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('open')

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

  const rows = reports.filter(r => filter === 'all' ? true : (r.status || 'open') === filter)

  return (
    <AdminShell active="/admin/problem-reports">
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px' }}>
        <h1 style={{ fontSize: 22, color: '#1a1a19', margin: '0 0 4px' }}>Problem Reports</h1>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 16px' }}>Issues reported by users from the Portal and Site App.</p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} style={{ padding: '7px 14px', borderRadius: 20, border: filter === v ? '2px solid #ca8a04' : '1px solid #e0e0e0', background: filter === v ? '#fffbeb' : '#fff', fontWeight: filter === v ? 700 : 500, fontSize: 13, cursor: 'pointer' }}>{l}</button>
          ))}
        </div>

        {loading ? <div style={{ color: '#aaa', padding: 30, textAlign: 'center' }}>Loading…</div>
          : !rows.length ? <div style={{ background: '#fff', border: '1px dashed #ddd', borderRadius: 12, padding: 30, textAlign: 'center', color: '#999' }}>No {filter === 'all' ? '' : filter} reports.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.map(r => (
                <div key={r.id} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 16, opacity: r.status === 'resolved' ? 0.65 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 13, color: '#777' }}>
                      <strong style={{ color: '#1a1a19' }}>{r.userName}</strong> · <span style={{ background: r.platform === 'Site App' ? '#eef2ff' : '#f0fdf4', color: r.platform === 'Site App' ? '#3730a3' : '#166534', borderRadius: 12, padding: '1px 8px', fontSize: 11, fontWeight: 600 }}>{r.platform}</span> · {fmt(r.createdAt)}
                    </div>
                    <button onClick={() => setStatus(r.id, r.status === 'resolved' ? 'open' : 'resolved')} style={{ background: 'none', border: 'none', color: r.status === 'resolved' ? '#888' : '#16a34a', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                      {r.status === 'resolved' ? 'Reopen' : 'Mark resolved'}
                    </button>
                  </div>
                  {r.page && <div style={{ fontSize: 12.5, color: '#999', marginTop: 6 }}>Page: {r.page}</div>}
                  <div style={{ fontSize: 14, color: '#1a1a19', marginTop: 6, whiteSpace: 'pre-wrap' }}>{r.description}</div>
                </div>
              ))}
            </div>
          )}
      </div>
    </AdminShell>
  )
}
