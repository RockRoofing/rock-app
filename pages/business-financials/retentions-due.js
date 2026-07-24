import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, monthLbl, fmtDate, Card } from '../../components/BizNav'

const monthKey = (s) => (s || '').slice(0, 7)
const pad = (n) => String(n).padStart(2, '0')
const nowMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const todayStr = () => new Date().toISOString().slice(0, 10)

// Mirror of the Retention Tracker helpers so figures always balance with it.
const retStatusOf = (e) => e.retStatus || (e.markedComplete ? 'complete' : 'live')
function calcBalance(e) {
  const r1 = parseFloat(e.release1Value || 0) || 0
  const r2 = parseFloat(e.release2Value || 0) || 0
  const received = (e.release1Received ? r1 : 0) + (e.release2Received ? r2 : 0)
  return (r1 + r2) - received
}

export default function RetentionsDue() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState([])       // merged, same as the tracker
  const [selectedMonth, setSelectedMonth] = useState(null)
  const [sortKey, setSortKey] = useState('date')
  const [sortDir, setSortDir] = useState('asc')

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  async function load() {
    setLoading(true)
    try {
      // Same three sources the Retention Tracker uses, merged the same way, so this
      // page always balances with it.
      const [manualRes, dashRes] = await Promise.all([
        fetch('/api/retention').then(r => r.json()).catch(() => ({ entries: [] })),
        fetch('/api/dashboard').then(r => r.json()).catch(() => ({ projects: [] })),
      ])
      let hiddenIds = []
      try { hiddenIds = (await fetch('/api/hidden-projects').then(r => r.json())).hidden || [] } catch {}
      const hiddenSet = new Set(hiddenIds.map(String))
      const manual = manualRes.entries || []
      const visibleProjects = (dashRes.projects || []).filter(p => !hiddenSet.has(String(p.xeroId)))

      const xeroEntries = visibleProjects.map(p => ({
        id: p.xeroId, xeroId: p.xeroId,
        ourRef: p.jobNo || '', customerName: p.customer || '', projectName: p.name || '',
        retentionOwed: p.totalRetention || 0,
        retention612Allocated: p.retention612Allocated || 0,
        finalAccount: p.afa || 0, projectValue: p.contractValue || 0,
        retentionPct: (p.retentionPct || 0) * 100,
        completionDate: p.completionDate || p.pcDate || '',
        release1Value: (p.totalRetention || 0) / 2 || 0, release1Date: '', release1Received: false,
        release2Value: (p.totalRetention || 0) / 2 || 0, release2Date: '', release2Received: false,
        status: p.status,
      }))

      const xeroByXid = new Map(xeroEntries.map(x => [x.xeroId, x]))
      const merged = manual.map(e => {
        if (e.xeroId && xeroByXid.has(e.xeroId)) {
          const x = xeroByXid.get(e.xeroId)
          return {
            ...e,
            retentionOwed: x.retentionOwed, retention612Allocated: x.retention612Allocated,
            finalAccount: e.finalAccount || x.finalAccount,
            projectValue: e.projectValue || x.projectValue,
            retentionPct: e.retentionPct || x.retentionPct,
            completionDate: e.completionDate || x.completionDate,
          }
        }
        return e
      })
      const manualIds = new Set(manual.map(e => e.xeroId).filter(Boolean))
      const all = [
        ...xeroEntries.filter(x => !manualIds.has(x.xeroId) && !manual.find(e => e.id === x.xeroId)),
        ...merged,
      ].filter(e => !(e.xeroId && hiddenSet.has(String(e.xeroId))))

      setEntries(all)
    } catch (e) { console.error(e) }
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  // Each unreceived release becomes a dated cash-in event. Undated releases are
  // grouped under "Date TBC" so nothing is lost and the total still balances.
  const releases = useMemo(() => {
    const out = []
    for (const e of entries) {
      if (retStatusOf(e) === 'complete') {
        // Complete = fully released; only include anything still flagged not received.
      }
      const name = `${e.ourRef ? e.ourRef + ' - ' : ''}${e.customerName || e.projectName || 'Project'}`
      const r1 = parseFloat(e.release1Value || 0) || 0
      const r2 = parseFloat(e.release2Value || 0) || 0
      if (r1 && !e.release1Received) out.push({ ref: e.ourRef || '', name, project: e.projectName || '', which: '1st release', date: e.release1Date || '', amount: r1, id: (e.id || e.xeroId) + '-r1' })
      if (r2 && !e.release2Received) out.push({ ref: e.ourRef || '', name, project: e.projectName || '', which: '2nd release', date: e.release2Date || '', amount: r2, id: (e.id || e.xeroId) + '-r2' })
    }
    return out
  }, [entries])

  // Balancing check: total of releases here must equal sum of tracker balances.
  const trackerOutstanding = useMemo(() => entries.reduce((s, e) => s + calcBalance(e), 0), [entries])
  const releasesTotal = useMemo(() => releases.reduce((s, r) => s + r.amount, 0), [releases])
  const balanced = Math.abs(trackerOutstanding - releasesTotal) < 1

  // Group DATED releases by month for the chart.
  const byMonth = useMemo(() => {
    const m = {}
    for (const r of releases) { const k = monthKey(r.date) || 'Date TBC'; m[k] = (m[k] || 0) + r.amount }
    // dated months sorted, TBC last
    const keys = Object.keys(m).filter(k => k !== 'Date TBC').sort()
    const arr = keys.map(k => ({ month: k, amount: Math.round(m[k]) }))
    if (m['Date TBC']) arr.push({ month: 'Date TBC', amount: Math.round(m['Date TBC']) })
    return arr
  }, [releases])

  const filtered = useMemo(() => {
    let arr = releases
    if (selectedMonth) arr = arr.filter(r => (monthKey(r.date) || 'Date TBC') === selectedMonth)
    return arr
  }, [releases, selectedMonth])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      let av, bv
      switch (sortKey) {
        case 'ref': av = (a.ref || '').toLowerCase(); bv = (b.ref || '').toLowerCase(); break
        case 'name': av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); break
        case 'amount': av = a.amount || 0; bv = b.amount || 0; break
        case 'date': default:
          // TBC sorts to the end
          av = a.date || '9999-99-99'; bv = b.date || '9999-99-99'; break
      }
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
    return arr
  }, [filtered, sortKey, sortDir])
  const filteredTotal = useMemo(() => sorted.reduce((s, r) => s + r.amount, 0), [sorted])
  const overdueTotal = useMemo(() => releases.filter(r => r.date && r.date < todayStr()).reduce((s, r) => s + r.amount, 0), [releases])
  const tbcTotal = useMemo(() => releases.filter(r => !r.date).reduce((s, r) => s + r.amount, 0), [releases])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'amount' ? 'desc' : 'asc') }
  }
  const arrow = (key) => sortKey === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''

  if (!ok) return null

  return (
    <>
      <Head><title>Retentions Due - Rock Roofing</title></Head>
      <BizNav />
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 24px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
          <div>
            <h1 style={{ margin: 0, color: INK, fontSize: 26 }}>Retentions Due</h1>
            <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4 }}>When outstanding retention is due to land, from the Retention Tracker.</div>
          </div>
          <a href="/retention" style={{ fontSize: 13, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>Open Retention Tracker &rarr;</a>
        </div>

        {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : (
          <>
            {/* Balancing banner */}
            <div style={{ marginBottom: 16, borderRadius: 10, padding: '10px 14px', fontSize: 12.5,
              background: balanced ? '#f0fdf4' : '#fffbeb', border: `1px solid ${balanced ? '#bbf7d0' : '#fde68a'}`, color: balanced ? '#166534' : '#92400e' }}>
              {balanced
                ? <>Balanced with the Retention Tracker: outstanding retention {gbp(trackerOutstanding)} = total shown below.</>
                : <>Note: releases shown ({gbp(releasesTotal)}) differ from tracker outstanding ({gbp(trackerOutstanding)}) by {gbp(releasesTotal - trackerOutstanding)}. This happens when a project is marked Complete with a release still flagged unreceived, or vice-versa - fix it in the Retention Tracker.</>}
            </div>

            {/* Stat cards */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
              <Stat label="Total retention due" value={gbp(releasesTotal)} sub={`${releases.length} releases`} accent />
              <Stat label="Overdue (past due date)" value={gbp(overdueTotal)} sub="Due date has passed, not received" />
              <Stat label="Date to be confirmed" value={gbp(tbcTotal)} sub="No release date set yet" />
            </div>

            {/* Chart */}
            <Card title="Retention due to land by month" sub="Click a bar to filter the schedule below. Undated releases sit under 'Date TBC'.">
              {byMonth.length === 0 ? <div style={{ color: '#bbb', padding: 30, textAlign: 'center' }}>No outstanding retention - everything is either received or not yet set up in the tracker.</div> : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={byMonth} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="month" tickFormatter={(m) => m === 'Date TBC' ? 'TBC' : monthLbl(m)} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={52} />
                    <Tooltip formatter={(v) => gbp(v)} labelFormatter={(m) => m === 'Date TBC' ? 'Date to be confirmed' : monthLbl(m)} />
                    <Bar dataKey="amount" name="Due" cursor="pointer" onClick={(d) => setSelectedMonth(sm => sm === d.month ? null : d.month)}>
                      {byMonth.map((e) => <Cell key={e.month} fill={selectedMonth === e.month ? '#0f766e' : (selectedMonth ? '#99d5cd' : '#14b8a6')} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Schedule table */}
            <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #eee' }}>
                <div style={{ fontWeight: 700, color: INK }}>Release schedule{selectedMonth ? ` - ${selectedMonth === 'Date TBC' ? 'Date TBC' : monthLbl(selectedMonth)}` : ''}</div>
                {selectedMonth && <button onClick={() => setSelectedMonth(null)} style={{ background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', color: '#666' }}>Clear month</button>}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                    <th onClick={() => toggleSort('date')} style={{ ...th, cursor: 'pointer' }}>Due date{arrow('date')}</th>
                    <th onClick={() => toggleSort('ref')} style={{ ...th, textAlign: 'left', cursor: 'pointer' }}>Ref{arrow('ref')}</th>
                    <th onClick={() => toggleSort('name')} style={{ ...th, textAlign: 'left', cursor: 'pointer' }}>Customer / project{arrow('name')}</th>
                    <th style={{ ...th, textAlign: 'left' }}>Release</th>
                    <th onClick={() => toggleSort('amount')} style={{ ...th, cursor: 'pointer' }}>Amount{arrow('amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#bbb', padding: 24 }}>No retention releases{selectedMonth ? ' for this month' : ''}.</td></tr>}
                  {sorted.map((r) => {
                    const overdue = r.date && r.date < todayStr()
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid #f2f0ec' }}>
                        <td style={{ ...td, color: overdue ? '#dc2626' : (r.date ? '#333' : '#b45309'), fontWeight: overdue ? 700 : 400 }}>{r.date ? fmtDate(r.date) : 'TBC'}</td>
                        <td style={{ ...td, textAlign: 'left', color: '#666' }}>{r.ref || '-'}</td>
                        <td style={{ ...td, textAlign: 'left' }}>{r.name}{r.project && r.project !== r.name ? <span style={{ color: '#aaa' }}> - {r.project}</span> : null}</td>
                        <td style={{ ...td, textAlign: 'left', color: '#888' }}>{r.which}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{gbp(r.amount)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                {sorted.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #eee', fontWeight: 700, background: '#faf9f7' }}>
                      <td colSpan={4} style={{ ...td, textAlign: 'right' }}>Total{selectedMonth ? ` (${selectedMonth === 'Date TBC' ? 'Date TBC' : monthLbl(selectedMonth)})` : ''}</td>
                      <td style={{ ...td, fontWeight: 800 }}>{gbp(filteredTotal)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
              Figures come straight from the Retention Tracker (release values, dates and received flags). Marking a release received in the Tracker removes it here; the total always equals the Tracker&apos;s outstanding retention.
            </div>
          </>
        )}
      </div>
    </>
  )
}

function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ flex: '1 1 200px', minWidth: 180, background: accent ? INK : '#fff', color: accent ? '#fff' : INK, border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: accent ? '#cbd2d9' : '#8a857c' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: accent ? '#aab3bd' : '#9a958c', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const th = { padding: '10px 14px', textAlign: 'right', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: '#9a958c', whiteSpace: 'nowrap' }
const td = { padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap' }
