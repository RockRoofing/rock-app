import { useState, useEffect, useMemo } from 'react'
import { projectVariations } from '../lib/variationInstruct'

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
  // WHAT AN ITEM NEEDS BEFORE IT CAN LEAVE THIS WINDOW.
  //
  // Every one of these ends up on a document going to a customer. A line with no
  // description, no quantity or no unit is not a priced item, and an item with neither
  // materials nor labour behind it is priced from nothing.
  const priced = (rows) => (rows || []).some(r => n(r.qty) > 0 && n(r.rate) > 0)
  const missing = []
  if (!String(d.description || '').trim()) missing.push('a description')
  if (!(n(d.qty) > 0)) missing.push('a quantity')
  if (!d.unit) missing.push('a unit')
  if (d.markupPct === '' || d.markupPct == null || isNaN(parseFloat(d.markupPct))) missing.push('a mark-up %')
  if (!priced(d.materials) && !priced(d.labour)) missing.push('at least one materials or labour line')
  const needsMarkup = d.markupPct === '' || d.markupPct == null || isNaN(parseFloat(d.markupPct))
  const incomplete = missing.length > 0

  const tryClose = () => {
    if (incomplete) { alert(`This item still needs ${missing.join(', ')}.`); return }
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
          <span style={{ fontSize: 12, color: incomplete ? '#dc2626' : (saved ? GREEN : '#aaa') }}>
            {incomplete ? `Still needs ${missing.join(', ')}` : (saved ? 'Saved' : 'Saves as you type')}
          </span>
          <button onClick={tryClose} disabled={incomplete}
            title={incomplete ? `Still needs ${missing.join(', ')}` : 'Save and close'}
            style={{ background: incomplete ? '#e5e7eb' : GREEN, color: incomplete ? '#9ca3af' : '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: incomplete ? 'default' : 'pointer' }}>
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
// Exported so Contracted Rates can use the same window. One send flow, so a variation
// raised from the rate schedule goes out looking exactly like one built here - same
// email, same instruct button, same record coming back.
export function SendVariationModal({ project, variation, me, onClose, onSent }) {
  // A chase reads differently from a first send. Sending the same email again and calling
  // it a reminder is how customers stop reading them.
  const alreadySent = !!variation.builder?.firstSentAt
  const contacts = (project.customerContacts || []).filter(c => c.email)
  // ONE recipient. The instruct link is issued to the address it is sent to and the
  // instruction records who clicked it - so "to" has to be one person, or the record says
  // an address rather than a person. Everyone else goes in CC.
  const [to, setTo] = useState(() => contacts[0]?.email || '')
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
  // Who it is addressed to: the first ticked contact's FIRST NAME. "Hi Jack," rather than
  // "Hi," - it is a letter to a person, and the name is one we already hold.
  const firstName = (() => {
    const c = contacts.find(x => x.email === to)
    return String(c?.name || '').trim().split(/\s+/)[0] || ''
  })()

  useEffect(() => {
    setSubject(`${alreadySent ? 'Reminder: ' : ''}Variation ${variation.varNumber} - ${projLabel}`)
    setText(
      `Hi${firstName ? ` ${firstName}` : ''},\n\n`
      + (alreadySent
        ? `Following up on variation ${variation.varNumber} for ${projLabel}, sent on ${new Date(variation.builder.firstSentAt).toLocaleDateString('en-GB')}.\n\n`
          + `We have not yet received your instruction. The variation is attached again for convenience.\n\n`
        : `Please find attached variation ${variation.varNumber} for ${projLabel}.\n\n`)
      + (b.subContractRef ? `Sub-Contract Ref: ${b.subContractRef}\n` : '')
      + (variation.description ? `Description: ${variation.description}\n` : '')
      + `Value: ${money(Number(variation.materials) + Number(variation.labour) + Number(variation.profit))}\n\n`
      + (alreadySent ? `Could you confirm your instruction so we can programme the works.\n\n` : `Please confirm your instruction to proceed.\n\n`)
      // Bolded in the HTML by the send endpoint, which matches on this exact line.
      + `We are unable to proceed without your instruction via the below instruct button.\n\n`
      + `Kind regards\n`
      // The sender's own details, so the customer can pick up the phone rather than
      // hunting for a number or replying and waiting.
      + `${me?.name || ''}\n`
      + `Rock Roofing Limited\n`
      + (me?.phone ? `${me.phone}\n` : '')
      + (me?.email ? `${me.email}\n` : '')
    )
  }, [variation, firstName, me])

  const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter(x => x !== v) : [...list, v])

  async function send() {
    const typed = extra.split(/[,;\s]+/).filter(x => x.includes('@'))
    const all = [to, ...typed].filter(Boolean)
    if (!all.length) { setErr('Pick who is instructing this.'); return }
    if (all.length > 1) { setErr('Only one person can be in To - put the others in Copy in.'); return }
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
          subject, text, reminder: alreadySent,
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
            <h3 style={{ margin: '0 0 2px', fontSize: 18 }}>{alreadySent ? 'Send reminder' : 'Send'} {variation.varNumber}</h3>
            <div style={{ fontSize: 12.5, color: '#888' }}>{projLabel} · the PDF is attached automatically</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${LINE}`, borderRadius: 8, width: 34, height: 34, fontSize: 22, lineHeight: 1, color: '#6b7280', cursor: 'pointer' }}>&times;</button>
        </div>

        <div style={hdr}>To - who instructs it</div>
        {contacts.length === 0 && <div style={{ fontSize: 12.5, color: '#c2410c' }}>No customer contacts with an email on this project&rsquo;s handover. Type an address below.</div>}
        {contacts.length > 0 && (
          <select value={to} onChange={e => setTo(e.target.value)} style={inp}>
            <option value="">Select…</option>
            {contacts.map(c => <option key={c.email} value={c.email}>{c.name}{c.title ? ` (${c.title})` : ''} — {c.email}</option>)}
          </select>
        )}
        <input value={extra} onChange={e => setExtra(e.target.value)} placeholder={contacts.length ? 'Or type a different address' : 'Their email address'} style={{ ...inp, marginTop: 6 }} />
        <div style={{ fontSize: 11.5, color: '#888', marginTop: 4 }}>
          One person. The instruct link is issued to this address and the instruction records who used it.
        </div>

        <div style={hdr}>Copy in</div>
        <div style={{ fontSize: 11.5, color: '#888', marginBottom: 4 }}>They receive the variation and the instruction when it comes back, but cannot instruct it.</div>
        {contacts.filter(c => c.email !== to).length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 3 }}>Customer</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
              {contacts.filter(c => c.email !== to).map(c => (
                <label key={c.email} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={cc.includes(c.email)} onChange={() => toggle(cc, setCc, c.email)} />
                  {c.name}{c.title ? ` (${c.title})` : ''}
                </label>
              ))}
            </div>
          </>
        )}
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 3 }}>Rock Roofing</div>
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
            {sending ? 'Sending…' : (alreadySent ? 'Send reminder to customer' : 'Send variation')}
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
  const [reqOther, setReqOther] = useState(false)
  const [editingVar, setEditingVar] = useState(null)   // varNumber being edited, or null for new
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

  // Whether the one on screen has already gone out - drives the wording throughout.
  //
  // MUST sit after `project`. useMemo runs its callback during render, so declaring this
  // above the const it reads put `project` in the temporal dead zone and threw a
  // ReferenceError on every render of the builder. It compiled cleanly, because nothing
  // can know at build time that a const declared later would be read earlier.
  const raisedAlreadySent = useMemo(() => {
    const v = projectVariations(project).find(x => String(x.varNumber) === String(editingVar))
    return !!v?.builder?.firstSentAt
  }, [project, editingVar])

  // Everything already raised on this project. Newest first: the one somebody wants is
  // almost always the last one.
  const existingVars = useMemo(() => {
    const vs = projectVariations(project)
    // Newest at the top. Sent variations order by WHEN THEY WENT - which is the order the
    // customer knows them in - and anything not yet sent sits above them, because that is
    // what still needs doing.
    return [...vs].sort((a, b) => {
      const as = a.builder?.firstSentAt || 0, bs = b.builder?.firstSentAt || 0
      if (!as && bs) return -1
      if (as && !bs) return 1
      if (as && bs) return bs - as
      return String(b.varNumber || '').localeCompare(String(a.varNumber || ''), undefined, { numeric: true })
    })
  }, [project])

  // Open one for editing. Everything comes back - items, workings, clarifications - so a
  // draft can be finished later rather than started again.
  function openVariation(v) {
    const b = v.builder || {}
    if (!v.builder) {
      // Raised straight onto the tracker, so there are no items or workings to load.
      // Opening it would show an empty builder and saving would overwrite the figures
      // somebody typed on the tracker with nothing.
      setMsg(`${v.varNumber} was added on the tracker rather than built here, so there are no workings to open. Edit it on the Variation Tracker.`)
      setEditingVar(v.varNumber)
      return
    }
    setEditingVar(v.varNumber)
    setRaised(null)
    setHeader({
      varNumber: v.varNumber || '',
      date: b.date || todayISO(),
      requestedBy: b.requestedBy || '',
      description: v.description || '',
    })
    setItems((b.items || []).map(x => ({ ...x })))
    setClar(b.clarifications?.length ? b.clarifications.slice() : BASE_CLARIFICATIONS.slice())
    setMsg('')
  }

  function newVariation() {
    setEditingVar(null)
    setRaised(null)
    setReqOther(false)
    // The same sent-based number as everywhere else. This had its own copy of the
    // calculation, counting every variation raised - so it disagreed with the header the
    // moment a draft existed.
    setHeader({ varNumber: nextSentLabel, date: todayISO(), requestedBy: '', description: '' })
    setItems([])
    setClar(BASE_CLARIFICATIONS.slice())
    setMsg('')
  }
  // Called orderRef on the record; "Sub-Contract Ref" is the label it prints under.
  const subContractRef = project?.orderRef || project?.settings?.orderRef || project?.settings?.customerOrderRef || ''

  // Next number from the LAST variation on this project, whether it was built here or
  // added straight to the tracker - variations do not have to come through the builder.
  // NUMBERED WHEN IT GOES OUT, not when it is raised.
  //
  // A draft that is never sent used to consume V03 for ever, so the customer's numbering
  // had gaps in it that meant nothing to them. The next number now follows the highest
  // number ACTUALLY SENT, and a draft carries it provisionally until it goes.
  const nextSentNumber = useMemo(() => {
    const vars = projectVariations(project)
    // EVERY variation on the tracker, not just the sent ones.
    //
    // I had this following sends, so an unsent draft did not burn a number. That was
    // wrong: the tracker is the register, and a number that already exists on it cannot
    // be handed out again - two V03s on one project is worse than a gap in the sequence.
    const nums = vars
      .map(v => parseInt(String(v.varNumber || '').replace(/[^0-9]/g, '')))
      .filter(x => !isNaN(x))
    return (nums.length ? Math.max(...nums) : 0) + 1
  }, [project])
  const nextSentLabel = `V${String(nextSentNumber).padStart(2, '0')}`

  // The builder detail of whichever variation is open, so its status can be shown above
  // the form.
  const openVar = useMemo(() => {
    if (!editingVar) return null
    const v = existingVars.find(x => String(x.varNumber) === String(editingVar))
    return v?.builder || null
  }, [existingVars, editingVar])

  useEffect(() => {
    if (!project) return
    setHeader(h => ({ ...h, varNumber: nextSentLabel }))
  }, [project, nextSentLabel])

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

  async function save(forceNumber) {
    if (!project) { setMsg('Pick a project first.'); return false }
    if (!items.length) { setMsg('Add at least one item.'); return false }
    setSaving(true); setMsg('')
    try {
      const settings = project.settings || {}
      // BOTH PLACES. The dashboard returns variations on the project itself; the tracker
      // mirrors them onto settings. This only looked at settings, so on any project where
      // they came back on project.variations `existing` was EMPTY - and saving a new
      // variation wrote a list of one over everything already there.
      //
      // That is why previous variations were disappearing.
      const existing = projectVariations(project)
      // Whoever raised it FIRST stays on it. Editing a variation should not quietly
      // reassign it to whoever happened to open it.
      const prior = existing.find(v => String(v.varNumber) === String(header.varNumber))
      const raisedByExisting = prior?.builder?.raisedBy || null
      const raisedRecordAt = prior?.builder?.raisedAt || null
      const record = {
        // The four fields every other page reads. Everything downstream - the anticipated
        // final account, applications, cash flow, project financials, retention - works
        // off these and needs no knowledge of the builder.
        varNumber: forceNumber || header.varNumber,
        description: header.description || (items[0]?.description || ''),
        instructed: 'no',
        materials: String(Math.round(totals.materials * 100) / 100),
        labour: String(Math.round(totals.labour * 100) / 100),
        profit: String(Math.round(totals.profit * 100) / 100),
        // The builder's own detail, carried on the same record.
        builder: {
          date: header.date,
          requestedBy: header.requestedBy,
          subContractRef: project.orderRef || settings.orderRef || settings.customerOrderRef || '',
          items, clarifications: clar,
          builtAt: Date.now(),
          // Kept on the variation so the document can say who priced it long after the
          // fact - and so it still says the right person if somebody else edits it later.
          raisedAt: (raisedRecordAt || Date.now()),
          raisedBy: raisedByExisting || { name: me?.name || '', email: me?.email || '', phone: me?.phone || '' },
        },
      }
      // Replace when editing, append when new - matched on the variation number, which
      // is what identifies it everywhere else.
      const ix = existing.findIndex(v => String(v.varNumber) === String(record.varNumber))
      const next = ix >= 0
        ? existing.map((v, i) => i === ix ? { ...v, ...record } : v)
        : [...existing, record]
      const r = await fetch(`/api/project/${project.xeroId}/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, variations: next }),
      })
      if (!r.ok) throw new Error('Save failed')
      // Hold on to what was raised. Download and Send need a SAVED variation - the PDF
      // is built server-side from the record, so there is nothing to send until it
      // exists.
      setRaised({ varNumber: record.varNumber, record })
      setMsg(`${header.varNumber} saved on ${project.jobNo || project.name}. It is on the tracker and in the final account.`)
      // The form stays as it is. Clearing it after a save meant an edit you wanted to
      // check, or send, vanished the moment it was written.
      setEditingVar(record.varNumber)
      if (onSaved) await onSaved()
      setSaving(false)
      return true
    } catch (e) { setMsg(`Could not save: ${e.message || ''}`.trim()) }
    setSaving(false)
    return false
  }

  // Save, then open the send window. One action, because a variation that is raised and
  // not sent is a variation the customer does not know about - and the send needs a saved
  // record to build the PDF from.
  async function saveAndSend() {
    // The number is whatever the tracker gave it when it was raised - not reassigned at
    // send time, which would renumber a draft somebody had already referred to.
    const ok = await save()
    if (ok) setSendOpen(true)
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
  // CUSTOMER PEOPLE ONLY. It was also offering the company name and our own QS, which are
  // not people who request a variation - the customer's own contacts from the handover
  // are.
  const customerOptions = useMemo(() => {
    const names = (project?.customerContacts || []).map(c => String(c.name || '').trim()).filter(Boolean)
    return [...new Set(names)]
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
        // Variations already on this project down the left, the one being worked on to the
        // right. Most of the time somebody is here to look at what was sent last month
        // rather than to start something new.
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,260px) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden', position: 'sticky', top: 0 }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${LINE}`, fontSize: 13, fontWeight: 700, color: INK }}>
            Variations on this project
          </div>
          <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
            {existingVars.length === 0 && (
              <div style={{ padding: 16, fontSize: 12.5, color: '#aaa' }}>None yet.</div>
            )}
            {existingVars.map(v => {
              const on = editingVar === v.varNumber
              const val = n(v.materials) + n(v.labour) + n(v.profit)
              const sent = !!v.builder?.sentAt
              return (
                <button key={v.varNumber} onClick={() => openVariation(v)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px',
                    border: 'none', borderBottom: `1px solid ${LINE}`,
                    background: on ? '#eef2ff' : '#fff', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: on ? '#4338ca' : INK }}>
                    {v.varNumber}
                    {/* Three states, not two. A variation typed onto the tracker has no
                        workings here, and saying "DRAFT" would suggest it can be opened
                        and finished. */}
                    <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 9, fontSize: 9.5, fontWeight: 700, background: sent ? '#dcfce7' : (v.builder ? '#fef9c3' : '#f1f5f9'), color: sent ? '#166534' : (v.builder ? '#a16207' : '#64748b') }}>
                      {sent ? 'SENT' : (v.builder ? 'DRAFT' : 'TRACKER')}
                    </span>
                    {v.instructed === 'yes' && (
                      <span style={{ marginLeft: 4, padding: '1px 6px', borderRadius: 9, fontSize: 9.5, fontWeight: 700, background: '#dbeafe', color: '#1d4ed8' }}>INSTRUCTED</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#666', marginTop: 2, wordBreak: 'break-word' }}>{v.description || 'no description'}</div>
                  <div style={{ fontSize: 11.5, color: '#888', marginTop: 2 }}>{money(val)}</div>
                </button>
              )
            })}
          </div>
          <div style={{ padding: 10, borderTop: `1px solid ${LINE}` }}>
            <button onClick={newVariation}
              style={{ width: '100%', background: INK, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + Raise new variation
            </button>
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          {/* The status of the one being worked on: raised by whom, sent when, instructed
              by whom. It was only visible on the tracker, which meant opening a second
              page to answer "have they come back on this yet". */}
          {openVar && (
            <div style={{
              background: openVar.instruction ? '#f0fdf4' : (openVar.firstSentAt ? '#fffbeb' : '#f8f9fa'),
              border: `1px solid ${openVar.instruction ? '#a7f3d0' : (openVar.firstSentAt ? '#fde68a' : LINE)}`,
              borderRadius: 10, padding: '12px 14px', marginBottom: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.3, color: openVar.instruction ? '#15803d' : (openVar.firstSentAt ? '#92400e' : '#666') }}>
                  {openVar.instruction ? 'INSTRUCTED' : (openVar.firstSentAt ? 'SENT — NOT YET INSTRUCTED' : 'DRAFT — NOT SENT')}
                </div>
                <button onClick={() => downloadPdf(header.varNumber)}
                  style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                  Download PDF
                </button>
              </div>
              {openVar.instruction && (
                <div style={{ fontSize: 12.5, color: INK, marginTop: 5, lineHeight: 1.7 }}>
                  <strong>{[openVar.instruction.byName, openVar.instruction.byRole, openVar.instruction.byCompany].filter(Boolean).join(', ')}</strong>
                  <div style={{ color: '#555' }}>
                    {new Date(openVar.instruction.at).toLocaleString('en-GB')}
                    {openVar.instruction.byEmail ? ` · via the link sent to ${openVar.instruction.byEmail}` : ''}
                  </div>
                </div>
              )}
              {!openVar.instruction && openVar.firstSentAt && (
                <div style={{ fontSize: 12.5, color: '#92400e', marginTop: 4 }}>
                  Sent {new Date(openVar.firstSentAt).toLocaleDateString('en-GB')} to {(openVar.sentTo || []).join(', ')}
                  {openVar.reminderSentAt ? `, chased ${new Date(openVar.reminderSentAt).toLocaleDateString('en-GB')}` : ''}.
                </div>
              )}
              <div style={{ fontSize: 11.5, color: '#666', marginTop: 8 }}>
                Raised {openVar.raisedAt ? new Date(openVar.raisedAt).toLocaleString('en-GB') : '—'}
                {openVar.raisedBy?.name ? ` by ${openVar.raisedBy.name}` : ''}
              </div>
            </div>
          )}

          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div><div style={lbl}>Project</div><div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{[project.jobNo, project.name].filter(Boolean).join(' — ')}</div></div>
              <div><div style={lbl}>Sub-Contract Ref</div><div style={{ fontSize: 13.5, color: INK }}>{subContractRef || <span style={{ color: '#c2410c' }}>not set on the handover</span>}</div></div>
              <div>
                <div style={lbl}>Variation No.</div>
                <input value={header.varNumber} onChange={e => setHeader({ ...header, varNumber: e.target.value })} style={{ ...inp, fontWeight: 700 }} />
                <div style={{ fontSize: 10.5, color: '#888', marginTop: 2 }}>Next number on the tracker for this project.</div>
              </div>
              <div><div style={lbl}>Date</div><input type="date" value={header.date} onChange={e => setHeader({ ...header, date: e.target.value })} style={inp} /></div>
              <div>
                <div style={lbl}>Requested by</div>
                {/* A real dropdown, with one option that opens a text box. A datalist
                    looked like a text field and hid the names behind it, so nobody used
                    them - but somebody who is not on the handover still has to be
                    enterable. */}
                {reqOther ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input autoFocus value={header.requestedBy} onChange={e => setHeader({ ...header, requestedBy: e.target.value })} style={inp} placeholder="Name" />
                    {customerOptions.length > 0 && (
                      <button onClick={() => { setReqOther(false); setHeader({ ...header, requestedBy: '' }) }}
                        title="Back to the list"
                        style={{ background: 'none', border: `1px solid ${LINE}`, borderRadius: 7, padding: '0 10px', fontSize: 12, cursor: 'pointer', color: '#666' }}>list</button>
                    )}
                  </div>
                ) : (
                  <select value={header.requestedBy}
                    onChange={e => { if (e.target.value === '__other') { setReqOther(true); setHeader({ ...header, requestedBy: '' }) } else setHeader({ ...header, requestedBy: e.target.value }) }}
                    style={inp}>
                    <option value="">{customerOptions.length ? 'Select…' : 'No customer contacts on the handover'}</option>
                    {customerOptions.map(c => <option key={c} value={c}>{c}</option>)}
                    <option value="__other">Someone else…</option>
                  </select>
                )}
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
            <button onClick={saveAndSend} disabled={saving}
              style={{ background: INK, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : (raisedAlreadySent ? 'Save & send reminder to customer' : (editingVar ? 'Save & send to customer' : 'Raise & send to customer'))}
            </button>
          </div>
        </div>
        </div>
      )}

      {sendOpen && raised && (
        <SendVariationModal project={project} variation={raised.record} me={me}
          onClose={() => setSendOpen(false)}
          onSent={async (m) => {
            setSendOpen(false)
            // Refresh first, so the variation just sent is on the list with its SENT badge
            // and its number counts towards the next one.
            if (onSaved) await onSaved()
            // Then a clean sheet. Leaving the sent variation on screen is what let a
            // second Save turn it into the next variation instead of raising a new one.
            newVariation()
            setMsg(`${m} Ready for the next variation.`)
          }} />
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
