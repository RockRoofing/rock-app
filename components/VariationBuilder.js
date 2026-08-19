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

// The only units we price in. A free-text box produced "m2", "M2", "sqm" and "sq m" on
// four lines of the same variation.
const UNITS = ['m2', 'm', 'nr', 'item']

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
    unit: item.unit || '',
    // NO DEFAULT. A mark-up that arrives pre-filled is a mark-up nobody checks, and 20%
    // on a job priced at 30% is money given away without anyone deciding to.
    markupPct: item.markupPct ?? '',
    materials: item.materials?.length ? item.materials.map(x => ({ ...x })) : [{ description: '', qty: '', unit: '', rate: '', wastePct: '' }],
    labour: item.labour?.length ? item.labour.map(x => ({ ...x })) : [{ description: '', qty: '', unit: '', rate: '' }],
  }))
  const [saved, setSaved] = useState(false)

  // Escape closes. A click outside does NOT - there is a lot of typing in here and losing
  // it to a stray click would be the worst thing this window could do.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') tryClose() }
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
    ...prev, [kind]: [...prev[kind], kind === 'materials' ? { description: '', qty: '', unit: '', rate: '', wastePct: '' } : { description: '', qty: '', unit: '', rate: '' }],
  }))
  const delRow = (kind, i) => setD(prev => ({ ...prev, [kind]: prev[kind].filter((_, ix) => ix !== i) }))

  // The mark-up must be entered before this window will close. It is the one number that
  // cannot be inferred from anything else in here, and an item priced at cost is a
  // mistake that reaches the customer.
  const needsMarkup = d.markupPct === '' || d.markupPct == null || isNaN(parseFloat(d.markupPct))
  const tryClose = () => {
    if (needsMarkup) { alert('Enter a mark-up % before closing.\n\nWithout it the item is priced at cost.'); return }
    onSave(calc(d)); onClose()
  }
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
          <button onClick={tryClose} title="Close - your workings are saved"
            style={{ background: 'none', border: `1px solid ${LINE}`, borderRadius: 8, width: 34, height: 34, fontSize: 22, lineHeight: 1, color: '#6b7280', cursor: 'pointer' }}>&times;</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px 110px', gap: 10, marginTop: 16, alignItems: 'end' }}>
          <div>
            <div style={th}>Description (shows on the variation)</div>
            <input value={d.description} onChange={e => set({ description: e.target.value })} style={inp} placeholder="e.g. Additional VCL to plant deck" />
          </div>
          <div><div style={th}>Quantity</div><input type="number" value={d.qty} onChange={e => set({ qty: e.target.value })} style={inp} /></div>
          <div>
            <div style={th}>Unit</div>
            <select value={d.unit} onChange={e => set({ unit: e.target.value })} style={inp}>
              <option value="">-</option>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <div style={th}>Mark-up %</div>
            <input type="number" value={d.markupPct} onChange={e => set({ markupPct: e.target.value })}
              placeholder="required"
              style={{ ...inp, borderColor: needsMarkup ? '#dc2626' : LINE, background: needsMarkup ? '#fef2f2' : '#fff' }} />
          </div>
        </div>

        {[['materials', 'Materials', true], ['labour', 'Labour', false]].map(([kind, label, hasWaste]) => (
          <div key={kind} style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{label}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{money(kind === 'materials' ? t.materialsTotal : t.labourTotal)}</div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ ...th, width: '40%' }}>Description</th>
                <th style={{ ...th, width: 80 }}>Qty</th>
                <th style={{ ...th, width: 80 }}>Unit</th>
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
                      <td style={td}>
                        <select value={r.unit || ''} onChange={e => setRow(kind, i, { unit: e.target.value })} style={inp}>
                          <option value="">-</option>
                          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>
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
            [needsMarkup ? 'Mark-up - not set' : `Mark-up @ ${n(d.markupPct)}%`, t.profit],
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
          <span style={{ fontSize: 12, color: needsMarkup ? '#dc2626' : (saved ? GREEN : '#aaa') }}>
            {needsMarkup ? 'Enter a mark-up % to finish' : (saved ? 'Saved' : 'Saves as you type')}
          </span>
          <button onClick={tryClose} disabled={needsMarkup}
            title={needsMarkup ? 'Enter a mark-up % first' : 'Save and close'}
            style={{ background: needsMarkup ? '#e5e7eb' : GREEN, color: needsMarkup ? '#9ca3af' : '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: needsMarkup ? 'default' : 'pointer' }}>
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
  // MARK-UP ON COST, not margin on the sell. 20% mark-up on £1,000 of cost is £1,200, and
  // the profit in it is 16.7% of the sell - which is a different figure from a 20% margin
  // and the one the estimators work to when pricing a variation.
  const m = n(d.markupPct) / 100
  const total = cost * (1 + m)
  const profit = total - cost
  const qty = n(d.qty) || 1
  return {
    ...d,
    materialsTotal, labourTotal, profit, total,
    rate: total / qty,
  }
}


// Send the variation to the customer, with the PDF attached.
//
// Recipients follow the same idea as the Outstanding Invoices report: the customer's own
// people are offered as tick boxes, the Rock team can be copied, and anything not on
// either list can be typed.
function SendVariationModal({ project, variation, me, onClose, onSent }) {
  const contacts = (project.customerContacts || []).filter(c => c.email)
  const [to, setTo] = useState(() => (contacts[0]?.email ? [contacts[0].email] : []))
  const [cc, setCc] = useState([])
  const [extra, setExtra] = useState('')
  const [team, setTeam] = useState([])
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/portal-auth?action=directory').then(r => r.json())
      .then(d => setTeam((d.users || []).filter(u => u.email)))
      .catch(() => {})
  }, [])

  const b = variation.builder || {}
  const projLabel = [project.jobNo, project.name].filter(Boolean).join(' - ')

  // The email writes itself from the variation, so nobody has to retype the reference,
  // the number and the description - and so every one that goes out says the same things.
  useEffect(() => {
    setSubject(`Variation ${variation.varNumber} - ${projLabel}`)
    setText(
      `Hi,\n\n`
      + `Please find attached variation ${variation.varNumber} for ${projLabel}.\n\n`
      + (b.subContractRef ? `Sub-Contract Ref: ${b.subContractRef}\n` : '')
      + (variation.description ? `Description: ${variation.description}\n` : '')
      + `Value: ${money(Number(variation.materials) + Number(variation.labour) + Number(variation.profit))}\n\n`
      + `Please confirm your instruction to proceed.\n\n`
      + `Kind regards\n${me?.name || ''}`
    )
  }, [variation])

  const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter(x => x !== v) : [...list, v])

  async function send() {
    const all = [...to, ...extra.split(/[,;\s]+/).filter(x => x.includes('@'))]
    if (!all.length) { setErr('Pick at least one recipient.'); return }
    setSending(true); setErr('')
    try {
      const r = await fetch('/api/variation-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.xeroId, varNumber: variation.varNumber,
          to: all, cc,
          // Replies reach the person who sent it. A customer querying a variation has to
          // get back to whoever raised it, not to a sending address nobody reads.
          replyTo: me?.email || '',
          subject, text,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Send failed')
      onSent(`Sent to ${d.sentTo.join(', ')}.`)
    } catch (e) { setErr(e.message || 'Could not send') }
    setSending(false)
  }

  const inp = { padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 7, fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }
  const hdr = { fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.3, margin: '14px 0 6px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 820, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: 720, maxWidth: '100%', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: '0 0 2px', fontSize: 18 }}>Send {variation.varNumber}</h3>
            <div style={{ fontSize: 12.5, color: '#888' }}>{projLabel} · the PDF is attached automatically</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${LINE}`, borderRadius: 8, width: 34, height: 34, fontSize: 22, lineHeight: 1, color: '#6b7280', cursor: 'pointer' }}>&times;</button>
        </div>

        <div style={hdr}>To - customer</div>
        {contacts.length === 0 && <div style={{ fontSize: 12.5, color: '#c2410c' }}>No customer contacts with an email on this project&rsquo;s handover. Type an address below.</div>}
        {contacts.map(c => (
          <label key={c.email} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={to.includes(c.email)} onChange={() => toggle(to, setTo, c.email)} />
            {c.name}{c.title ? ` (${c.title})` : ''} <span style={{ color: '#888' }}>{c.email}</span>
          </label>
        ))}
        <input value={extra} onChange={e => setExtra(e.target.value)} placeholder="Other addresses, comma separated" style={{ ...inp, marginTop: 6 }} />

        <div style={hdr}>Copy in</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxHeight: 110, overflowY: 'auto' }}>
          {team.map(u => (
            <label key={u.email} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={cc.includes(u.email)} onChange={() => toggle(cc, setCc, u.email)} />
              {u.name || u.email}
            </label>
          ))}
        </div>

        <div style={hdr}>Subject</div>
        <input value={subject} onChange={e => setSubject(e.target.value)} style={inp} />
        <div style={hdr}>Message</div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={10} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />

        <div style={{ fontSize: 11.5, color: '#888', marginTop: 8 }}>Replies come back to {me?.email || 'you'}.</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, justifyContent: 'flex-end' }}>
          {err && <span style={{ fontSize: 13, color: '#dc2626' }}>{err}</span>}
          <button onClick={onClose} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={send} disabled={sending}
            style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13.5, fontWeight: 700, cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.6 : 1 }}>
            {sending ? 'Sending…' : 'Send variation'}
          </button>
        </div>
      </div>
    </div>
  )
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
  const [raised, setRaised] = useState(null)     // the variation just saved
  const [sendOpen, setSendOpen] = useState(false)
  const [me, setMe] = useState(null)
  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => setMe(d.user || null)).catch(() => {})
  }, [])

  function downloadPdf(varNumber) {
    // Straight to the endpoint with download=1 - it is a document to file or attach, so a
    // download rather than a tab.
    window.location.href = `/api/variation-send?projectId=${project.xeroId}&varNumber=${encodeURIComponent(varNumber)}&download=1`
  }
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
    // No unit and no mark-up: both must be chosen. Seeding them is what makes a default
    // stick, which is the thing this change was for.
    setItems(prev => [...prev, calc({ description: '', qty: 1, unit: '', markupPct: '', materials: [], labour: [] })])
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
      // Hold on to what was raised. Download and Send need a SAVED variation - the PDF
      // is built server-side from the record, so there is nothing to send until it
      // exists.
      setRaised({ varNumber: record.varNumber, record })
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
  // Who can have asked for this: the customer's own people from the handover, plus the
  // company and the QS. A datalist rather than a select, deliberately - it offers the
  // names we hold AND lets you type somebody we do not, because the person who rang up
  // is not always on the handover.
  const customerOptions = useMemo(() => {
    const st = project?.settings || {}
    const contacts = (project?.customerContacts || []).map(c => c.title ? `${c.name} (${c.title})` : c.name)
    const out = [...contacts, project?.customer, st.customerName, st.qsName, st.customerContact, st.siteContact]
    return [...new Set(out.filter(Boolean).map(x => String(x).trim()))]
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
                <input list="var-customers" value={header.requestedBy} onChange={e => setHeader({ ...header, requestedBy: e.target.value })} style={inp}
                  placeholder={customerOptions.length ? 'Pick one, or type a name' : 'Customer name'} />
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
            {raised && (
              <>
                <button onClick={() => downloadPdf(raised.varNumber)}
                  style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', color: INK }}>
                  Download {raised.varNumber} PDF
                </button>
                <button onClick={() => setSendOpen(true)}
                  style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
                  Send to customer
                </button>
              </>
            )}
            <button onClick={save} disabled={saving}
              style={{ background: INK, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Raise variation'}
            </button>
          </div>
        </>
      )}

      {sendOpen && raised && (
        <SendVariationModal project={project} variation={raised.record} me={me}
          onClose={() => setSendOpen(false)}
          onSent={(m) => { setSendOpen(false); setMsg(m) }} />
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
