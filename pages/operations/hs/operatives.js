import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, th, td, Loading, EmptyCard, primaryBtn, ghostBtn, linkBtn } from '../../../components/opsUI'

const TRADES = ['Single Ply', 'Felt', 'Liquids', 'Hot Melt', 'Rainscreen', 'Composite Panels', 'Aluminium', 'Standing Seam', 'Labourer', 'Other']

export default function Operatives() {
  const [ops, setOps] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(null)
  const [search, setSearch] = useState('')
  const [tradeFilter, setTradeFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })

  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/operatives').then(r => r.json()); setOps(d.operatives || []) } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const companies = useMemo(() => [...new Set(ops.map(o => o.company).filter(Boolean))].sort(), [ops])

  function toggleSort(key) { setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }) }
  const arrow = (key) => sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''

  const rows = useMemo(() => {
    let arr = ops.filter(o => {
      if (search && !`${o.firstName} ${o.lastName}`.toLowerCase().includes(search.toLowerCase())) return false
      if (tradeFilter && !(o.trades || []).includes(tradeFilter)) return false
      if (companyFilter && o.company !== companyFilter) return false
      return true
    })
    const val = (o) => {
      if (sort.key === 'name') return `${o.firstName} ${o.lastName}`.toLowerCase()
      if (sort.key === 'company') return (o.company || '').toLowerCase()
      if (sort.key === 'email') return (o.email || '').toLowerCase()
      if (sort.key === 'phone') return (o.phone || '').toLowerCase()
      if (sort.key === 'trades') return (o.trades || []).join(',').toLowerCase()
      return ''
    }
    return [...arr].sort((a, b) => { const av = val(a), bv = val(b); if (av < bv) return sort.dir === 'asc' ? -1 : 1; if (av > bv) return sort.dir === 'asc' ? 1 : -1; return 0 })
  }, [ops, search, tradeFilter, companyFilter, sort])

  async function del(o) {
    if (!confirm(`Delete ${o.firstName} ${o.lastName}?`)) return
    await fetch('/api/operatives', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: o.id }) })
    load()
  }

  return (
    <OperationsShell active="hs:operatives" section="hs" title="Operatives" wide>
      <PageHeading title="Operatives" sub="Installer roster — feeds the Planning Gantt."
        action={<button onClick={() => setEdit({})} style={primaryBtn}>+ Add new</button>} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14, alignItems: 'flex-end' }}>
        <div><div style={lbl}>Search by name</div><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name…" style={{ ...fInput, minWidth: 180 }} /></div>
        <div><div style={lbl}>Trade</div>
          <select value={tradeFilter} onChange={e => setTradeFilter(e.target.value)} style={{ ...fInput, fontFamily: 'inherit' }}>
            <option value="">All trades</option>{TRADES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div><div style={lbl}>Company</div>
          <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)} style={{ ...fInput, fontFamily: 'inherit' }}>
            <option value="">All companies</option>{companies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {(search || tradeFilter || companyFilter) && <button onClick={() => { setSearch(''); setTradeFilter(''); setCompanyFilter('') }} style={{ ...ghostBtn, padding: '7px 12px' }}>Clear</button>}
        <div style={{ marginLeft: 'auto', fontSize: 12.5, color: '#888', alignSelf: 'center' }}>{rows.length} operative{rows.length === 1 ? '' : 's'}</div>
      </div>

      {loading ? <Loading /> : ops.length === 0 ? (
        <EmptyCard title="No operatives yet" body="Click “Add new” to add your first installer." />
      ) : (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('name')}>Name{arrow('name')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('email')}>Email{arrow('email')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('phone')}>Phone{arrow('phone')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('company')}>Company{arrow('company')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('trades')}>Trade{arrow('trades')}</th>
              <th style={{ ...th, textAlign: 'right' }}></th>
            </tr></thead>
            <tbody>
              {rows.map(o => (
                <tr key={o.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={td}><strong>{o.firstName} {o.lastName}</strong></td>
                  <td style={td}>{o.email || '—'}</td>
                  <td style={td}>{o.phone || '—'}</td>
                  <td style={td}>{o.company || '—'}</td>
                  <td style={td}>{(o.trades || []).length ? (o.trades || []).join(', ') : '—'}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setEdit(o)} style={linkBtn}>Edit</button>
                    <button onClick={() => del(o)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && <OpModal initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </OperationsShell>
  )
}

const lbl = { fontSize: 11, color: '#888', marginBottom: 3 }
const fInput = { padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5 }

function OpModal({ initial, onClose, onSaved }) {
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '', company: '', trades: [], ...initial })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (patch) => setF(prev => ({ ...prev, ...patch }))
  const toggleTrade = (t) => set({ trades: (f.trades || []).includes(t) ? f.trades.filter(x => x !== t) : [...(f.trades || []), t] })

  async function save() {
    setErr('')
    if (!f.firstName.trim() || !f.lastName.trim()) return setErr('First and last name are required.')
    if (!f.email.trim()) return setErr('Email is required.')
    if (!f.phone.trim()) return setErr('Phone is required.')
    if (!f.company.trim()) return setErr('Company is required.')
    if (!(f.trades || []).length) return setErr('Select at least one trade.')
    setSaving(true)
    try {
      const r = await fetch('/api/operatives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operative: f }) })
      if (!r.ok) throw new Error('Save failed')
      onSaved()
    } catch (e) { setErr(e.message || 'Could not save.') }
    setSaving(false)
  }

  const input = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }
  const L = ({ children, req }) => <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '14px 0 6px' }}>{children}{req && <span style={{ color: '#dc2626' }}> *</span>}</div>

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 2vw', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #eee' }}>
          <h2 style={{ margin: 0, fontSize: 17, color: INK }}>{initial.id ? 'Edit operative' : 'Add operative'}</h2>
          <button onClick={onClose} style={{ fontSize: 24, border: 'none', background: 'none', cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        <div style={{ padding: '4px 24px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div><L req>First name</L><input value={f.firstName} onChange={e => set({ firstName: e.target.value })} style={input} /></div>
            <div><L req>Last name</L><input value={f.lastName} onChange={e => set({ lastName: e.target.value })} style={input} /></div>
            <div><L req>Email</L><input value={f.email} onChange={e => set({ email: e.target.value })} style={input} type="email" /></div>
            <div><L req>Phone</L><input value={f.phone} onChange={e => set({ phone: e.target.value })} style={input} /></div>
          </div>
          <L req>Company</L>
          <input value={f.company} onChange={e => set({ company: e.target.value })} style={input} />
          <L req>Trade <span style={{ fontWeight: 400, color: '#999', fontSize: 12 }}>(select all that apply)</span></L>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {TRADES.map(t => {
              const on = (f.trades || []).includes(t)
              return <button key={t} onClick={() => toggleTrade(t)} style={{ padding: '8px 13px', borderRadius: 20, border: on ? `2px solid ${GOLD}` : '1px solid #d9d5cc', background: on ? '#fffbeb' : '#fff', color: on ? '#92400e' : '#555', fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: 'pointer' }}>{on ? '✓ ' : ''}{t}</button>
            })}
          </div>
          {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 14 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, borderTop: '1px solid #eee', paddingTop: 18 }}>
            <button onClick={onClose} style={ghostBtn}>Cancel</button>
            <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
