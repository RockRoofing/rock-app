import { useState, useEffect, useMemo } from 'react'
import { INK, th, td, Loading, primaryBtn, ghostBtn, linkBtn } from './opsUI'

// Shared, editable Procurement Savings grid for a single project.
// Used by the Projects tab (per-project) and the Pre-Contract page.
// Both read/write the same data via /api/procurement-savings, so edits mirror.
const gbp = (n) => (n == null || n === '' || isNaN(n)) ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(Number(n))
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const hasVal = (v) => v !== '' && v != null
const blankRow = () => ({ supplier: '', qty: '', unit: '', tenderedRate: '', dateProvided: '', buyingRate: '', jmComments: '', buyerComments: '', supplierContact: '' })

export default function ProcurementSavings({ projectNo, projectName }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => { if (projectNo) load() }, [projectNo])
  async function load() {
    setLoading(true); setDirty(false); setNotice('')
    try {
      const d = await fetch(`/api/procurement-savings?projectNo=${encodeURIComponent(projectNo)}`).then(r => r.json())
      setRows(d.rows && d.rows.length ? d.rows : [blankRow()])
    } catch { setRows([blankRow()]) }
    setLoading(false)
  }

  function updateCell(i, key, val) { setRows(rs => rs.map((r, idx) => idx === i ? { ...r, [key]: val } : r)); setDirty(true) }
  function addRow() { setRows(rs => [...rs, blankRow()]); setDirty(true) }
  function removeRow(i) { setRows(rs => rs.filter((_, idx) => idx !== i)); setDirty(true) }

  async function save() {
    setSaving(true)
    try {
      const clean = rows.filter(r => Object.values(r).some(hasVal))
      await fetch('/api/procurement-savings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, rows: clean }) })
      setRows(clean.length ? clean : [blankRow()])
      setDirty(false); setNotice('Saved.'); setTimeout(() => setNotice(''), 2500)
    } catch { setNotice('Could not save.') }
    setSaving(false)
  }

  const totals = useMemo(() => {
    let tendered = 0, buying = 0, savings = 0
    for (const r of rows) {
      const tTotal = num(r.qty) * num(r.tenderedRate)
      const bTotal = num(r.qty) * num(r.buyingRate)
      tendered += tTotal
      if (hasVal(r.buyingRate)) { buying += bTotal; savings += (tTotal - bTotal) }
    }
    return { tendered, buying, savings }
  }, [rows])

  const outstanding = rows.filter(r => (hasVal(r.tenderedRate) || hasVal(r.qty)) && !hasVal(r.buyingRate)).length

  if (loading) return <Loading />

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#666' }}>
          {outstanding > 0
            ? <span style={{ color: '#b45309', fontWeight: 600 }}>⚠ {outstanding} line{outstanding === 1 ? '' : 's'} awaiting a confirmed buying rate</span>
            : <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ All lines have a confirmed buying rate</span>}
        </div>
        <div style={{ flex: 1 }} />
        {notice && <span style={{ fontSize: 13, color: notice === 'Saved.' ? '#16a34a' : '#dc2626' }}>{notice}</span>}
        {dirty && <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save changes'}</button>}
      </div>

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
              const hasBuying = hasVal(r.buyingRate)
              const bTotal = num(r.qty) * num(r.buyingRate)
              const savings = hasBuying ? tTotal - bTotal : null
              const needsBuying = (hasVal(r.tenderedRate) || hasVal(r.qty)) && !hasBuying
              return (
                <tr key={i} style={{ borderTop: '1px solid #f0f0f0', verticalAlign: 'middle', background: needsBuying ? '#fffbeb' : '#fff' }}>
                  <td style={td}><input value={r.supplier || ''} onChange={e => updateCell(i, 'supplier', e.target.value)} style={cell} placeholder="Supplier / rate" /></td>
                  <td style={td}><input value={r.qty ?? ''} onChange={e => updateCell(i, 'qty', e.target.value)} style={{ ...cell, textAlign: 'right' }} inputMode="decimal" /></td>
                  <td style={td}><input value={r.unit || ''} onChange={e => updateCell(i, 'unit', e.target.value)} style={cell} placeholder="item / m2" /></td>
                  <td style={td}><input value={r.tenderedRate ?? ''} onChange={e => updateCell(i, 'tenderedRate', e.target.value)} style={{ ...cell, textAlign: 'right' }} inputMode="decimal" /></td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{gbp(tTotal)}</td>
                  <td style={td}><input type="date" value={r.dateProvided || ''} onChange={e => updateCell(i, 'dateProvided', e.target.value)} style={cell} /></td>
                  <td style={td}><input value={r.buyingRate ?? ''} onChange={e => updateCell(i, 'buyingRate', e.target.value)} style={{ ...cell, textAlign: 'right' }} inputMode="decimal" placeholder={needsBuying ? 'needed' : ''} /></td>
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
    </div>
  )
}

const cell = { width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #eee', borderRadius: 6, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }
