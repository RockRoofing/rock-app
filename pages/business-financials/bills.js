import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, monthLbl, fmtDate, Card } from '../../components/BizNav'

const monthKey = (s) => (s || '').slice(0, 7)
const isoDay = (d) => d.toISOString().slice(0, 10)

// Default date window: 12 months back to 12 months forward (by due date).
function defaultRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - 12, 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 12, 1)
  return { from: isoDay(from), to: isoDay(to) }
}

export default function BillsToPay() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [items, setItems] = useState([])
  const [updatedAt, setUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [sel, setSel] = useState({})

  const dr = defaultRange()
  const [fromDate, setFromDate] = useState(dr.from)
  const [toDate, setToDate] = useState(dr.to)

  // Supplier multi-select filter
  const [supplierPick, setSupplierPick] = useState([])   // [] = all suppliers
  const [supplierOpen, setSupplierOpen] = useState(false)
  const [supplierSearch, setSupplierSearch] = useState('')
  const supplierRef = useRef(null)

  // Sorting
  const [sortKey, setSortKey] = useState('dueDate')
  const [sortDir, setSortDir] = useState('asc')

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/business-financials?view=bills').then(r => r.json()); setItems(d.items || []); setUpdatedAt(d.updatedAt) } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  // Close supplier dropdown on outside click.
  useEffect(() => {
    function onDoc(e) { if (supplierRef.current && !supplierRef.current.contains(e.target)) setSupplierOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  async function sync() {
    setSyncing(true)
    try { await fetch('/api/business-financials?view=bills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'bills', sync: true }) }); await load() } catch {}
    setSyncing(false)
  }

  const thisMonth = new Date().toISOString().slice(0, 7)

  // All supplier names (for the filter list).
  const allSuppliers = useMemo(() => {
    const s = new Set()
    for (const i of items) if (i.contact) s.add(i.contact)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [items])

  const supplierMatches = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase()
    return q ? allSuppliers.filter(s => s.toLowerCase().includes(q)) : allSuppliers
  }, [allSuppliers, supplierSearch])

  const pickSet = useMemo(() => new Set(supplierPick), [supplierPick])

  // Rows after date + supplier filters.
  const filtered = useMemo(() => {
    return items.filter(i => {
      const d = i.dueDate || ''
      if (fromDate && d && d < fromDate) return false
      if (toDate && d && d > toDate) return false
      if (fromDate && !d) return false   // undated excluded once a range is set
      if (pickSet.size && !pickSet.has(i.contact)) return false
      return true
    })
  }, [items, fromDate, toDate, pickSet])

  // Sorting.
  const sorted = useMemo(() => {
    const arr = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      let av, bv
      switch (sortKey) {
        case 'contact': av = (a.contact || '').toLowerCase(); bv = (b.contact || '').toLowerCase(); break
        case 'number': av = (a.number || '').toLowerCase(); bv = (b.number || '').toLowerCase(); break
        case 'date': av = a.date || ''; bv = b.date || ''; break
        case 'amountDue': av = a.amountDue || 0; bv = b.amountDue || 0; break
        case 'dueDate':
        default: av = a.dueDate || ''; bv = b.dueDate || ''; break
      }
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
    return arr
  }, [filtered, sortKey, sortDir])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'amountDue' ? 'desc' : 'asc') }
  }
  const sortArrow = (key) => sortKey === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''

  const total = useMemo(() => filtered.reduce((s, i) => s + (i.amountDue || 0), 0), [filtered])
  const selTotal = useMemo(() => sorted.filter(i => sel[i.id]).reduce((s, i) => s + (i.amountDue || 0), 0), [sorted, sel])
  const selCount = Object.values(sel).filter(Boolean).length

  // LEFT chart: ALL bills (unfiltered), by due month.
  const byMonthAll = useMemo(() => {
    const m = {}
    for (const i of items) { const k = monthKey(i.dueDate) || 'No date'; m[k] = (m[k] || 0) + (i.amountDue || 0) }
    return Object.keys(m).sort().map(k => ({ month: k, amount: Math.round(m[k]) }))
  }, [items])

  // RIGHT chart: ticked rows if any ticked, else all filtered rows.
  const byMonthSel = useMemo(() => {
    const anyTicked = Object.values(sel).some(Boolean)
    const base = anyTicked ? sorted.filter(i => sel[i.id]) : sorted
    const m = {}
    for (const i of base) { const k = monthKey(i.dueDate) || 'No date'; m[k] = (m[k] || 0) + (i.amountDue || 0) }
    return Object.keys(m).sort().map(k => ({ month: k, amount: Math.round(m[k]) }))
  }, [sorted, sel])
  const rightIsTicked = Object.values(sel).some(Boolean)

  if (!ok) return null
  return (
    <>
      <Head><title>Bills to Pay - Business Financials</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <BizNav />
        <div style={{ padding: '24px 16px', maxWidth: '100%', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
            <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>Bills to Pay <span style={{ fontSize: 12, color: '#aaa', fontWeight: 400 }}>(supplier bills only)</span></h1>
            <button onClick={sync} disabled={syncing} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: syncing ? 0.6 : 1 }}>{syncing ? 'Syncing...' : 'Sync bills'}</button>
          </div>

          {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : (
            <>
              {/* Filters */}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: 12 }}>
                <div>
                  <div style={flabel}>Due from</div>
                  <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={finput} />
                </div>
                <div>
                  <div style={flabel}>Due to</div>
                  <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={finput} />
                </div>
                <button onClick={() => { const d = defaultRange(); setFromDate(d.from); setToDate(d.to) }} style={{ ...miniBtn, height: 34 }}>Reset dates</button>

                {/* Supplier multi-select with type-ahead */}
                <div ref={supplierRef} style={{ position: 'relative', minWidth: 260 }}>
                  <div style={flabel}>Suppliers {supplierPick.length ? `(${supplierPick.length})` : '(all)'}</div>
                  <div onClick={() => setSupplierOpen(o => !o)} style={{ ...finput, minWidth: 260, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: supplierPick.length ? INK : '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                      {supplierPick.length ? supplierPick.join(', ') : 'All suppliers'}
                    </span>
                    <span style={{ color: '#999' }}>{supplierOpen ? '\u25B2' : '\u25BC'}</span>
                  </div>
                  {supplierOpen && (
                    <div style={{ position: 'absolute', top: 60, left: 0, zIndex: 30, background: '#fff', border: '1px solid #e2e0da', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,0.14)', width: 320, padding: 8 }}>
                      <input autoFocus value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder="Type to search suppliers..."
                        style={{ width: '100%', padding: '7px 9px', border: '1px solid #e2e0da', borderRadius: 7, fontSize: 12, marginBottom: 8 }} />
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <button onClick={() => setSupplierPick([])} style={miniBtn}>Clear</button>
                        <button onClick={() => setSupplierPick(supplierMatches)} style={miniBtn}>Select shown</button>
                      </div>
                      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                        {supplierMatches.length === 0 && <div style={{ fontSize: 12, color: '#aaa', padding: 8 }}>No suppliers match.</div>}
                        {supplierMatches.map(s => (
                          <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 12, cursor: 'pointer' }}>
                            <input type="checkbox" checked={pickSet.has(s)} onChange={() => setSupplierPick(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}>
                  <Stat label="Filtered total" value={gbp(total)} sub={`${filtered.length} bills`} />
                  <Stat label="Selected" value={gbp(selTotal)} sub={`${selCount} ticked`} accent />
                </div>
              </div>

              {/* Two charts side by side */}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 45%', minWidth: 320 }}>
                  <Card title="Bills due by month (all bills)" sub="Every outstanding supplier bill by due month">
                    {byMonthAll.length === 0 ? <div style={{ color: '#bbb', padding: 30, textAlign: 'center' }}>No outstanding bills - click "Sync bills".</div> : (
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={byMonthAll} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                          <XAxis dataKey="month" tickFormatter={(m) => m === 'No date' ? 'No date' : monthLbl(m)} tick={{ fontSize: 11 }} />
                          <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={48} />
                          <Tooltip formatter={(v) => gbp(v)} labelFormatter={(m) => m === 'No date' ? 'No due date' : monthLbl(m)} />
                          <ReferenceLine x={thisMonth} stroke="#16a34a" strokeDasharray="4 3" label={{ value: 'now', fontSize: 10, fill: '#16a34a' }} />
                          <Bar dataKey="amount" name="Due" fill="#dc2626" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </Card>
                </div>
                <div style={{ flex: '1 1 45%', minWidth: 320 }}>
                  <Card title={rightIsTicked ? 'Selected bills by month (ticked)' : 'Filtered bills by month'} sub={rightIsTicked ? 'Only the rows you have ticked' : 'Follows the supplier + date filters'}>
                    {byMonthSel.length === 0 ? <div style={{ color: '#bbb', padding: 30, textAlign: 'center' }}>No bills match the current filter/selection.</div> : (
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={byMonthSel} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                          <XAxis dataKey="month" tickFormatter={(m) => m === 'No date' ? 'No date' : monthLbl(m)} tick={{ fontSize: 11 }} />
                          <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={48} />
                          <Tooltip formatter={(v) => gbp(v)} labelFormatter={(m) => m === 'No date' ? 'No due date' : monthLbl(m)} />
                          <ReferenceLine x={thisMonth} stroke="#16a34a" strokeDasharray="4 3" label={{ value: 'now', fontSize: 10, fill: '#16a34a' }} />
                          <Bar dataKey="amount" name="Due" fill="#2563eb" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </Card>
                </div>
              </div>

              {/* Table (full width) */}
              <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                      <th style={{ ...th, width: 36 }}>
                        <input type="checkbox" checked={selCount > 0 && selCount === sorted.length} onChange={e => setSel(e.target.checked ? Object.fromEntries(sorted.map(i => [i.id, true])) : {})} />
                      </th>
                      <th style={{ ...th, textAlign: 'left', cursor: 'pointer' }} onClick={() => toggleSort('contact')}>Supplier{sortArrow('contact')}</th>
                      <th style={{ ...th, textAlign: 'left', cursor: 'pointer' }} onClick={() => toggleSort('number')}>Ref{sortArrow('number')}</th>
                      <th style={{ ...th, textAlign: 'left', cursor: 'pointer' }} onClick={() => toggleSort('date')}>Bill date{sortArrow('date')}</th>
                      <th style={{ ...th, textAlign: 'left', cursor: 'pointer' }} onClick={() => toggleSort('dueDate')}>Due date{sortArrow('dueDate')}</th>
                      <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('amountDue')}>Amount due{sortArrow('amountDue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(i => {
                      const overdue = i.dueDate && i.dueDate < new Date().toISOString().slice(0, 10)
                      return (
                        <tr key={i.id} style={{ borderBottom: '1px solid #f2f0ec', background: sel[i.id] ? '#fffbeb' : 'transparent' }}>
                          <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={!!sel[i.id]} onChange={e => setSel(s => ({ ...s, [i.id]: e.target.checked }))} /></td>
                          <td style={{ ...td, textAlign: 'left' }}>{i.contact || '-'}</td>
                          <td style={{ ...td, textAlign: 'left', color: '#888' }}>{i.number || '-'}</td>
                          <td style={{ ...td, textAlign: 'left', color: '#555' }}>{fmtDate(i.date)}</td>
                          <td style={{ ...td, textAlign: 'left', color: overdue ? '#dc2626' : '#555', fontWeight: overdue ? 600 : 400 }}>{fmtDate(i.dueDate)}{overdue ? ' - overdue' : ''}</td>
                          <td style={{ ...td, fontWeight: 600 }}>{gbp(i.amountDue)}</td>
                        </tr>
                      )
                    })}
                    {sorted.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#bbb', padding: 24 }}>No bills match the current filters.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>Last synced {updatedAt ? new Date(updatedAt).toLocaleString('en-GB') : 'never'}. Showing supplier bills (Xero ACCPAY) only.</div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ background: accent ? '#fffbeb' : '#fff', border: `1px solid ${accent ? '#fde68a' : '#e6e3dc'}`, borderRadius: 12, padding: '10px 16px', minWidth: 150 }}>
      <div style={{ fontSize: 12, color: '#888' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ? '#92400e' : INK, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
const th = { padding: '10px 12px', fontSize: 12, color: '#777', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', textAlign: 'right' }
const flabel = { fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }
const finput = { padding: '7px 9px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, background: '#fff' }
const miniBtn = { flex: 1, fontSize: 11, border: '1px solid #e2e0da', background: '#fff', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }
