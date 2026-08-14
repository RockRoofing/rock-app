import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

const INK = '#1a1a19'
const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#8a857c', fontWeight: 600, whiteSpace: 'nowrap' }
const td = { padding: '10px 12px', fontSize: 13.5, borderTop: '1px solid #f0f0f0', verticalAlign: 'top' }
const inp = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }
const btn = { background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const link = { background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 13, marginLeft: 10 }

export default function DesignCustomers() {
  const router = useRouter()
  const [me, setMe] = useState(null)
  const [users, setUsers] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [notice, setNotice] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { (async () => {
    try {
      const d = await fetch('/api/portal-auth?action=me').then(r => r.json())
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin' && d.user.role !== 'management') { router.replace('/'); return }
      setMe(d.user)
      await Promise.all([loadUsers(), loadProjects()])
    } catch {}
    setLoading(false)
  })() }, [])

  async function loadUsers() {
    try { const d = await fetch('/api/design-customers?action=list').then(r => r.json()); setUsers(d.users || []) } catch {}
  }
  async function loadProjects() {
    try {
      const d = await fetch('/api/planning').then(r => r.json())
      const ps = (d.projects || []).map(p => ({ projectNo: p.projectNo || p.jobNo, name: p.name || '' })).filter(p => p.projectNo)
      const seen = new Set(); const uniq = []
      for (const p of ps) { if (seen.has(p.projectNo)) continue; seen.add(p.projectNo); uniq.push(p) }
      uniq.sort((a, b) => String(b.projectNo).localeCompare(String(a.projectNo), undefined, { numeric: true }))
      setProjects(uniq)
    } catch {}
  }

  function newUser() { setErr(''); setNotice(''); setForm({ firstName: '', lastName: '', email: '', company: '', phone: '', projects: [], active: true }) }
  function toggleProject(no) {
    setForm(f => { const has = (f.projects || []).includes(no); return { ...f, projects: has ? f.projects.filter(x => x !== no) : [...(f.projects || []), no] } })
  }

  async function save() {
    setErr('')
    if (!form.firstName && !form.lastName) return setErr('Enter a name.')
    if (!form.email) return setErr('Enter an email.')
    if (!(form.projects || []).length) return setErr('Assign at least one project. External users cannot be given all-project access.')
    const action = form.id ? 'update' : 'create'
    try {
      const r = await fetch('/api/design-customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, user: form }) })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Could not save.'); return }
      setUsers(d.users || [])
      setForm(null)
      if (action === 'create' && d.tempPassword) {
        if (d.emailSent) setNotice(`Customer created and login details emailed to ${form.email}. (Temporary password: ${d.tempPassword})`)
        else setNotice(`Customer created, but the email could NOT be sent${d.emailError ? ` (${d.emailError})` : ''}. Share these login details manually - Email: ${form.email}, Temporary password: ${d.tempPassword}`)
      }
      else setNotice('Saved.')
    } catch { setErr('Could not save.') }
  }
  async function resetPw(u) {
    const pw = prompt(`Set a new temporary password for ${u.name} (min 8 characters):`)
    if (!pw) return
    const r = await fetch('/api/design-customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-password', id: u.id, password: pw }) })
    const d = await r.json()
    if (r.ok) setNotice(`Password updated for ${u.name}.`); else setErr(d.error || 'Could not set password.')
  }
  async function resendInvite(u) {
    if (!confirm(`Email new login details to ${u.name} (${u.email})? This generates a new temporary password.`)) return
    const r = await fetch('/api/design-customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resend-invite', id: u.id }) })
    const d = await r.json()
    if (!r.ok) { setErr(d.error || 'Could not resend.'); return }
    setUsers(d.users || [])
    if (d.emailSent) setNotice(`Login details emailed to ${u.email}. (Temporary password: ${d.tempPassword})`)
    else setNotice(`Could NOT send email${d.emailError ? ` (${d.emailError})` : ''}. Share manually - Email: ${u.email}, Temporary password: ${d.tempPassword}`)
  }
  async function del(u) {
    if (!confirm(`Delete customer ${u.name}? They will no longer be able to log in.`)) return
    const r = await fetch('/api/design-customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: u.id }) })
    const d = await r.json()
    if (r.ok) setUsers(d.users || [])
  }

  if (!me) return null
  const projName = (no) => { const p = projects.find(x => x.projectNo === no); return p ? (p.name ? `${no} — ${p.name}` : no) : no }

  return (
    <>
      <Head><title>Design Customers — Admin</title></Head>
      <div style={{ background: '#1a1a19', color: '#fff', padding: '16px 24px' }}>
        <a href={me && me.role === 'management' ? '/design' : '/admin'} style={{ color: '#bbb', fontSize: 13, textDecoration: 'none' }}>{me && me.role === 'management' ? '\u2039 Design' : '\u2039 Admin'}</a>
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>Design Customers</div>
        <div style={{ color: '#999', fontSize: 13, marginTop: 2 }}>External customer / design-team logins for the Design portal. Each is scoped to specific projects and can only view, comment, approve and download.</div>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#8a857c' }}>{users.length} customer login{users.length === 1 ? '' : 's'}</div>
          <button onClick={newUser} style={btn}>+ Add customer</button>
        </div>

        {notice && <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}><span>{notice}</span><button onClick={() => setNotice('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#065f46' }}>×</button></div>}

        {loading ? <div style={{ color: '#999', padding: 30 }}>Loading…</div> : (
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#faf9f7' }}>{['Name', 'Email', 'Company', 'Projects', 'Status', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={td}><strong>{u.name}</strong></td>
                    <td style={td}>{u.email}{u.mustResetPassword && <span style={{ marginLeft: 6, fontSize: 11, color: '#ca8a04' }}>temp pw</span>}</td>
                    <td style={td}>{u.company || '—'}</td>
                    <td style={td}>{(u.projects || []).length ? (u.projects || []).map(projName).join(', ') : <span style={{ color: '#dc2626' }}>none</span>}</td>
                    <td style={td}>{u.active === false ? <span style={{ color: '#bbb' }}>Inactive</span> : <span style={{ color: '#16a34a' }}>Active</span>}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => { setErr(''); setNotice(''); setForm({ ...u, projects: [...(u.projects || [])] }) }} style={link}>Edit</button>
                      <button onClick={() => resendInvite(u)} style={link}>Resend login email</button>
                      <button onClick={() => resetPw(u)} style={link}>Reset password</button>
                      <button onClick={() => del(u)} style={{ ...link, color: '#dc2626' }}>Delete</button>
                    </td>
                  </tr>
                ))}
                {!users.length && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#aaa', padding: 30 }}>No customer logins yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && (
        <div onClick={() => setForm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 100, overflowY: 'auto', padding: '4vh 16px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 24, width: 520, maxWidth: '94vw' }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>{form.id ? 'Edit customer' : 'Add customer'}</h2>
            {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>{err}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><Lbl>First name</Lbl><input value={form.firstName || ''} onChange={e => setForm({ ...form, firstName: e.target.value })} style={inp} /></div>
              <div><Lbl>Last name</Lbl><input value={form.lastName || ''} onChange={e => setForm({ ...form, lastName: e.target.value })} style={inp} /></div>
            </div>
            <div style={{ marginTop: 10 }}><Lbl>Email (their login)</Lbl><input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} style={inp} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
              <div><Lbl>Company</Lbl><input value={form.company || ''} onChange={e => setForm({ ...form, company: e.target.value })} style={inp} /></div>
              <div><Lbl>Phone</Lbl><input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} style={inp} /></div>
            </div>

            <div style={{ marginTop: 14 }}>
              <Lbl>Projects they can access</Lbl>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>Tick each project this customer may access. External users must be scoped to specific projects — there is no "all projects" option.</div>
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #eee', borderRadius: 10, padding: 8 }}>
                {projects.length === 0 && <div style={{ color: '#bbb', fontSize: 13, padding: 8 }}>No projects found.</div>}
                {projects.map(p => {
                  const on = (form.projects || []).includes(p.projectNo)
                  return (
                    <label key={p.projectNo} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: on ? '#f5f3ff' : 'transparent' }}>
                      <input type="checkbox" checked={on} onChange={() => toggleProject(p.projectNo)} />
                      <span style={{ fontSize: 13.5 }}>{p.name ? `${p.projectNo} — ${p.name}` : p.projectNo}</span>
                    </label>
                  )
                })}
              </div>
              <div style={{ fontSize: 12, color: '#8a857c', marginTop: 6 }}>{(form.projects || []).length} project{(form.projects || []).length === 1 ? '' : 's'} selected</div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 14 }}>
              <input type="checkbox" checked={form.active !== false} onChange={e => setForm({ ...form, active: e.target.checked })} /> Active (can log in)
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setForm(null)} style={{ background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '9px 16px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={save} style={btn}>{form.id ? 'Save' : 'Create customer'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Lbl({ children }) { return <div style={{ fontSize: 12.5, color: '#666', marginBottom: 4, fontWeight: 600 }}>{children}</div> }
