import { useState, useEffect, useMemo } from 'react'

// ---------------------------------------------------------------------------
// Variation Builder
// ---------------------------------------------------------------------------
// Builds a variation from its workings and writes it into the SAME place the tracker
// writes: settings.variations, as { varNumber, description, instructed, materials,
// labour, profit }.
//
// That is the whole trick. Every other page already reads those fields, so a variation
// built here flows into the anticipated final account, applications, cash flow, project
// financials and the retention register with no further work. The builder's own detail -
// items, workings, clarifications - rides along on the same record under extra keys that
// nothing else has to know about.

const INK = '#1a1a2e'
const LINE = '#e5e7eb'
const GREEN = '#1c704f'

const n = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x }
const money = (v) => '£' + n(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const todayISO = () => new Date().toISOString().slice(0, 10)

// The clarifications that go on every variation unless somebody removes them.
export const BASE_CLARIFICATIONS = [
  'Attendances: craneage, 110V power, forklift, access, perimeter handrailing, skips, and safety netting by others.',
  'Included for 1 No. continuous visit.',
  'Programme periods to be agreed.',
  'Quantities subject to remeasurement.',
  'All works to be completed from scaffold or the roof. Rates available if working required from a MEWP.',
]

const letter = (i) => String.fromCharCode(97 + i)   // a, b, c...

// ---------------------------------------------------------------------------
// Workings
// ---------------------------------------------------------------------------
// Where the rate actually comes from. Materials and labour are priced line by line, waste
// is added to materials only, and the margin is applied to the lot - which is why the
// variation's "profit" figure is a product of the workings rather than something typed.
function WorkingsModal({ item, onSave, onClose }) {
  const [d, setD] = useState(() => ({
    description: item.description || '',
    qty: item.qty ?? 1,
    unit: item.unit || 'item',
    marginPct: item.marginPct ?? 20,
    materials: item.materials?.length ? item.materials.map(x => ({ ...x })) : [{ description: '', qty: '', rate: '', wastePct: '' }],
    labour: item.labour?.length ? item.labour.map(x => ({ ...x })) : [{ description: '', qty: '', rate: '' }],
  }))
  const [saved, setSaved] = useState(false)

  // Escape closes. A click outside does NOT - there is a lot of typing in here and losing
  // it to a stray click would be the worst thing this window could do.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { onSave(calc(d)); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Auto-save: every change is pushed up, so closing by any route keeps the work.
  useEffect(() => { onSave(calc(d)); setSaved(true); const t = setTimeout(() => setSaved(false), 1200); return () => clearTimeout(t) }, [d])

  const set = (patch) => setD(prev => ({ ...prev, ...patch }))
  const setRow = (kind, i, patch) => setD(prev => ({
    ...prev, [kind]: prev[kind].map((r, ix) => ix === i ? { ...r, ...patch } : r),
  }))
  const addRow = (kind) => setD(prev => ({
    ...prev, [kind]: [...prev[kind], kind === 'materials' ? { description: '', qty: '', rate: '', wastePct: '' } : { description: '', qty: '', rate: '' }],
  }))
  const delRow = (kind, i) => setD(prev => ({ ...prev, [kind]: prev[kind].filter((_, ix) => ix !== i) }))

  const t = calc(d)

  const inp = { padding: '5px 7px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 12.5, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }
  const th = { padding: '6px 8px', fontSize: 10.5, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', textAlign: 'left', letterSpacing: 0.3 }
  const td = { padding: '4px 6px', verticalAlign: 'top' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 800, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: 1080, maxWidth: '100%', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: '0 0 2px', fontSize: 18 }}>Workings</h3>
            <div style={{ fontSize: 12.5, color: '#888' }}>Price the item up. The rate on the variation is worked out from what you enter here.</div>
          </div>
          <button onClick={() => { onSave(t); onClose() }} title="Close - your workings are saved"
            style={{ background: 'none', border: `1px solid ${LINE}`, borderRadius: 8, width: 34, height: 34, fontSize: 22, lineHeight: 1, color: '#6b7280', cursor: 'pointer' }}>&times;</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px 110px', gap: 10, marginTop: 16, alignItems: 'end' }}>
          <div>
            <div style={th}>Description (shows on the variation)</div>
            <input value={d.description} onChange={e => set({ description: e.target.value })} style={inp} placeholder="e.g. Additional VCL to plant deck" />
          </div>
          <div><div style={th}>Quantity</div><input type="number" value={d.qty} onChange={e => set({ qty: e.target.value })} style={inp} /></div>
          <div><div style={th}>Unit</div><input value={d.unit} onChange={e => set({ unit: e.target.value })} style={inp} placeholder="m2 / item / no." /></div>
          <div><div style={th}>Margin %</div><input type="number" value={d.marginPct} onChange={e => set({ marginPct: e.target.value })} style={inp} /></div>
        </div>

        {[['materials', 'Materials', true], ['labour', 'Labour', false]].map(([kind, label, hasWaste]) => (
          <div key={kind} style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{label}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{money(kind === 'materials' ? t.materialsTotal : t.labourTotal)}</div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ ...th, width: '46%' }}>Description</th>
                <th style={{ ...th, width: 90 }}>Qty</th>
                <th style={{ ...th, width: 110 }}>Rate</th>
                {hasWaste && <th style={{ ...th, width: 90 }}>Waste %</th>}
                <th style={{ ...th, width: 110, textAlign: 'right' }}>Total</th>
                <th style={{ ...th, width: 34 }}></th>
              </tr></thead>
              <tbody>
                {d[kind].map((r, i) => {
                  const base = n(r.qty) * n(r.rate)
                  const tot = hasWaste ? base * (1 + n(r.wastePct) / 100) : base
                  return (
                    <tr key={i}>
                      <td style={td}><input value={r.description} onChange={e => setRow(kind, i, { description: e.target.value })} style={inp} /></td>
                      <td style={td}><input type="number" value={r.qty} onChange={e => setRow(kind, i, { qty: e.target.value })} style={inp} /></td>
                      <td style={td}><input type="number" value={r.rate} onChange={e => setRow(kind, i, { rate: e.target.value })} style={inp} /></td>
                      {hasWaste && <td style={td}><input type="number" value={r.wastePct} onChange={e => setRow(kind, i, { wastePct: e.target.value })} style={inp} placeholder="0" /></td>}
                      <td style={{ ...td, textAlign: 'right', fontSize: 12.5, paddingTop: 10, fontWeight: 600 }}>{money(tot)}</td>
                      <td style={td}>
                        <button onClick={() => delRow(kind, i)} title="Remove"
                          style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 15, padding: '4px 0' }}>&times;</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <button onClick={() => addRow(kind)}
              style={{ marginTop: 4, background: 'none', border: 'none', color: '#2563eb', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
              + Add {label.toLowerCase()} line
            </button>
          </div>
        ))}

        <div style={{ marginTop: 18, padding: '12px 14px', background: '#f8f9fa', borderRadius: 10, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {[
            ['Materials (incl. waste)', t.materialsTotal],
            ['Labour', t.labourTotal],
            [`Margin @ ${n(d.marginPct)}%`, t.profit],
            ['Item total', t.total],
            [`Rate per ${d.unit || 'unit'}`, t.rate],
          ].map(([l, v], i) => (
            <div key={l}>
              <div style={{ fontSize: 10.5, color: '#888' }}>{l}</div>
              <div style={{ fontSize: i >= 3 ? 15 : 13.5, fontWeight: 700, color: i >= 3 ? GREEN : INK }}>{money(v)}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 12, color: saved ? GREEN : '#aaa' }}>{saved ? 'Saved' : 'Saves as you type'}</span>
          <button onClick={() => { onSave(t); onClose() }}
            style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
            Save &amp; close
          </button>
        </div>
      </div>
    </div>
  )
}

// The sums, in one place so the modal and the variation total cannot disagree.
// Waste applies to MATERIALS ONLY - it is wasted material, not wasted time - and the
// margin applies to materials and labour together.
export function calc(d) {
  const materialsTotal = (d.materials || []).reduce((s, r) => s + (n(r.qty) * n(r.rate)) * (1 + n(r.wastePct) / 100), 0)
  const labourTotal = (d.labour || []).reduce((s, r) => s + n(r.qty) * n(r.rate), 0)
  const cost = materialsTotal + labourTotal
  const m = n(d.marginPct) / 100
  // Margin ON THE SELL, not a mark-up on cost: 20% margin means 20% of the final figure,
  // which is how margin is treated everywhere else in the portal.
  const total = m > 0 && m < 1 ? cost / (1 - m) : cost
  const profit = total - cost
  const qty = n(d.qty) || 1
  return {
    ...d,
    materialsTotal, labourTotal, profit, total,
    rate: total / qty,
  }
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------
export default function VariationBuilder({ projects, onSaved }) {
  const [projectId, setProjectId] = useState('')
  const [header, setHeader] = useState({ varNumber: '', date: todayISO(), requestedBy: '', description: '' })
  const [items, setItems] = useState([])
  const [clar, setClar] = useState(BASE_CLARIFICATIONS.slice())
  const [editing, setEditing] = useState(null)   // index into items
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const project = useMemo(() => (projects || []).find(p => String(p.xeroId) === String(projectId)) || null, [projects, projectId])

  // Next number from the LAST variation on this project, whether it was built here or
  // added straight to the tracker - variations do not have to come through the builder.
  useEffect(() => {
    if (!project) return
    const vars = project.variations || project.settings?.variations || []
    const nums = vars.map(v => parseInt(String(v.varNumber || '').replace(/[^0-9]/g, ''))).filter(x => !isNaN(x))
    const next = (nums.length ? Math.max(...nums) : 0) + 1
    setHeader(h => ({ ...h, varNumber: `V${String(next).padStart(2, '0')}` }))
  }, [project])

  const totals = useMemo(() => items.reduce((a, it) => ({
    materials: a.materials + n(it.materialsTotal),
    labour: a.labour + n(it.labourTotal),
    profit: a.profit + n(it.profit),
    total: a.total + n(it.total),
  }), { materials: 0, labour: 0, profit: 0, total: 0 }), [items])

  function addItem() {
    setItems(prev => [...prev, calc({ description: '', qty: 1, unit: 'item', marginPct: 20, materials: [], labour: [] })])
    setEditing(items.length)
  }

  async function save() {
    if (!project) { setMsg('Pick a project first.'); return }
    if (!items.length) { setMsg('Add at least one item.'); return }
    setSaving(true); setMsg('')
    try {
      const settings = project.settings || {}
      const existing = Array.isArray(settings.variations) ? settings.variations : []
      const record = {
        // The four fields every other page reads. Everything downstream - the anticipated
        // final account, applications, cash flow, project financials, retention - works
        // off these and needs no knowledge of the builder.
        varNumber: header.varNumber,
        description: header.description || (items[0]?.description || ''),
        instructed: 'no',
        materials: String(Math.round(totals.materials * 100) / 100),
        labour: String(Math.round(totals.labour * 100) / 100),
        profit: String(Math.round(totals.profit * 100) / 100),
        // The builder's own detail, carried on the same record.
        builder: {
          date: header.date,
          requestedBy: header.requestedBy,
          subContractRef: settings.subContractRef || settings.subcontractRef || '',
          items, clarifications: clar,
          builtAt: Date.now(),
        },
      }
      const r = await fetch(`/api/project/${project.xeroId}/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, variations: [...existing, record] }),
      })
      if (!r.ok) throw new Error('Save failed')
      setMsg(`${header.varNumber} raised on ${project.jobNo || project.name}. It is now on the tracker and in the final account.`)
      setItems([]); setHeader(h => ({ ...h, description: '', requestedBy: '' }))
      setClar(BASE_CLARIFICATIONS.slice())
      if (onSaved) await onSaved()
    } catch (e) { setMsg(`Could not save: ${e.message || ''}`.trim()) }
    setSaving(false)
  }

  const inp = { padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 7, fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }
  const lbl = { fontSize: 11, color: '#888', marginBottom: 3, fontWeight: 600 }
  const th = { padding: '8px 10px', fontSize: 10.5, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', textAlign: 'left', letterSpacing: 0.3 }
  const td = { padding: '8px 10px', fontSize: 13, borderTop: `1px solid ${LINE}` }

  // Customers to pick from: the project's own contacts, from the handover.
  const customerOptions = useMemo(() => {
    const s = project?.settings || {}
    return [s.customerName, s.qsName, s.customerContact, s.siteContact].filter(Boolean)
  }, [project])

  return (
    <div>
      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
        <div style={lbl}>Project</div>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); setItems([]); setMsg('') }}
          style={{ ...inp, maxWidth: 520 }}>
          <option value="">Select a project…</option>
          {(projects || []).map(p => (
            <option key={p.xeroId} value={p.xeroId}>{[p.jobNo, p.name].filter(Boolean).join(' — ')}</option>
          ))}
        </select>
      </div>

      {!project ? (
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 40, textAlign: 'center', color: '#888', fontSize: 13.5 }}>
          Pick a project to start building a variation.
        </div>
      ) : (
        <>
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div><div style={lbl}>Project</div><div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{[project.jobNo, project.name].filter(Boolean).join(' — ')}</div></div>
              <div><div style={lbl}>Sub-Contract Ref</div><div style={{ fontSize: 13.5, color: INK }}>{project.settings?.subContractRef || project.settings?.subcontractRef || <span style={{ color: '#c2410c' }}>not set in Project Details</span>}</div></div>
              <div><div style={lbl}>Variation No.</div><input value={header.varNumber} onChange={e => setHeader({ ...header, varNumber: e.target.value })} style={{ ...inp, fontWeight: 700 }} /></div>
              <div><div style={lbl}>Date</div><input type="date" value={header.date} onChange={e => setHeader({ ...header, date: e.target.value })} style={inp} /></div>
              <div>
                <div style={lbl}>Requested by</div>
                <input list="var-customers" value={header.requestedBy} onChange={e => setHeader({ ...header, requestedBy: e.target.value })} style={inp} placeholder="Customer name" />
                <datalist id="var-customers">{customerOptions.map(c => <option key={c} value={c} />)}</datalist>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={lbl}>Variation Description</div>
              <input value={header.description} onChange={e => setHeader({ ...header, description: e.target.value })} style={inp} placeholder="What this variation is for" />
            </div>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ ...th, width: 60 }}>Item</th>
                <th style={th}>Description</th>
                <th style={{ ...th, width: 90 }}>Quantity</th>
                <th style={{ ...th, width: 80 }}>Unit</th>
                <th style={{ ...th, width: 120, textAlign: 'right' }}>Rate</th>
                <th style={{ ...th, width: 130, textAlign: 'right' }}>Total</th>
                <th style={{ ...th, width: 120 }}></th>
              </tr></thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={7} style={{ ...td, color: '#aaa', textAlign: 'center', padding: 24 }}>No items yet.</td></tr>
                )}
                {items.map((it, i) => (
                  <tr key={i}>
                    <td style={{ ...td, fontWeight: 700, color: '#dc2626' }}>{i + 1}</td>
                    <td style={td}>{it.description || <span style={{ color: '#c2410c' }}>no description - open the workings</span>}</td>
                    <td style={td}>{n(it.qty)}</td>
                    <td style={td}>{it.unit}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{money(it.rate)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{money(it.total)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button onClick={() => setEditing(i)} style={{ background: 'none', border: `1px solid ${LINE}`, borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer', color: '#333' }}>Workings</button>
                      <button onClick={() => setItems(prev => prev.filter((_, ix) => ix !== i))} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12, marginLeft: 6 }}>Remove</button>
                    </td>
                  </tr>
                ))}
                {items.length > 0 && (
                  <tr style={{ background: '#f8f9fa' }}>
                    <td style={{ ...td, fontWeight: 800 }} colSpan={5}>Total</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 800, fontSize: 15 }}>{money(totals.total)}</td>
                    <td style={td}></td>
                  </tr>
                )}
              </tbody>
            </table>
            <div style={{ padding: 10, borderTop: `1px solid ${LINE}` }}>
              <button onClick={addItem}
                style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ Add item</button>
              {items.length > 0 && (
                <span style={{ fontSize: 12, color: '#888', marginLeft: 12 }}>
                  materials {money(totals.materials)} · labour {money(totals.labour)} · profit {money(totals.profit)}
                </span>
              )}
            </div>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 8 }}>Clarifications</div>
            {clar.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#dc2626', width: 16, paddingTop: 7 }}>{letter(i)}</span>
                <textarea value={c} rows={1} onChange={e => setClar(prev => prev.map((x, ix) => ix === i ? e.target.value : x))}
                  style={{ ...inp, resize: 'vertical', fontSize: 12.5 }} />
                <button onClick={() => setClar(prev => prev.filter((_, ix) => ix !== i))} title="Remove"
                  style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16, paddingTop: 4 }}>&times;</button>
              </div>
            ))}
            <button onClick={() => setClar(prev => [...prev, ''])}
              style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>+ Add new…</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
            {msg && <span style={{ fontSize: 13, color: msg.startsWith('Could not') ? '#dc2626' : GREEN }}>{msg}</span>}
            <button onClick={save} disabled={saving}
              style={{ background: INK, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Raise variation'}
            </button>
          </div>
        </>
      )}

      {editing != null && items[editing] && (
        <WorkingsModal
          item={items[editing]}
          onSave={(v) => setItems(prev => prev.map((x, i) => i === editing ? v : x))}
          onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
