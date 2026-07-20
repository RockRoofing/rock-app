import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Shell } from '../index'
import { INK, BRAND, useMyProjects, ProjectPicker, ProjectHeader } from '../../../lib/cmSiteApp'

const money = (n) => (n || n === 0) ? `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
const rate = (n) => n == null || n === '' ? '' : Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// CM › Contracted Rates — project-first, READ-ONLY. Shows the above/below-the-line
// schedule for the selected project (from the portal's Contracted Rates page).
export default function CmContractedRates() {
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

  const { myProjects, loading: projLoading } = useMyProjects(user)

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
  const above = items.filter(x => x.section === 'above')
  const below = items.filter(x => x.section === 'below')

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={backLink}>‹ Home</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 10px' }}>Contracted Rates</h2>

        {!proj ? (
          projLoading ? <Loading /> : <ProjectPicker projects={myProjects} onPick={pick} subtitle="Select one of your projects." />
        ) : (
          <>
            <ProjectHeader project={proj} onBack={() => setProj(null)} />
            {loading ? <Loading /> : !items.length ? (
              <Empty>No contracted rates uploaded for this project yet.</Empty>
            ) : (
              <>
                {/* Above-the-line contract works only (below-the-line hidden). */}
                <Section title="Contract works" items={above} accent="#0f766e" />
                {/* Total line for above-the-line. */}
                {cr?.totals && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f766e', color: '#fff', borderRadius: 12, padding: '12px 16px', marginTop: 2, marginBottom: 16 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>Contract works total</span>
                    <span style={{ fontSize: 16, fontWeight: 800 }}>{money(cr.totals.aboveTotal)}</span>
                  </div>
                )}
                {/* Variations — instructed status + values, below the total. */}
                <VariationsSection variations={variations} />
              </>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}

function Section({ title, items, accent, belowLine }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: accent, margin: '4px 0 8px' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((x, i) => {
          const strike = x.struck ? { textDecoration: 'line-through', color: '#b91c1c', opacity: 0.7 } : {}
          if (x.kind === 'heading') {
            return <div key={x.id || i} style={{ fontWeight: 700, color: '#374151', fontSize: 13.5, marginTop: 4, ...strike }}>{x.description}</div>
          }
          const isText = x.totalMode === 'text'
          const lineTotal = isText ? null : (x.total != null && (x.qty == null || x.rate == null) ? x.total : ((x.qty || 0) * (x.rate || 0)))
          return (
            <div key={x.id || i} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontWeight: 600, color: INK, fontSize: 13.5, ...strike }}>
                  {x.code ? <span style={{ color: '#9ca3af', marginRight: 6 }}>{x.code}</span> : null}{x.description || '—'}
                </div>
                <div style={{ fontWeight: 700, color: INK, fontSize: 13.5, whiteSpace: 'nowrap' }}>
                  {isText ? <span style={{ color: '#a16207', fontStyle: 'italic', fontWeight: 400 }}>{x.totalText || 'TBC'}</span> : money(lineTotal)}
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#777', marginTop: 4 }}>
                {x.qty != null ? `${x.qty} ${x.unit || ''}` : (x.unit || '')}{x.rate != null ? `  ·  @ £${rate(x.rate)}` : ''}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MiniCard({ label, value, muted }) {
  return (
    <div style={{ flex: 1, background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: muted ? '#b45309' : INK, marginTop: 2 }}>{value}</div>
    </div>
  )
}

// Variations with instructed status and value (CM view — financials shown).
function VariationsSection({ variations = [] }) {
  const varValue = (v) => (v.materials != null || v.labour != null || v.profit != null)
    ? (Number(v.materials || 0) + Number(v.labour || 0) + Number(v.profit || 0))
    : (v.finalValue ?? v.value ?? null)
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#b45309', margin: '4px 0 8px' }}>Variations</div>
      {variations.length === 0 ? (
        <Empty>No variations on this project.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {variations.map((v, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <div style={{ fontWeight: 700, color: INK, fontSize: 13.5 }}>{v.varNumber || '—'}</div>
                <div style={{ fontWeight: 700, color: INK, fontSize: 13.5, whiteSpace: 'nowrap' }}>{varValue(v) == null ? '—' : money(varValue(v))}</div>
              </div>
              <div style={{ fontSize: 13, color: '#374151', marginTop: 3 }}>{v.description || '—'}</div>
              <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '2px 9px', background: v.instructed ? '#dcfce7' : '#fef3c7', color: v.instructed ? '#166534' : '#92400e' }}>
                {v.instructed ? 'Instructed' : 'Not instructed'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const backLink = { background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }
const Loading = () => <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading…</div>
const Empty = ({ children }) => <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>{children}</div>
