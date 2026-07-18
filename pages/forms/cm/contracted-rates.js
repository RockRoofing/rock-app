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
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    setReady(true)
  }, [])

  const { myProjects, loading: projLoading } = useMyProjects(user)

  async function pick(p) {
    setProj(p); setCr(null); setLoading(true)
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
      } else {
        setCr({ items: [] })
      }
    } catch { setCr({ items: [] }) }
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
                {cr?.totals && (
                  <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                    <MiniCard label="Contract works" value={money(cr.totals.aboveTotal)} />
                    <MiniCard label="Below the line" value={money(cr.totals.belowTotal)} muted />
                  </div>
                )}
                <Section title="Above the line" items={above} accent="#0f766e" />
                {below.length > 0 && <Section title="Below the line (optional / variation)" items={below} accent="#b45309" belowLine />}
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

const backLink = { background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }
const Loading = () => <div style={{ textAlign: 'center', color: '#aaa', padding: 30 }}>Loading…</div>
const Empty = ({ children }) => <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>{children}</div>
