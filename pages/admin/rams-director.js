import { useState, useEffect } from 'react'
import AdminShell from '../../components/AdminShell'

// Admin -> RAMS Director. Choose the Portal User (job role: Director) who approves
// and signs RAMS in the Site App. Matched in the Site App by email.
const GOLD = '#ca8a04', INK = '#1a1a19'

export default function RamsDirectorPage() {
  const [director, setDirector] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [choice, setChoice] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true)
    try {
      const d = await fetch('/api/rams-director').then(r => r.json())
      setDirector(d.director || null)
      setCandidates(d.candidates || [])
      setChoice((d.director?.email || '').toLowerCase())
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function save() {
    setBusy(true); setErr(''); setNotice('')
    try {
      const r = await fetch('/api/rams-director', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: choice }),
      })
      const d = await r.json()
      if (!r.ok || !d.ok) { setErr(d.error || 'Could not save.'); setBusy(false); return }
      setDirector(d.director || null)
      setNotice(d.director ? `RAMS Director set to ${d.director.name}.` : 'RAMS Director cleared.')
    } catch (e) { setErr(e?.message || 'Could not save.') }
    setBusy(false)
  }

  return (
    <AdminShell active="/admin/rams-director" title="RAMS Director">
      <div style={{ maxWidth: 640 }}>
        <h1 style={{ fontSize: 22, color: INK, margin: '0 0 6px' }}>RAMS Director</h1>
        <p style={{ color: '#777', fontSize: 14, margin: '0 0 20px' }}>Choose who approves and signs RAMS at the Director stage of the approval chain. They approve in the Site App (matched by their email), so the chosen person must also be a Site App user with the same email address.</p>

        {loading ? <div style={{ color: '#aaa', padding: 20 }}>Loading…</div> : (
          <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, padding: 20 }}>
            {director
              ? <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 14, color: '#166534' }}>Current RAMS Director: <strong>{director.name}</strong> ({director.email})</div>
              : <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 14, color: '#92400e' }}>No RAMS Director set yet — the approval chain will stall at the Director stage until one is chosen.</div>}

            <div style={{ fontSize: 12, fontWeight: 600, color: '#777', marginBottom: 6 }}>Director (Portal Users with job role &ldquo;Director&rdquo;)</div>
            {candidates.length === 0 ? (
              <div style={{ fontSize: 13, color: '#888', background: '#faf9f7', borderRadius: 8, padding: 14 }}>No Portal Users have the &ldquo;Director&rdquo; job role. Set a user's job role to Director under Portal Users first.</div>
            ) : (
              <select value={choice} onChange={e => setChoice(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', border: '1px solid #e0e0e0', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', background: '#fff' }}>
                <option value="">— None —</option>
                {candidates.map(c => <option key={c.email} value={c.email.toLowerCase()}>{c.name} ({c.email})</option>)}
              </select>
            )}

            {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 12 }}>{err}</div>}
            {notice && <div style={{ color: '#16a34a', fontSize: 13, marginTop: 12 }}>{notice}</div>}

            <button onClick={save} disabled={busy} style={{ marginTop: 16, background: busy ? '#c9c4ba' : GOLD, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
              {busy ? 'Saving…' : 'Save RAMS Director'}
            </button>
          </div>
        )}
      </div>
    </AdminShell>
  )
}
