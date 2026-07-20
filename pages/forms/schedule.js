import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Shell } from './index'
import { INK, BRAND, useMyProjects, ProjectPicker, ProjectHeader } from '../../lib/cmSiteApp'

// Operative › Schedule of Works — project-first, READ-ONLY, NO FINANCIALS.
// Operatives only see projects they have permission to view (useMyProjects).
// Shows item number, description, quantity and unit only — no rates or totals.
// Variations are listed at the bottom (VO number, description, item, qty, instructed
// status) with no financial information.
export default function ScheduleOfWorks() {
  const router = useRouter()
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false)
  const [proj, setProj] = useState(null)
  const [cr, setCr] = useState(null)
  const [variations, setVariations] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    setReady(true)
  }, [])

  // Operatives see every project they have PERMISSION to view (projectAccess),
  // not just projects they're the CM on. `projects` = permission-filtered list.
  const { projects: myProjects, loading: projLoading } = useMyProjects(user)

  async function pick(p) {
    setProj(p); setCr(null); setVariations([]); setLoading(true)
    try {
      const matchKey = (x) => String(x.jobNo || x.projectNo || '').trim()
      let d = await fetch('/api/dashboard').then(r => r.json())
      let row = (d.projects || []).find(x => matchKey(x) === String(p.projectNo).trim())
      if (!row) {
        d = await fetch('/api/dashboard?sync=true').then(r => r.json())
        row = (d.projects || []).find(x => matchKey(x) === String(p.projectNo).trim())
      }
      if (row?.xeroId) {
        const cd = await fetch(`/api/contracted-rates-view?projectId=${encodeURIComponent(row.xeroId)}`).then(r => r.json())
        setCr(cd.contractedRates || { items: [] })
        setVariations(cd.variations || [])
      } else {
        setCr({ items: [] }); setVariations([])
      }
    } catch { setCr({ items: [] }); setVariations([]) }
    setLoading(false)
  }

  if (!ready) return <Shell user={user}><Loading /></Shell>

  const items = cr?.items || []
  // Above-the-line = the contracted works; below-the-line = optional/variation items.
  const above = items.filter(x => x.section === 'above')
  const below = items.filter(x => x.section === 'below')

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={backLink}>‹ Home</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 10px' }}>Schedule of Works</h2>

        {!proj ? (
          projLoading ? <Loading /> : <ProjectPicker projects={myProjects} onPick={pick} subtitle="Select one of your projects." />
        ) : (
          <>
            <ProjectHeader project={proj} onBack={() => { setProj(null); setCr(null); setVariations([]) }} />
            {loading ? <Loading /> : !items.length ? (
              <Empty>No schedule of works uploaded for this project yet.</Empty>
            ) : (
              <>
                <Section title="Works" items={above} />
                {below.length > 0 && <Section title="Additional / optional items" items={below} />}
              </>
            )}

            {/* Variations — non-financial */}
            {!loading && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK, textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0 8px' }}>Variations</div>
                {variations.length === 0 ? (
                  <Empty>No variations on this project.</Empty>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {variations.map((v, i) => (
                      <div key={i} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontWeight: 700, color: INK, fontSize: 14 }}>{v.varNumber || '—'}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '2px 9px', background: v.instructed ? '#dcfce7' : '#fef3c7', color: v.instructed ? '#166534' : '#92400e' }}>
                            {v.instructed ? 'Instructed' : 'Not instructed'}
                          </span>
                        </div>
                        <div style={{ fontSize: 13.5, color: '#374151' }}>{v.description || '—'}</div>
                        {(v.item || v.qty !== '' && v.qty != null) && (
                          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
                            {v.item ? <>Item {v.item}</> : null}
                            {v.item && (v.qty !== '' && v.qty != null) ? ' · ' : ''}
                            {(v.qty !== '' && v.qty != null) ? <>Qty {v.qty}{v.unit ? ` ${v.unit}` : ''}</> : null}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}

// A section of schedule items. Renders ONLY item number, description, qty and unit.
// No rate or total column is displayed anywhere.
function Section({ title, items }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: INK, textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0 8px' }}>{title}</div>
      <div style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, overflow: 'hidden' }}>
        {items.map((x, i) => {
          const isHeading = x.kind === 'heading'
          const strike = x.struck ? { textDecoration: 'line-through', opacity: 0.5 } : {}
          if (isHeading) {
            return <div key={x.id || i} style={{ fontWeight: 700, color: '#374151', fontSize: 13.5, padding: '9px 12px', background: '#f7f6f2', ...strike }}>{x.description}</div>
          }
          const hasQty = x.qty != null && x.qty !== ''
          return (
            <div key={x.id || i} style={{ display: 'flex', gap: 10, padding: '9px 12px', borderTop: i === 0 ? 'none' : '1px solid #f0eee8', ...strike }}>
              <div style={{ minWidth: 42, fontWeight: 700, color: BRAND, fontSize: 13 }}>{x.code || ''}</div>
              <div style={{ flex: 1, fontSize: 13.5, color: '#374151' }}>{x.description}</div>
              {hasQty && <div style={{ whiteSpace: 'nowrap', fontSize: 13, color: '#111', fontWeight: 600 }}>{x.qty}{x.unit ? ` ${x.unit}` : ''}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Loading() { return <div style={{ textAlign: 'center', color: '#999', fontSize: 14, padding: 30 }}>Loading…</div> }
function Empty({ children }) { return <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 22, textAlign: 'center', color: '#999', fontSize: 14 }}>{children}</div> }
const backLink = { background: 'none', border: 'none', color: BRAND, fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: '4px 0' }
