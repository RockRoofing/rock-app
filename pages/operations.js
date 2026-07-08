import { useState, useEffect } from 'react'
import Head from 'next/head'
import NegotiatingTable from '../components/NegotiatingTable'

const INK = '#1a1a19', GOLD = '#ca8a04', BG = '#fafaf9'
const fmtDate = ts => ts ? new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

const TABS = [
  { id: 'submissions', label: 'Submissions' },
  { id: 'negotiating', label: 'Negotiating' },
  { id: 'users', label: 'Users' },
  { id: 'documents', label: 'Documents' },
  { id: 'forms', label: 'Forms' },
  { id: 'planning', label: 'Planning', soon: true },
  { id: 'srats', label: 'SRATs', soon: true },
]

export default function Operations() {
  const [tab, setTab] = useState('submissions')
  return (
    <>
      <Head><title>Rock Roofing — Operations</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: BG }}>
        {/* Nav */}
        <div style={{ background: INK, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 8, height: 52 }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <a href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>← Portal</a>
          <span style={{ color: '#444' }}>|</span>
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Operations</span>
          <div style={{ flex: 1 }} />
          <a href="https://forms.rockroofing.co.uk" target="_blank" rel="noreferrer"
            style={{ color: GOLD, fontSize: 13, textDecoration: 'none', border: `1px solid ${GOLD}55`, borderRadius: 6, padding: '5px 12px' }}>
            Open Forms app ↗
          </a>
        </div>

        {/* Tabs */}
        <div style={{ background: '#fff', borderBottom: '1px solid #ececec', padding: '0 24px', display: 'flex', gap: 4, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => !t.soon && setTab(t.id)}
              style={{
                background: 'transparent', border: 'none', cursor: t.soon ? 'default' : 'pointer',
                padding: '14px 14px', fontSize: 13.5, whiteSpace: 'nowrap',
                color: t.soon ? '#c4c4c4' : tab === t.id ? INK : '#888',
                fontWeight: tab === t.id ? 600 : 500,
                borderBottom: tab === t.id ? `2px solid ${GOLD}` : '2px solid transparent',
              }}>
              {t.label}{t.soon && <span style={{ fontSize: 10, marginLeft: 5, color: '#c4c4c4' }}>soon</span>}
            </button>
          ))}
        </div>

        <div style={{ maxWidth: tab === 'negotiating' ? 1800 : 1100, margin: '0 auto', padding: tab === 'negotiating' ? '24px 32px' : '24px' }}>
          {tab === 'submissions' && <Submissions />}
          {tab === 'negotiating' && <div><H title="Projects in Negotiating" sub="Live from Pipedrive" /><NegotiatingTable accent={GOLD} /></div>}
          {tab === 'users' && <Users />}
          {tab === 'documents' && <Documents />}
          {tab === 'forms' && <Forms />}
        </div>
      </div>
    </>
  )
}

// ── Submissions inbox ───────────────────────────────────────────────────────
function Submissions() {
  const [subs, setSubs] = useState([]); const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)
  useEffect(() => { (async () => {
    try { const r = await fetch('/api/submissions'); const d = await r.json(); setSubs(d.submissions || []) } catch {}
    setLoading(false)
  })() }, [])

  if (loading) return <Loading />
  if (!subs.length) return <EmptyCard title="No submissions yet" body="When operatives submit forms on the Forms app, they'll appear here." />

  return (
    <>
      <H title="Site submissions" sub={`${subs.length} total`} />
      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#faf9f7', color: '#888', textAlign: 'left' }}>
            {['Form', 'Project', 'Operative', 'When', 'Flags', ''].map(h => <th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {subs.map(s => (
              <tr key={s.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                <td style={td}><strong>{s.formTitle}</strong></td>
                <td style={td}>{s.projectName || '—'}</td>
                <td style={td}>{s.operative || '—'}</td>
                <td style={{ ...td, color: '#999' }}>{fmtDate(s.submittedAt)}</td>
                <td style={td}>{s.flagCount > 0
                  ? <span style={{ background: '#fef3c7', color: '#92400e', fontWeight: 600, borderRadius: 20, padding: '2px 10px', fontSize: 12 }}>⚠ {s.flagCount}</span>
                  : <span style={{ color: '#bbb' }}>—</span>}</td>
                <td style={td}><button onClick={() => openSub(s.id, setOpen)} style={linkBtn}>View</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <SubModal sub={open} onClose={() => setOpen(null)} />}
    </>
  )
}
async function openSub(id, setOpen) {
  try { const r = await fetch(`/api/submissions?id=${id}`); const d = await r.json(); setOpen(d.submission) } catch {}
}
function SubModal({ sub, onClose }) {
  return (
    <Modal onClose={onClose} title={sub.formTitle}>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        {sub.projectName} · {sub.operative} · {fmtDate(sub.submittedAt)}
      </div>
      {sub.flags?.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <strong style={{ color: '#92400e' }}>⚠️ Flags:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#92400e', fontSize: 13 }}>
            {sub.flags.map((f, i) => <li key={i}>{f.field}</li>)}
          </ul>
        </div>
      )}
      {Object.entries(sub.answers || {}).map(([k, v]) => {
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null
        const isPhotos = Array.isArray(v) && typeof v[0] === 'string' && /^https?:|^data:/.test(v[0])
        return (
          <div key={k} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f2f2f2' }}>
            <div style={{ fontSize: 11, color: '#999', textTransform: 'uppercase', letterSpacing: 0.4 }}>{k}</div>
            {isPhotos
              ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {v.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} style={{ height: 80, borderRadius: 6 }} /></a>)}
                </div>
              : <div style={{ fontSize: 14, color: INK, marginTop: 2 }}>
                  {typeof v === 'object' ? (v.name ? `${v.name} (${v.date})` : JSON.stringify(v)) : Array.isArray(v) ? v.join(', ') : String(v)}
                </div>}
          </div>
        )
      })}
    </Modal>
  )
}

// ── Users manager ───────────────────────────────────────────────────────────
function Users() {
  const [users, setUsers] = useState([]); const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null); const [err, setErr] = useState('')
  useEffect(() => { load() }, [])
  async function load() { try { const r = await fetch('/api/ops-users'); const d = await r.json(); setUsers(d.users || []) } catch {}; setLoading(false) }
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
  if (loading) return <Loading />
  return (
    <>
      <H title="Forms users" sub="Operatives who can log into the Forms app" action={<button onClick={() => setForm({ name: '', role: '', pin: '', active: true })} style={primaryBtn}>+ Add user</button>} />
      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#faf9f7', color: '#888', textAlign: 'left' }}>
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
    </>
  )
}

// ── Documents manager ───────────────────────────────────────────────────────
function Documents() {
  const [docs, setDocs] = useState({ company: [], guidance: [], project: [] }); const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState('company'); const [form, setForm] = useState(null)
  useEffect(() => { load() }, [])
  async function load() { try { const r = await fetch('/api/ops-docs'); const d = await r.json(); setDocs(d.docs || { company: [], guidance: [], project: [] }) } catch {}; setLoading(false) }
  async function persist(next) { setDocs(next); await fetch('/api/ops-docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs: next }) }) }
  function addDoc() {
    if (!form?.title || !form?.url) return
    const item = { id: `doc_${Date.now()}`, title: form.title, url: form.url }
    persist({ ...docs, [cat]: [...(docs[cat] || []), item] }); setForm(null)
  }
  function removeDoc(id) { persist({ ...docs, [cat]: docs[cat].filter(d => d.id !== id) }) }
  if (loading) return <Loading />
  const catTabs = [['company', 'Company Information'], ['guidance', 'Operative Guidance'], ['project', 'Project Documents']]
  return (
    <>
      <H title="Documents" sub="Shown to operatives in the Forms app" action={<button onClick={() => setForm({ title: '', url: '' })} style={primaryBtn}>+ Add link</button>} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {catTabs.map(([id, label]) => (
          <button key={id} onClick={() => setCat(id)} style={{
            padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
            border: `1px solid ${cat === id ? GOLD : '#e0e0e0'}`, background: cat === id ? '#fffbeb' : '#fff',
            color: cat === id ? '#92400e' : '#666', fontWeight: cat === id ? 600 : 400,
          }}>{label}</button>
        ))}
      </div>
      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 8 }}>
        {(docs[cat] || []).map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 10px', borderBottom: '1px solid #f4f4f4' }}>
            <span style={{ fontSize: 20 }}>📄</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{d.title}</div>
              <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2a78d6' }}>{d.url.slice(0, 60)}</a>
            </div>
            <button onClick={() => removeDoc(d.id)} style={{ ...linkBtn, color: '#dc2626' }}>Remove</button>
          </div>
        ))}
        {!(docs[cat] || []).length && <div style={{ padding: 30, textAlign: 'center', color: '#aaa', fontSize: 14 }}>No documents in this category.</div>}
      </div>
      <p style={{ fontSize: 12, color: '#999', marginTop: 10 }}>
        Tip: paste a SharePoint / OneDrive "view" link so operatives can view drawings & documents on their phone without downloading.
      </p>
      {form && (
        <Modal onClose={() => setForm(null)} title="Add document link">
          <Lbl>Title</Lbl>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={inp2} placeholder="e.g. Working at Height Policy" />
          <Lbl>Link (SharePoint / OneDrive / URL)</Lbl>
          <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} style={inp2} placeholder="https://…" />
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button onClick={addDoc} style={primaryBtn}>Add</button>
            <button onClick={() => setForm(null)} style={ghostBtn}>Cancel</button>
          </div>
        </Modal>
      )}
    </>
  )
}

// ── Forms list (read + toggle) ──────────────────────────────────────────────
function Forms() {
  const [forms, setForms] = useState([]); const [loading, setLoading] = useState(true)
  useEffect(() => { (async () => { try { const r = await fetch('/api/forms'); const d = await r.json(); setForms(d.forms || []) } catch {}; setLoading(false) })() }, [])
  if (loading) return <Loading />
  return (
    <>
      <H title="Forms" sub={`${forms.length} forms available in the Forms app`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
        {forms.map(f => (
          <div key={f.id} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{f.title}</div>
            <div style={{ fontSize: 13, color: '#999', margin: '6px 0 10px' }}>{f.short}</div>
            <div style={{ fontSize: 12, color: '#bbb' }}>{f.fields.filter(x => x.type !== 'section' && x.type !== 'note').length} questions</div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: '#999', marginTop: 16 }}>
        A drag-and-drop form builder is coming in the next phase. Your 5 core forms are already live in the app.
      </p>
    </>
  )
}

// ── Shared UI bits ──────────────────────────────────────────────────────────
const H = ({ title, sub, action }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
    <div><h2 style={{ margin: 0, fontSize: 20, color: INK }}>{title}</h2>{sub && <div style={{ color: '#999', fontSize: 13, marginTop: 2 }}>{sub}</div>}</div>
    {action}
  </div>
)
const Loading = () => <div style={{ padding: 40, textAlign: 'center', color: '#aaa' }}>Loading…</div>
const EmptyCard = ({ title, body }) => (
  <div style={{ background: '#fff', border: '1px dashed #ddd', borderRadius: 14, padding: 40, textAlign: 'center' }}>
    <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>{title}</div>
    <div style={{ color: '#999', fontSize: 14, marginTop: 6 }}>{body}</div>
  </div>
)
function Modal({ title, children, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 560, width: '100%', maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, color: INK }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
const Lbl = ({ children }) => <div style={{ fontSize: 12, color: '#888', margin: '12px 0 4px' }}>{children}</div>
const th = { padding: '10px 14px', fontWeight: 600, fontSize: 12 }
const td = { padding: '11px 14px' }
const inp2 = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14 }
const primaryBtn = { background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }
const ghostBtn = { background: '#f2f2f0', color: '#555', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, cursor: 'pointer' }
const linkBtn = { background: 'none', border: 'none', color: '#2a78d6', cursor: 'pointer', fontSize: 13, padding: '0 8px' }
