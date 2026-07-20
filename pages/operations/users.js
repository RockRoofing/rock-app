import { useState, useEffect, useRef, useMemo } from 'react'
import OperationsShell from '../../components/AdminShell'
import { PageHeading } from '../../components/OperationsShell'
import { INK, th, td, Loading, Modal, Lbl, inp2, primaryBtn, ghostBtn, linkBtn } from '../../components/opsUI'

const ROLES = ['Operative', 'Contracts Manager', 'Quantity Surveyor', 'Operations Manager', 'Estimator', 'Director', 'Other']
const TRADES = ['Single Ply', 'Felt', 'Liquids', 'Hot Melt', 'Rainscreen', 'Composite Panels', 'Aluminium', 'Standing Seam', 'Labourer', 'Other']
const Req = () => <span style={{ color: '#dc2626' }}>*</span>

// Works for both new records (firstName/lastName) and any legacy record (name).
const fullName = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || '—'

export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [projects, setProjects] = useState([])

  // Distinct company names already on record (used for the autocomplete + de-dupe).
  const knownCompanies = useMemo(() => {
    const seen = new Map()   // lowercased -> canonical spelling
    for (const u of users) {
      const c = (u.company || '').trim()
      if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [users])

  useEffect(() => { load(); loadProjects() }, [])
  async function loadProjects() {
    try {
      const d = await fetch('/api/ops-projects').then(r => r.json())
      setProjects((d.projects || []).map(p => ({ no: p.projectNo, name: p.projectName || '' }))
        .sort((a, b) => (a.no || '').localeCompare(b.no || '', undefined, { numeric: true })))
    } catch {}
  }
  async function load() {
    try { const r = await fetch('/api/ops-users'); const d = await r.json(); setUsers(d.users || []) } catch {}
    setLoading(false)
  }
  async function save() {
    setErr('')
    // All fields mandatory
    if (!form.firstName?.trim() || !form.lastName?.trim()) { setErr('First and last name are required.'); return }
    if (!form.role) { setErr('Please select a role.'); return }
    if (!form.phone?.trim()) { setErr('Mobile number is required.'); return }
    if (!form.email?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) { setErr('A valid email address is required.'); return }
    if (!form.company?.trim()) { setErr('Company is required.'); return }
    if (!Array.isArray(form.trades) || form.trades.length === 0) { setErr('Please select at least one trade.'); return }
    setSaving(true)
    // De-dupe: if the typed company matches an existing one (case/whitespace
    // insensitive), use the existing canonical spelling rather than creating a
    // near-duplicate.
    const typed = form.company.trim()
    const canonical = knownCompanies.find(c => c.toLowerCase() === typed.toLowerCase()) || typed
    const payload = { ...form, company: canonical }
    const r = await fetch('/api/ops-users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: payload }) })
    const d = await r.json()
    setSaving(false)
    if (!r.ok) { setErr(d.error || 'Error'); return }
    const wasNew = !form.id
    setForm(null); setUsers(d.users || [])
    if (wasNew) {
      setNotice(d.emailSent
        ? `Invite sent to ${d.email} with a temporary PIN.`
        : `User added. Email could not be sent${d.emailError ? ` (${d.emailError})` : ''} — temporary PIN: ${d.tempPin || '—'}`)
    }
  }
  async function del(id) {
    if (!confirm('Remove this user?')) return
    await fetch('/api/ops-users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }
  async function resetPin(u) {
    if (!confirm(`Reset PIN for ${fullName(u)}? A new temporary PIN will be emailed and they'll set their own on next login.`)) return
    const r = await fetch('/api/ops-users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset-pin', id: u.id }) })
    const d = await r.json()
    if (!r.ok) { setNotice(d.error || 'Could not reset PIN'); return }
    setNotice(d.emailSent
      ? `New temporary PIN emailed to ${u.email}.`
      : `PIN reset. Email not sent — temporary PIN: ${d.tempPin || '—'}`)
    load()
  }

  return (
    <OperationsShell active="/operations/users" title="Site App Users" allow={['management', 'admin']}>
      <PageHeading title="Site App Users" sub="People who can log into the Site App"
        action={<button onClick={() => { setNotice(''); setForm({ firstName: '', lastName: '', role: '', accessLevel: 'operative', phone: '', email: '', company: '', trades: [], active: true }) }} style={primaryBtn}>+ Add user</button>} />

      {notice && (
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 13.5, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{notice}</span>
          <button onClick={() => setNotice('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#065f46' }}>×</button>
        </div>
      )}

      {loading ? <Loading /> : (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              {['Name', 'Role', 'Access', 'Company', 'Trade', 'Projects', 'Mobile', 'Email', 'PIN', 'Status', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={td}><strong>{fullName(u)}</strong></td>
                  <td style={td}>{u.role || '—'}</td>
                  <td style={td}>{u.accessLevel === 'contracts-manager'
                    ? <span style={{ background: '#eef2ff', color: '#3730a3', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>Contracts Manager</span>
                    : <span style={{ background: '#f0f4f8', color: '#475569', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>Operative</span>}</td>
                  <td style={td}>{u.company || '—'}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>{(u.trades || []).length ? (u.trades || []).join(', ') : '—'}</td>
                  <td style={{ ...td, fontSize: 12.5, color: '#666' }}>{(u.projectAccess == null || u.projectAccess === 'all') ? 'All' : `${(u.projectAccess || []).length} selected`}</td>
                  <td style={td}>{u.phone || '—'}</td>
                  <td style={td}>{u.email || '—'}</td>
                  <td style={td}>{u.mustResetPin
                    ? <span style={{ color: '#ca8a04', fontSize: 12 }}>Temp — awaiting reset</span>
                    : <span style={{ color: '#16a34a', fontSize: 12 }}>Set</span>}</td>
                  <td style={td}>{u.active === false ? <span style={{ color: '#bbb' }}>Inactive</span> : <span style={{ color: '#16a34a' }}>Active</span>}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => { setNotice(''); setForm({ ...u }) }} style={linkBtn}>Edit</button>
                    <button onClick={() => resetPin(u)} style={linkBtn}>Reset PIN</button>
                    <button onClick={() => del(u.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
                  </td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={8} style={{ ...td, color: '#aaa', textAlign: 'center', padding: 30 }}>No users yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}


      {form && (
        <Modal onClose={() => setForm(null)} title={form.id ? 'Edit user' : 'Add user'}>
          <Lbl>First name <Req /></Lbl>
          <input value={form.firstName || ''} onChange={e => setForm({ ...form, firstName: e.target.value })} style={inp2} />
          <Lbl>Last name <Req /></Lbl>
          <input value={form.lastName || ''} onChange={e => setForm({ ...form, lastName: e.target.value })} style={inp2} />
          <Lbl>Role <Req /></Lbl>
          <select value={form.role || ''} onChange={e => setForm({ ...form, role: e.target.value })} style={inp2}>
            <option value="">Select role…</option>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <Lbl>Access level <Req /></Lbl>
          <select value={form.accessLevel || 'operative'} onChange={e => setForm({ ...form, accessLevel: e.target.value })} style={inp2}>
            <option value="operative">Operative</option>
            <option value="contracts-manager">Contracts Manager</option>
          </select>
          <div style={{ fontSize: 12, color: '#999', marginTop: 4, marginBottom: 4 }}>Contracts Managers see additional features in the Site App.</div>
          <Lbl>Project access <Req /></Lbl>
          <ProjectAccessPicker projects={projects}
            value={form.projectAccess}
            onChange={pa => setForm({ ...form, projectAccess: pa })} />
          <div style={{ fontSize: 12, color: '#999', marginTop: 10, marginBottom: 4 }}>Controls which projects this user sees and can complete forms for in the Site App.</div>
          <Lbl>Mobile number <Req /></Lbl>
          <input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} style={inp2} inputMode="tel" placeholder="07…" />
          <Lbl>Email address <Req /></Lbl>
          <input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} style={inp2} inputMode="email" placeholder="name@example.com" />
          <Lbl>Company <Req /></Lbl>
          <CompanyInput value={form.company || ''} options={knownCompanies} onChange={v => setForm({ ...form, company: v })} />
          <Lbl>Trade(s) <Req /> <span style={{ fontWeight: 400, color: '#999', fontSize: 11 }}>(select at least one)</span></Lbl>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
            {TRADES.map(t => {
              const on = (form.trades || []).includes(t)
              return (
                <button key={t} type="button" onClick={() => {
                  const cur = form.trades || []
                  setForm({ ...form, trades: on ? cur.filter(x => x !== t) : [...cur, t] })
                }} style={{ padding: '6px 11px', borderRadius: 16, border: '1px solid ' + (on ? '#ca8a04' : '#e0e0e0'), background: on ? '#fffbeb' : '#fff', color: on ? '#92400e' : '#666', fontSize: 12.5, fontWeight: on ? 600 : 400, cursor: 'pointer' }}>
                  {on ? '✓ ' : ''}{t}
                </button>
              )
            })}
          </div>
          {!form.id && (
            <div style={{ background: '#f2efe8', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: '#666', marginTop: 14 }}>
              A temporary PIN will be generated and emailed to the user with a link to the Site App.
              They'll be asked to set their own PIN the first time they log in.
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 14 }}>
            <input type="checkbox" checked={form.active !== false} onChange={e => setForm({ ...form, active: e.target.checked })} /> Active
          </label>
          {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : (form.id ? 'Save' : 'Add user & send invite')}</button>
            <button onClick={() => setForm(null)} style={ghostBtn}>Cancel</button>
          </div>
        </Modal>
      )}
    </OperationsShell>
  )
}

// Company autocomplete. Suggests existing companies as you type so we don't
// create near-duplicates. Typing a name that matches an existing company (case/
// whitespace-insensitive) reuses that company on save (handled in save()).
function CompanyInput({ value, options, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const q = (value || '').trim().toLowerCase()
  const matches = q
    ? options.filter(c => c.toLowerCase().includes(q)).slice(0, 8)
    : options.slice(0, 8)
  // Exact (case-insensitive) match already on record?
  const exact = options.find(c => c.toLowerCase() === q)
  // Show suggestions only if there are options and no exact-only match.
  const showList = open && matches.length > 0 && !(matches.length === 1 && exact)

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        style={inp2}
        placeholder="Start typing a company name…"
        autoComplete="off"
      />
      {value && exact && (
        <div style={{ fontSize: 11.5, color: '#16a34a', marginTop: 3 }}>✓ Matches an existing company — this record will be used.</div>
      )}
      {showList && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #ddd', borderRadius: 10, boxShadow: '0 6px 20px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto', padding: 4 }}>
          <div style={{ fontSize: 11, color: '#999', padding: '4px 10px 2px' }}>Existing companies</div>
          {matches.map(c => (
            <button key={c} type="button" onClick={() => { onChange(c); setOpen(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6, border: 'none', background: c.toLowerCase() === q ? '#fffbeb' : '#fff', cursor: 'pointer', fontSize: 13.5, color: '#1a1a19' }}>
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Tick-box dropdown for project access. Value is 'all' (all current + future
// projects) or an array of projectNos. Defaults to 'all' when unset.
function ProjectAccessPicker({ projects, value, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const isAll = value === 'all' || value == null
  const selected = Array.isArray(value) ? value : []

  // Close the dropdown when clicking anywhere outside it.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Ticking "All projects" turns it ON; unticking it switches to specific mode
  // (empty selection). Ticking any individual project also switches to specific
  // mode with that project selected.
  const toggleAll = () => onChange(isAll ? [] : 'all')
  const toggleProject = (no) => {
    const base = isAll ? [] : selected
    const next = base.includes(no) ? base.filter(x => x !== no) : [...base, no]
    onChange(next)
  }

  const summary = isAll ? 'All projects (current & future)'
    : selected.length === 0 ? 'No projects selected'
    : `${selected.length} project${selected.length === 1 ? '' : 's'} selected`

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ ...inp2, textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: isAll || selected.length ? '#1a1a19' : '#c00' }}>{summary}</span>
        <span style={{ color: '#999' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #ddd', borderRadius: 10, boxShadow: '0 6px 20px rgba(0,0,0,0.12)', maxHeight: 280, overflowY: 'auto', padding: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, background: isAll ? '#fffbeb' : 'transparent' }}>
            <input type="checkbox" checked={isAll} onChange={toggleAll} /> All projects (current &amp; future)
          </label>
          <div style={{ borderTop: '1px solid #f0f0f0', margin: '4px 0' }} />
          {projects.length === 0 && <div style={{ padding: '8px 10px', color: '#aaa', fontSize: 13 }}>No projects.</div>}
          {projects.map(p => (
            <label key={p.no} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13.5 }}>
              <input type="checkbox" checked={!isAll && selected.includes(p.no)} onChange={() => toggleProject(p.no)} />
              {p.no}{p.name && p.name !== p.no ? ` — ${p.name}` : ''}
            </label>
          ))}
          {isAll && <div style={{ padding: '8px 10px', fontSize: 12, color: '#888' }}>Currently all projects. Untick "All projects" or tick a specific project below to restrict access.</div>}
        </div>
      )}
    </div>
  )
}
