import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, th, td, Loading, EmptyCard, Modal, Lbl, inp2, primaryBtn, ghostBtn, linkBtn, fmtDate } from '../../../components/opsUI'
import RowAttachments from '../../../components/RowAttachments'
import ExpandableText from '../../../components/ExpandableText'
import { dateCellStyle, procurementLate } from '../../../components/pmShared'

const PAGE_SIZE = 100
const GREEN = { background: '#ecfdf5' }

export default function Procurement() {
  const [items, setItems] = useState([])
  const [team, setTeam] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(null)
  const [page, setPage] = useState(0)

  const [fProject, setFProject] = useState('')
  const [fMember, setFMember] = useState('')
  const [fSupplier, setFSupplier] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [fOrdered, setFOrdered] = useState('no')   // default: show not-yet-ordered
  const [sort, setSort] = useState({ key: 'orderBy', dir: 'asc' })

  useEffect(() => { load() }, [])
  async function load() {
    try {
      const [it, t, p] = await Promise.all([
        fetch('/api/procurement').then(x => x.json()),
        fetch('/api/team').then(x => x.json()),
        fetch('/api/ops-projects').then(x => x.json()).catch(() => ({})),
      ])
      setItems(it.items || [])
      setTeam((t.members || []).filter(m => m.active !== false))
      setProjects((p.projects || []).map(x => ({ no: x.projectNo, name: x.projectName || x.name || '' })))
    } catch {}
    setLoading(false)
  }

  const memberNames = useMemo(() => team.map(m => m.name).filter(Boolean), [team])
  const suppliers = useMemo(() => [...new Set(items.map(i => i.supplier).filter(Boolean))].sort(), [items])
  const projectOptions = useMemo(() => {
    const fromRows = items.map(r => ({ no: r.projectNo, name: r.projectName }))
    const all = [...projects, ...fromRows].filter(p => p.no || p.name)
    const seen = new Set(); const out = []
    for (const p of all) { const k = `${p.no}|${p.name}`; if (!seen.has(k)) { seen.add(k); out.push(p) } }
    return out.sort((a, b) => (a.no || '').localeCompare(b.no || ''))
  }, [items, projects])

  const filtered = useMemo(() => {
    let out = items.filter(r => {
      if (fProject && `${r.projectNo}|${r.projectName}` !== fProject) return false
      if (fMember && r.assignee !== fMember) return false
      if (fSupplier && r.supplier !== fSupplier) return false
      if (fOrdered === 'no' && r.orderPlaced) return false
      if (fOrdered === 'yes' && !r.orderPlaced) return false
      if (fFrom && (!r.orderBy || r.orderBy < fFrom)) return false
      if (fTo && (!r.orderBy || r.orderBy > fTo)) return false
      return true
    })
    const { key, dir } = sort
    out = [...out].sort((a, b) => {
      let av = a[key] ?? '', bv = b[key] ?? ''
      if (key === 'orderPlaced' || key === 'designComplete') { av = a[key] ? 1 : 0; bv = b[key] ? 1 : 0 }
      if (av < bv) return dir === 'asc' ? -1 : 1
      if (av > bv) return dir === 'asc' ? 1 : -1
      return 0
    })
    return out
  }, [items, fProject, fMember, fSupplier, fFrom, fTo, fOrdered, sort])

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const hasFilters = fProject || fMember || fSupplier || fFrom || fTo || fOrdered !== 'no'

  function toggleSort(key) { setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }); setPage(0) }

  async function saveItem(item) {
    await fetch('/api/procurement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item }) })
    setEdit(null); load()
  }
  async function patchItem(id, patch) {
    const r = items.find(x => x.id === id); if (!r) return
    const updated = { ...r, ...patch }
    setItems(rs => rs.map(x => x.id === id ? updated : x))
    await fetch('/api/procurement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: updated }) })
  }
  async function delItem(id) {
    if (!confirm('Delete this procurement item?')) return
    await fetch('/api/procurement', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }

  const emptyItem = { projectNo: '', projectName: '', package: '', supplier: '', assignee: '', designBy: '', designComplete: false, orderBy: '', leadInWeeks: '', requiredOnSite: '', orderPlaced: false, supplierContact: '', comments: '', attachments: [] }

  const sortableCols = [
    { key: 'projectNo', label: 'Project' },
    { key: 'package', label: 'Activity / Package' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'assignee', label: 'Responsible' },
  ]

  return (
    <OperationsShell active="pm:procurement" section="pm" title="Procurement" wide>
      <PageHeading title="Procurement Schedule" sub="Open procurement across all projects. Placed orders are hidden by default."
        action={<button onClick={() => setEdit({ ...emptyItem })} style={primaryBtn}>+ Add item</button>} />

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <F label="Project"><select value={fProject} onChange={e => { setFProject(e.target.value); setPage(0) }} style={sel}><option value="">All projects</option>{projectOptions.map(p => <option key={`${p.no}|${p.name}`} value={`${p.no}|${p.name}`}>{[p.no, p.name].filter(Boolean).join(' — ')}</option>)}</select></F>
        <F label="Supplier"><select value={fSupplier} onChange={e => { setFSupplier(e.target.value); setPage(0) }} style={sel}><option value="">All</option>{suppliers.map(s => <option key={s} value={s}>{s}</option>)}</select></F>
        <F label="Team member"><select value={fMember} onChange={e => { setFMember(e.target.value); setPage(0) }} style={sel}><option value="">All</option>{memberNames.map(m => <option key={m} value={m}>{m}</option>)}</select></F>
        <F label="Order-by from"><input type="date" value={fFrom} onChange={e => { setFFrom(e.target.value); setPage(0) }} style={sel} /></F>
        <F label="Order-by to"><input type="date" value={fTo} onChange={e => { setFTo(e.target.value); setPage(0) }} style={sel} /></F>
        <F label="Order placed?"><select value={fOrdered} onChange={e => { setFOrdered(e.target.value); setPage(0) }} style={sel}><option value="no">No (open)</option><option value="yes">Yes (placed)</option><option value="all">All</option></select></F>
        {hasFilters && <button onClick={() => { setFProject(''); setFMember(''); setFSupplier(''); setFFrom(''); setFTo(''); setFOrdered('no'); setPage(0) }} style={ghostBtn}>Reset</button>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>{filtered.length} item{filtered.length === 1 ? '' : 's'}</div>
      </div>

      {loading ? <Loading /> : !filtered.length ? (
        <EmptyCard title="No procurement items to show" body={hasFilters ? 'Try adjusting the filters.' : 'Procurement items from Internal Handover Minutes and manually-added items appear here.'} />
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1500 }}>
              <thead><tr style={{ background: '#faf9f7' }}>
                {sortableCols.map(c => <th key={c.key} onClick={() => toggleSort(c.key)} style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap' }}>{c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>)}
                <th style={th}>Design By</th>
                <th style={th}>Design Complete?</th>
                <th style={th}>Order By</th>
                <th style={th}>Lead-in (wks)</th>
                <th style={th}>Required On Site</th>
                <th style={th}>Order Placed?</th>
                <th style={th}>Supplier Contact</th>
                <th style={th}>Comments</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr></thead>
              <tbody>
                {pageRows.map(r => {
                  // Two independent green timelines:
                  //  - Design Complete? = Yes greens cells up to & including "Design By"
                  //  - Order Placed?    = Yes greens cells up to & including "Order By"
                  const designGreen = !!r.designComplete
                  const orderGreen = !!r.orderPlaced
                  // Left block (project..responsible) greens once design is complete,
                  // and stays green (order also implies design stage passed).
                  const leftGreen = (designGreen || orderGreen) ? GREEN : {}
                  const late = !orderGreen && procurementLate(r.requiredOnSite, r.leadInWeeks)
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid #f0f0f0', verticalAlign: 'top' }}>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...leftGreen }}><strong>{r.projectNo}</strong>{r.projectName ? <div style={{ fontSize: 11, color: '#999' }}>{r.projectName}</div> : null}</td>
                      <td style={{ ...td, ...leftGreen }}><ExpandableText value={r.package} onSave={v => patchItem(r.id, { package: v })} label="Activity / Package" width={200} /></td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...leftGreen }}>{r.supplier || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...leftGreen }}>{r.assignee || '—'}</td>
                      {/* Design By — green if design complete, else traffic light */}
                      <td style={{ ...td, whiteSpace: 'nowrap', ...(designGreen || orderGreen ? GREEN : dateCellStyle(r.designBy)) }}>{r.designBy ? fmtDate(r.designBy) : '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <select value={r.designComplete ? 'yes' : 'no'} onChange={e => patchItem(r.id, { designComplete: e.target.value === 'yes' })} style={{ ...sel, minWidth: 76, padding: '5px 8px' }}>
                          <option value="no">No</option><option value="yes">Yes</option>
                        </select>
                      </td>
                      {/* Order By — green if order placed, else traffic light */}
                      <td style={{ ...td, whiteSpace: 'nowrap', ...(orderGreen ? GREEN : dateCellStyle(r.orderBy)) }}>{r.orderBy ? fmtDate(r.orderBy) : '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'center' }}>
                        <input type="number" min="0" step="1" value={r.leadInWeeks ?? ''} onChange={e => patchItem(r.id, { leadInWeeks: e.target.value.replace(/[^0-9]/g, '') })} style={{ width: 56, padding: '6px 6px', border: '1px solid #e0e0e0', borderRadius: 6, fontSize: 13, textAlign: 'center' }} />
                      </td>
                      {/* Required On Site — with lead-in shortage flag */}
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{r.requiredOnSite ? fmtDate(r.requiredOnSite) : '—'}</span>
                          {late && <span title="Not enough lead-in time to procure before this date" style={{ background: '#dc2626', color: '#fff', fontSize: 10.5, fontWeight: 700, borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap' }}>⚠ SHORT</span>}
                        </div>
                        {late && <div style={{ fontSize: 10.5, color: '#dc2626', marginTop: 3 }}>Not enough lead-in time</div>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <select value={r.orderPlaced ? 'yes' : 'no'} onChange={e => patchItem(r.id, { orderPlaced: e.target.value === 'yes' })} style={{ ...sel, minWidth: 76, padding: '5px 8px' }}>
                          <option value="no">No</option><option value="yes">Yes</option>
                        </select>
                      </td>
                      <td style={{ ...td }}><ExpandableText value={r.supplierContact} onSave={v => patchItem(r.id, { supplierContact: v })} label="Supplier contact details" width={180} /></td>
                      <td style={{ ...td }}><ExpandableText value={r.comments} onSave={v => patchItem(r.id, { comments: v })} label="Comments" width={200} /></td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                          <RowAttachments files={r.attachments || []} onChange={files => patchItem(r.id, { attachments: files })} />
                          <button onClick={() => setEdit(r)} style={linkBtn}>Edit</button>
                          <button onClick={() => delItem(r.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16, alignItems: 'center' }}>
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={ghostBtn}>‹ Prev</button>
              <span style={{ fontSize: 13, color: '#666' }}>Page {page + 1} of {pageCount}</span>
              <button disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)} style={ghostBtn}>Next ›</button>
            </div>
          )}
        </>
      )}

      {edit && <ProcModal item={edit} team={team} projectOptions={projectOptions} onClose={() => setEdit(null)} onSave={saveItem} />}
    </OperationsShell>
  )
}

function ProcModal({ item, team, projectOptions, onClose, onSave }) {
  const [f, setF] = useState({ ...item })
  const setProj = (val) => { const [no, name] = val.split('|'); setF({ ...f, projectNo: no, projectName: name }) }
  const late = !f.orderPlaced && procurementLate(f.requiredOnSite, f.leadInWeeks)
  return (
    <Modal onClose={onClose} title={f.id ? 'Edit procurement item' : 'Add procurement item'} wide>
      <Lbl>Project</Lbl>
      <select value={`${f.projectNo || ''}|${f.projectName || ''}`} onChange={e => setProj(e.target.value)} style={inp2}>
        <option value="|">Select project…</option>
        {projectOptions.map(p => <option key={`${p.no}|${p.name}`} value={`${p.no}|${p.name}`}>{[p.no, p.name].filter(Boolean).join(' — ')}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><Lbl>Activity / Package</Lbl><input value={f.package || ''} onChange={e => setF({ ...f, package: e.target.value })} style={inp2} /></div>
        <div style={{ flex: 1 }}><Lbl>Supplier</Lbl><input value={f.supplier || ''} onChange={e => setF({ ...f, supplier: e.target.value })} style={inp2} /></div>
      </div>
      <Lbl>Team member responsible</Lbl>
      <select value={f.assignee || ''} onChange={e => setF({ ...f, assignee: e.target.value })} style={inp2}><option value="">—</option>{team.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}</select>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><Lbl>Design completed by</Lbl><input type="date" value={f.designBy || ''} onChange={e => setF({ ...f, designBy: e.target.value })} style={inp2} /></div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}><label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, paddingBottom: 10 }}><input type="checkbox" checked={!!f.designComplete} onChange={e => setF({ ...f, designComplete: e.target.checked })} /> Design complete</label></div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><Lbl>Order placed by</Lbl><input type="date" value={f.orderBy || ''} onChange={e => setF({ ...f, orderBy: e.target.value })} style={inp2} /></div>
        <div style={{ width: 120 }}><Lbl>Lead-in (weeks)</Lbl><input type="number" min="0" step="1" value={f.leadInWeeks ?? ''} onChange={e => setF({ ...f, leadInWeeks: e.target.value.replace(/[^0-9]/g, '') })} style={inp2} /></div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><Lbl>Required on site</Lbl><input type="date" value={f.requiredOnSite || ''} onChange={e => setF({ ...f, requiredOnSite: e.target.value })} style={inp2} /></div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}><label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, paddingBottom: 10 }}><input type="checkbox" checked={!!f.orderPlaced} onChange={e => setF({ ...f, orderPlaced: e.target.checked })} /> Order placed</label></div>
      </div>
      {late && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginTop: 8 }}>⚠ Not enough lead-in time — the order date needed to hit "required on site" has already passed.</div>}
      <Lbl>Supplier contact details</Lbl><textarea value={f.supplierContact || ''} onChange={e => setF({ ...f, supplierContact: e.target.value })} style={{ ...inp2, minHeight: 44 }} />
      <Lbl>Comments</Lbl><textarea value={f.comments || ''} onChange={e => setF({ ...f, comments: e.target.value })} style={{ ...inp2, minHeight: 50 }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button onClick={() => onSave(f)} style={primaryBtn} disabled={!f.projectNo || (!f.package && !f.supplier)}>Save</button>
        <button onClick={onClose} style={ghostBtn}>Cancel</button>
      </div>
    </Modal>
  )
}

const F = ({ label, children }) => <div><div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{label}</div>{children}</div>
const sel = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', minWidth: 140 }
