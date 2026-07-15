import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, th, td, Loading, EmptyCard, primaryBtn, ghostBtn, linkBtn } from '../../../components/opsUI'

const TRADES = ['Single Ply', 'Felt', 'Liquids', 'Hot Melt', 'Rainscreen', 'Composite Panels', 'Aluminium', 'Standing Seam', 'Labourer', 'Other']

export default function Operatives() {
  const [ops, setOps] = useState([])
  const [loading, setLoading] = useState(true)
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


  return (
    <OperationsShell active="hs:operatives" section="hs" title="Operatives" wide>
      <PageHeading title="Operatives" sub="Installer roster — automatically populated from Site App Users. Add or edit people under Admin → Site App Users." />

      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#1e40af', marginBottom: 14 }}>
        This list is read-only. It mirrors your Site App Users. To add someone or change their company/trade, go to <strong>Admin → Site App Users</strong>.
      </div>

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
        <EmptyCard title="No operatives yet" body="Add people under Admin → Site App Users — they'll appear here automatically." />
      ) : (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead><tr style={{ background: '#faf9f7' }}>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('name')}>Name{arrow('name')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('email')}>Email{arrow('email')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('phone')}>Phone{arrow('phone')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('company')}>Company{arrow('company')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('trades')}>Trade{arrow('trades')}</th>
            </tr></thead>
            <tbody>
              {rows.map(o => (
                <tr key={o.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={td}><strong>{o.firstName} {o.lastName}</strong></td>
                  <td style={td}>{o.email || '—'}</td>
                  <td style={td}>{o.phone || '—'}</td>
                  <td style={td}>{o.company || '—'}</td>
                  <td style={td}>{(o.trades || []).length ? (o.trades || []).join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OperationsShell>
  )
}

const lbl = { fontSize: 11, color: '#888', marginBottom: 3 }
const fInput = { padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5 }
