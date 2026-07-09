import { useState, useEffect, useMemo, useRef } from 'react'
import OperationsShell, { PageHeading, SubTabs, ComingSoon } from '../../components/OperationsShell'
import { INK, GOLD, th, td, Loading, EmptyCard, Modal, Lbl, inp2, primaryBtn, ghostBtn, linkBtn, fmtDateTime } from '../../components/opsUI'
import ProjectFiles from '../../components/ProjectFiles'

const SUB_TABS = [
  { key: 'handover', label: 'Handover' },
  { key: 'drawings', label: 'Drawings' },
  { key: 'rams', label: 'RAMS' },
  { key: 'ramsbuilder', label: 'RAMS Builder' },
  { key: 'submissions', label: 'Forms Submissions' },
  { key: 'images', label: 'Project Images' },
]

const STATUS_LABEL = { active: 'Live', complete: 'Complete', draft: 'Draft' }

export default function ProjectsPage() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [openNo, setOpenNo] = useState(null)   // project detail open
  const [sub, setSub] = useState('handover')
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
        {sub === 'handover' && <HandoverReadOnly projectNo={openNo} />}
        {sub === 'drawings' && <ProjectFiles projectNo={openNo} category="drawing" title="Project drawings" note="Upload drawings (PDF/image). These are visible to operatives in the Forms App." />}
        {sub === 'rams' && <RamsTable projectNo={openNo} />}
        {sub === 'ramsbuilder' && <ComingSoon title="RAMS Builder" note="A guided builder to generate branded RAMS from templates — coming soon." />}
        {sub === 'submissions' && <ProjectSubmissions projectNo={openNo} />}
        {sub === 'images' && <ProjectImages projectNo={openNo} />}
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
              {cols.map(c => <th key={c.key} onClick={() => toggleSort(c.key)} style={{ ...th, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>{c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>)}
              <th style={th}></th>
            </tr></thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.projectNo} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><strong>{p.projectNo}</strong>{p.manual && <span title="Manually added" style={{ marginLeft: 6, fontSize: 10, color: '#aaa' }}>manual</span>}</td>
                  <td style={td}><button onClick={() => { setOpenNo(p.projectNo); setSub('handover') }} style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontWeight: 600, padding: 0, textAlign: 'left' }}>{p.projectName || '—'}</button></td>
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
      setSubs((d.submissions || []).filter(s => s.projectId === projectNo || s.projectName === projectNo))
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
                  <td style={{ ...td, textAlign: 'right' }}><button onClick={() => openSub(s)} style={linkBtn}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <Modal onClose={() => setOpen(null)} title={open.formTitle} wide>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>{open.projectName} · {open.operative} · {fmtDateTime(open.submittedAt)}</div>
          {!full ? <Loading /> : (
            <>
              <div style={{ marginBottom: 14 }}><button onClick={() => openPrintView([full], labelFor)} style={ghostBtn}>Download PDF</button></div>
              {Object.entries(full.answers || {}).map(([k, v]) => {
                if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null
                const isPhotos = Array.isArray(v) && typeof v[0] === 'string' && /^https?:|^data:/.test(v[0])
                return (
                  <div key={k} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f2f2f2' }}>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 3 }}>{labelFor(full.formId, k)}</div>
                    {isPhotos
                      ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>{v.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} style={{ height: 90, borderRadius: 6 }} /></a>)}</div>
                      : <div style={{ fontSize: 14, color: INK, marginTop: 2 }}>{typeof v === 'object' ? (v.name ? `${v.name} (${v.date})` : JSON.stringify(v)) : Array.isArray(v) ? v.join(', ') : String(v)}</div>}
                  </div>
                )
              })}
            </>
          )}
        </Modal>
      )}
    </div>
  )
}

// ── Project images pulled from all form submissions ──
function ProjectImages({ projectNo }) {
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { (async () => {
    try {
      const r = await fetch('/api/submissions'); const d = await r.json()
      const mine = (d.submissions || []).filter(s => s.projectId === projectNo || s.projectName === projectNo)
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

  if (loading) return <Loading />
  if (!images.length) return <EmptyCard title="No images yet" body="Images added to form submissions for this project will appear here." />
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 16 }}>
      {images.map((img, i) => (
        <div key={i} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden' }}>
          <a href={img.url} target="_blank" rel="noreferrer"><img src={img.url} alt="" style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }} /></a>
          <div style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: 12, color: '#999' }}>{new Date(img.submittedAt).toLocaleString('en-GB')}</div>
            <div style={{ fontSize: 13, color: INK, fontWeight: 600, marginTop: 2 }}>{img.formTitle}</div>
            <a href={`/operations/submissions?open=${img.subId}`} style={{ ...linkBtn, display: 'inline-block', marginTop: 4 }}>View form ›</a>
          </div>
        </div>
      ))}
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
    let failed = 0
    const { upload } = await import('@vercel/blob/client')
    for (const file of Array.from(list)) {
      try {
        const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/upload-file', contentType: file.type || undefined })
        await fetch('/api/project-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, file: { category: 'rams', name: file.name, url: blob.url, contentType: file.type, size: file.size } }) })
      } catch (e) { console.error(e); failed++ }
    }
    if (inputRef.current) inputRef.current.value = ''
    setUploading(false)
    if (failed) setErr(`${failed} file(s) failed to upload.`)
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
        <div>
          <input ref={inputRef} type="file" accept="application/pdf,image/*" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
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
                <tr key={f.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><strong>Rev {total - i}</strong>{i === 0 && <span style={{ marginLeft: 8, fontSize: 11, background: '#ecfdf5', color: '#065f46', borderRadius: 20, padding: '2px 8px', fontWeight: 600 }}>Latest</span>}</td>
                  <td style={td}>{f.name}</td>
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
    </div>
  )
}
