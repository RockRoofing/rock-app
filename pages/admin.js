import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

import { ROLES, ROLE_LABEL as roleLabel, normRole } from '../lib/roles'
// Fixed job roles (descriptive) — matches the old Team Members list plus the
// roles the IHM/Pre-Start dropdowns need.
const JOB_ROLES = ['Operative', 'Contracts Manager', 'Operations Manager', 'Estimator', 'Quantity Surveyor', 'Design Manager', 'Site Supervisor', 'Sales Manager', 'Director', 'Other']

export default function AdminPage() {
  const router = useRouter()
  const [me, setMe] = useState(null)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [notice, setNotice] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setMe(d.user); loadUsers()
    })
  }, [])

  async function loadUsers() {
    setLoading(true)
    try { const r = await fetch('/api/portal-auth?action=list'); const d = await r.json(); setUsers(d.users || []) } catch {}
    setLoading(false)
  }

  async function save() {
    setErr('')
    const derivedName = form.name || [form.firstName, form.lastName].filter(Boolean).join(' ')
    if (!derivedName.trim() || !form.email?.trim()) { setErr('Name and email are required.'); return }
    setSaving(true)
    try {
      const action = form.id ? 'update' : 'create'
      const payload = { ...form, name: derivedName }
      const r = await fetch('/api/portal-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, user: payload }) })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Save failed'); setSaving(false); return }
      setUsers(d.users || users)
      setNotice(action === 'create'
        ? (d.emailSent
            ? `User created. Their login details have been emailed to ${form.email}.`
            : `User created, but the email could not be sent${d.emailError ? ` (${d.emailError})` : ''}. Temporary password: ${d.tempPassword} — share this with them; they'll set their own on first login.`)
        : 'User updated.')
      setForm(null)
    } catch (e) { setErr(e?.message || 'Save failed') }
    setSaving(false)
  }

  async function del(id) {
    if (!confirm('Delete this user? They will no longer be able to log in.')) return
    const r = await fetch('/api/portal-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    const d = await r.json()
    if (r.ok) setUsers(d.users || users); else alert(d.error || 'Delete failed')
  }

  async function resetPassword(u) {
    const pw = prompt(`Set a new password for ${u.name} (min 8 characters):`)
    if (!pw) return
    const r = await fetch('/api/portal-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-password', id: u.id, password: pw }) })
    const d = await r.json()
    if (r.ok) setNotice(`Password updated for ${u.name}.`); else alert(d.error || 'Failed')
  }

  if (!me) return null

  return (
    <>
      <Head><title>Rock Roofing — Admin</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none' }}>← Portal</a>
          <span style={{ color: '#3a3a38' }}>|</span>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>Admin</span>
        </div>
        <div style={{ background: '#232321', padding: '0 24px', display: 'flex', gap: 4, height: 44, alignItems: 'center', overflowX: 'auto' }}>
          {[['Portal Users', '/admin'], ['Templates', '/admin/templates'], ['Form Builder', '/operations/forms-builder'], ['Site App Users', '/operations/users'], ['Documents', '/admin/documents'], ['App Improvements', '/admin/problem-reports']].map(([label, href]) => (
            <a key={href} href={href} style={{ fontSize: 13, textDecoration: 'none', padding: '8px 14px', whiteSpace: 'nowrap', color: href === '/admin' ? '#fff' : '#bbb', fontWeight: href === '/admin' ? 600 : 400, borderBottom: href === '/admin' ? '2px solid #ca8a04' : '2px solid transparent' }}>{label}</a>
          ))}
        </div>

        <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, color: '#1a1a19' }}>Portal Users</h1>
              <div style={{ color: '#999', fontSize: 13, marginTop: 2 }}>Create logins and assign roles. Pre-Contract · Post-Contract · Management · Admin.</div>
            </div>
            <button onClick={() => { setNotice(''); setErr(''); setForm({ firstName: '', lastName: '', email: '', phone: '', jobRole: '', role: 'post-contract', active: true }) }} style={btn}>+ Add user</button>
          </div>

          {notice && <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}><span>{notice}</span><button onClick={() => setNotice('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#065f46' }}>×</button></div>}

          {loading ? <div style={{ color: '#999', padding: 30 }}>Loading…</div> : (
            <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#faf9f7' }}>{['Name', 'Email', 'Phone', 'Job role', 'Access', 'Status', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                      <td style={td}><strong>{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.name}</strong></td>
                      <td style={td}>{u.email}</td>
                      <td style={td}>{u.phone || '—'}</td>
                      <td style={td}>{u.jobRole || '—'}</td>
                      <td style={td}><span style={{ background: u.role === 'admin' ? '#fef3c7' : u.role === 'management' ? '#fff1f2' : '#f3f4f6', color: u.role === 'admin' ? '#92400e' : u.role === 'management' ? '#be123c' : '#555', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{roleLabel[u.role] || u.role}</span>{u.mustResetPassword && <span style={{ marginLeft: 6, fontSize: 11, color: '#ca8a04' }}>temp pw</span>}</td>
                      <td style={td}>{u.active === false ? <span style={{ color: '#bbb' }}>Inactive</span> : <span style={{ color: '#16a34a' }}>Active</span>}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => { setNotice(''); setErr(''); setForm({ ...u, role: normRole(u.role) }) }} style={link}>Edit</button>
                        <button onClick={() => resetPassword(u)} style={link}>Reset password</button>
                        {u.id !== me.id && <button onClick={() => del(u.id)} style={{ ...link, color: '#dc2626' }}>Delete</button>}
                      </td>
                    </tr>
                  ))}
                  {!users.length && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#aaa', padding: 30 }}>No users yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {form && (
          <div onClick={() => setForm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 24, width: 420, maxWidth: '90vw' }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>{form.id ? 'Edit user' : 'Add user'}</h2>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}><Lbl>First name</Lbl><input value={form.firstName || ''} onChange={e => setForm({ ...form, firstName: e.target.value })} style={inp} /></div>
                <div style={{ flex: 1 }}><Lbl>Last name</Lbl><input value={form.lastName || ''} onChange={e => setForm({ ...form, lastName: e.target.value })} style={inp} /></div>
              </div>
              <Lbl>Email</Lbl><input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} style={inp} type="email" />
              <Lbl>Phone number</Lbl><input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} style={inp} inputMode="tel" placeholder="07…" />
              <Lbl>Job role</Lbl>
              <select value={form.jobRole || ''} onChange={e => setForm({ ...form, jobRole: e.target.value })} style={inp}>
                <option value="">Select job role…</option>
                {JOB_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <Lbl>Access level</Lbl>
              <select value={normRole(form.role)} onChange={e => setForm({ ...form, role: e.target.value })} style={inp}>
                {ROLES.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 14 }}>
                <input type="checkbox" checked={form.active !== false} onChange={e => setForm({ ...form, active: e.target.checked })} /> Active
              </label>
              {!form.id && <div style={{ background: '#f2efe8', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: '#666', marginTop: 14 }}>A temporary password will be generated and emailed to them with a login link. They'll set their own on first login. (If email can't send, the password is shown here to pass on manually.)</div>}
              {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                <button onClick={save} disabled={saving} style={btn}>{saving ? 'Saving…' : (form.id ? 'Save' : 'Create user')}</button>
                <button onClick={() => setForm(null)} style={ghost}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

const Lbl = ({ children }) => <div style={{ fontSize: 12.5, color: '#666', margin: '10px 0 5px' }}>{children}</div>
const th = { padding: '10px 14px', fontWeight: 600, fontSize: 12, textAlign: 'left', color: '#888' }
const td = { padding: '11px 14px', fontSize: 13 }
const inp = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14 }
const btn = { background: '#ca8a04', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }
const ghost = { background: '#f2f2f0', color: '#555', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, cursor: 'pointer' }
const link = { background: 'none', border: 'none', color: '#2a78d6', cursor: 'pointer', fontSize: 13, padding: '0 8px' }
