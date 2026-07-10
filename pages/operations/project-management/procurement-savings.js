import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, th, td, Loading, EmptyCard, primaryBtn, ghostBtn, linkBtn } from '../../../components/opsUI'

// Procurement Savings — per-project. Tendered vs buying rates -> savings.
// Tendered Total = Qty x Tendered Rate; Buying Total = Qty x Buying Rate;
// Total Savings = Tendered Total - Buying Total.
const gbp = (n) => (n == null || n === '' || isNaN(n)) ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(Number(n))
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const blankRow = () => ({ supplier: '', qty: '', unit: '', tenderedRate: '', dateProvided: '', buyingRate: '', jmComments: '', buyerComments: '', supplierContact: '' })

export default function ProcurementSavings() {
  const [projects, setProjects] = useState([])
  const [projectNo, setProjectNo] = useState('')
  const [projectName, setProjectName] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingRows, setLoadingRows] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => { (async () => {
    try {
      const p = await fetch('/api/ops-projects').then(r => r.json()).catch(() => ({}))
      setProjects((p.projects || []).map(x => ({ no: x.projectNo, name: x.projectName || x.name || '' })).filter(x => x.no))
    } catch {}
    setLoading(false)
  })() }, [])

  async function selectProject(no) {
    const proj = projects.find(p => p.no === no)
    setProjectNo(no); setProjectName(proj?.name || ''); setNotice(''); setDirty(false)
    if (!no) { setRows([]); return }
    setLoadingRows(true)
    try {
      const d = await fetch(`/api/procurement-savings?projectNo=${encodeURIComponent(no)}`).then(r => r.json())
      setRows(d.rows && d.rows.length ? d.rows : [blankRow()])
    } catch { setRows([blankRow()]) }
    setLoadingRows(false)
  }

  function updateCell(i, key, val) {
    setRows(rs => rs.map((r, idx) => idx === i ? { ...r, [key]: val } : r)); setDirty(true)
  }
  function addRow() { setRows(rs => [...rs, blankRow()]); setDirty(true) }
  function removeRow(i) { setRows(rs => rs.filter((_, idx) => idx !== i)); setDirty(true) }

  async function save() {
    setSaving(true)
    try {
      // strip fully-empty rows on save
      const clean = rows.filter(r => Object.values(r).some(v => v !== '' && v != null))
      await fetch('/api/procurement-savings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, rows: clean }) })
      setRows(clean.length ? clean : [blankRow()])
      setDirty(false); setNotice('Saved.')
      setTimeout(() => setNotice(''), 2500)
    } catch { setNotice('Could not save.') }
    setSaving(false)
  }

  const totals = useMemo(() => {
    let tendered = 0, buying = 0, savings = 0
    for (const r of rows) {
      const tTotal = num(r.qty) * num(r.tenderedRate)
      const bTotal = num(r.qty) * num(r.buyingRate)
      tendered += tTotal
      if (r.buyingRate !== '' && r.buyingRate != null) { buying += bTotal; savings += (tTotal - bTotal) }
    }
    return { tendered, buying, savings }
  }, [rows])

  return (
    <OperationsShell active="pm:procurement-savings" section="pm" title="Procurement Savings" wide>
      <PageHeading title="Procurement Savings" sub="Per-project tendered vs buying rates and resulting savings. Select a project to view or edit its schedule."
        action={dirty ? <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save changes'}</button> : null} />

      {notice && <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 8, padding: '9px 14px', fontSize: 13, marginBottom: 14 }}>{notice}</div>}

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>Project</div>
          <select value={projectNo} onChange={e => {
            if (dirty && !confirm('You have unsaved changes. Switch project and lose them?')) return
            selectProject(e.target.value)
          }} style={{ padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', minWidth: 280 }}>
            <option value="">Select a project…</option>
            {projects.map(p => <option key={p.no} value={p.no}>{[p.no, p.name].filter(Boolean).join(' — ')}</option>)}
          </select>
        </div>
      </div>

      {loading ? <Loading /> : !projectNo ? (
        <EmptyCard title="Select a project" body="Choose a project above to view or build its procurement savings schedule." />
      ) : loadingRows ? <Loading /> : (
        <>
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1500 }}>
              <thead>
                <tr style={{ background: '#faf9f7' }}>
                  <th style={{ ...th, minWidth: 200 }}>Key Supplier / Rate</th>
                  <th style={{ ...th, width: 80 }}>Qty</th>
                  <th style={{ ...th, width: 70 }}>Unit</th>
                  <th style={{ ...th, width: 120 }}>Tendered Rate</th>
                  <th style={{ ...th, width: 120 }}>Tendered Total</th>
                  <th style={{ ...th, width: 130 }}>Date Rate Provided</th>
                  <th style={{ ...th, width: 120 }}>Buying Rate</th>
                  <th style={{ ...th, width: 120 }}>Buying Total</th>
                  <th style={{ ...th, width: 120 }}>Total Savings</th>
                  <th style={{ ...th, minWidth: 160 }}>JM Comments</th>
                  <th style={{ ...th, minWidth: 160 }}>Buyer Comments</th>
                  <th style={{ ...th, minWidth: 180 }}>Supplier Contact</th>
                  <th style={{ ...th, width: 50 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const tTotal = num(r.qty) * num(r.tenderedRate)
                  const hasBuying = r.buyingRate !== '' && r.buyingRate != null
                  const bTotal = num(r.qty) * num(r.buyingRate)
                  const savings = hasBuying ? tTotal - bTotal : null
                  return (
                    <tr key={i} style={{ borderTop: '1px solid #f0f0f0', verticalAlign: 'middle' }}>
                      <td style={td}><input value={r.supplier || ''} onChange={e => updateCell(i, 'supplier', e.target.value)} style={cell} placeholder="Supplier / rate" /></td>
                      <td style={td}><input value={r.qty ?? ''} onChange={e => updateCell(i, 'qty', e.target.value)} style={{ ...cell, textAlign: 'right' }} inputMode="decimal" /></td>
                      <td style={td}><input value={r.unit || ''} onChange={e => updateCell(i, 'unit', e.target.value)} style={cell} placeholder="item / m2" /></td>
                      <td style={td}><input value={r.tenderedRate ?? ''} onChange={e => updateCell(i, 'tenderedRate', e.target.value)} style={{ ...cell, textAlign: 'right' }} inputMode="decimal" /></td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{gbp(tTotal)}</td>
                      <td style={td}><input type="date" value={r.dateProvided || ''} onChange={e => updateCell(i, 'dateProvided', e.target.value)} style={cell} /></td>
                      <td style={td}><input value={r.buyingRate ?? ''} onChange={e => updateCell(i, 'buyingRate', e.target.value)} style={{ ...cell, textAlign: 'right' }} inputMode="decimal" /></td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{hasBuying ? gbp(bTotal) : '—'}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: savings == null ? '#bbb' : savings >= 0 ? '#16a34a' : '#dc2626' }}>{savings == null ? '—' : gbp(savings)}</td>
                      <td style={td}><textarea value={r.jmComments || ''} onChange={e => updateCell(i, 'jmComments', e.target.value)} style={{ ...cell, minHeight: 34, resize: 'vertical' }} /></td>
                      <td style={td}><textarea value={r.buyerComments || ''} onChange={e => updateCell(i, 'buyerComments', e.target.value)} style={{ ...cell, minHeight: 34, resize: 'vertical' }} /></td>
                      <td style={td}><textarea value={r.supplierContact || ''} onChange={e => updateCell(i, 'supplierContact', e.target.value)} style={{ ...cell, minHeight: 34, resize: 'vertical' }} /></td>
                      <td style={{ ...td, textAlign: 'center' }}><button onClick={() => removeRow(i)} style={{ ...linkBtn, color: '#dc2626' }} title="Remove row">×</button></td>
                    </tr>
                  )
                })}
                <tr style={{ background: '#faf9f7', borderTop: '2px solid #e5e5e5' }}>
                  <td style={{ ...td, fontWeight: 700, color: INK }} colSpan={4}>TOTALS</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{gbp(totals.tendered)}</td>
                  <td style={td}></td>
                  <td style={td}></td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{gbp(totals.buying)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: totals.savings >= 0 ? '#16a34a' : '#dc2626' }}>{gbp(totals.savings)}</td>
                  <td style={td} colSpan={4}></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
            <button onClick={addRow} style={ghostBtn}>+ Add row</button>
            {dirty && <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save changes'}</button>}
            {dirty && <span style={{ fontSize: 12, color: '#dc2626' }}>Unsaved changes</span>}
          </div>
        </>
      )}
    </OperationsShell>
  )
}

const cell = { width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #eee', borderRadius: 6, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }
