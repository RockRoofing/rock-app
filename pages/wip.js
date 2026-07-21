import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import CommercialNav from '../components/CommercialNav'
import ProjectDatesModal from '../components/ProjectDatesModal'

const GOLD = '#ca8a04'
const INK = '#1a1a19'
const fmtC = (n) => `£${Math.round(n || 0).toLocaleString('en-GB')}`
const fmtDate = (s) => { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
const monthLabel = (mk) => { if (!mk) return ''; const [y, m] = mk.split('-'); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) }

// Build a list of selectable months: 18 back from the current month.
function monthOptions() {
  const now = new Date()
  const out = []
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export default function WipPage() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  // Default = the last COMPLETED month (previous month), and lets you filter back.
  const [month, setMonth] = useState(() => { const n = new Date(); const d = new Date(n.getFullYear(), n.getMonth() - 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
  const [datesModal, setDatesModal] = useState(null)
  const [carriedIds, setCarriedIds] = useState([])
  const [carrying, setCarrying] = useState(null)

  // Carry a last-month adjustment into the CURRENT (selected) month for its project.
  // Toggle a last-month adjustment in/out of the CURRENT month for its project.
  async function carryForward(p, a) {
    setCarrying(a.id)
    try {
      // Is there already an equivalent adjustment in this month? If so, un-tick:
      // remove it. Otherwise, tick on: add it.
      const existing = (p.thisMonthAdj || []).find(t => t.description === (a.description || '') && t.amount === a.amount)
      if (existing) {
        await fetch(`/api/project/${p.id}/wip-adjustments`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adjId: existing.id }),
        })
        setCarriedIds(ids => ids.filter(x => x !== a.id))
      } else {
        await fetch(`/api/project/${p.id}/wip-adjustments`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month, type: 'cost', description: a.description || '', amount: a.amount, margin: a.margin ?? null }),
        })
        setCarriedIds(ids => [...ids, a.id])
      }
      await load()
    } catch {}
    setCarrying(null)
  }

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (!['post-contract', 'management', 'admin'].includes(d.user.role)) { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  async function load() {
    setLoading(true)
    try { const d = await fetch(`/api/wip?month=${month}`).then(r => r.json()); setData(d) } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok, month])

  if (!ok) return null
  const projects = data?.projects || []
  const anyLastMonth = projects.some(p => (p.lastMonthAdj || []).length > 0)

  return (
    <>
      <Head><title>WIP · Rock Roofing</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <CommercialNav active="/wip" />
        <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>

          {/* Header: total WIP + month filter */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
            <div>
              <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>Work in Progress</h1>
              <div style={{ fontSize: 13, color: '#777', marginTop: 2 }}>Figures as at valuation date · {monthLabel(month)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '10px 18px', textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#888' }}>Total WIP</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#16a34a' }}>{fmtC(data?.totalWip)}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Profit in WIP: <strong style={{ color: '#0f766e' }}>{fmtC(data?.totalWipProfit)}</strong></div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Figures as at valuation date (month)</div>
                <select value={month} onChange={e => setMonth(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, background: '#fff' }}>
                  {monthOptions().map(mk => <option key={mk} value={mk}>{monthLabel(mk)}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Missing application/valuation dates — same as Applications / Calendar */}
          {(data?.missingDates || []).length > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
              <span style={{ fontWeight: 700, marginRight: 8 }}>⚠ Missing dates:</span>
              {data.missingDates.map((r, i) => (
                <span key={r.xeroId}>
                  <button onClick={() => setDatesModal({ xeroId: r.xeroId, jobNo: r.jobNo, name: r.name })} style={{ background: 'none', border: 'none', color: '#92400e', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0 }}>{[r.jobNo, r.name].filter(Boolean).join(' — ')}</button>
                  {i < data.missingDates.length - 1 ? <span style={{ margin: '0 6px', color: '#b45309' }}>·</span> : null}
                </span>
              ))}
            </div>
          )}

          {/* Previous month's manual adjustments — information only, NOT in the total.
              Click the grey tick to carry an item forward into the current month. */}
          {anyLastMonth && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '12px 16px', marginBottom: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>Last month's manual adjustments (for information only — not in this month's total). Tick to carry an item into {monthLabel(month)}.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {projects.flatMap(p => (p.lastMonthAdj || []).map((a) => {
                  // Already carried if an equivalent adjustment exists this month.
                  const carried = (p.thisMonthAdj || []).some(t => t.description === a.description && t.amount === a.amount) || carriedIds.includes(a.id)
                  return (
                    <div key={p.id + a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, background: carried ? '#dcfce7' : '#fff', border: `1px solid ${carried ? '#86efac' : '#fde68a'}`, borderRadius: 8, padding: '6px 10px' }}>
                      <button onClick={() => carryForward(p, a)} disabled={carrying === a.id} title={carried ? 'Remove from this month' : 'Carry into this month'}
                        style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', cursor: carrying === a.id ? 'default' : 'pointer', background: carried ? '#16a34a' : '#d1d5db', color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1, flexShrink: 0, opacity: carrying === a.id ? 0.5 : 1 }}>✓</button>
                      <span style={{ fontWeight: 700, color: carried ? '#166534' : '#7c5e10' }}>{[p.jobNo, p.name].filter(Boolean).join(' — ')}</span>
                      <span style={{ flex: 1, color: carried ? '#166534' : '#7c5e10' }}>{a.description || 'Adjustment'}</span>
                      <span style={{ fontWeight: 700, color: carried ? '#166534' : '#7c5e10' }}>{fmtC(a.amount)}</span>
                      {carried && <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>carried ✓</span>}
                    </div>
                  )
                }))}
              </div>
            </div>
          )}

          {loading ? <div style={{ color: '#999', padding: 40 }}>Loading…</div> : projects.length === 0 ? (
            <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 40, textAlign: 'center', color: '#999' }}>
              No WIP to show for {monthLabel(month)}. Projects appear here when there are post-valuation costs, credit notes, or manual adjustments in the month.
            </div>
          ) : (
            projects.map(p => <ProjectSection key={p.id} p={p} month={month} onChange={load} />)
          )}
        </div>
        {datesModal && <ProjectDatesModal project={datesModal} onClose={() => setDatesModal(null)} onSaved={() => { setDatesModal(null); load() }} />}
      </div>
    </>
  )
}

function ProjectSection({ p, month, onChange }) {
  const [sortCol, setSortCol] = useState('date')
  const [sortDir, setSortDir] = useState('asc')
  const [marginEdit, setMarginEdit] = useState(p.margin != null ? (p.margin * 100).toFixed(1) : '')
  const [savingMargin, setSavingMargin] = useState(false)

  useEffect(() => { setMarginEdit(p.margin != null ? (p.margin * 100).toFixed(1) : '') }, [p.margin])

  function sortRows(rows) {
    const arr = [...rows]
    arr.sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol]
      if (sortCol === 'amount') return sortDir === 'asc' ? (av - bv) : (bv - av)
      av = String(av || ''); bv = String(bv || '')
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return arr
  }
  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir(col === 'amount' ? 'desc' : 'asc') }
  }
  const arrow = (col) => sortCol === col ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''

  async function saveMargin() {
    setSavingMargin(true)
    try {
      await fetch(`/api/project/${p.id}/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wipMarginOverride: marginEdit === '' ? null : Number(marginEdit) }),
      })
      await onChange()
    } catch {}
    setSavingMargin(false)
  }

  const sortedCosts = sortRows(p.postValCosts)

  // Credit-note table sorting (default: date descending).
  const [cnCol, setCnCol] = useState('date')
  const [cnDir, setCnDir] = useState('desc')
  const cnArrow = (col) => cnCol === col ? (cnDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''
  function cnToggle(col) { if (cnCol === col) setCnDir(d => d === 'asc' ? 'desc' : 'asc'); else { setCnCol(col); setCnDir(col === 'amount' ? 'desc' : 'asc') } }
  const sortedCredits = [...p.creditNotes].sort((a, b) => {
    let av = cnCol === 'appliedTo' ? (a.appliedTo || a.number) : a[cnCol], bv = cnCol === 'appliedTo' ? (b.appliedTo || b.number) : b[cnCol]
    if (cnCol === 'amount') return cnDir === 'asc' ? (av - bv) : (bv - av)
    av = String(av || ''); bv = String(bv || '')
    return cnDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
  })
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, padding: 18, marginBottom: 18 }}>
      {/* Project header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14, borderBottom: '2px solid #f0eee8', paddingBottom: 10 }}>
        <div>
          <span style={{ fontSize: 17, fontWeight: 800, color: INK }}>{p.jobNo ? `${p.jobNo} — ` : ''}{p.name}</span>
          <span style={{ fontSize: 13, color: '#888', marginLeft: 10 }}>Valuation date: {fmtDate(p.valuationDate)}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 11, color: '#888' }}>Project WIP </span>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#16a34a' }}>{fmtC(p.wipValue)}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
            <span style={{ fontSize: 11, color: '#888' }}>Margin</span>
            <input type="number" value={marginEdit} onChange={e => setMarginEdit(e.target.value)} placeholder="—"
              style={{ width: 60, padding: '3px 6px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, textAlign: 'right' }} />
            <span style={{ fontSize: 11, color: '#888' }}>%</span>
            <button onClick={saveMargin} disabled={savingMargin} style={{ background: '#f0f2f5', border: '1px solid #ddd', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#333' }}>{savingMargin ? '…' : 'Save'}</button>
          </div>
          <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>post-val costs {fmtC(p.postValTotal)}{p.adjTotal ? ` · adj ${fmtC(p.adjTotal)}` : ''} · profit {fmtC(p.wipProfit)}</div>
        </div>
      </div>

      {/* Two columns: costs (wider) + credit notes */}
      <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* LEFT: post-valuation costs */}
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#555', marginBottom: 6 }}>Costs after valuation date → end of month</div>
          {p.valuationIsMonthEnd ? (
            <Empty>Valuation date is the end of the month — no post-valuation costs.</Empty>
          ) : p.postValCosts.length === 0 ? (
            <Empty>No costs after the valuation date this month.</Empty>
          ) : (
            <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#faf9f7' }}>
                    <th style={thSort} onClick={() => toggleSort('date')}>Date{arrow('date')}</th>
                    <th style={thSort} onClick={() => toggleSort('supplier')}>Supplier{arrow('supplier')}</th>
                    <th style={thSort} onClick={() => toggleSort('reference')}>Invoice{arrow('reference')}</th>
                    <th style={thSort} onClick={() => toggleSort('accountName')}>Account{arrow('accountName')}</th>
                    <th style={thSort} onClick={() => toggleSort('type')}>Type{arrow('type')}</th>
                    <th style={{ ...thSort, textAlign: 'right' }} onClick={() => toggleSort('amount')}>Amount{arrow('amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCosts.map((l, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #f2f0ec' }}>
                      <td style={tdL}>{fmtDate(l.date)}</td>
                      <td style={tdL}>{l.supplier || '—'}</td>
                      <td style={{ ...tdL, color: '#888' }}>{l.reference || '—'}</td>
                      <td style={{ ...tdL, color: '#888' }}>{l.accountCode}{l.accountName ? ` ${l.accountName}` : ''}</td>
                      <td style={tdL}>{l.type || '—'}</td>
                      <td style={{ ...tdR, fontWeight: 600 }}>{fmtC(l.amount)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid #eee', background: '#faf9f7' }}>
                    <td style={{ ...tdL, fontWeight: 700 }} colSpan={5}>Total post-valuation costs</td>
                    <td style={{ ...tdR, fontWeight: 800 }}>{fmtC(p.postValTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <ManualAdjustments p={p} month={month} onChange={onChange} />
        </div>

        {/* RIGHT: credit notes */}
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#555', marginBottom: 6 }}>Credit notes against this project</div>
          {p.creditNotes.length === 0 ? (
            <Empty>No credit notes.</Empty>
          ) : (
            <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#faf9f7' }}>
                    <th style={thSort} onClick={() => cnToggle('date')}>Date{cnArrow('date')}</th>
                    <th style={thSort} onClick={() => cnToggle('appliedTo')}>Credit / applied to{cnArrow('appliedTo')}</th>
                    <th style={{ ...thSort, textAlign: 'right' }} onClick={() => cnToggle('amount')}>Amount{cnArrow('amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCredits.map((c, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #f2f0ec' }}>
                      <td style={tdL}>{fmtDate(c.date)}</td>
                      <td style={tdL}>
                        <div>{c.number || '—'}</div>
                        {c.appliedTo && <div style={{ fontSize: 11, color: '#888' }}>→ {c.appliedTo}</div>}
                      </td>
                      <td style={{ ...tdR, fontWeight: 600, color: '#dc2626' }}>−{fmtC(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ManualAdjustments({ p, month, onChange }) {
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const projMarginPct = p.margin != null ? (p.margin * 100).toFixed(1) : ''
  const [margin, setMargin] = useState(projMarginPct)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setMargin(p.margin != null ? (p.margin * 100).toFixed(1) : '') }, [p.margin])

  async function add() {
    if (!amount) return
    setBusy(true)
    try {
      await fetch(`/api/project/${p.id}/wip-adjustments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, type: 'cost', description: desc, amount: Number(amount), margin: margin === '' ? null : Number(margin) }),
      })
      setDesc(''); setAmount(''); setMargin(projMarginPct); await onChange()
    } catch {}
    setBusy(false)
  }
  async function remove(adjId) {
    setBusy(true)
    try {
      await fetch(`/api/project/${p.id}/wip-adjustments`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjId }),
      })
      await onChange()
    } catch {}
    setBusy(false)
  }

  return (
    <div style={{ marginTop: 14, border: '1px solid #eee', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>Manual WIP Cost Adjustments</div>
      <div style={{ fontSize: 11, color: '#b45309', margin: '2px 0 10px' }}>One-off adjustments for this month only — never carried forward. Positive = cost incurred but not yet in Xero (increases WIP); negative = cost you won't recover / a WIP write-down (decreases WIP).</div>
      {(p.thisMonthAdj || []).map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fffbeb', borderRadius: 8, padding: '6px 10px', marginBottom: 6, fontSize: 12.5 }}>
          <span style={{ fontSize: 10, fontWeight: 700, background: '#fde68a', color: '#7c5e10', borderRadius: 6, padding: '1px 6px' }}>{monthLabel(month).split(' ')[0].slice(0, 3)} {month.slice(0, 4)}</span>
          <span style={{ flex: 1, color: '#333' }}>{a.description || 'Adjustment'}</span>
          <span style={{ fontSize: 11, color: '#888' }}>margin {(a.margin != null && a.margin !== '') ? `${a.margin}%` : (p.margin != null ? `${(p.margin * 100).toFixed(1)}% (project)` : '—')}</span>
          <span style={{ fontWeight: 700, color: a.amount < 0 ? '#dc2626' : INK }}>{fmtC(a.amount)}</span>
          <button onClick={() => remove(a.id)} disabled={busy} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description" style={{ flex: 1, padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 12.5 }} />
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (− to reduce)" style={{ width: 140, padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 12.5 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <input type="number" value={margin} onChange={e => setMargin(e.target.value)} placeholder="margin" title="Margin % (defaults to project margin)" style={{ width: 66, padding: '7px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 12.5, textAlign: 'right' }} />
          <span style={{ fontSize: 12, color: '#888' }}>%</span>
        </div>
        <button onClick={add} disabled={busy || !amount} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: busy || !amount ? 'default' : 'pointer', opacity: busy || !amount ? 0.5 : 1, whiteSpace: 'nowrap' }}>+ Add to {monthLabel(month).split(' ')[0]}</button>
      </div>
      {(p.thisMonthAdj || []).length > 0 && (
        <div style={{ fontSize: 12, color: '#777', marginTop: 8 }}>Adjustments for {monthLabel(month)}: <strong style={{ color: '#b45309' }}>Net cost adjustment: {fmtC(p.adjTotal)}</strong></div>
      )}
    </div>
  )
}

const Empty = ({ children }) => <div style={{ border: '1px dashed #e0ddd6', borderRadius: 10, padding: 16, textAlign: 'center', color: '#bbb', fontSize: 12.5 }}>{children}</div>
const thL = { textAlign: 'left', padding: '7px 10px', fontSize: 11, color: '#888', fontWeight: 600 }
const thR = { textAlign: 'right', padding: '7px 10px', fontSize: 11, color: '#888', fontWeight: 600 }
const thSort = { ...thL, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }
const tdL = { textAlign: 'left', padding: '6px 10px' }
const tdR = { textAlign: 'right', padding: '6px 10px' }
