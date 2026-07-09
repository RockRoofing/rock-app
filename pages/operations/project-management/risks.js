import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, th, td, Loading, EmptyCard, Modal, Lbl, inp2, primaryBtn, ghostBtn, linkBtn, fmtDate } from '../../../components/opsUI'

export default function RiskLog() {
  const [risks, setRisks] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(null)      // manual risk being added/edited
  const [metaEdit, setMetaEdit] = useState(null) // any risk having meta edited

  // filters
  const [fProject, setFProject] = useState('')
  const [fMember, setFMember] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [fStatus, setFStatus] = useState('')   // '', 'open', 'closed'
  const [sort, setSort] = useState({ key: 'projectNo', dir: 'asc' })

  useEffect(() => { load() }, [])
  async function load() {
    try { const r = await fetch('/api/risks'); const d = await r.json(); setRisks(d.risks || []) } catch {}
    setLoading(false)
  }

  const projects = useMemo(() => [...new Set(risks.map(r => r.projectName).filter(Boolean))].sort(), [risks])
  const members = useMemo(() => [...new Set(risks.map(r => r.assignee).filter(Boolean))].sort(), [risks])

  const filtered = useMemo(() => {
    let out = risks.filter(r => {
      if (fProject && r.projectName !== fProject) return false
      if (fMember && r.assignee !== fMember) return false
      if (fStatus === 'open' && r.closed) return false
      if (fStatus === 'closed' && !r.closed) return false
      if (fFrom && (!r.closeOutDate || r.closeOutDate < fFrom)) return false
      if (fTo && (!r.closeOutDate || r.closeOutDate > fTo)) return false
      return true
    })
    const { key, dir } = sort
    out = [...out].sort((a, b) => {
      let av = a[key] ?? '', bv = b[key] ?? ''
      if (key === 'closed') { av = a.closed ? 1 : 0; bv = b.closed ? 1 : 0 }
      if (av < bv) return dir === 'asc' ? -1 : 1
      if (av > bv) return dir === 'asc' ? 1 : -1
      return 0
    })
    return out
  }, [risks, fProject, fMember, fFrom, fTo, fStatus, sort])

  function toggleSort(key) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  async function saveManual() {
    if (!edit.description?.trim()) { alert('Add a risk description.'); return }
    await fetch('/api/risks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ risk: edit }) })
    setEdit(null); load()
  }
  async function saveMeta() {
    // Patch the stored risk directly (works for IHM + manual).
    await fetch('/api/risks', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ risk: { id: metaEdit.id, assignee: metaEdit.assignee, closeOutDate: metaEdit.closeOutDate, closed: metaEdit.closed, comments: metaEdit.comments } }) })
    setMetaEdit(null); load()
  }
  async function delManual(id) {
    if (!confirm('Delete this manual risk?')) return
    await fetch('/api/risks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }

  const hasFilters = fProject || fMember || fFrom || fTo || fStatus
  const openCount = filtered.filter(r => !r.closed).length

  const cols = [
    { key: 'projectName', label: 'Project' },
    { key: 'projectNo', label: 'Project No.' },
    { key: 'assignee', label: 'Assigned to' },
    { key: 'description', label: 'Risk' },
    { key: 'mitigation', label: 'Mitigation' },
    { key: 'closeOutDate', label: 'Close-out' },
    { key: 'closed', label: 'Status' },
    { key: 'comments', label: 'Comments' },
  ]

  return (
    <OperationsShell active="pm:risks" section="pm" title="Risk Log" wide>
      <PageHeading title="Risk Log" sub="Auto-populated from Internal Handover Minutes, plus manually added"
        action={<button onClick={() => setEdit({ projectNo: '', projectName: '', assignee: '', description: '', mitigation: '', closeOutDate: '', closed: false })} style={primaryBtn}>+ Add risk</button>} />

      {/* Filters */}
      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <F label="Project"><select value={fProject} onChange={e => setFProject(e.target.value)} style={sel}><option value="">All projects</option>{projects.map(p => <option key={p}>{p}</option>)}</select></F>
        <F label="Team member"><select value={fMember} onChange={e => setFMember(e.target.value)} style={sel}><option value="">All members</option>{members.map(m => <option key={m}>{m}</option>)}</select></F>
        <F label="Status"><select value={fStatus} onChange={e => setFStatus(e.target.value)} style={sel}><option value="">All</option><option value="open">Open</option><option value="closed">Closed</option></select></F>
        <F label="Close-out from"><input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} style={sel} /></F>
        <F label="Close-out to"><input type="date" value={fTo} onChange={e => setFTo(e.target.value)} style={sel} /></F>
        {hasFilters && <button onClick={() => { setFProject(''); setFMember(''); setFFrom(''); setFTo(''); setFStatus('') }} style={{ background: '#f2f2f0', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, color: '#555', cursor: 'pointer' }}>Reset</button>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>{filtered.length} risks · {openCount} open</div>
      </div>

      {loading ? <Loading /> : !filtered.length ? (
        <EmptyCard title={hasFilters ? 'No risks match your filters' : 'No risks yet'}
          body={hasFilters ? 'Try clearing filters.' : 'Risks from Internal Handover Minutes appear here automatically, or add one manually.'} />
      ) : (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              {cols.map(c => (
                <th key={c.key} onClick={() => toggleSort(c.key)} style={{ ...th, cursor: 'pointer', userSelect: 'none' }}>
                  {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th style={th}></th>
            </tr></thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid #f0f0f0', verticalAlign: 'top', background: r.closed ? '#fafefb' : '#fff' }}>
                  <td style={td}>{r.projectName || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><strong>{r.projectNo || '—'}</strong></td>
                  <td style={td}>{r.assignee || <span style={{ color: '#ccc' }}>Unassigned</span>}</td>
                  <td style={{ ...td, maxWidth: 280 }}>{r.description || '—'}</td>
                  <td style={{ ...td, maxWidth: 280, color: '#555' }}>{r.mitigation || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.closeOutDate ? fmtDate(r.closeOutDate) : '—'}</td>
                  <td style={td}>{r.closed
                    ? <span style={{ background: '#ecfdf5', color: '#065f46', borderRadius: 20, padding: '2px 10px', fontSize: 12 }}>Closed</span>
                    : <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>Open</span>}
                    {r.sourceIhm && <span title="From Internal Handover Minutes" style={{ marginLeft: 6, fontSize: 10, color: '#aaa' }}>IHM</span>}
                  </td>
                  <td style={{ ...td, maxWidth: 220, color: '#555' }}>{r.comments || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setMetaEdit({ id: r.id, assignee: r.assignee, closeOutDate: r.closeOutDate, closed: r.closed, comments: r.comments })} style={linkBtn}>Update</button>
                    {!r.sourceIhm && <>
                      <button onClick={() => setEdit({ ...r })} style={linkBtn}>Edit</button>
                      <button onClick={() => delManual(r.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual add/edit modal */}
      {edit && (
        <Modal onClose={() => setEdit(null)} title={edit.id ? 'Edit risk' : 'Add risk'}>
          <Lbl>Project name</Lbl>
          <input value={edit.projectName} onChange={e => setEdit({ ...edit, projectName: e.target.value })} style={inp2} />
          <Lbl>Project number</Lbl>
          <input value={edit.projectNo} onChange={e => setEdit({ ...edit, projectNo: e.target.value })} style={inp2} placeholder="e.g. J247" />
          <Lbl>Team member assigned</Lbl>
          <input value={edit.assignee} onChange={e => setEdit({ ...edit, assignee: e.target.value })} style={inp2} />
          <Lbl>Risk description</Lbl>
          <textarea value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} rows={2} style={{ ...inp2, resize: 'vertical' }} />
          <Lbl>Risk mitigation</Lbl>
          <textarea value={edit.mitigation} onChange={e => setEdit({ ...edit, mitigation: e.target.value })} rows={2} style={{ ...inp2, resize: 'vertical' }} />
          <Lbl>Close-out date</Lbl>
          <input type="date" value={edit.closeOutDate} onChange={e => setEdit({ ...edit, closeOutDate: e.target.value })} style={inp2} />
          <Lbl>Comments</Lbl>
          <textarea value={edit.comments || ''} onChange={e => setEdit({ ...edit, comments: e.target.value })} rows={2} style={{ ...inp2, resize: 'vertical' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 14 }}>
            <input type="checkbox" checked={!!edit.closed} onChange={e => setEdit({ ...edit, closed: e.target.checked })} /> Closed out
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button onClick={saveManual} style={primaryBtn}>Save</button>
            <button onClick={() => setEdit(null)} style={ghostBtn}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Meta update modal (works for IHM + manual) */}
      {metaEdit && (
        <Modal onClose={() => setMetaEdit(null)} title="Update risk">
          <Lbl>Team member assigned</Lbl>
          <input value={metaEdit.assignee || ''} onChange={e => setMetaEdit({ ...metaEdit, assignee: e.target.value })} style={inp2} />
          <Lbl>Close-out date</Lbl>
          <input type="date" value={metaEdit.closeOutDate || ''} onChange={e => setMetaEdit({ ...metaEdit, closeOutDate: e.target.value })} style={inp2} />
          <Lbl>Comments</Lbl>
          <textarea value={metaEdit.comments || ''} onChange={e => setMetaEdit({ ...metaEdit, comments: e.target.value })} rows={2} style={{ ...inp2, resize: 'vertical' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 14 }}>
            <input type="checkbox" checked={!!metaEdit.closed} onChange={e => setMetaEdit({ ...metaEdit, closed: e.target.checked })} /> Closed out
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button onClick={saveMeta} style={primaryBtn}>Save</button>
            <button onClick={() => setMetaEdit(null)} style={ghostBtn}>Cancel</button>
          </div>
        </Modal>
      )}
    </OperationsShell>
  )
}

const F = ({ label, children }) => (
  <div><div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{label}</div>{children}</div>
)
const sel = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', minWidth: 140 }
