import { useState, useEffect, useMemo, useRef } from 'react'
import OperationsShell, { PageHeading, SubTabs, ComingSoon } from '../../components/OperationsShell'
import { INK, GOLD, th, td, Loading, EmptyCard, Modal, Lbl, inp2, primaryBtn, ghostBtn, linkBtn, fmtDateTime } from '../../components/opsUI'
import ProjectFiles from '../../components/ProjectFiles'
import PreStartForm from '../../components/PreStartForm'
import SubmissionModal from '../../components/SubmissionModal'
import ProcurementSavings from '../../components/ProcurementSavings'
import ProjectConcerns from '../../components/ProjectConcerns'

const SUB_TABS = [
  { key: 'details', label: 'Project Details' },
  { key: 'handover', label: 'Handover' },
  { key: 'procurement-savings', label: 'Procurement Savings' },
  { key: 'prestart', label: 'Pre-Start' },
  { key: 'drawings', label: 'Drawings' },
  { key: 'rams', label: 'RAMS' },
  { key: 'submissions', label: 'Project Forms' },
  { key: 'images', label: 'Project Images' },
  { key: 'concerns', label: 'Project Concerns' },
]

const STATUS_LABEL = { active: 'Live', complete: 'Complete', draft: 'Draft' }

export default function ProjectsPage() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [openNo, setOpenNo] = useState(null)   // project detail open
  const [sub, setSub] = useState('details')
  const [manual, setManual] = useState(null)   // manual-add modal
  const [team, setTeam] = useState([])

  // filters
  const [q, setQ] = useState('')
  const [fCM, setFCM] = useState('')
  const [fEst, setFEst] = useState('')
  const [fQS, setFQS] = useState('')
  const [fDM, setFDM] = useState('')
  const [fStatus, setFStatus] = useState('active')  // default: Live only
  const [sort, setSort] = useState({ key: 'projectNo', dir: 'asc' })

  useEffect(() => { load() }, [])
  async function load() {
    try { const r = await fetch('/api/ops-projects'); const d = await r.json(); setProjects(d.projects || []) } catch {}
    try {
      const rt = await fetch('/api/team'); const dt = await rt.json()
      setTeam((dt.members || []).filter(m => m.active !== false)
        .map(m => [m.firstName, m.lastName].filter(Boolean).join(' ') || m.name || '').filter(Boolean).sort())
    } catch {}
    setLoading(false)
  }

  const uniq = (k) => [...new Set(projects.map(p => p[k]).filter(Boolean))].sort()

  const filtered = useMemo(() => {
    let out = projects.filter(p => {
      if (fStatus && p.status !== fStatus) return false
      if (fCM && p.contractsManager !== fCM) return false
      if (fEst && p.estimator !== fEst) return false
      if (fQS && p.quantitySurveyor !== fQS) return false
      if (fDM && p.designManager !== fDM) return false
      if (q) {
        const s = q.toLowerCase()
        if (!(`${p.projectNo} ${p.projectName}`.toLowerCase().includes(s))) return false
      }
      return true
    })
    const { key, dir } = sort
    out = [...out].sort((a, b) => {
      const av = (a[key] ?? '').toString().toLowerCase(), bv = (b[key] ?? '').toString().toLowerCase()
      if (av < bv) return dir === 'asc' ? -1 : 1
      if (av > bv) return dir === 'asc' ? 1 : -1
      return 0
    })
    return out
  }, [projects, q, fCM, fEst, fQS, fDM, fStatus, sort])

  function toggleSort(key) { setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }) }

  async function setStatus(projectNo, status) {
    await fetch('/api/ops-projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-status', projectNo, status }) })
    load()
  }
  async function saveManual() {
    if (!manual.projectNo?.trim() || !manual.projectName?.trim()) { alert('Project number and name are required.'); return }
    const isEdit = !!manual.__edit
    const r = await fetch('/api/ops-projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isEdit
        ? { action: 'set-details', projectNo: manual.projectNo, project: manual }
        : { action: 'manual-add', project: manual }),
    })
    const d = await r.json()
    if (!r.ok) { alert(d.error || 'Could not save'); return }
    setManual(null); load()
  }
  function editProject(p) {
    setManual({
      __edit: true, __manual: p.manual,
      projectNo: p.projectNo, projectName: p.projectName,
      contractsManager: p.contractsManager, estimator: p.estimator,
      quantitySurveyor: p.quantitySurveyor, designManager: p.designManager,
      location: p.location, status: p.status,
    })
  }
  async function delProject(projectNo) {
    if (!confirm(`Delete project ${projectNo}? This removes the operations record.`)) return
    await fetch('/api/ops-projects', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo }) })
    load()
  }

  // ── Detail view ───────────────────────────────────────────────────────────
  if (openNo) {
    const p = projects.find(x => x.projectNo === openNo)
    return (
      <OperationsShell active="projects" title="Projects" wide>
        <button onClick={() => setOpenNo(null)} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0, marginBottom: 8 }}>‹ All projects</button>
        <PageHeading title={`${p?.projectNo || ''} — ${p?.projectName || ''}`} sub={p?.location || ''} />
        <SubTabs tabs={SUB_TABS} active={sub} onChange={setSub} />
        {sub === 'details' && <ProjectDetails projectNo={openNo} onSaved={load} />}
        {sub === 'handover' && <HandoverReadOnly projectNo={openNo} />}
        {sub === 'procurement-savings' && <ProcurementSavings projectNo={openNo} />}
        {sub === 'prestart' && <PreStartForm projectNo={openNo} />}
        {sub === 'drawings' && <ProjectFiles projectNo={openNo} category="drawing" title="Project drawings" note="Upload drawings (PDF/image). These are visible to operatives in the Site App." />}
        {sub === 'rams' && <RamsTable projectNo={openNo} />}
        {sub === 'submissions' && <ProjectSubmissions projectNo={openNo} />}
        {sub === 'images' && <ProjectImages projectNo={openNo} />}
        {sub === 'concerns' && <ProjectConcerns projectNo={openNo} projectName={p?.projectName || ''} />}
      </OperationsShell>
    )
  }

  const hasFilters = q || fCM || fEst || fQS || fDM || fStatus !== 'active'
  const cols = [
    { key: 'projectNo', label: 'Project No.' },
    { key: 'projectName', label: 'Project Name' },
    { key: 'contractsManager', label: 'CM' },
    { key: 'estimator', label: 'Estimator' },
    { key: 'quantitySurveyor', label: 'QS' },
    { key: 'designManager', label: 'Design Manager' },
    { key: 'location', label: 'Location' },
    { key: 'status', label: 'Status' },
  ]

  return (
    <OperationsShell active="projects" title="Projects" wide>
      <PageHeading title="Projects" sub="Created from Internal Handover Minutes"
        action={<button onClick={() => setManual({ projectNo: '', projectName: '', contractsManager: '', estimator: '', quantitySurveyor: '', designManager: '', location: '', status: 'active' })} style={ghostBtn}>+ Add Project</button>} />

      {/* Filters */}
      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <F label="Search no. / name"><input value={q} onChange={e => setQ(e.target.value)} placeholder="J247 or name…" style={sel} /></F>
        <F label="CM"><select value={fCM} onChange={e => setFCM(e.target.value)} style={sel}><option value="">All</option>{uniq('contractsManager').map(v => <option key={v}>{v}</option>)}</select></F>
        <F label="Estimator"><select value={fEst} onChange={e => setFEst(e.target.value)} style={sel}><option value="">All</option>{uniq('estimator').map(v => <option key={v}>{v}</option>)}</select></F>
        <F label="QS"><select value={fQS} onChange={e => setFQS(e.target.value)} style={sel}><option value="">All</option>{uniq('quantitySurveyor').map(v => <option key={v}>{v}</option>)}</select></F>
        <F label="Design Manager"><select value={fDM} onChange={e => setFDM(e.target.value)} style={sel}><option value="">All</option>{uniq('designManager').map(v => <option key={v}>{v}</option>)}</select></F>
        <F label="Status"><select value={fStatus} onChange={e => setFStatus(e.target.value)} style={sel}><option value="active">Live</option><option value="complete">Complete</option><option value="draft">Draft</option><option value="">All</option></select></F>
        {hasFilters && <button onClick={() => { setQ(''); setFCM(''); setFEst(''); setFQS(''); setFDM(''); setFStatus('active') }} style={{ background: '#f2f2f0', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, color: '#555', cursor: 'pointer' }}>Reset</button>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>{filtered.length} projects</div>
      </div>

      {loading ? <Loading /> : !filtered.length ? (
        <EmptyCard title={hasFilters ? 'No projects match' : 'No projects yet'}
          body={hasFilters ? 'Try clearing filters.' : 'Complete an Internal Handover to create a project, or add an old one.'} />
      ) : (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              <th style={th}></th>
              {cols.map(c => <th key={c.key} onClick={() => toggleSort(c.key)} style={{ ...th, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>{c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>)}
              <th style={th}></th>
            </tr></thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.projectNo} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><button onClick={() => { setOpenNo(p.projectNo); setSub('details') }} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>View</button></td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><strong>{p.projectNo}</strong>{p.manual && <span title="Manually added" style={{ marginLeft: 6, fontSize: 10, color: '#aaa' }}>manual</span>}</td>
                  <td style={td}><button onClick={() => { setOpenNo(p.projectNo); setSub('details') }} style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontWeight: 600, padding: 0, textAlign: 'left' }}>{p.projectName || '—'}</button></td>
                  <td style={td}>{p.contractsManager || '—'}</td>
                  <td style={td}>{p.estimator || '—'}</td>
                  <td style={td}>{p.quantitySurveyor || '—'}</td>
                  <td style={td}>{p.designManager || '—'}</td>
                  <td style={{ ...td, maxWidth: 220 }}>{p.location || '—'}</td>
                  <td style={td}>
                    {p.status === 'draft'
                      ? <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>Draft</span>
                      : <select value={p.status} onChange={e => setStatus(p.projectNo, e.target.value)}
                          style={{ border: '1px solid #e0e0e0', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            background: p.status === 'complete' ? '#eef2ff' : '#ecfdf5', color: p.status === 'complete' ? '#3730a3' : '#065f46' }}>
                          <option value="active">Live</option>
                          <option value="complete">Complete</option>
                        </select>}
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => editProject(p)} style={linkBtn}>Edit</button>
                    {p.manual && <button onClick={() => delProject(p.projectNo)} style={{ ...linkBtn, color: '#dc2626', marginLeft: 10 }}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {manual && (
        <Modal onClose={() => setManual(null)} title={manual.__edit ? 'Edit Project' : 'Add Project'}>
          {!manual.__edit && <div style={{ fontSize: 12.5, color: '#888', marginBottom: 10 }}>Projects will be automatically added when Internal Handover Minutes are complete. Only add projects where an Internal Handover Meeting is not required.</div>}
          {manual.__edit && !manual.__manual && <div style={{ fontSize: 12.5, color: '#92400e', background: '#fef3c7', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>This project came from an Internal Handover. Edits here may be overwritten if that IHM is re-completed.</div>}
          <Lbl>Project number</Lbl>
          <input value={manual.projectNo} onChange={e => setManual({ ...manual, projectNo: e.target.value })} style={{ ...inp2, ...(manual.__edit ? { background: '#f5f5f4', color: '#888' } : {}) }} placeholder="e.g. J240" disabled={manual.__edit} />
          <Lbl>Project name</Lbl>
          <input value={manual.projectName} onChange={e => setManual({ ...manual, projectName: e.target.value })} style={inp2} />
          <Lbl>Contracts Manager</Lbl>
          <select value={manual.contractsManager} onChange={e => setManual({ ...manual, contractsManager: e.target.value })} style={inp2}><option value="">— Select —</option>{team.map(n => <option key={n}>{n}</option>)}</select>
          <Lbl>Estimator</Lbl>
          <select value={manual.estimator} onChange={e => setManual({ ...manual, estimator: e.target.value })} style={inp2}><option value="">— Select —</option>{team.map(n => <option key={n}>{n}</option>)}</select>
          <Lbl>Quantity Surveyor</Lbl>
          <select value={manual.quantitySurveyor} onChange={e => setManual({ ...manual, quantitySurveyor: e.target.value })} style={inp2}><option value="">— Select —</option>{team.map(n => <option key={n}>{n}</option>)}</select>
          <Lbl>Design Manager</Lbl>
          <select value={manual.designManager} onChange={e => setManual({ ...manual, designManager: e.target.value })} style={inp2}><option value="">— Select —</option>{team.map(n => <option key={n}>{n}</option>)}</select>
          <Lbl>Location</Lbl>
          <input value={manual.location} onChange={e => setManual({ ...manual, location: e.target.value })} style={inp2} />
          <Lbl>Status</Lbl>
          <select value={manual.status} onChange={e => setManual({ ...manual, status: e.target.value })} style={inp2}><option value="active">Live</option><option value="complete">Complete</option></select>
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button onClick={saveManual} style={primaryBtn}>{manual.__edit ? 'Save changes' : 'Add project'}</button>
            <button onClick={() => setManual(null)} style={ghostBtn}>Cancel</button>
          </div>
        </Modal>
      )}
    </OperationsShell>
  )
}

// Read-only handover view inside a project
// ── Project Details — single source of truth (writes the same project.data the IHM uses) ──
// Module-level so they keep a stable identity across renders. Defining these
// inside the component remounts their subtree on every keystroke, which is what
// caused Site Contacts inputs to lose focus after one character.
const L = ({ children }) => <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '14px 0 6px' }}>{children}</div>
const Section = ({ title, children }) => (
  <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 18, marginBottom: 16 }}>
    <div style={{ fontSize: 13, fontWeight: 700, color: GOLD, marginBottom: 4 }}>{(title || '').toUpperCase()}</div>
    {children}
  </div>
)

function ProjectDetails({ projectNo, onSaved }) {
  const [d, setD] = useState(null)
  const [team, setTeam] = useState([])
  const [supervisors, setSupervisors] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { (async () => {
    setLoading(true)
    try {
      const [pr, tr, sr] = await Promise.all([
        fetch(`/api/ops-projects?no=${encodeURIComponent(projectNo)}`).then(r => r.json()),
        fetch('/api/team').then(r => r.json()).catch(() => ({})),
        fetch('/api/hs-matrix?supervisors=1').then(r => r.json()).catch(() => ({})),
      ])
      const data = pr?.project?.data || {}
      setD({
        projectName: data.projectName || '', projectNo,
        projectAddress: data.projectAddress || data.siteLocation || '',
        contractsManager: data.contractsManager || '', operationsManager: data.operationsManager || '',
        quantitySurveyor: data.quantitySurveyor || '', estimator: data.estimator || '',
        designManager: data.designManager || '', siteSupervisor: data.siteSupervisor || '',
        customerCompany: data.customerCompany || '',
        siteContacts: Array.isArray(data.siteContacts) ? data.siteContacts : [],
      })
      setTeam((tr.members || []).filter(m => m.active !== false))
      setSupervisors(sr.supervisors || [])
    } catch {}
    setLoading(false)
  })() }, [projectNo])

  const set = (patch) => setD(prev => ({ ...prev, ...patch }))
  const tmName = (m) => m.name || [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email

  async function save() {
    setSaving(true); setMsg('')
    try {
      const r = await fetch('/api/ops-projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-details', projectNo, project: d }),
      })
      if (!r.ok) throw new Error('Save failed')
      setMsg('Saved. The Internal Handover Minutes reflect these details too.')
      onSaved && onSaved()
    } catch { setMsg('Could not save. Please try again.') }
    setSaving(false)
  }

  if (loading || !d) return <Loading />

  const input = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }
  const TeamSel = ({ label, field }) => (
    <div>
      <L>{label}</L>
      <select value={d[field] || ''} onChange={e => set({ [field]: e.target.value })} style={input}>
        <option value="">Select…</option>
        {team.map(m => <option key={m.id} value={tmName(m)}>{tmName(m)}{m.role ? ` — ${m.role}` : ''}</option>)}
        {d[field] && !team.some(m => tmName(m) === d[field]) && <option value={d[field]}>{d[field]}</option>}
      </select>
    </div>
  )
  const SupSel = ({ label, field }) => (
    <div>
      <L>{label}</L>
      <select value={d[field] || ''} onChange={e => set({ [field]: e.target.value })} style={input}>
        <option value="">Select…</option>
        {supervisors.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        {d[field] && !supervisors.some(s => s.name === d[field]) && <option value={d[field]}>{d[field]} (no current supervisor ticket)</option>}
      </select>
      {supervisors.length === 0 && <div style={{ fontSize: 11, color: '#b45309', margintop: 4 }}>No qualified supervisors yet — add a supervisor ticket (Internal Supervisor Assessment / SSSTS / SMSTS / IOSH Managing Safely) in the H&S Training Matrix.</div>}
    </div>
  )

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ fontSize: 12.5, color: '#888', marginBottom: 14 }}>
        This is the single source of truth for the project. Editing here updates the Internal Handover Minutes, and feeds project forms, reports and tables.
      </div>

      <Section title="Project Details">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px' }}>
          <div><L>Project name</L><input value={d.projectName} onChange={e => set({ projectName: e.target.value })} style={input} /></div>
          <div><L>Project number</L><input value={d.projectNo} disabled style={{ ...input, background: '#f0f0f0', color: '#888' }} /></div>
        </div>
        <L>Project address</L>
        <textarea value={d.projectAddress} onChange={e => set({ projectAddress: e.target.value })} style={{ ...input, minHeight: 60, resize: 'vertical' }} />
      </Section>

      <Section title="Project Team">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px' }}>
          <TeamSel label="Contracts Manager" field="contractsManager" />
          <TeamSel label="Operations Manager" field="operationsManager" />
          <TeamSel label="Quantity Surveyor" field="quantitySurveyor" />
          <TeamSel label="Estimator" field="estimator" />
          <TeamSel label="Design Manager" field="designManager" />
          <SupSel label="Site Supervisor" field="siteSupervisor" />
        </div>
      </Section>

      <Section title="Customer Details">
        <L>Customer company</L>
        <input value={d.customerCompany} onChange={e => set({ customerCompany: e.target.value })} style={input} />
      </Section>

      <Section title="Site Contacts">
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Customer site contacts. Used for sending issues and reports to the customer.</div>
        {(d.siteContacts || []).map((c, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <input value={c.title || ''} onChange={e => { const n = [...d.siteContacts]; n[i] = { ...n[i], title: e.target.value }; set({ siteContacts: n }) }} placeholder="Role" style={{ ...input, padding: '7px 9px' }} />
            <input value={c.name || ''} onChange={e => { const n = [...d.siteContacts]; n[i] = { ...n[i], name: e.target.value }; set({ siteContacts: n }) }} placeholder="Name" style={{ ...input, padding: '7px 9px' }} />
            <input value={c.email || ''} onChange={e => { const n = [...d.siteContacts]; n[i] = { ...n[i], email: e.target.value }; set({ siteContacts: n }) }} placeholder="Email" style={{ ...input, padding: '7px 9px' }} />
            <input value={c.phone || ''} onChange={e => { const n = [...d.siteContacts]; n[i] = { ...n[i], phone: e.target.value }; set({ siteContacts: n }) }} placeholder="Phone" style={{ ...input, padding: '7px 9px' }} />
            <button onClick={() => set({ siteContacts: d.siteContacts.filter((_, j) => j !== i) })} style={{ ...linkBtn, color: '#dc2626' }}>Remove</button>
          </div>
        ))}
        <button onClick={() => set({ siteContacts: [...(d.siteContacts || []), { title: '', name: '', email: '', phone: '' }] })} style={ghostBtn}>+ Add contact</button>
      </Section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
        <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save Project Details'}</button>
        {msg && <span style={{ fontSize: 12.5, color: msg.startsWith('Saved') ? '#16a34a' : '#dc2626' }}>{msg}</span>}
      </div>
    </div>
  )
}

// ── Read-only Handover ──
function HandoverReadOnly({ projectNo }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [doc, setDoc] = useState(null)
  useEffect(() => { (async () => {
    try { const r = await fetch(`/api/ops-projects?no=${projectNo}`); const d = await r.json(); setData(d.project?.data || null) } catch {}
    setLoading(false)
  })() }, [projectNo])
  if (loading) return <Loading />
  if (!data) return <EmptyCard title="No handover data" body="This project has no stored handover details." />
  const row = (label, val) => val ? (
    <div style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #f3f3f1' }}>
      <div style={{ width: 220, color: '#888', fontSize: 13, flexShrink: 0 }}>{label}</div>
      <div style={{ fontSize: 14, color: INK, whiteSpace: 'pre-wrap' }}>{val}</div>
    </div>
  ) : null
  return (
    <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 20 }}>
      {row('Project Name', data.projectName)}
      {row('Project Number', data.projectNo)}
      {row('Contracts Manager', data.contractsManager)}
      {row('Estimator', data.estimator)}
      {row('Quantity Surveyor', data.quantitySurveyor)}
      {row('Design Manager', data.designManager)}
      {row('Operations Manager', data.operationsManager)}
      {row('Address', data.projectAddress)}
      {row('Customer', data.customerCompany)}
      {row('Contract Value', data.contractValue)}
      {row('Scope of Works', data.scopeOfWorks)}
      {Array.isArray(data.scopeFiles) && data.scopeFiles.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 10 }}>Handover documents</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
            {data.scopeFiles.map((f, i) => {
              const img = (f.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(f.name || f.url || '')
              return (
                <div key={i} style={{ border: '1px solid #ececec', borderRadius: 10, overflow: 'hidden' }}>
                  <div onClick={() => setDoc(f)} style={{ height: 100, background: '#f7f6f4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {img ? <img src={f.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ fontSize: 30, color: '#bbb' }}>📄</div>}
                  </div>
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: 12, color: INK, fontWeight: 600, wordBreak: 'break-word' }}>{f.name}</div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                      <button onClick={() => setDoc(f)} style={linkBtn}>View</button>
                      <a href={f.url} download={f.name} target="_blank" rel="noreferrer" style={{ ...linkBtn, textDecoration: 'none' }}>Download</a>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div style={{ marginTop: 12, fontSize: 12, color: '#aaa' }}>Read-only. Edit via Pre-Contract → Internal Handover Minutes.</div>
      {doc && (
        <div onClick={() => setDoc(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', color: '#fff' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{doc.name}</div>
            <button onClick={() => setDoc(null)} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 26, cursor: 'pointer' }}>×</button>
          </div>
          <div onClick={e => e.stopPropagation()} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto' }}>
            {((doc.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(doc.name || doc.url || ''))
              ? <img src={doc.url} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              : <iframe src={doc.url} title={doc.name} style={{ width: '100%', height: '100%', border: 'none', background: '#fff', borderRadius: 8 }} />}
          </div>
        </div>
      )}
    </div>
  )
}

const F = ({ label, children }) => (<div><div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{label}</div>{children}</div>)
const sel = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', minWidth: 130 }

// ── Project-specific form submissions (like the Submissions page, no project filter) ──
function ProjectSubmissions({ projectNo }) {
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)
  const [full, setFull] = useState(null)
  const [sel, setSel] = useState({})   // id -> true
  const [fType, setFType] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [formDefs, setFormDefs] = useState({})   // formId -> { id: label }

  useEffect(() => { (async () => {
    try {
      const r = await fetch('/api/submissions'); const d = await r.json()
      setSubs((d.submissions || []).filter(s => !s.isIssue && (s.projectId === projectNo || s.projectName === projectNo)))
    } catch {}
    // Load all form definitions once, build id->label maps for showing questions
    try {
      const rf = await fetch('/api/forms'); const df = await rf.json()
      const map = {}
      for (const f of (df.forms || [])) {
        const lm = {}
        for (const fld of (f.fields || [])) if (fld.id) lm[fld.id] = fld.label || fld.id
        map[f.id] = lm
      }
      setFormDefs(map)
    } catch {}
    setLoading(false)
  })() }, [projectNo])

  const labelFor = (formId, key) => (formDefs[formId] && formDefs[formId][key]) || key

  const types = useMemo(() => [...new Set(subs.map(s => s.formTitle).filter(Boolean))].sort(), [subs])
  const rows = useMemo(() => subs.filter(s => {
    if (fType && s.formTitle !== fType) return false
    if (fFrom && s.submittedAt < new Date(fFrom).getTime()) return false
    if (fTo && s.submittedAt > new Date(fTo).getTime() + 86400000) return false
    return true
  }), [subs, fType, fFrom, fTo])

  async function openSub(s) {
    setOpen(s); setFull(null)
    try { const r = await fetch(`/api/submissions?id=${s.id}`); const d = await r.json(); setFull(d.submission) } catch {}
  }
  async function deleteSub(s) {
    if (!window.confirm(`Delete this "${s.formTitle}" submission? This removes it from Project Forms and the main Forms page. This cannot be undone.`)) return
    try {
      const r = await fetch(`/api/submissions?id=${s.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('failed')
      setSubs(prev => prev.filter(x => x.id !== s.id))
      setSel(prev => { const n = { ...prev }; delete n[s.id]; return n })
      if (open && open.id === s.id) { setOpen(null); setFull(null) }
    } catch { window.alert('Could not delete the submission.') }
  }
  function toggle(id) { setSel(p => ({ ...p, [id]: !p[id] })) }
  const selIds = Object.keys(sel).filter(k => sel[k])

  async function downloadSelected() {
    const ids = selIds.length ? selIds : rows.map(r => r.id)
    if (!ids.length) return
    setDownloading(true)
    try {
      const fulls = await Promise.all(ids.map(id => fetch(`/api/submissions?id=${id}`).then(r => r.json()).then(d => d.submission)))
      openPrintView(fulls.filter(Boolean), labelFor)
    } catch (e) { alert('Could not prepare download') }
    setDownloading(false)
  }

  if (loading) return <Loading />
  return (
    <div>
      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <F label="Form type"><select value={fType} onChange={e => setFType(e.target.value)} style={sel2}><option value="">All</option>{types.map(t => <option key={t}>{t}</option>)}</select></F>
        <F label="From"><input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} style={sel2} /></F>
        <F label="To"><input type="date" value={fTo} onChange={e => setFTo(e.target.value)} style={sel2} /></F>
        <div style={{ flex: 1 }} />
        <button onClick={downloadSelected} disabled={downloading} style={primaryBtn}>{downloading ? 'Preparing…' : selIds.length ? `Download ${selIds.length} PDF` : 'Download as PDF'}</button>
      </div>
      {!rows.length ? <EmptyCard title="No submissions" body="No forms have been submitted for this project yet." /> : (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              <th style={{ ...th, width: 40 }}><input type="checkbox" checked={selIds.length === rows.length && rows.length > 0} onChange={e => setSel(e.target.checked ? Object.fromEntries(rows.map(r => [r.id, true])) : {})} /></th>
              {['Form', 'Operative', 'Submitted', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={td}><input type="checkbox" checked={!!sel[s.id]} onChange={() => toggle(s.id)} /></td>
                  <td style={td}><strong style={{ color: INK }}>{s.formTitle}</strong></td>
                  <td style={td}>{s.operative || '—'}</td>
                  <td style={{ ...td, color: '#999', whiteSpace: 'nowrap' }}>{fmtDateTime(s.submittedAt)}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => openSub(s)} style={linkBtn}>View / Edit</button>
                    <button onClick={() => deleteSub(s)} style={{ ...linkBtn, color: '#dc2626', marginLeft: 12 }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && full && (
        <SubmissionModal sub={full} labels={formDefs} onClose={() => setOpen(null)}
          onSaved={(s) => setFull(s)} onDownload={(s) => openPrintView([s], labelFor)} />
      )}
      {open && !full && <Modal onClose={() => setOpen(null)} title={open.formTitle} wide><Loading /></Modal>}
    </div>
  )
}

// ── Project images pulled from all form submissions ──
function ProjectImages({ projectNo }) {
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [openSub, setOpenSub] = useState(null)      // full submission shown in modal
  const [loadingSub, setLoadingSub] = useState(false)
  const [formDefs, setFormDefs] = useState({})
  useEffect(() => { (async () => {
    try {
      const [subsR, formsR] = await Promise.all([
        fetch('/api/submissions').then(r => r.json()),
        fetch('/api/forms').then(r => r.json()).catch(() => ({})),
      ])
      // Build a formId -> {qId: label} map for readable question labels
      const defs = {}
      for (const f of (formsR.forms || [])) {
        const m = {}
        for (const q of (f.questions || f.fields || [])) m[q.id] = q.label || q.question || q.id
        defs[f.id] = m
      }
      setFormDefs(defs)
      const mine = (subsR.submissions || []).filter(s => s.projectId === projectNo || s.projectName === projectNo)
      const fulls = await Promise.all(mine.map(s => fetch(`/api/submissions?id=${s.id}`).then(r => r.json()).then(d => d.submission).catch(() => null)))
      const imgs = []
      for (const sub of fulls.filter(Boolean)) {
        for (const v of Object.values(sub.answers || {})) {
          if (Array.isArray(v)) for (const u of v) {
            if (typeof u === 'string' && /^https?:|^data:/.test(u)) imgs.push({ url: u, formTitle: sub.formTitle, submittedAt: sub.submittedAt, subId: sub.id })
          }
        }
      }
      imgs.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0))
      setImages(imgs)
    } catch {}
    setLoading(false)
  })() }, [projectNo])

  async function viewForm(subId) {
    setLoadingSub(true)
    try {
      const d = await fetch(`/api/submissions?id=${subId}`).then(r => r.json())
      if (d.submission) setOpenSub(d.submission)
    } catch {}
    setLoadingSub(false)
  }

  if (loading) return <Loading />
  if (!images.length) return <EmptyCard title="No images yet" body="Images added to form submissions for this project will appear here." />
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 16 }}>
        {images.map((img, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden' }}>
            <img src={img.url} alt="" onClick={() => setOpenSub({ _imageOnly: true, url: img.url, formTitle: img.formTitle, submittedAt: img.submittedAt })} style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block', cursor: 'pointer' }} />
            <div style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 12, color: '#999' }}>{new Date(img.submittedAt).toLocaleString('en-GB')}</div>
              <div style={{ fontSize: 13, color: INK, fontWeight: 600, marginTop: 2 }}>{img.formTitle}</div>
              <button onClick={() => viewForm(img.subId)} style={{ ...linkBtn, display: 'inline-block', marginTop: 4, padding: 0 }}>{loadingSub ? 'Opening…' : 'View form ›'}</button>
            </div>
          </div>
        ))}
      </div>
      {openSub && <ImageFormModal sub={openSub} formDefs={formDefs} onClose={() => setOpenSub(null)} />}
    </>
  )
}

// Large pop-out for a form submission (or a single image), with download + close.
function ImageFormModal({ sub, formDefs, onClose }) {
  const labelFor = (k) => (formDefs[sub.formId] && formDefs[sub.formId][k]) || k
  const isImageOnly = sub._imageOnly
  const entries = isImageOnly ? [] : Object.entries(sub.answers || {}).filter(([, v]) => !(v == null || v === '' || (Array.isArray(v) && !v.length)))
  const renderVal = (v) => {
    const isPhotos = Array.isArray(v) && typeof v[0] === 'string' && /^https?:|^data:/.test(v[0])
    if (isPhotos) return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {v.map((u, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <img src={u} alt="" style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 8, border: '1px solid #eee' }} />
            <a href={u} download target="_blank" rel="noreferrer" style={{ position: 'absolute', bottom: 6, right: 6, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 11, padding: '3px 7px', borderRadius: 5, textDecoration: 'none' }}>Download</a>
          </div>
        ))}
      </div>
    )
    if (Array.isArray(v)) return v.join(', ')
    if (typeof v === 'object') return v.name ? `${v.name}${v.date ? ` (${v.date})` : ''}` : JSON.stringify(v)
    return String(v)
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px' }}>
        <div style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>{sub.formTitle}{sub.submittedAt ? ` · ${new Date(sub.submittedAt).toLocaleString('en-GB')}` : ''}</div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 30, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>
      <div onClick={e => e.stopPropagation()} style={{ flex: 1, overflow: 'auto', margin: '0 20px 20px', background: '#fff', borderRadius: 12, padding: isImageOnly ? 0 : 28 }}>
        {isImageOnly ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: 16 }}>
              <img src={sub.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid #eee', textAlign: 'right' }}>
              <a href={sub.url} download target="_blank" rel="noreferrer" style={{ ...primaryBtn, textDecoration: 'none' }}>Download image</a>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: INK }}>{sub.formTitle}</div>
                <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>{sub.projectName || ''}{sub.operative ? ` · ${sub.operative}` : ''}</div>
              </div>
              <button onClick={() => openPrintView([sub], (fid, k) => (formDefs[fid] && formDefs[fid][k]) || k)} style={ghostBtn}>Download PDF</button>
            </div>
            {entries.map(([k, v]) => (
              <div key={k} style={{ padding: '12px 0', borderBottom: '1px solid #f4f4f2' }}>
                <div style={{ fontSize: 12.5, color: '#888', marginBottom: 6 }}>{labelFor(k)}</div>
                <div style={{ fontSize: 14, color: INK }}>{renderVal(v)}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

const sel2 = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', minWidth: 130 }

// Branded print-to-PDF view for one or more submissions
function openPrintView(subs, labelFor) {
  const logo = `${window.location.origin}/rock-logo.jpg`
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const fmt = ts => new Date(ts).toLocaleString('en-GB')
  const lbl = (formId, k) => (labelFor ? labelFor(formId, k) : k)
  const answerHtml = (v) => {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '<em style="color:#999">—</em>'
    const isPhotos = Array.isArray(v) && typeof v[0] === 'string' && /^https?:|^data:/.test(v[0])
    if (isPhotos) return `<div class="imgs">${v.map(u => `<img src="${esc(u)}" />`).join('')}</div>`
    if (typeof v === 'object' && !Array.isArray(v)) return esc(v.name ? `${v.name} (${v.date || ''})` : JSON.stringify(v))
    if (Array.isArray(v)) return v.map(esc).join(', ')
    return esc(v)
  }
  const body = subs.map(sub => `
    <section class="doc">
      <header>
        <img class="logo" src="${logo}" />
        <div class="meta">
          <h1>${esc(sub.formTitle)}</h1>
          <div>${esc(sub.projectName || '')}</div>
          <div>Operative: ${esc(sub.operative || '—')}</div>
          <div>Submitted: ${esc(fmt(sub.submittedAt))}</div>
        </div>
      </header>
      ${Object.entries(sub.answers || {})
        .filter(([, v]) => !(v == null || v === '' || (Array.isArray(v) && !v.length)))
        .map(([k, v]) => `
        <div class="row"><div class="q">${esc(lbl(sub.formId, k))}</div><div class="a">${answerHtml(v)}</div></div>
      `).join('')}
    </section>`).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Rock Roofing — Submission</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: system-ui, Arial, sans-serif; color: #1a1a19; margin: 0; padding: 0; }
      .doc { padding: 32px 36px; page-break-after: always; }
      .doc:last-child { page-break-after: auto; }
      header { display: flex; align-items: center; gap: 20px; border-bottom: 3px solid #ca8a04; padding-bottom: 16px; margin-bottom: 20px; }
      .logo { height: 60px; width: auto; }
      .meta h1 { margin: 0 0 4px; font-size: 20px; }
      .meta div { font-size: 12.5px; color: #555; }
      .row { display: flex; gap: 16px; padding: 9px 0; border-bottom: 1px solid #eee; }
      .q { width: 34%; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: #888; }
      .a { flex: 1; font-size: 13.5px; }
      .imgs { display: flex; flex-wrap: wrap; gap: 6px; }
      .imgs img { height: 130px; border-radius: 6px; border: 1px solid #ddd; }
      @media print { .doc { padding: 16px; } }
    </style></head><body>${body}
    <script>window.onload = () => { setTimeout(() => window.print(), 400); };</script>
    </body></html>`
  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to download the PDF.'); return }
  w.document.write(html); w.document.close()
}

// ── RAMS as a revisions table (latest at top) ──
function RamsTable({ projectNo }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const [viewer, setViewer] = useState(null)
  const [signedOpen, setSignedOpen] = useState(false)
  const inputRef = useRef()

  useEffect(() => { load() }, [projectNo])
  async function load() {
    setLoading(true)
    try { const r = await fetch(`/api/project-files?no=${encodeURIComponent(projectNo)}&cat=rams`); const d = await r.json(); setFiles(d.files || []) } catch {}
    setLoading(false)
  }
  async function handleFiles(list) {
    if (!list || !list.length) return
    setErr(''); setUploading(true)
    let failed = 0, lastErr = ''
    for (const file of Array.from(list)) {
      try {
        const up = await fetch('/api/upload-file', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name), 'x-content-type': file.type || 'application/octet-stream' }, body: file })
        const ud = await up.json()
        if (!up.ok || !ud.url) { failed++; lastErr = ud.error || `HTTP ${up.status}`; continue }
        await fetch('/api/project-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, file: { category: 'rams', name: file.name, url: ud.url, contentType: ud.contentType, size: ud.size } }) })
      } catch (e) { console.error(e); failed++; lastErr = e?.message || String(e) }
    }
    if (inputRef.current) inputRef.current.value = ''
    setUploading(false)
    if (failed) setErr(`${failed} file(s) failed to upload. ${lastErr}`)
    load()
  }
  async function del(id) {
    if (!confirm('Delete this RAMS revision?')) return
    await fetch('/api/project-files', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, id }) })
    load()
  }
  // Newest first; revision number = count so latest has the highest rev
  const sorted = [...files].sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0))
  const total = sorted.length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: 16, fontWeight: 700, color: INK }}>RAMS</div><div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>Revisions listed newest first. Visible to operatives in the Forms App.</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input ref={inputRef} type="file" accept="application/pdf,image/*" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
          <button onClick={() => setSignedOpen(true)} style={{ ...primaryBtn, background: '#fff', color: '#92400e', border: '1px solid #e6b567' }}>⬇ Download Signed RAMS</button>
          <button onClick={() => inputRef.current?.click()} disabled={uploading} style={primaryBtn}>{uploading ? 'Uploading…' : '+ Upload RAMS'}</button>
        </div>
      </div>
      {err && <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 10 }}>{err}</div>}
      {loading ? <Loading /> : !sorted.length ? <EmptyCard title="No RAMS yet" body="Upload a RAMS document using the button above." /> : (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead><tr style={{ background: '#faf9f7' }}>{['Revision', 'Document', 'Uploaded', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {sorted.map((f, i) => (
                <tr key={f.id} style={{ borderTop: '1px solid #f0f0f0', background: i === 0 ? '#fafefb' : '#fff' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <strong>Rev {total - i}</strong>
                    {i === 0
                      ? <span style={{ marginLeft: 8, fontSize: 11, background: '#065f46', color: '#fff', borderRadius: 20, padding: '2px 10px', fontWeight: 700, letterSpacing: 0.3 }}>CURRENT</span>
                      : <span style={{ marginLeft: 8, fontSize: 11, background: '#f1f1ef', color: '#999', borderRadius: 20, padding: '2px 10px', fontWeight: 600 }}>Superseded</span>}
                  </td>
                  <td style={{ ...td, color: i === 0 ? INK : '#999' }}>{f.name}</td>
                  <td style={{ ...td, color: '#999', whiteSpace: 'nowrap' }}>{new Date(f.uploadedAt).toLocaleString('en-GB')}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setViewer(f)} style={linkBtn}>View</button>
                    <a href={f.url} download={f.name} target="_blank" rel="noreferrer" style={{ ...linkBtn, textDecoration: 'none', marginLeft: 10 }}>Download</a>
                    <button onClick={() => del(f.id)} style={{ ...linkBtn, color: '#dc2626', marginLeft: 10 }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viewer && (
        <div onClick={() => setViewer(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', color: '#fff' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{viewer.name}</div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <a href={viewer.url} download={viewer.name} target="_blank" rel="noreferrer" style={{ color: '#fff', fontSize: 14 }} onClick={e => e.stopPropagation()}>Download</a>
              <button onClick={() => setViewer(null)} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 26, cursor: 'pointer' }}>×</button>
            </div>
          </div>
          <div onClick={e => e.stopPropagation()} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto' }}>
            {((viewer.contentType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(viewer.name))
              ? <img src={viewer.url} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              : <iframe src={viewer.url} title={viewer.name} style={{ width: '100%', height: '100%', border: 'none', background: '#fff', borderRadius: 8 }} />}
          </div>
        </div>
      )}
      {signedOpen && <SignedRamsPicker projectNo={projectNo} onClose={() => setSignedOpen(false)} />}
    </div>
  )
}

// Pick a RAMS revision and download the signed version (original + appended
// signature/approval audit trail).
function SignedRamsPicker({ projectNo, onClose }) {
  const [revs, setRevs] = useState(null)
  const [busyId, setBusyId] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { (async () => {
    try {
      const d = await fetch(`/api/rams-signed-pdf?no=${encodeURIComponent(projectNo)}`).then(r => r.json())
      setRevs(d.revisions || [])
    } catch { setRevs([]); setErr('Could not load revisions.') }
  })() }, [projectNo])

  async function download(fileId) {
    setErr(''); setBusyId(fileId)
    try {
      const r = await fetch(`/api/rams-signed-pdf?no=${encodeURIComponent(projectNo)}&fileId=${encodeURIComponent(fileId)}`)
      if (!r.ok) { let m = 'Could not generate the signed RAMS.'; try { m = (await r.json()).error || m } catch {} ; setErr(m); setBusyId(''); return }
      const blob = await r.blob()
      const cd = r.headers.get('Content-Disposition') || ''
      const nameMatch = /filename="?([^"]+)"?/.exec(cd)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = nameMatch ? nameMatch[1] : 'RAMS-signed.pdf'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e) { setErr(e?.message || 'Download failed.') }
    setBusyId('')
  }

  const stageLabel = (s) => ({ cm: 'Awaiting CM', director: 'Awaiting Director', 'site-manager': 'Awaiting Site Manager', operatives: 'Signing / complete', complete: 'Complete', rejected: 'Edits required' }[s] || s)
  const total = revs ? revs.length : 0

  return (
    <Modal onClose={onClose} title="Download Signed RAMS">
      <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>Select a revision to download. The signed file is the original RAMS with the full approval workflow and every signature (names, dates and times) appended to the back.</div>
      {err && <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 10 }}>{err}</div>}
      {revs === null ? <div style={{ fontSize: 13, color: '#999', padding: '10px 0' }}>Loading…</div>
        : revs.length === 0 ? <div style={{ fontSize: 13, color: '#999', padding: '10px 0' }}>No RAMS uploaded for this project yet.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {revs.map((rv, i) => (
              <div key={rv.fileId} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #ececec', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>
                    Rev {total - i}{i === 0 && <span style={{ marginLeft: 8, fontSize: 10.5, background: '#065f46', color: '#fff', borderRadius: 20, padding: '1px 8px', fontWeight: 700 }}>CURRENT</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rv.name}</div>
                  <div style={{ fontSize: 11.5, color: '#888', marginTop: 2 }}>{stageLabel(rv.stage)} · {rv.signedCount} operative signature{rv.signedCount === 1 ? '' : 's'} · uploaded {rv.uploadedAt ? new Date(rv.uploadedAt).toLocaleDateString('en-GB') : '—'}</div>
                </div>
                <button onClick={() => download(rv.fileId)} disabled={!!busyId} style={{ ...primaryBtn, padding: '8px 14px', whiteSpace: 'nowrap' }}>{busyId === rv.fileId ? 'Preparing…' : '⬇ Download'}</button>
              </div>
            ))}
          </div>
        )}
    </Modal>
  )
}
