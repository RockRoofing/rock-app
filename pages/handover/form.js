import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import PreContractNav from '../../components/PreContractNav'
import { INK, GOLD, Lbl, inp2, primaryBtn, ghostBtn, Loading } from '../../components/opsUI'
import { IHM_SECTIONS, CONTACT_ROLES, emptyRoofType } from '../../lib/ihmSchema'

function Wrap({ children }) {
  return (
    <>
      <Head><title>Rock Roofing — Internal Handover</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        <PreContractNav active="handover" />
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>{children}</div>
      </div>
    </>
  )
}

export default function Handover() {
  const router = useRouter()
  const { no } = router.query   // editing an existing project?
  const [data, setData] = useState({ siteContacts: [], manufacturerContacts: [], roofTypes: [emptyRoofType()], risks: [] })
  const [status, setStatus] = useState('draft')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [openSection, setOpenSection] = useState('project')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!no) {
      // New handover — suggest the next J-number after the highest existing one.
      ;(async () => {
        try {
          const r = await fetch('/api/ops-projects')
          const d = await r.json()
          let maxNum = 0
          for (const p of (d.projects || [])) {
            const m = /^J(\d+)$/i.exec((p.projectNo || '').trim())
            if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10))
          }
          const next = 'J' + (maxNum + 1)
          setData(d0 => ({ ...d0, projectNo: d0.projectNo || next }))
        } catch {}
      })()
      return
    }
    setLoading(true)
    ;(async () => {
      try {
        const r = await fetch(`/api/ops-projects?no=${no}`)
        const d = await r.json()
        if (d.project) {
          setData({
            siteContacts: [], manufacturerContacts: [], roofTypes: [emptyRoofType()], risks: [],
            ...d.project.data,
          })
          setStatus(d.project.status || 'active')
        }
      } catch {}
      setLoading(false)
    })()
  }, [no])

  function set(id, val) { setData(d => ({ ...d, [id]: val })); setErr('') }

  async function save(finalise) {
    setErr('')
    if (!data.projectNo?.trim() || !data.projectName?.trim()) {
      setErr('Project Name and RR Project Number are required.')
      setOpenSection('project')
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/ops-projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: data, status: finalise ? 'active' : 'draft' }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Could not save'); setSaving(false); return }
      router.push("/handover")
    } catch { setErr('Could not save'); setSaving(false) }
  }

  if (loading) return <Wrap><Loading /></Wrap>

  return (
    <Wrap>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <button onClick={() => router.push("/handover")} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }}>‹ All handovers</button>
      </div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: INK }}>{no ? `Internal Handover — ${no}` : 'New Internal Handover'}</h1>
        <div style={{ color: '#999', fontSize: 13, marginTop: 2 }}>Completing this creates the operations project</div>
      </div>

      {/* Section accordion */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {IHM_SECTIONS.map(section => {
          const isOpen = openSection === section.id
          return (
            <div key={section.id} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden' }}>
              <button onClick={() => setOpenSection(isOpen ? '' : section.id)} style={{
                width: '100%', textAlign: 'left', background: isOpen ? '#fffbeb' : '#fff', border: 'none',
                padding: '14px 18px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: 15, fontWeight: 600, color: INK,
              }}>
                <span>{section.title}</span>
                <span style={{ color: GOLD }}>{isOpen ? '−' : '+'}</span>
              </button>
              {isOpen && (
                <div style={{ padding: '4px 18px 20px' }}>
                  {section.fields.map(f => (
                    <FieldRenderer key={f.id} f={f} value={data[f.id]} onChange={v => set(f.id, v)} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: 14, marginTop: 16 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 24, position: 'sticky', bottom: 0, background: '#fafaf9', padding: '12px 0' }}>
        <button onClick={() => save(true)} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : (no ? 'Save changes' : 'Create project')}</button>
        <button onClick={() => save(false)} disabled={saving} style={ghostBtn}>Save as draft</button>
        <button onClick={() => router.push("/handover")} style={ghostBtn}>Cancel</button>
      </div>
    </Wrap>
  )
}

// ── Field renderer ──────────────────────────────────────────────────────────
function FieldRenderer({ f, value, onChange }) {
  if (f.type === 'contacts') return <ContactsField value={value || []} onChange={onChange} />
  if (f.type === 'rooftypes') return <RoofTypesField value={value || []} onChange={onChange} />
  if (f.type === 'risklog') return <RiskLogField value={value || []} onChange={onChange} />

  return (
    <div style={{ margin: '14px 0' }}>
      <Lbl>{f.label}{f.required && <span style={{ color: '#dc2626' }}> *</span>}</Lbl>
      {f.help && <div style={{ fontSize: 12, color: '#aaa', marginTop: -4, marginBottom: 4 }}>{f.help}</div>}
      {f.type === 'long'
        ? <textarea value={value || ''} onChange={e => onChange(e.target.value)} rows={2} style={{ ...inp2, resize: 'vertical' }} />
        : f.type === 'date'
        ? <input type="date" value={value || ''} onChange={e => onChange(e.target.value)} style={inp2} />
        : f.type === 'yesno'
        ? <select value={value || ''} onChange={e => onChange(e.target.value)} style={inp2}>
            <option value="">—</option><option>Yes</option><option>No</option><option>N/A</option><option>TBC</option>
          </select>
        : <input value={value || ''} onChange={e => onChange(e.target.value)} style={inp2} />}
    </div>
  )
}

// Repeatable contact rows: title / name / email / phone
function ContactsField({ value, onChange }) {
  function addRow() { onChange([...value, { title: '', name: '', email: '', phone: '' }]) }
  function update(i, k, v) { const n = [...value]; n[i] = { ...n[i], [k]: v }; onChange(n) }
  function remove(i) { onChange(value.filter((_, j) => j !== i)) }
  return (
    <div style={{ margin: '8px 0' }}>
      {value.map((c, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 1.6fr 1.2fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <input list="contactRoles" value={c.title} onChange={e => update(i, 'title', e.target.value)} placeholder="Title/Role" style={inpSm} />
          <input value={c.name} onChange={e => update(i, 'name', e.target.value)} placeholder="Name" style={inpSm} />
          <input value={c.email} onChange={e => update(i, 'email', e.target.value)} placeholder="Email" style={inpSm} />
          <input value={c.phone} onChange={e => update(i, 'phone', e.target.value)} placeholder="Phone" style={inpSm} />
          <button onClick={() => remove(i)} style={removeBtn}>×</button>
        </div>
      ))}
      <datalist id="contactRoles">{CONTACT_ROLES.map(r => <option key={r} value={r} />)}</datalist>
      <button onClick={addRow} style={addBtn}>+ Add contact</button>
    </div>
  )
}

// Repeatable roof-type spec blocks
function RoofTypesField({ value, onChange }) {
  function addType() { onChange([...value, emptyRoofType()]) }
  function updateType(i, patch) { const n = [...value]; n[i] = { ...n[i], ...patch }; onChange(n) }
  function updateRow(ti, ri, k, v) {
    const n = [...value]; const rows = [...n[ti].rows]; rows[ri] = { ...rows[ri], [k]: v }; n[ti] = { ...n[ti], rows }; onChange(n)
  }
  function removeType(i) { onChange(value.filter((_, j) => j !== i)) }
  return (
    <div style={{ margin: '8px 0' }}>
      {value.map((rt, ti) => (
        <div key={ti} style={{ border: '1px solid #eee', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input value={rt.name} onChange={e => updateType(ti, { name: e.target.value })} placeholder={`Roof Type ${ti + 1} name`} style={{ ...inpSm, flex: 1, fontWeight: 600 }} />
            <input value={rt.substrate} onChange={e => updateType(ti, { substrate: e.target.value })} placeholder="Substrate" style={{ ...inpSm, flex: 1 }} />
            <button onClick={() => removeType(ti)} style={removeBtn}>×</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ color: '#999', textAlign: 'left' }}>
              {['Layer', 'Manufacturer', 'Reference', 'Thickness', 'Calc?'].map(h => <th key={h} style={{ padding: '2px 4px', fontWeight: 600 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rt.rows.map((row, ri) => (
                <tr key={ri}>
                  <td style={{ padding: '2px 4px', color: '#666', whiteSpace: 'nowrap' }}>{row.layer}</td>
                  <td style={{ padding: '2px 4px' }}><input value={row.manufacturer} onChange={e => updateRow(ti, ri, 'manufacturer', e.target.value)} style={inpXs} /></td>
                  <td style={{ padding: '2px 4px' }}><input value={row.reference} onChange={e => updateRow(ti, ri, 'reference', e.target.value)} style={inpXs} /></td>
                  <td style={{ padding: '2px 4px' }}><input value={row.thickness} onChange={e => updateRow(ti, ri, 'thickness', e.target.value)} style={inpXs} /></td>
                  <td style={{ padding: '2px 4px' }}><input value={row.calc} onChange={e => updateRow(ti, ri, 'calc', e.target.value)} style={inpXs} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <button onClick={addType} style={addBtn}>+ Add roof type</button>
    </div>
  )
}

// Repeatable risk / mitigation rows
function RiskLogField({ value, onChange }) {
  function addRow() { onChange([...value, { risk: '', mitigation: '' }]) }
  function update(i, k, v) { const n = [...value]; n[i] = { ...n[i], [k]: v }; onChange(n) }
  function remove(i) { onChange(value.filter((_, j) => j !== i)) }
  return (
    <div style={{ margin: '8px 0' }}>
      {value.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr auto', gap: 8, marginBottom: 8, alignItems: 'start' }}>
          <textarea value={r.risk} onChange={e => update(i, 'risk', e.target.value)} placeholder="Risk" rows={2} style={{ ...inpSm, resize: 'vertical' }} />
          <textarea value={r.mitigation} onChange={e => update(i, 'mitigation', e.target.value)} placeholder="Mitigation" rows={2} style={{ ...inpSm, resize: 'vertical' }} />
          <button onClick={() => remove(i)} style={removeBtn}>×</button>
        </div>
      ))}
      <button onClick={addRow} style={addBtn}>+ Add risk</button>
    </div>
  )
}

const inpSm = { boxSizing: 'border-box', width: '100%', padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13 }
const inpXs = { boxSizing: 'border-box', width: '100%', padding: '5px 7px', border: '1px solid #e8e8e8', borderRadius: 6, fontSize: 12 }
const addBtn = { background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }
const removeBtn = { background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16 }
