import { useState, useEffect, useMemo } from 'react'
import { INK, th, td, Loading, primaryBtn, ghostBtn, linkBtn } from './opsUI'
import RowAttachments from './RowAttachments'
import ExpandableText from './ExpandableText'
import ContactPicker from './ContactPicker'

// Shared, editable Procurement Savings grid for a single project.
// Used by the Projects tab and the Pre-Contract page — same data via
// /api/procurement-savings, so edits mirror across both.
//   Tendered Total = Qty x Tendered Rate
//   Buying Total   = Qty x Buying Rate
//   Total Savings  = Tendered Total - Buying Total
const gbp = (n) => (n == null || n === '' || isNaN(n)) ? '' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(Number(n))
const gbpOrDash = (n) => gbp(n) || '—'
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const hasVal = (v) => v !== '' && v != null
const UNITS = ['m2', 'm', 'item', 'nr']
const blankRow = () => ({ packageName: '', supplier: '', dateProvided: '', qty: '', unit: '', tenderedRate: '', buyingRate: '', budgetComments: '', buyerComments: '', contactId: '', attachments: [] })

// Currency input: shows formatted £ when not focused, raw number when editing.
function MoneyInput({ value, onChange }) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      value={focused ? (value ?? '') : (hasVal(value) ? gbp(value) : '')}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={e => onChange(e.target.value.replace(/[£,\s]/g, ''))}
      inputMode="decimal"
      style={{ ...cell, textAlign: 'right', minWidth: 120 }}
    />
  )
}

export default function ProcurementSavings({ projectNo }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState('')
  const [sort, setSort] = useState({ key: null, dir: 'asc' })

  useEffect(() => { if (projectNo) load() }, [projectNo])
  async function load() {
    setLoading(true); setDirty(false); setNotice('')
    try {
      const d = await fetch(`/api/procurement-savings?projectNo=${encodeURIComponent(projectNo)}`).then(r => r.json())
      setRows(d.rows && d.rows.length ? d.rows.map(r => ({ ...blankRow(), ...r })) : [blankRow()])
    } catch { setRows([blankRow()]) }
    setLoading(false)
  }

  function updateCell(i, key, val) { setRows(rs => rs.map((r, idx) => idx === i ? { ...r, [key]: val } : r)); setDirty(true) }
  function addRow() { setRows(rs => [...rs, blankRow()]); setDirty(true) }
  function removeRow(i) { setRows(rs => rs.filter((_, idx) => idx !== i)); setDirty(true) }

  async function save() {
    setSaving(true)
    try {
      const clean = rows.filter(r => Object.entries(r).some(([k, v]) => k !== 'attachments' && hasVal(v)) || (r.attachments || []).length)
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

  // Completeness status (three states):
  //  - no tendered/budget rates anywhere      -> "Budget rates must be inserted"
  //  - a budget row exists without buying rate -> "Buying rates still needed"
  //  - every budget row has a buying rate      -> "All lines confirmed"
  const budgetRows = rows.filter(r => hasVal(r.tenderedRate))
  const awaitingBuying = budgetRows.filter(r => !hasVal(r.buyingRate)).length
  const status = budgetRows.length === 0
    ? { tone: '#b45309', text: '⚠ Budget rates must be inserted' }
    : awaitingBuying > 0
      ? { tone: '#b45309', text: `⚠ Buying rates still needed (${awaitingBuying} line${awaitingBuying === 1 ? '' : 's'})` }
      : { tone: '#16a34a', text: '✓ All lines have a confirmed buying rate' }

  // Sorting: returns display order (indices) so edits still map to real rows.
  const order = useMemo(() => {
    const idx = rows.map((_, i) => i)
    if (!sort.key) return idx
    const val = (r) => {
      if (sort.key === 'tenderedTotal') return num(r.qty) * num(r.tenderedRate)
      if (sort.key === 'buyingTotal') return num(r.qty) * num(r.buyingRate)
      if (sort.key === 'savings') return hasVal(r.buyingRate) ? num(r.qty) * num(r.tenderedRate) - num(r.qty) * num(r.buyingRate) : -Infinity
      const v = r[sort.key]
      return isNaN(parseFloat(v)) ? (v || '').toString().toLowerCase() : parseFloat(v)
    }
    return idx.sort((a, b) => {
      const av = val(rows[a]), bv = val(rows[b])
      if (av < bv) return sort.dir === 'asc' ? -1 : 1
      if (av > bv) return sort.dir === 'asc' ? 1 : -1
      return 0
    })
  }, [rows, sort])

  function toggleSort(key) { setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }) }
  const arrow = (key) => sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''
  const H = ({ k, label, w, min }) => <th onClick={() => toggleSort(k)} style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap', ...(w ? { width: w } : {}), ...(min ? { minWidth: min } : {}) }}>{label}{arrow(k)}</th>

  if (loading) return <Loading />

  const AddRowBar = (
    <div style={{ padding: '8px 0' }}>
      <button onClick={addRow} style={ghostBtn}>+ Add row</button>
      {dirty && <button onClick={save} disabled={saving} style={{ ...primaryBtn, marginLeft: 10 }}>{saving ? 'Saving…' : 'Save changes'}</button>}
      {dirty && <span style={{ fontSize: 12, color: '#dc2626', marginLeft: 10 }}>Unsaved changes</span>}
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13 }}>
          <span style={{ color: status.tone, fontWeight: 600 }}>{status.text}</span>
        </div>
        <div style={{ flex: 1 }} />
        {notice && <span style={{ fontSize: 13, color: notice === 'Saved.' ? '#16a34a' : '#dc2626' }}>{notice}</span>}
        {dirty && <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save changes'}</button>}
      </div>

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1850 }}>
          <thead>
            <tr style={{ background: '#faf9f7' }}>
              <H k="packageName" label="Package Name" min={160} />
              <H k="supplier" label="Supplier" min={180} />
              <H k="dateProvided" label="Tender Rate Provided" w={150} />
              <H k="qty" label="Qty" w={110} />
              <H k="unit" label="Unit" w={90} />
              <H k="tenderedRate" label="Tendered Rate" w={150} />
              <H k="tenderedTotal" label="Tendered Total" w={150} />
              <H k="buyingRate" label="Buying Rate" w={150} />
              <H k="buyingTotal" label="Buying Total" w={150} />
              <H k="savings" label="Total Savings" w={150} />
              <th style={{ ...th, minWidth: 140 }}>Budget Comments</th>
              <th style={{ ...th, minWidth: 140 }}>Buyer Comments</th>
              <th style={{ ...th, minWidth: 180 }}>Supplier Contact</th>
              <th style={{ ...th, width: 60 }}>Files</th>
              <th style={{ ...th, width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={15} style={{ ...td, padding: 0 }}>{AddRowBar}</td></tr>
            )}
            {order.map((ri, displayIdx) => {
              const r = rows[ri]
              const tTotal = num(r.qty) * num(r.tenderedRate)
              const hasBuying = hasVal(r.buyingRate)
              const bTotal = num(r.qty) * num(r.buyingRate)
              const savings = hasBuying ? tTotal - bTotal : null
              const needsBuying = hasVal(r.tenderedRate) && !hasBuying
              const isLast = displayIdx === order.length - 1
              return [
                  <tr key={ri} style={{ borderTop: '1px solid #f0f0f0', verticalAlign: 'middle', background: needsBuying ? '#fffbeb' : '#fff' }}>
                    <td style={td}><input value={r.packageName || ''} onChange={e => updateCell(ri, 'packageName', e.target.value)} style={cell} placeholder="Package" /></td>
                    <td style={td}><input value={r.supplier || ''} onChange={e => updateCell(ri, 'supplier', e.target.value)} style={cell} placeholder="Supplier" /></td>
                    <td style={td}><input type="date" value={r.dateProvided || ''} onChange={e => updateCell(ri, 'dateProvided', e.target.value)} style={cell} /></td>
                    <td style={td}><input value={r.qty ?? ''} onChange={e => updateCell(ri, 'qty', e.target.value)} style={{ ...cell, textAlign: 'right', minWidth: 76 }} inputMode="decimal" /></td>
                    <td style={td}>
                      <select value={r.unit || ''} onChange={e => updateCell(ri, 'unit', e.target.value)} style={{ ...cell, cursor: 'pointer', minWidth: 72 }}>
                        <option value="">—</option>
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td style={td}><MoneyInput value={r.tenderedRate} onChange={v => updateCell(ri, 'tenderedRate', v)} /></td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{gbpOrDash(tTotal)}</td>
                    <td style={td}><MoneyInput value={r.buyingRate} onChange={v => updateCell(ri, 'buyingRate', v)} /></td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{hasBuying ? gbpOrDash(bTotal) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: savings == null ? '#bbb' : savings >= 0 ? '#16a34a' : '#dc2626' }}>{savings == null ? '—' : gbpOrDash(savings)}</td>
                    <td style={td}><ExpandableText value={r.budgetComments} onSave={v => updateCell(ri, 'budgetComments', v)} label="Budget Comments" width="100%" /></td>
                    <td style={td}><ExpandableText value={r.buyerComments} onSave={v => updateCell(ri, 'buyerComments', v)} label="Buyer Comments" width="100%" /></td>
                    <td style={td}><ContactPicker value={r.contactId || ''} onChange={(id) => updateCell(ri, 'contactId', id || '')} /></td>
                    <td style={{ ...td, textAlign: 'center' }}><RowAttachments files={r.attachments || []} onChange={files => updateCell(ri, 'attachments', files)} /></td>
                    <td style={{ ...td, textAlign: 'center' }}><button onClick={() => removeRow(ri)} style={{ ...linkBtn, color: '#dc2626' }} title="Remove row">×</button></td>
                  </tr>,
                  isLast ? <tr key="addbar"><td colSpan={15} style={{ ...td, padding: 0, borderTop: '1px solid #f0f0f0' }}>{AddRowBar}</td></tr> : null
              ]
            })}
            <tr style={{ background: '#faf9f7', borderTop: '2px solid #e5e5e5' }}>
              <td style={{ ...td, fontWeight: 700, color: INK }} colSpan={6}>TOTALS</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{gbpOrDash(totals.tendered)}</td>
              <td style={td}></td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{gbpOrDash(totals.buying)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: totals.savings >= 0 ? '#16a34a' : '#dc2626' }}>{gbpOrDash(totals.savings)}</td>
              <td style={td} colSpan={5}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

const cell = { width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #eee', borderRadius: 6, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }
