import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, th, td, Loading, EmptyCard, Modal, Lbl, inp2, primaryBtn, ghostBtn, linkBtn, fmtDate } from '../../../components/opsUI'
import RowAttachments from '../../../components/RowAttachments'
import ExpandableText from '../../../components/ExpandableText'
import { dateCellStyle } from '../../../components/pmShared'

const PAGE_SIZE = 100

export default function Deliveries() {
  const [rows, setRows] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState('')
  const [edit, setEdit] = useState(null)
  const [items, setItems] = useState(null)     // line-items pop-out
  const [addr, setAddr] = useState(null)       // address pop-out
  const [page, setPage] = useState(0)

  const [fProject, setFProject] = useState('')
  const [fStatus, setFStatus] = useState('open')   // open = not delivered
  const [sort, setSort] = useState({ key: 'requiredDeliveryDate', dir: 'asc' })

  useEffect(() => {
    // Show data fast (no sync), then sync in the background so the page isn't
    // blocked by paginating all POs. New POs appear a moment after load.
    load(false).then(() => load(true))
  }, [])
  async function load(sync) {
    if (sync) setSyncing(true)
    try {
      const d = await fetch(`/api/deliveries${sync ? '?sync=true' : ''}`).then(r => r.json())
      setRows(d.deliveries || [])
      setProjects(d.projects || [])
      if (sync && d.syncInfo) {
        setNotice(d.syncInfo.error ? `Sync issue: ${d.syncInfo.error}`
          : d.syncInfo.firstRun ? `Baseline set (${d.syncInfo.baseline || 0} existing POs noted). New POs approved from now on will appear here on the next sync.`
          : (d.syncInfo.added ? `Synced — ${d.syncInfo.added} new PO(s) added.` : 'Synced — no new POs.'))
      }
    } catch (e) { if (!sync) setNotice('Could not load deliveries.') }
    setLoading(false)
    setSyncing(false)
  }

  const projectOptions = useMemo(() => {
    const fromRows = rows.map(r => ({ name: r.projectName, jobNo: r.projectNo }))
    const all = [...projects, ...fromRows].filter(p => p.name || p.jobNo)
    const seen = new Set(); const out = []
    for (const p of all) { const k = `${p.jobNo}|${p.name}`; if (!seen.has(k)) { seen.add(k); out.push(p) } }
    return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [rows, projects])

  const filtered = useMemo(() => {
    let out = rows.filter(r => {
      const delivered = !!r.actualDeliveryDate
      if (fProject && `${r.projectNo}|${r.projectName}` !== fProject) return false
      if (fStatus === 'open' && delivered) return false
      if (fStatus === 'complete' && !delivered) return false
      return true
    })
    const { key, dir } = sort
    out = [...out].sort((a, b) => {
      let av = a[key] ?? '', bv = b[key] ?? ''
      if (av < bv) return dir === 'asc' ? -1 : 1
      if (av > bv) return dir === 'asc' ? 1 : -1
      return 0
    })
    return out
  }, [rows, fProject, fStatus, sort])

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  function toggleSort(key) { setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }); setPage(0) }

  async function patch(id, patchObj) {
    const r = rows.find(x => x.id === id); if (!r) return
    const updated = { ...r, ...patchObj }
    setRows(rs => rs.map(x => x.id === id ? updated : x))
    await fetch('/api/deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delivery: updated }) })
  }
  async function saveRow(delivery) {
    await fetch('/api/deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delivery }) })
    setEdit(null); load(false)
  }
  async function delRow(id) {
    if (!confirm('Delete this delivery row?')) return
    await fetch('/api/deliveries', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load(false)
  }

  // Setting an actual delivery date marks it complete — warn if no attachment.
  function setActualDate(r, date) {
    if (date && !(r.attachments || []).length) {
      if (!confirm('Mark this delivery complete with no delivery note or photos attached?\n\nAre you sure?')) return
    }
    patch(r.id, { actualDeliveryDate: date })
  }

  const yn = (r, key) => (
    <select value={r[key] ? 'yes' : 'no'} onChange={e => {
      const toYes = e.target.value === 'yes'
      if (toYes && !r[key]) {
        const dstr = r.requiredDeliveryDate ? new Date(r.requiredDeliveryDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'not set'
        alert(`Is the required delivery date of ${dstr} still applicable?\n\nIf not, please update it in the "Required Delivery" column of this row.`)
      }
      patch(r.id, { [key]: toYes })
    }} style={{ ...sel, minWidth: 72, padding: '5px 8px' }}>
      <option value="no">No</option><option value="yes">Yes</option>
    </select>
  )

  return (
    <OperationsShell active="pm:deliveries" section="pm" title="Deliveries" wide>
      <PageHeading title="Delivery Schedule" sub="One row per Purchase Order. Approved POs (from go-live) sync from Xero; delivered items are hidden by default."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => load(true)} disabled={syncing} style={ghostBtn}>{syncing ? 'Syncing…' : 'Sync with Xero'}</button>
            <button onClick={() => setEdit({ projectNo: '', projectName: '', deliveryAddress: '', poNumber: '', orderDate: '', requiredDeliveryDate: '', lineItems: [], poSent: false, supplierConfirmedDate: false, secondCheck: false, actualDeliveryDate: '', attachments: [], comments: '' })} style={primaryBtn}>+ Add delivery</button>
          </div>
        } />

      {notice && <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', borderRadius: 8, padding: '9px 14px', fontSize: 13, marginBottom: 14 }}>{notice}</div>}

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <F label="Project"><select value={fProject} onChange={e => { setFProject(e.target.value); setPage(0) }} style={sel}><option value="">All projects</option>{projectOptions.map(p => <option key={`${p.jobNo}|${p.name}`} value={`${p.jobNo}|${p.name}`}>{[p.jobNo, p.name].filter(Boolean).join(' — ')}</option>)}</select></F>
        <F label="Status"><select value={fStatus} onChange={e => { setFStatus(e.target.value); setPage(0) }} style={sel}><option value="open">Open (not delivered)</option><option value="complete">Delivered</option><option value="all">All</option></select></F>
        {(fProject || fStatus !== 'open') && <button onClick={() => { setFProject(''); setFStatus('open'); setPage(0) }} style={ghostBtn}>Reset</button>}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>{filtered.length} PO{filtered.length === 1 ? '' : 's'}</div>
      </div>

      {loading ? <Loading /> : !filtered.length ? (
        <EmptyCard title="No deliveries to show" body="Approved Xero POs raised from now on will appear here after a sync, plus any you add manually." />
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1500 }}>
              <thead><tr style={{ background: '#faf9f7' }}>
                <th onClick={() => toggleSort('projectNo')} style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap' }}>Project{sort.key === 'projectNo' ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                <th onClick={() => toggleSort('poNumber')} style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap' }}>PO No{sort.key === 'poNumber' ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                <th onClick={() => toggleSort('supplier')} style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap' }}>Supplier{sort.key === 'supplier' ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                <th onClick={() => toggleSort('orderDate')} style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap' }}>Order Date{sort.key === 'orderDate' ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                <th style={th}>Address</th>
                <th style={th}>Items</th>
                <th style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => toggleSort('requiredDeliveryDate')}>Required Delivery{sort.key === 'requiredDeliveryDate' ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                <th style={th}>PO Sent</th><th style={th}>Supplier Confirmed</th><th style={th}>2nd Check</th>
                <th style={th}>Actual Delivery</th><th style={th}>Comments</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr></thead>
              <tbody>
                {pageRows.map(r => {
                  const delivered = !!r.actualDeliveryDate
                  const GREENC = { background: '#ecfdf5' }
                  // Progressive green timeline. Column stages, left to right:
                  //  0 Required Delivery (green once a required date is set)
                  //  1 PO Sent, 2 Supplier Confirmed, 3 2nd Check (each Yes extends)
                  // Everything LEFT of Required Delivery greens with stage 0.
                  // Actual Delivery date set -> whole row green.
                  let lastGreen = -1
                  if (r.requiredDeliveryDate) lastGreen = 0
                  if (r.poSent) lastGreen = Math.max(lastGreen, 1)
                  if (r.supplierConfirmedDate) lastGreen = Math.max(lastGreen, 2)
                  if (r.secondCheck) lastGreen = Math.max(lastGreen, 3)
                  const rowGreen = delivered ? GREENC : {}
                  // left block (project..items) greens as soon as stage 0 reached
                  const leftGreen = (delivered || lastGreen >= 0) ? GREENC : {}
                  const stageGreen = (i) => (delivered || i <= lastGreen) ? GREENC : {}
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid #f0f0f0', verticalAlign: 'middle', ...rowGreen }}>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...leftGreen }}>
                        {r.projectName || r.projectNo ? <><strong>{r.projectNo}</strong>{r.projectName ? <div style={{ fontSize: 11, color: '#999' }}>{r.projectName}</div> : null}</>
                          : <button onClick={() => setEdit(r)} style={{ ...linkBtn, padding: 0, color: '#ca8a04' }}>Assign project</button>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...leftGreen }}>{r.poNumber || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...leftGreen }}>{r.supplier || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...leftGreen }}>{r.orderDate ? fmtDate(r.orderDate) : '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...leftGreen }}>
                        {r.deliveryAddress
                          ? <button onClick={() => setAddr(r)} style={{ ...linkBtn, padding: 0 }}>View</button>
                          : <span style={{ color: '#bbb', fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...leftGreen }}>
                        {(r.lineItems || []).length
                          ? <button onClick={() => setItems(r)} style={{ ...linkBtn, padding: 0 }}>View items ({r.lineItems.length})</button>
                          : <span style={{ color: '#bbb', fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...((delivered || lastGreen >= 0) ? GREENC : dateCellStyle(r.requiredDeliveryDate)) }}>
                        <input type="date" value={r.requiredDeliveryDate || ''} onChange={e => patch(r.id, { requiredDeliveryDate: e.target.value })} style={{ ...sel, minWidth: 140, padding: '5px 8px', background: 'transparent', border: '1px solid #e0e0e0' }} />
                      </td>
                      <td style={{ ...td, ...stageGreen(1) }}>{yn(r, 'poSent')}</td>
                      <td style={{ ...td, ...stageGreen(2) }}>{yn(r, 'supplierConfirmedDate')}</td>
                      <td style={{ ...td, ...stageGreen(3) }}>{yn(r, 'secondCheck')}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...rowGreen }}>
                        <input type="date" value={r.actualDeliveryDate || ''} onChange={e => setActualDate(r, e.target.value)} style={{ ...sel, minWidth: 140, padding: '5px 8px' }} />
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', ...rowGreen }}><ExpandableText value={r.comments} onSave={v => patch(r.id, { comments: v })} label="Comments" width={200} /></td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', ...rowGreen }}>
                        <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                          <RowAttachments files={r.attachments || []} onChange={files => patch(r.id, { attachments: files })} />
                          <button onClick={() => setEdit(r)} style={linkBtn}>Edit</button>
                          <button onClick={() => delRow(r.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
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

      {items && <ItemsModal row={items} onClose={() => setItems(null)} />}
      {addr && <AddressModal row={addr} onClose={() => setAddr(null)} />}
      {edit && <DeliveryModal row={edit} projectOptions={projectOptions} onClose={() => setEdit(null)} onSave={saveRow} />}
    </OperationsShell>
  )
}

function AddressModal({ row, onClose }) {
  return (
    <Modal onClose={onClose} title={`Delivery address — ${row.poNumber || 'PO'}`}>
      <div style={{ fontSize: 15, color: INK, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{row.deliveryAddress || '—'}</div>
      {(row.projectName || row.projectNo) && (
        <div style={{ marginTop: 14, fontSize: 13, color: '#999' }}>{[row.projectNo, row.projectName].filter(Boolean).join(' — ')}</div>
      )}
    </Modal>
  )
}

function ItemsModal({ row, onClose }) {
  return (
    <Modal onClose={onClose} title={`Items — ${row.poNumber || 'PO'}`} wide>
      {(row.lineItems || []).length === 0 ? <div style={{ color: '#999', fontSize: 14 }}>No line items.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#faf9f7' }}><th style={{ ...th, textAlign: 'left' }}>Description</th><th style={{ ...th, textAlign: 'right', width: 90 }}>Qty</th></tr></thead>
          <tbody>
            {row.lineItems.map((li, i) => (
              <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
                <td style={{ ...td, whiteSpace: 'pre-wrap' }}>{li.description || '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{li.quantity ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}

function DeliveryModal({ row, projectOptions, onClose, onSave }) {
  const [f, setF] = useState({ ...row, lineItems: row.lineItems || [] })
  const setProj = (val) => { const [jobNo, name] = val.split('|'); setF({ ...f, projectNo: jobNo, projectName: name }) }
  function addItem() { setF({ ...f, lineItems: [...(f.lineItems || []), { description: '', quantity: '' }] }) }
  function updItem(i, k, v) { const n = [...f.lineItems]; n[i] = { ...n[i], [k]: v }; setF({ ...f, lineItems: n }) }
  function rmItem(i) { setF({ ...f, lineItems: f.lineItems.filter((_, j) => j !== i) }) }
  const isXero = f.source === 'xero'
  return (
    <Modal onClose={onClose} title={f.id ? 'Edit delivery' : 'Add delivery'} wide>
      <Lbl>Project (Xero project name)</Lbl>
      <select value={`${f.projectNo || ''}|${f.projectName || ''}`} onChange={e => setProj(e.target.value)} style={inp2}>
        <option value="|">Select project…</option>
        {projectOptions.map(p => <option key={`${p.jobNo}|${p.name}`} value={`${p.jobNo}|${p.name}`}>{[p.jobNo, p.name].filter(Boolean).join(' — ')}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><Lbl>PO number</Lbl><input value={f.poNumber || ''} onChange={e => setF({ ...f, poNumber: e.target.value })} style={inp2} /></div>
        <div style={{ flex: 1 }}><Lbl>Order date</Lbl><input type="date" value={f.orderDate || ''} onChange={e => setF({ ...f, orderDate: e.target.value })} style={inp2} /></div>
      </div>
      <Lbl>Delivery address</Lbl><textarea value={f.deliveryAddress || ''} onChange={e => setF({ ...f, deliveryAddress: e.target.value })} style={{ ...inp2, minHeight: 48 }} />
      <Lbl>Required delivery date</Lbl><input type="date" value={f.requiredDeliveryDate || ''} onChange={e => setF({ ...f, requiredDeliveryDate: e.target.value })} style={inp2} />

      <Lbl>Line items (description &amp; quantity)</Lbl>
      {isXero && <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>Pulled from Xero. You can adjust if needed.</div>}
      {(f.lineItems || []).map((li, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input value={li.description || ''} onChange={e => updItem(i, 'description', e.target.value)} placeholder="Description" style={{ ...inp2, flex: 1 }} />
          <input value={li.quantity ?? ''} onChange={e => updItem(i, 'quantity', e.target.value)} placeholder="Qty" style={{ ...inp2, width: 80 }} />
          <button onClick={() => rmItem(i)} style={ghostBtn}>×</button>
        </div>
      ))}
      <button onClick={addItem} style={ghostBtn}>+ Add item</button>

      <div style={{ display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
        <label style={ck}><input type="checkbox" checked={!!f.poSent} onChange={e => setF({ ...f, poSent: e.target.checked })} /> PO sent</label>
        <label style={ck}><input type="checkbox" checked={!!f.supplierConfirmedDate} onChange={e => setF({ ...f, supplierConfirmedDate: e.target.checked })} /> Supplier confirmed date</label>
        <label style={ck}><input type="checkbox" checked={!!f.secondCheck} onChange={e => setF({ ...f, secondCheck: e.target.checked })} /> 2nd check</label>
      </div>
      <Lbl>Actual delivery date</Lbl><input type="date" value={f.actualDeliveryDate || ''} onChange={e => setF({ ...f, actualDeliveryDate: e.target.value })} style={inp2} />
      <Lbl>Comments</Lbl><textarea value={f.comments || ''} onChange={e => setF({ ...f, comments: e.target.value })} style={{ ...inp2, minHeight: 50 }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button onClick={() => onSave(f)} style={primaryBtn}>Save</button>
        <button onClick={onClose} style={ghostBtn}>Cancel</button>
      </div>
    </Modal>
  )
}

const F = ({ label, children }) => <div><div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{label}</div>{children}</div>
const sel = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', minWidth: 140 }
const ck = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }
