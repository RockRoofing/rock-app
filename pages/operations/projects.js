import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading, SubTabs, ComingSoon } from '../../components/OperationsShell'
import { INK, GOLD, th, td, Loading, EmptyCard, Modal, Lbl, inp2, primaryBtn, ghostBtn, linkBtn } from '../../components/opsUI'

const SUB_TABS = [
  { key: 'handover', label: 'Handover' },
  { key: 'drawings', label: 'Drawings' },
  { key: 'rams', label: 'RAMS' },
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
    const r = await fetch('/api/ops-projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'manual-add', project: manual }) })
    const d = await r.json()
    if (!r.ok) { alert(d.error || 'Could not add'); return }
    setManual(null); load()
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
        {sub === 'drawings' && <ComingSoon title="Drawings" note="Project drawings — managed here, viewable on the Forms App. To be wired to file links/uploads." />}
        {sub === 'rams' && <ComingSoon title="RAMS" note="Project RAMS — to be wired next." />}
        {sub === 'submissions' && <ComingSoon title="Forms Submissions" note="Filtered submissions for this project — to be wired to the submissions list." />}
        {sub === 'images' && <ComingSoon title="Project Images" note="Photo timeline pulled from form submissions — to be wired next." />}
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
        action={<button onClick={() => setManual({ projectNo: '', projectName: '', contractsManager: '', estimator: '', quantitySurveyor: '', designManager: '', location: '', status: 'active' })} style={ghostBtn}>+ Add old project</button>} />

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
                    {p.manual && <button onClick={() => delProject(p.projectNo)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {manual && (
        <Modal onClose={() => setManual(null)} title="Add old project (temporary)">
          <div style={{ fontSize: 12.5, color: '#888', marginBottom: 10 }}>For projects already handed over before the app. You can delete these later once all IHMs are in.</div>
          <Lbl>Project number</Lbl>
          <input value={manual.projectNo} onChange={e => setManual({ ...manual, projectNo: e.target.value })} style={inp2} placeholder="e.g. J240" />
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
            <button onClick={saveManual} style={primaryBtn}>Add project</button>
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
      <div style={{ marginTop: 12, fontSize: 12, color: '#aaa' }}>Read-only. Edit via Pre-Contract → Internal Handover Minutes.</div>
    </div>
  )
}

const F = ({ label, children }) => (<div><div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{label}</div>{children}</div>)
const sel = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', minWidth: 130 }
