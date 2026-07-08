import { useState, useEffect } from 'react'
import OperationsShell, { PageHeading } from '../../components/OperationsShell'
import { INK, th, td, Loading, Modal, Lbl, inp2, primaryBtn, ghostBtn, linkBtn } from '../../components/opsUI'

// Roles align with IHM meeting attendees + common ops roles.
export const TEAM_ROLES = [
  'Estimator', 'Contracts Manager', 'Operations Manager', 'Design Manager',
  'Quantity Surveyor', 'Site Supervisor', 'Sales Manager', 'Director', 'Other',
]

const fullName = (m) => [m.firstName, m.lastName].filter(Boolean).join(' ') || m.name || '—'

export default function TeamMembers() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    try { const r = await fetch('/api/team'); const d = await r.json(); setMembers(d.members || []) } catch {}
    setLoading(false)
  }
  async function save() {
    setErr('')
    if (!form.firstName?.trim() || !form.lastName?.trim()) { setErr('First and last name are required.'); return }
    if (!form.role) { setErr('Please select a role.'); return }
    if (!form.email?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) { setErr('A valid email is required.'); return }
    if (!form.phone?.trim()) { setErr('Phone number is required.'); return }
    await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member: form }) })
    setForm(null); load()
  }
  async function del(id) {
    if (!confirm('Delete this team member?')) return
    await fetch('/api/team', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }
  async function toggleActive(m) {
    await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member: { id: m.id, active: m.active === false } }) })
    load()
  }

  return (
    <OperationsShell active="team" title="Team Members">
      <PageHeading title="Team Members" sub="Internal staff — feeds Handover attendees and Project Financials"
        action={<button onClick={() => setForm({ firstName: '', lastName: '', role: '', email: '', phone: '', active: true })} style={primaryBtn}>+ Add Team Member</button>} />

      {loading ? <Loading /> : (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              {['Name', 'Role', 'Email', 'Phone', 'Status', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={td}><strong>{fullName(m)}</strong></td>
                  <td style={td}>{m.role || '—'}</td>
                  <td style={td}>{m.email || '—'}</td>
                  <td style={td}>{m.phone || '—'}</td>
                  <td style={td}>{m.active === false ? <span style={{ color: '#bbb' }}>Inactive</span> : <span style={{ color: '#16a34a' }}>Active</span>}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setForm({ ...m })} style={linkBtn}>Edit</button>
                    <button onClick={() => toggleActive(m)} style={linkBtn}>{m.active === false ? 'Mark active' : 'Mark inactive'}</button>
                    <button onClick={() => del(m.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
                  </td>
                </tr>
              ))}
              {!members.length && <tr><td colSpan={6} style={{ ...td, color: '#aaa', textAlign: 'center', padding: 30 }}>No team members yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal onClose={() => setForm(null)} title={form.id ? 'Edit Team Member' : 'Add Team Member'}>
          <Lbl>First name</Lbl>
          <input value={form.firstName || ''} onChange={e => setForm({ ...form, firstName: e.target.value })} style={inp2} />
          <Lbl>Last name</Lbl>
          <input value={form.lastName || ''} onChange={e => setForm({ ...form, lastName: e.target.value })} style={inp2} />
          <Lbl>Role</Lbl>
          <select value={form.role || ''} onChange={e => setForm({ ...form, role: e.target.value })} style={inp2}>
            <option value="">Select role…</option>
            {TEAM_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <Lbl>Email</Lbl>
          <input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} style={inp2} inputMode="email" />
          <Lbl>Phone number</Lbl>
          <input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} style={inp2} inputMode="tel" />
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
