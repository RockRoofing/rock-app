import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, Loading, ghostBtn, primaryBtn, linkBtn } from '../../../components/opsUI'

const NAME_W = 170, META_W = 120, COL_W = 96

const DAY = 86400000
const parseISO = (s) => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const todayMid = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

// colour by expiry: >2 months green, <2 months orange, past red
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
  const [edit, setEdit] = useState(null)  // { personId, colId }

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
    if (d.columns) setColumns(d.columns)
    setData(prev => { const n = { ...prev }; for (const pid of Object.keys(n)) if (n[pid]) { const c = { ...n[pid] }; delete c[colId]; n[pid] = c } return n })
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
            <div style={{ display: 'flex', borderBottom: '2px solid #e6e2d8', background: '#faf9f7', alignItems: 'flex-end' }}>
              <HeadFix w={NAME_W} left={0}>Employee</HeadFix>
              <HeadFix w={META_W} left={NAME_W}>Company</HeadFix>
              <HeadFix w={META_W} left={NAME_W + META_W}>Trade</HeadFix>
              <HeadFix w={META_W} left={NAME_W + META_W * 2}>Phone</HeadFix>
              <HeadPlain w={META_W}>Email</HeadPlain>
              {columns.map(c => (
                <div key={c.id} style={{ width: COL_W, minWidth: COL_W, height: 140, position: 'relative', borderLeft: '1px solid #f0f0f0' }}>
                  <div style={{ position: 'absolute', bottom: 26, left: '50%', transformOrigin: 'left bottom', transform: 'rotate(-60deg)', whiteSpace: 'nowrap', fontSize: 10.5, color: '#444', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.label}>{c.label}</div>
                  <button onClick={() => delColumn(c.id, c.label)} title="Delete column" style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', border: 'none', background: 'none', color: '#ccc', cursor: 'pointer', fontSize: 13 }}>×</button>
                </div>
              ))}
            </div>

            {/* rows */}
            {shown.map(p => (
              <div key={p.id} style={{ display: 'flex', borderBottom: '1px solid #f2f2f2', minHeight: 38, alignItems: 'stretch' }}>
                <CellFix w={NAME_W} left={0} bold>{p.name}</CellFix>
                <CellFix w={META_W} left={NAME_W}>{p.company}</CellFix>
                <CellFix w={META_W} left={NAME_W + META_W}>{p.trade}</CellFix>
                <CellFix w={META_W} left={NAME_W + META_W * 2}>{p.phone}</CellFix>
                <div style={{ width: META_W, minWidth: META_W, padding: '6px 8px', fontSize: 11, color: '#555', borderRight: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</div>
                {columns.map(c => {
                  const cell = (data[p.id] || {})[c.id]
                  const col = cellColour(cell)
                  const isEditing = edit && edit.personId === p.id && edit.colId === c.id
                  return (
                    <div key={c.id} style={{ width: COL_W, minWidth: COL_W, borderLeft: '1px solid #f5f5f5', position: 'relative' }}>
                      {isEditing ? (
                        <CellEditor cell={cell} onSave={(v) => saveCell(p.id, c.id, v)} onCancel={() => setEdit(null)} />
                      ) : (
                        <div onClick={() => setEdit({ personId: p.id, colId: c.id })} title={`${p.name} — ${c.label}`}
                          style={{ height: '100%', minHeight: 38, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: col ? col.bg : '#fff', color: col ? col.fg : '#ddd', fontSize: 10.5, fontWeight: 600, textAlign: 'center', padding: '2px' }}>
                          {col ? col.text : ''}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
            {shown.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: '#aaa' }}>No people match. Add operatives under H&S → Operatives, or portal users under Admin.</div>}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: '#999', marginTop: 8 }}>Click a cell to set an expiry date or mark “No expiry”. People come from the Operatives roster and portal users. Add or remove training columns with the buttons above / the × on each column.</div>
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
  <div style={{ width: w, minWidth: w, position: 'sticky', left, zIndex: 4, background: '#faf9f7', padding: '8px', fontSize: 11, fontWeight: 700, color: INK, alignSelf: 'stretch', display: 'flex', alignItems: 'flex-end', borderRight: '1px solid #eee' }}>{children}</div>
)
const HeadPlain = ({ w, children }) => (
  <div style={{ width: w, minWidth: w, padding: '8px', fontSize: 11, fontWeight: 700, color: INK, alignSelf: 'flex-end', borderRight: '1px solid #eee' }}>{children}</div>
)
const CellFix = ({ w, left, bold, children }) => (
  <div style={{ width: w, minWidth: w, position: 'sticky', left, zIndex: 2, background: '#fff', padding: '6px 8px', fontSize: 11.5, fontWeight: bold ? 600 : 400, color: bold ? INK : '#555', borderRight: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</div>
)

const lbl = { fontSize: 11, color: '#888', marginBottom: 3 }
const fInput = { padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5 }
