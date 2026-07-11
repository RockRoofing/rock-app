import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, Loading, ghostBtn } from '../../../components/opsUI'

const NAME_W = 220, CELL_W = 40, ROW_H = 34
const HEADER_ORANGE = '#f5c77e'
const ROW_ALT = '#f7f6f3'

export default function RamsMatrixPage() {
  const [projects, setProjects] = useState([])
  const [ops, setOps] = useState([])
  const [signoffs, setSignoffs] = useState({})
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ project: '', operative: '', company: '', trade: '' })

  async function load() {
    setLoading(true)
    try {
      const [m, opr] = await Promise.all([
        fetch('/api/rams-matrix').then(r => r.json()).catch(() => ({})),
        fetch('/api/operatives').then(r => r.json()).catch(() => ({})),
      ])
      setProjects(m.projects || [])
      setSignoffs(m.signoffs || {})
      setOps((opr.operatives || []).slice().sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)))
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const companies = useMemo(() => [...new Set(ops.map(o => o.company).filter(Boolean))].sort(), [ops])
  const trades = useMemo(() => [...new Set(ops.flatMap(o => (o.trades || [])))].filter(Boolean).sort(), [ops])

  const shownOps = useMemo(() => ops.filter(o => {
    if (filters.operative && o.id !== filters.operative) return false
    if (filters.company && o.company !== filters.company) return false
    if (filters.trade && !(o.trades || []).includes(filters.trade)) return false
    return true
  }), [ops, filters])

  const shownProjects = useMemo(() => projects.filter(p => !filters.project || p.key === filters.project), [projects, filters])

  async function toggle(projectKey, opId) {
    const cur = !!(signoffs[projectKey] && signoffs[projectKey][opId])
    // optimistic
    setSignoffs(prev => {
      const n = { ...prev, [projectKey]: { ...(prev[projectKey] || {}) } }
      if (cur) delete n[projectKey][opId]; else n[projectKey][opId] = true
      return n
    })
    await fetch('/api/rams-matrix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle', projectKey, opId, signed: !cur }) }).catch(() => {})
  }

  if (loading) return (
    <OperationsShell active="hs:rams-matrix" section="hs" title="RAMS Matrix" wide><PageHeading title="RAMS Matrix" /><Loading /></OperationsShell>
  )

  const opName = (o) => `${o.firstName} ${o.lastName}`

  return (
    <OperationsShell active="hs:rams-matrix" section="hs" title="RAMS Matrix" wide>
      <PageHeading title="RAMS Matrix" sub="Which installers have signed onto each project's RAMS. Projects down the side, installers across the top." />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
        <div><div style={lbl}>Project</div>
          <select value={filters.project} onChange={e => setFilters(f => ({ ...f, project: e.target.value }))} style={{ ...fInput, minWidth: 180, fontFamily: 'inherit' }}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </div>
        <div><div style={lbl}>Operative</div>
          <select value={filters.operative} onChange={e => setFilters(f => ({ ...f, operative: e.target.value }))} style={{ ...fInput, minWidth: 160, fontFamily: 'inherit' }}>
            <option value="">All operatives</option>
            {ops.map(o => <option key={o.id} value={o.id}>{opName(o)}</option>)}
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
        {(filters.project || filters.operative || filters.company || filters.trade) &&
          <button onClick={() => setFilters({ project: '', operative: '', company: '', trade: '' })} style={{ ...ghostBtn, padding: '7px 12px' }}>Clear</button>}
      </div>

      {ops.length === 0 ? (
        <div style={{ padding: 20, fontSize: 13, color: '#888', background: '#faf9f7', borderRadius: 10 }}>No operatives yet. Add them under H&S → Operatives first.</div>
      ) : (
        <div style={{ border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: NAME_W + shownOps.length * CELL_W }}>
              {/* header: operative names, rotated */}
              <div style={{ display: 'flex', borderBottom: '2px solid #e6b567', background: HEADER_ORANGE, alignItems: 'flex-end' }}>
                <div style={{ width: NAME_W, minWidth: NAME_W, position: 'sticky', left: 0, zIndex: 3, background: HEADER_ORANGE, padding: '8px', fontSize: 12, fontWeight: 700, color: '#3a2e12', alignSelf: 'flex-end' }}>Project RAMS</div>
                {shownOps.map(o => (
                  <div key={o.id} title={`${opName(o)}${o.company ? ` · ${o.company}` : ''}`} style={{ width: CELL_W, minWidth: CELL_W, height: 130, position: 'relative', borderLeft: '1px solid #eab968' }}>
                    <div style={{ position: 'absolute', bottom: 8, left: '50%', transformOrigin: 'left bottom', transform: 'rotate(-60deg)', whiteSpace: 'nowrap', fontSize: 10.5, color: '#3a2e12', fontWeight: 600 }}>{opName(o)}</div>
                  </div>
                ))}
              </div>

              {/* rows */}
              {shownProjects.map((p, ri) => {
                const rowBg = ri % 2 === 1 ? ROW_ALT : '#fff'
                return (
                <div key={p.key} style={{ display: 'flex', borderBottom: '1px solid #f2f2f2', minHeight: ROW_H, alignItems: 'stretch', background: rowBg }}>
                  <div style={{ width: NAME_W, minWidth: NAME_W, position: 'sticky', left: 0, zIndex: 2, background: rowBg, borderRight: '1px solid #f0f0f0', padding: '6px 8px', fontSize: 12, fontWeight: 600, color: INK, display: 'flex', alignItems: 'center' }}>{p.name}</div>
                  {shownOps.map(o => {
                    const signed = !!(signoffs[p.key] && signoffs[p.key][o.id])
                    return (
                      <div key={o.id} onClick={() => toggle(p.key, o.id)} title={`${p.name} — ${opName(o)}`}
                        style={{ width: CELL_W, minWidth: CELL_W, borderLeft: '1px solid #f5f5f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: signed ? '#dcfce7' : 'transparent', fontSize: 12, fontWeight: 700, color: signed ? '#166534' : '#ddd' }}>
                        {signed ? 'Yes' : ''}
                      </div>
                    )
                  })}
                </div>
                )
              })}
              {shownProjects.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: '#aaa' }}>No projects match.</div>}
            </div>
          </div>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: '#999', marginTop: 8 }}>Click a cell to toggle whether that installer has signed onto the project's RAMS. Projects and installers populate automatically.</div>
    </OperationsShell>
  )
}

const lbl = { fontSize: 11, color: '#888', marginBottom: 3 }
const fInput = { padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5 }
