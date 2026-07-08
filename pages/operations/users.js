import { useState, useEffect } from 'react'
import OperationsShell, { PageHeading } from '../../components/OperationsShell'
import { INK, th, td, Loading, Modal, Lbl, inp2, primaryBtn, ghostBtn, linkBtn } from '../../components/opsUI'

export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    try { const r = await fetch('/api/ops-users'); const d = await r.json(); setUsers(d.users || []) } catch {}
    setLoading(false)
  }
  async function save() {
    setErr('')
    const r = await fetch('/api/ops-users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: form }) })
    if (!r.ok) { const d = await r.json(); setErr(d.error || 'Error'); return }
    setForm(null); load()
  }
  async function del(id) {
    if (!confirm('Remove this user?')) return
    await fetch('/api/ops-users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }

  return (
    <OperationsShell active="users" title="Users">
      <PageHeading title="Forms Users" sub="Operatives who can log into the Forms App"
        action={<button onClick={() => setForm({ name: '', role: '', pin: '', active: true })} style={primaryBtn}>+ Add user</button>} />

      {loading ? <Loading /> : (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              {['Name', 'Role', 'Status', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={td}><strong>{u.name}</strong></td>
                  <td style={td}>{u.role || '—'}</td>
                  <td style={td}>{u.active === false ? <span style={{ color: '#bbb' }}>Inactive</span> : <span style={{ color: '#16a34a' }}>Active</span>}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => setForm({ ...u, pin: '' })} style={linkBtn}>Edit</button>
                    <button onClick={() => del(u.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
                  </td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={4} style={{ ...td, color: '#aaa', textAlign: 'center', padding: 30 }}>No users yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal onClose={() => setForm(null)} title={form.id ? 'Edit user' : 'Add user'}>
          <Lbl>Full name</Lbl>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inp2} />
          <Lbl>Role (optional)</Lbl>
          <input value={form.role || ''} onChange={e => setForm({ ...form, role: e.target.value })} style={inp2} placeholder="e.g. Installer, Contracts Manager" />
          <Lbl>{form.id ? 'New PIN (leave blank to keep current)' : 'PIN (4–6 digits)'}</Lbl>
          <input value={form.pin || ''} onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} style={inp2} inputMode="numeric" placeholder="••••" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 14 }}>
            <input type="checkbox" checked={form.active !== false} onChange={e => setForm({ ...form, active: e.target.checked })} /> Active
          </label>
          {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button onClick={save} style={primaryBtn}>Save</button>
            <button onClick={() => setForm(null)} style={ghostBtn}>Cancel</button>
          </div>
        </Modal>
      )}
    </OperationsShell>
  )
}
