import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Shell } from '../index'
import { INK, BRAND, useMyProjects, ProjectPicker, ProjectHeader } from '../../../lib/cmSiteApp'

// CM > Project Finance. Project-first, READ-ONLY, high level only.
// Margin is on the same basis as the EOM report (last completed month's valuation date,
// including WIP), so it matches what Commercial see.

const money = (n) => (n || n === 0)
  ? `${n < 0 ? '-' : ''}\u00a3${Math.abs(Number(n)).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`
  : '\u2014'
const pct1 = (n) => (n || n === 0) ? `${(Number(n) * 100).toFixed(1)}%` : '\u2014'
const fmtDay = (s) => {
  if (!s) return ''
  const d = new Date(s + 'T00:00:00')
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function CmProjectFinance() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [proj, setProj] = useState(null)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [costTab, setCostTab] = useState('labour')

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    let u = null
    try { u = JSON.parse(s) } catch {}
    // Project Finance is Contracts Manager only.
    if (!u || u.accessLevel !== 'contracts-manager') { router.replace('/forms'); return }
    setUser(u); setReady(true)
  }, [])

  const { myProjects, loading: projLoading } = useMyProjects(user)
  // Only LIVE projects - a CM does not need finance on completed or archived jobs here.
  const liveProjects = (myProjects || []).filter(p => (p.status || 'active') === 'active')

  async function pick(p) {
    setProj(p); setData(null); setErr(''); setLoading(true)
    try {
      const r = await fetch(`/api/cm-project-financials?no=${encodeURIComponent(p.projectNo)}&name=${encodeURIComponent(user?.name || '')}`)
      const d = await r.json()
      if (!r.ok) setErr(d.error || 'Could not load the figures.')
      else setData(d)
    } catch { setErr('Could not load the figures.') }
    setLoading(false)
  }

  if (!ready) return null

  return (
    <Shell>
      {!proj ? (
        <>
          <button onClick={() => router.push('/forms')} style={backLink}>&lsaquo; Back</button>
          <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 4px' }}>Project Finance</h2>
          {projLoading
            ? <div style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>Loading...</div>
            : <ProjectPicker projects={liveProjects} onPick={pick} subtitle="Select a live project you are Contracts Manager on." />}
        </>
      ) : (
        <>
          <ProjectHeader project={proj} onBack={() => { setProj(null); setData(null); setErr('') }} />
          {loading ? <div style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>Loading...</div>
            : err ? <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 12, padding: 16, fontSize: 14 }}>{err}</div>
              : data ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                  <div style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 16, padding: 18, textAlign: 'center' }}>
                    <div style={{ fontSize: 13, color: '#888', fontWeight: 600 }}>Project margin</div>
                    <div style={{ fontSize: 42, fontWeight: 800, lineHeight: 1.1, marginTop: 4, color: data.margin == null ? '#9ca3af' : data.margin < 0 ? '#dc2626' : data.margin < 0.1 ? '#d97706' : '#16a34a' }}>
                      {pct1(data.margin)}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#888', marginTop: 6 }}>
                      {data.asAt ? `As at ${fmtDay(data.asAt)} valuation` : 'No valuation date set for last month'}
                    </div>
                  </div>

                  <Budget title="Labour" b={data.labour} />
                  <Budget title="Materials" b={data.materials} />
                  <Budget title="Total" b={data.total} strong />

                  <CostsTable costs={data.costs || []} totals={data.costTotals || {}}
                    truncated={!!data.costsTruncated} tab={costTab} setTab={setCostTab} />

                  <div style={{ fontSize: 11.5, color: '#999', textAlign: 'center', lineHeight: 1.5, padding: '0 6px' }}>
                    Margin is on the same basis as the EOM report - to the last completed month&apos;s
                    valuation date, including WIP. Budgets include instructed variations.
                    Figures are indicative; Commercial hold the definitive position.
                  </div>
                </div>
              ) : null}
        </>
      )}
    </Shell>
  )
}


// Costs actually incurred, split labour / materials. Newest first.
function CostsTable({ costs, totals, truncated, tab, setTab }) {
  const rows = (costs || []).filter(c => tab === 'all' ? true : c.type.toLowerCase() === tab)
  const shownTotal = rows.reduce((s, c) => s + (c.amount || 0), 0)
  const tabs = [
    ['labour', 'Labour', totals.labour],
    ['materials', 'Materials', totals.materials],
    ['all', 'All', (totals.labour || 0) + (totals.materials || 0)],
  ]
  return (
    <div style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 16, padding: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 10 }}>Costs incurred</div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {tabs.map(([k, label, tot]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: '9px 4px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
            border: '1px solid ' + (tab === k ? BRAND : '#e3e0d9'),
            background: tab === k ? BRAND : '#fff', color: tab === k ? '#fff' : INK,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 1 }}>{money(tot)}</div>
          </button>
        ))}
      </div>

      {!rows.length ? (
        <div style={{ color: '#999', fontSize: 13.5, textAlign: 'center', padding: '14px 0' }}>No costs recorded.</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#faf9f7' }}>
                  <th style={thL}>Date</th>
                  <th style={thL}>Supplier / description</th>
                  <th style={thR}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f1efea' }}>
                    <td style={{ ...tdL, whiteSpace: 'nowrap', color: '#888' }}>{shortDate(c.date)}</td>
                    <td style={tdL}>
                      <div style={{ fontWeight: 600, color: INK }}>{c.supplier || '\u2014'}</div>
                      {c.description && c.description !== c.supplier &&
                        <div style={{ color: '#999', fontSize: 11.5, marginTop: 1 }}>{c.description}</div>}
                    </td>
                    <td style={{ ...tdR, whiteSpace: 'nowrap', fontWeight: 600 }}>{money(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #e3e0d9' }}>
                  <td style={tdL} colSpan={2}><strong>{rows.length} line{rows.length === 1 ? '' : 's'}</strong></td>
                  <td style={{ ...tdR, fontWeight: 800 }}>{money(shownTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {truncated && (
            <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 8 }}>
              Showing the 400 most recent lines of {totals.count}. The tab totals above are for ALL lines.
            </div>
          )}
        </>
      )}
    </div>
  )
}

const shortDate = (s) => {
  if (!s) return ''
  const d = new Date(s + 'T00:00:00')
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}
const thL = { textAlign: 'left', padding: '7px 6px', fontSize: 11.5, color: '#888', fontWeight: 700 }
const thR = { textAlign: 'right', padding: '7px 6px', fontSize: 11.5, color: '#888', fontWeight: 700 }
const tdL = { textAlign: 'left', padding: '8px 6px', verticalAlign: 'top' }
const tdR = { textAlign: 'right', padding: '8px 6px', verticalAlign: 'top' }

function Budget({ title, b, strong }) {
  const d = b || {}
  const over = !!d.over
  const used = d.pctUsed == null ? 0 : Math.max(0, Math.min(1, d.pctUsed))
  const barColour = over ? '#dc2626' : used > 0.9 ? '#d97706' : '#16a34a'
  return (
    <div style={{ background: '#fff', border: `1px solid ${strong ? '#d9d5cc' : '#e3e0d9'}`, borderRadius: 16, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{title}</div>
        <div style={{ fontSize: 12.5, color: over ? '#dc2626' : '#888', fontWeight: over ? 700 : 500 }}>
          {d.pctUsed == null ? 'No budget set' : `${(used * 100).toFixed(0)}% used${over ? ' - OVER' : ''}`}
        </div>
      </div>

      <div style={{ height: 8, background: '#f1efea', borderRadius: 6, overflow: 'hidden', margin: '10px 0 12px' }}>
        <div style={{ width: `${used * 100}%`, height: '100%', background: barColour }} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Cell label="Budget" value={money(d.budget)} />
        <Cell label="Spend" value={money(d.spend)} />
        <Cell label="Remaining" value={money(d.remaining)} colour={d.remaining < 0 ? '#dc2626' : '#16a34a'} />
      </div>
    </div>
  )
}

function Cell({ label, value, colour }) {
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontSize: 11.5, color: '#999', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: colour || INK, marginTop: 2 }}>{value}</div>
    </div>
  )
}

const backLink = { background: 'none', border: 'none', color: BRAND, fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 0 }
