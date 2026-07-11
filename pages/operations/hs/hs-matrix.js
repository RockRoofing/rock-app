import { useState, useEffect, useMemo, useRef } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, Loading, ghostBtn, primaryBtn } from '../../../components/opsUI'

const NAME_W = 170, META_W = 120, COL_W = 96
const HEADER_ORANGE = '#f5c77e'   // slightly darker orange for column headers
const ROW_ALT = '#f7f6f3'

const DAY = 86400000
const parseISO = (s) => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const todayMid = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

// 10 header colour options (label -> swatch). '' = none (default orange).
const COL_COLOURS = ['#fecaca', '#fed7aa', '#fde68a', '#d9f99d', '#bbf7d0', '#a5f3fc', '#bfdbfe', '#ddd6fe', '#fbcfe8', '#e5e7eb']

function cellColour(cell) {
  if (!cell) return null
  if (cell.noExpiry) return { bg: '#dcfce7', fg: '#166534', text: 'No expiry' }
  if (!cell.date) return null
  const d = parseISO(cell.date); const now = todayMid()
  const twoMonths = new Date(now.getTime()); twoMonths.setMonth(twoMonths.getMonth() + 2)
  const label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
  if (d < now) return { bg: '#fee2e2', fg: '#b91c1c', text: label }
  if (d < twoMonths) return { bg: '#ffedd5', fg: '#9a3412', text: label }
  return { bg: '#dcfce7', fg: '#166534', text: label }
}

export default function HSMatrixPage() {
  const [columns, setColumns] = useState([])
  const [data, setData] = useState({})
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ person: '', company: '', trade: '' })
  const [edit, setEdit] = useState(null)       // { personId, colId } cell editor
  const [colMenu, setColMenu] = useState(null) // colId whose header menu is open
  const dragId = useRef(null)

  async function load() {
    setLoading(true)
    try {
      const m = await fetch('/api/hs-matrix').then(r => r.json())
      setColumns(m.columns || []); setData(m.data || {}); setPeople(m.people || [])
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const companies = useMemo(() => [...new Set(people.map(p => p.company).filter(Boolean))].sort(), [people])
  const trades = useMemo(() => [...new Set(people.flatMap(p => (p.trade || '').split(',').map(s => s.trim()).filter(Boolean)))].sort(), [people])

  const shown = useMemo(() => people.filter(p => {
    if (filters.person && p.id !== filters.person) return false
    if (filters.company && p.company !== filters.company) return false
    if (filters.trade && !(p.trade || '').split(',').map(s => s.trim()).includes(filters.trade)) return false
    return true
  }), [people, filters])

  async function addColumn() {
    const label = window.prompt('New training column name:')
    if (!label || !label.trim()) return
    const d = await fetch('/api/hs-matrix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add-col', label: label.trim() }) }).then(r => r.json())
    if (d.columns) setColumns(d.columns)
  }
  async function delColumn(colId, label) {
    if (!window.confirm(`Delete the "${label}" column and all its dates? This cannot be undone.`)) return
    const d = await fetch('/api/hs-matrix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'del-col', colId }) }).then(r => r.json())
    if (d.columns) setColumns(d.columns); setColMenu(null)
  }
  async function patchCol(colId, patch) {
    setColumns(prev => prev.map(c => c.id === colId ? { ...c, ...patch } : c))
    await fetch('/api/hs-matrix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-col', colId, ...patch }) }).catch(() => {})
  }
  async function saveCell(personId, colId, value) {
    setData(prev => {
      const n = { ...prev, [personId]: { ...(prev[personId] || {}) } }
      if (!value) delete n[personId][colId]; else n[personId][colId] = value
      return n
    })
    setEdit(null)
    await fetch('/api/hs-matrix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-cell', personId, colId, value }) }).catch(() => {})
  }

  // drag to reorder columns
  function onDrop(targetId) {
    const from = dragId.current; dragId.current = null
    if (!from || from === targetId) return
    setColumns(prev => {
      const ids = prev.map(c => c.id)
      const fi = ids.indexOf(from), ti = ids.indexOf(targetId)
      if (fi < 0 || ti < 0) return prev
      const next = prev.slice(); const [moved] = next.splice(fi, 1); next.splice(ti, 0, moved)
      const order = next.map(c => c.id)
      fetch('/api/hs-matrix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reorder-cols', order }) }).catch(() => {})
      return next
    })
  }

  if (loading) return (
    <OperationsShell active="hs:hs-matrix" section="hs" title="H&S Training Matrix" wide><PageHeading title="H&S Training Matrix" /><Loading /></OperationsShell>
  )

  return (
    <OperationsShell active="hs:hs-matrix" section="hs" title="H&S Training Matrix" wide>
      <PageHeading title="H&S Training Matrix" sub="Training expiry per person. Green = >2 months, amber = <2 months, red = expired. Blank = no record." action={<button onClick={addColumn} style={primaryBtn}>+ Add training column</button>} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
        <div><div style={lbl}>Person</div>
          <select value={filters.person} onChange={e => setFilters(f => ({ ...f, person: e.target.value }))} style={{ ...fInput, minWidth: 170, fontFamily: 'inherit' }}>
            <option value="">All people</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div><div style={lbl}>Company</div>
          <select value={filters.company} onChange={e => setFilters(f => ({ ...f, company: e.target.value }))} style={{ ...fInput, minWidth: 150, fontFamily: 'inherit' }}>
            <option value="">All companies</option>
            {companies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div><div style={lbl}>Trade</div>
          <select value={filters.trade} onChange={e => setFilters(f => ({ ...f, trade: e.target.value }))} style={{ ...fInput, minWidth: 140, fontFamily: 'inherit' }}>
            <option value="">All trades</option>
            {trades.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {(filters.person || filters.company || filters.trade) &&
          <button onClick={() => setFilters({ person: '', company: '', trade: '' })} style={{ ...ghostBtn, padding: '7px 12px' }}>Clear</button>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center', fontSize: 11.5, color: '#555' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#dcfce7', border: '1px solid #bbf7d0' }} /> valid</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#ffedd5', border: '1px solid #fed7aa' }} /> &lt;2 months</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#fee2e2', border: '1px solid #fecaca' }} /> expired</span>
        </div>
      </div>

      <div style={{ border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: NAME_W + META_W * 3 + columns.length * COL_W }}>
            {/* header */}
            <div style={{ display: 'flex', borderBottom: '2px solid #e6b567', alignItems: 'flex-end' }}>
              <HeadFix w={NAME_W} left={0}>Employee</HeadFix>
              <HeadFix w={META_W} left={NAME_W}>Company</HeadFix>
              <HeadFix w={META_W} left={NAME_W + META_W}>Trade</HeadFix>
              <HeadFix w={META_W} left={NAME_W + META_W * 2}>Phone</HeadFix>
              <HeadPlain w={META_W}>Email</HeadPlain>
              {columns.map(c => (
                <div key={c.id}
                  draggable
                  onDragStart={() => { dragId.current = c.id }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => onDrop(c.id)}
                  style={{ width: COL_W, minWidth: COL_W, height: 150, position: 'relative', borderLeft: '1px solid #eab968', background: c.colour || HEADER_ORANGE }}>
                  <div style={{ position: 'absolute', bottom: 30, left: '50%', transformOrigin: 'left bottom', transform: 'rotate(-60deg)', whiteSpace: 'nowrap', fontSize: 10.5, color: '#3a2e12', fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${c.label}${c.locked ? ' (mandatory)' : ''}`}>{c.locked ? '🔒 ' : ''}{c.label}</div>
                  <button onClick={() => setColMenu(colMenu === c.id ? null : c.id)} title="Column options" style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', border: 'none', background: 'rgba(255,255,255,0.7)', borderRadius: 5, color: '#5a4a1a', cursor: 'pointer', fontSize: 11, padding: '1px 6px' }}>⋯</button>
                  {colMenu === c.id && (
                    <div style={{ position: 'absolute', top: 150, left: '50%', transform: 'translateX(-50%)', zIndex: 30, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.18)', padding: 12, width: 200 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 8 }}>{c.label}</div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer', marginBottom: 10 }}>
                        <input type="checkbox" checked={!!c.locked} onChange={e => patchCol(c.id, { locked: e.target.checked })} /> Mandatory (lock cells)
                      </label>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 5 }}>Header colour</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                        <button onClick={() => patchCol(c.id, { colour: '' })} title="Default" style={{ width: 22, height: 22, borderRadius: 5, border: !c.colour ? '2px solid #333' : '1px solid #ccc', background: HEADER_ORANGE, cursor: 'pointer' }} />
                        {COL_COLOURS.map(col => (
                          <button key={col} onClick={() => patchCol(c.id, { colour: col })} style={{ width: 22, height: 22, borderRadius: 5, border: c.colour === col ? '2px solid #333' : '1px solid #ccc', background: col, cursor: 'pointer' }} />
                        ))}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <button onClick={() => delColumn(c.id, c.label)} style={{ ...ghostBtn, padding: '5px 10px', fontSize: 12, color: '#dc2626' }}>Delete</button>
                        <button onClick={() => setColMenu(null)} style={{ ...ghostBtn, padding: '5px 10px', fontSize: 12 }}>Close</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* rows */}
            {shown.map((p, ri) => {
              const rowBg = ri % 2 === 1 ? ROW_ALT : '#fff'
              return (
              <div key={p.id} style={{ display: 'flex', borderBottom: '1px solid #f2f2f2', minHeight: 38, alignItems: 'stretch', background: rowBg }}>
                <CellFix w={NAME_W} left={0} bg={rowBg} bold>{p.name}</CellFix>
                <CellFix w={META_W} left={NAME_W} bg={rowBg}>{p.company}</CellFix>
                <CellFix w={META_W} left={NAME_W + META_W} bg={rowBg}>{p.trade}</CellFix>
                <CellFix w={META_W} left={NAME_W + META_W * 2} bg={rowBg}>{p.phone}</CellFix>
                <div style={{ width: META_W, minWidth: META_W, padding: '6px 8px', fontSize: 11, color: '#555', borderRight: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</div>
                {columns.map(c => {
                  const cell = (data[p.id] || {})[c.id]
                  const col = cellColour(cell)
                  const isEditing = edit && edit.personId === p.id && edit.colId === c.id
                  const mandatoryEmpty = c.locked && !col
                  return (
                    <div key={c.id} style={{ width: COL_W, minWidth: COL_W, borderLeft: '1px solid #f5f5f5', position: 'relative' }}>
                      {isEditing ? (
                        <CellEditor cell={cell} onSave={(v) => saveCell(p.id, c.id, v)} onCancel={() => setEdit(null)} />
                      ) : (
                        <div onClick={() => setEdit({ personId: p.id, colId: c.id })} title={`${p.name} — ${c.label}${c.locked ? ' (mandatory)' : ''}`}
                          style={{ height: '100%', minHeight: 38, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: col ? col.bg : (mandatoryEmpty ? '#fef2f2' : 'transparent'), color: col ? col.fg : '#c99', fontSize: 10.5, fontWeight: 600, textAlign: 'center', padding: '2px', boxShadow: mandatoryEmpty ? 'inset 0 0 0 1.5px #fca5a5' : 'none' }}>
                          {col ? col.text : (mandatoryEmpty ? 'required' : '')}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              )
            })}
            {shown.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: '#aaa' }}>No people match. Add operatives under H&S → Operatives, or portal users under Admin.</div>}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: '#999', marginTop: 8 }}>Click a cell to set an expiry date or “No expiry”. Drag a column header to reorder. Click ⋯ on a column to lock it as mandatory (empty locked cells show “required”), colour it, or delete it.</div>
    </OperationsShell>
  )
}

function CellEditor({ cell, onSave, onCancel }) {
  const [date, setDate] = useState(cell && cell.date ? cell.date : '')
  const [noExpiry, setNoExpiry] = useState(!!(cell && cell.noExpiry))
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 20, background: '#fff', border: `2px solid ${GOLD}`, borderRadius: 8, padding: 8, width: 190, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
      <input type="date" value={date} disabled={noExpiry} onChange={e => setDate(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '6px', border: '1px solid #e0e0e0', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', opacity: noExpiry ? 0.5 : 1 }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, marginTop: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={noExpiry} onChange={e => setNoExpiry(e.target.checked)} /> Does not expire
      </label>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button onClick={() => onSave(noExpiry ? { noExpiry: true } : (date ? { date } : null))} style={{ ...primaryBtn, padding: '5px 10px', fontSize: 12, flex: 1 }}>Save</button>
        <button onClick={() => onSave(null)} title="Clear" style={{ ...ghostBtn, padding: '5px 8px', fontSize: 12 }}>Clear</button>
        <button onClick={onCancel} style={{ ...ghostBtn, padding: '5px 8px', fontSize: 12 }}>×</button>
      </div>
    </div>
  )
}

const HeadFix = ({ w, left, children }) => (
  <div style={{ width: w, minWidth: w, position: 'sticky', left, zIndex: 4, background: HEADER_ORANGE, padding: '8px', fontSize: 11, fontWeight: 700, color: '#3a2e12', alignSelf: 'stretch', display: 'flex', alignItems: 'flex-end', borderRight: '1px solid #eab968' }}>{children}</div>
)
const HeadPlain = ({ w, children }) => (
  <div style={{ width: w, minWidth: w, padding: '8px', fontSize: 11, fontWeight: 700, color: '#3a2e12', alignSelf: 'stretch', display: 'flex', alignItems: 'flex-end', background: HEADER_ORANGE, borderRight: '1px solid #eab968' }}>{children}</div>
)
const CellFix = ({ w, left, bold, bg, children }) => (
  <div style={{ width: w, minWidth: w, position: 'sticky', left, zIndex: 2, background: bg || '#fff', padding: '6px 8px', fontSize: 11.5, fontWeight: bold ? 600 : 400, color: bold ? INK : '#555', borderRight: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</div>
)

const lbl = { fontSize: 11, color: '#888', marginBottom: 3 }
const fInput = { padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5 }
