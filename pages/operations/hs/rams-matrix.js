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

  if (loading) return (
    <OperationsShell active="hs:rams-matrix" section="hs" title="RAMS Matrix" wide><PageHeading title="RAMS Matrix" /><Loading /></OperationsShell>
  )

  const opName = (o) => `${o.firstName} ${o.lastName}`

  // Approval-stage pipeline shown under each project name.
  const STAGE_ORDER = ['cm', 'director', 'site-manager', 'operatives']
  const StageLine = ({ stage, opsSigned }) => {
    const labels = [['cm', 'CM'], ['director', 'Director'], ['site-manager', 'Site Manager'], ['operatives', 'Operatives']]
    const complete = stage === 'complete'
    const curIdx = complete ? labels.length : STAGE_ORDER.indexOf(stage)
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2, fontSize: 10 }}>
        {labels.map(([k, label], i) => {
          // A stage node is green when the chain has moved past it. The Operatives
          // node also turns green once at least one operative has signed.
          const isOpsNode = k === 'operatives'
          const done = complete || i < curIdx || (isOpsNode && opsSigned)
          const current = !complete && i === curIdx && !(isOpsNode && opsSigned)
          const colour = done ? '#16a34a' : current ? '#dc2626' : '#bbb'
          return (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <span style={{ color: colour, fontWeight: current ? 800 : 500 }}>{label}</span>
              {i < labels.length - 1 && <span style={{ color: '#ccc' }}>›</span>}
            </span>
          )
        })}
      </div>
    )
  }

  return (
    <OperationsShell active="hs:rams-matrix" section="hs" title="RAMS Matrix" wide>
      <PageHeading title="RAMS Matrix" sub="Which installers have signed onto each project's RAMS. Projects down the side, installers across the top." />

      {/* Key */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 12, fontSize: 12.5, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 18, height: 18, borderRadius: 4, background: '#dcfce7', color: '#166534', fontWeight: 700, fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Yes</span> Signed RAMS</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 18, height: 18, borderRadius: 4, background: '#fed7aa', color: '#9a3412', fontWeight: 700, fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>PS</span> Pending Signature</span>
        <button onClick={load} style={{ ...ghostBtn, padding: '6px 12px', marginLeft: 'auto' }}>↻ Refresh</button>
      </div>

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
                // Chain has reached operatives → everyone not-yet-signed shows PS.
                const opsReached = p.stage === 'operatives' || p.stage === 'complete'
                const signerSet = new Set(p.signerKeys || [])
                const opsSigned = signerSet.size > 0
                const allSigned = opsReached && shownOps.length > 0 && shownOps.every(o => signerSet.has(opName(o).trim().toLowerCase()))
                return (
                <div key={p.key} style={{ display: 'flex', borderBottom: '1px solid #f2f2f2', minHeight: ROW_H, alignItems: 'stretch', background: rowBg }}>
                  <div style={{ width: NAME_W, minWidth: NAME_W, position: 'sticky', left: 0, zIndex: 2, background: rowBg, borderRight: '1px solid #f0f0f0', padding: '6px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: INK }}>{p.name}</div>
                    {p.hasRams
                      ? <StageLine stage={allSigned ? 'complete' : p.stage} opsSigned={opsSigned} />
                      : <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>No RAMS uploaded</div>}
                  </div>
                  {shownOps.map(o => {
                    const key = opName(o).trim().toLowerCase()
                    const signed = signerSet.has(key)
                    const state = signed ? 'yes' : (opsReached ? 'ps' : '')
                    const bg = state === 'yes' ? '#dcfce7' : state === 'ps' ? '#fed7aa' : 'transparent'
                    const fg = state === 'yes' ? '#166534' : state === 'ps' ? '#9a3412' : '#ddd'
                    return (
                      <div key={o.id} title={`${p.name} — ${opName(o)}`}
                        style={{ width: CELL_W, minWidth: CELL_W, borderLeft: '1px solid #f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, fontSize: 11, fontWeight: 700, color: fg }}>
                        {state === 'yes' ? 'Yes' : state === 'ps' ? 'PS' : ''}
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
      <div style={{ fontSize: 11.5, color: '#999', marginTop: 8 }}>Cells update automatically as operatives sign in the Site App. <strong>Yes</strong> = signed all current RAMS; <strong>PS</strong> = RAMS approved through to operatives and awaiting their signature. The line under each project shows the approval stage (current stage in red, completed stages in green).</div>
    </OperationsShell>
  )
}

const lbl = { fontSize: 11, color: '#888', marginBottom: 3 }
const fInput = { padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5 }
