import { useState, useEffect } from 'react'
import Link from 'next/link'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { Loading, EmptyCard } from '../../../components/opsUI'

// Read-only mirror of the Commercial Variation Tracker. Same data and layout,
// but no add/edit/delete — changes are made in the Commercial section only.
const fmt = (n) => n == null || n === '' || isNaN(n) ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(parseFloat(n))
const fmtN = (n) => n == null || n === '' ? 0 : parseFloat(n) || 0

export default function VariationsReadOnly() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  const [filterProject, setFilterProject] = useState('All')
  const [filterCustomer, setFilterCustomer] = useState('All')
  const [filterCM, setFilterCM] = useState('All')
  const [filterEstimator, setFilterEstimator] = useState('All')
  const [filterInstructed, setFilterInstructed] = useState('All')
  const [sortCol, setSortCol] = useState('varNumber')
  const [sortDir, setSortDir] = useState('asc')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard?sync=true')
      const data = await res.json()
      setProjects((data.projects || []).filter(p => p.status === 'INPROGRESS'))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  function toggleSort(col) { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('asc') } }

  const allRows = []
  for (const p of projects) {
    const variations = p.variations || p.settings?.variations || []
    for (const v of variations) {
      allRows.push({
        projectId: p.xeroId, jobNo: p.jobNo || '—', projectName: p.name || '—',
        customer: p.customer || p.customerName || '—', estimator: p.estimator || '—', cm: p.contractsManager || '—',
        varNumber: v.varNumber || '—', description: v.description || '—', instructed: v.instructed,
        materials: fmtN(v.materials), labour: fmtN(v.labour), profit: fmtN(v.profit),
        total: fmtN(v.materials) + fmtN(v.labour) + fmtN(v.profit),
      })
    }
  }

  const uniq = (arr, key) => ['All', ...new Set(arr.map(r => r[key]).filter(Boolean))].sort((a, b) => a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b))
  const projectOptions = ['All', ...new Set(allRows.map(r => `${r.jobNo} — ${r.projectName}`).filter(Boolean))].sort((a, b) => a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b))

  const filtered = allRows.filter(r => {
    if (filterProject !== 'All' && `${r.jobNo} — ${r.projectName}` !== filterProject) return false
    if (filterCustomer !== 'All' && r.customer !== filterCustomer) return false
    if (filterCM !== 'All' && r.cm !== filterCM) return false
    if (filterEstimator !== 'All' && r.estimator !== filterEstimator) return false
    if (filterInstructed !== 'All') {
      if (filterInstructed === 'Instructed' && !r.instructed) return false
      if (filterInstructed === 'Not Instructed' && r.instructed) return false
    }
    return true
  })
  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol]
    if (typeof av === 'string') av = av.toLowerCase()
    if (typeof bv === 'string') bv = bv.toLowerCase()
    if (av == null) return 1; if (bv == null) return -1
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })
  const tM = filtered.reduce((s, r) => s + r.materials, 0)
  const tL = filtered.reduce((s, r) => s + r.labour, 0)
  const tP = filtered.reduce((s, r) => s + r.profit, 0)
  const tT = filtered.reduce((s, r) => s + r.total, 0)

  const thS = { padding: '9px 11px', fontWeight: 600, color: '#555', textAlign: 'left', fontSize: 12, borderBottom: '2px solid #e5e5e5', whiteSpace: 'nowrap', background: '#faf9f7', cursor: 'pointer', userSelect: 'none' }
  const tdS = { padding: '9px 11px', fontSize: 12.5, borderBottom: '1px solid #f0f0f0', verticalAlign: 'middle' }
  const selS = { fontSize: 12, padding: '7px 10px', border: '1px solid #e5e5e5', borderRadius: 8, background: '#fff', cursor: 'pointer' }

  return (
    <OperationsShell active="pm:variations" section="pm" title="Variations" wide>
      <PageHeading title="Variations" sub="Read-only view of the Commercial Variation Tracker. Live & in-progress projects only. Changes are made in the Commercial section." />

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {[
          { label: 'Project', value: filterProject, set: setFilterProject, opts: projectOptions },
          { label: 'Customer', value: filterCustomer, set: setFilterCustomer, opts: uniq(allRows, 'customer') },
          { label: 'CM', value: filterCM, set: setFilterCM, opts: uniq(allRows, 'cm') },
          { label: 'Estimator', value: filterEstimator, set: setFilterEstimator, opts: uniq(allRows, 'estimator') },
        ].map(f => (
          <div key={f.label}><div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{f.label}</div>
            <select value={f.value} onChange={e => f.set(e.target.value)} style={selS}>{f.opts.map(o => <option key={o}>{o}</option>)}</select></div>
        ))}
        <div><div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>Instructed?</div>
          <select value={filterInstructed} onChange={e => setFilterInstructed(e.target.value)} style={selS}>{['All', 'Instructed', 'Not Instructed'].map(o => <option key={o}>{o}</option>)}</select></div>
        <button onClick={() => { setFilterProject('All'); setFilterCustomer('All'); setFilterCM('All'); setFilterEstimator('All'); setFilterInstructed('All') }} style={{ ...selS, color: '#555' }}>Reset</button>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>{filtered.length} variation{filtered.length === 1 ? '' : 's'}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Total Materials', value: fmt(tM) },
          { label: 'Total Labour', value: fmt(tL) },
          { label: 'Total Profit', value: fmt(tP), color: tP >= 0 ? '#16a34a' : '#e63946' },
          { label: 'Total Value', value: fmt(tT), color: '#1a1a19' },
        ].map(c => (
          <div key={c.label} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: '14px 18px' }}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.color || '#1a1a19' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {loading ? <Loading /> : filtered.length === 0 ? (
        <EmptyCard title="No variations found" body="Variations added in the Commercial section for live projects will appear here." />
      ) : (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead><tr>
              {[
                { label: 'Variation No', col: 'varNumber' }, { label: 'Project No', col: 'jobNo' }, { label: 'Project Name', col: 'projectName' },
                { label: 'Customer', col: 'customer' }, { label: 'Estimator', col: 'estimator' }, { label: 'CM', col: 'cm' },
                { label: 'Description', col: 'description' }, { label: 'Instructed?', col: 'instructed' },
                { label: 'Materials £', col: 'materials' }, { label: 'Labour £', col: 'labour' }, { label: 'Profit £', col: 'profit' }, { label: 'Total £', col: 'total' },
              ].map(({ label, col }) => (
                <th key={col} onClick={() => toggleSort(col)} style={{ ...thS, textAlign: ['materials', 'labour', 'profit', 'total'].includes(col) ? 'right' : 'left' }}>
                  {label} {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{ color: '#ccc' }}>↕</span>}
                </th>
              ))}
            </tr></thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fcfcfb' }}>
                  <td style={{ ...tdS, fontWeight: 600, color: '#1a1a19', whiteSpace: 'nowrap' }}>{r.varNumber || '—'}</td>
                  <td style={{ ...tdS, whiteSpace: 'nowrap' }}><Link href={`/project/${r.projectId}`} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}>{r.jobNo}</Link></td>
                  <td style={{ ...tdS, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.projectName}</td>
                  <td style={{ ...tdS, whiteSpace: 'nowrap' }}>{r.customer}</td>
                  <td style={{ ...tdS, whiteSpace: 'nowrap' }}>{r.estimator}</td>
                  <td style={{ ...tdS, whiteSpace: 'nowrap' }}>{r.cm}</td>
                  <td style={{ ...tdS, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>{r.description}</td>
                  <td style={{ ...tdS, textAlign: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: r.instructed ? '#dcfce7' : '#fee2e2', color: r.instructed ? '#16a34a' : '#e63946' }}>{r.instructed ? 'Instructed' : 'Not Instructed'}</span>
                  </td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{fmt(r.materials)}</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{fmt(r.labour)}</td>
                  <td style={{ ...tdS, textAlign: 'right', color: r.profit >= 0 ? '#16a34a' : '#e63946' }}>{fmt(r.profit)}</td>
                  <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{fmt(r.total)}</td>
                </tr>
              ))}
              <tr style={{ background: '#faf9f7', borderTop: '2px solid #e5e5e5' }}>
                <td colSpan={8} style={{ ...tdS, fontWeight: 700, color: '#1a1a19' }}>TOTALS ({filtered.length})</td>
                <td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>{fmt(tM)}</td>
                <td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>{fmt(tL)}</td>
                <td style={{ ...tdS, textAlign: 'right', fontWeight: 700, color: tP >= 0 ? '#16a34a' : '#e63946' }}>{fmt(tP)}</td>
                <td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>{fmt(tT)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </OperationsShell>
  )
}
