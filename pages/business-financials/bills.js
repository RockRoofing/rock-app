import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, monthLbl, fmtDate, Card } from '../../components/BizNav'

const monthKey = (s) => (s || '').slice(0, 7)

export default function BillsToPay() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [items, setItems] = useState([])
  const [updatedAt, setUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [sel, setSel] = useState({})

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/business-financials?view=bills').then(r => r.json()); setItems(d.items || []); setUpdatedAt(d.updatedAt) } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  async function sync() {
    setSyncing(true)
    try { await fetch('/api/business-financials?view=bills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'bills', sync: true }) }); await load() } catch {}
    setSyncing(false)
  }

  const sorted = useMemo(() => [...items].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')), [items])
  const total = useMemo(() => items.reduce((s, i) => s + (i.amountDue || 0), 0), [items])
  const selTotal = useMemo(() => sorted.filter(i => sel[i.id]).reduce((s, i) => s + (i.amountDue || 0), 0), [sorted, sel])
  const selCount = Object.values(sel).filter(Boolean).length

  const byMonth = useMemo(() => {
    const m = {}
    for (const i of items) { const k = monthKey(i.dueDate) || 'No date'; m[k] = (m[k] || 0) + (i.amountDue || 0) }
    return Object.keys(m).sort().map(k => ({ month: k, amount: Math.round(m[k]) }))
  }, [items])

  const thisMonth = new Date().toISOString().slice(0, 7)

  if (!ok) return null
  return (
    <>
      <Head><title>Bills to Pay · Business Financials</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <BizNav />
        <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
            <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>Bills to Pay</h1>
            <button onClick={sync} disabled={syncing} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: syncing ? 0.6 : 1 }}>{syncing ? 'Syncing…' : '↻ Sync bills'}</button>
          </div>

          {loading ? <div style={{ color: '#999', padding: 40 }}>Loading…</div> : (
            <>
              {/* Totals */}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
                <Stat label="Total outstanding" value={gbp(total)} sub={`${items.length} bills`} />
                <Stat label="Selected" value={gbp(selTotal)} sub={`${selCount} selected`} accent />
              </div>

              <Card title="Bills due by month" sub="Total amount due each month (past due on the left, upcoming on the right)">
                {byMonth.length === 0 ? <div style={{ color: '#bbb', padding: 30, textAlign: 'center' }}>No outstanding bills — click “Sync bills”.</div> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={byMonth} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="month" tickFormatter={(m) => m === 'No date' ? 'No date' : monthLbl(m)} tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={48} />
                      <Tooltip formatter={(v) => gbp(v)} labelFormatter={(m) => m === 'No date' ? 'No due date' : monthLbl(m)} />
                      <ReferenceLine x={thisMonth} stroke="#16a34a" strokeDasharray="4 3" label={{ value: 'now', fontSize: 10, fill: '#16a34a' }} />
                      <Bar dataKey="amount" name="Due" fill="#dc2626" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* Table */}
              <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
                  <thead>
                    <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                      <th style={{ ...th, width: 36 }}>
                        <input type="checkbox" checked={selCount > 0 && selCount === sorted.length} onChange={e => setSel(e.target.checked ? Object.fromEntries(sorted.map(i => [i.id, true])) : {})} />
                      </th>
                      <th style={{ ...th, textAlign: 'left' }}>Supplier</th>
                      <th style={{ ...th, textAlign: 'left' }}>Ref</th>
                      <th style={{ ...th, textAlign: 'left' }}>Due date</th>
                      <th style={th}>Amount due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(i => {
                      const overdue = i.dueDate && i.dueDate < new Date().toISOString().slice(0, 10)
                      return (
                        <tr key={i.id} style={{ borderBottom: '1px solid #f2f0ec', background: sel[i.id] ? '#fffbeb' : 'transparent' }}>
                          <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={!!sel[i.id]} onChange={e => setSel(s => ({ ...s, [i.id]: e.target.checked }))} /></td>
                          <td style={{ ...td, textAlign: 'left' }}>{i.contact || '—'}</td>
                          <td style={{ ...td, textAlign: 'left', color: '#888' }}>{i.number || '—'}</td>
                          <td style={{ ...td, textAlign: 'left', color: overdue ? '#dc2626' : '#555', fontWeight: overdue ? 600 : 400 }}>{fmtDate(i.dueDate)}{overdue ? ' · overdue' : ''}</td>
                          <td style={{ ...td, fontWeight: 600 }}>{gbp(i.amountDue)}</td>
                        </tr>
                      )
                    })}
                    {sorted.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#bbb', padding: 24 }}>No outstanding bills.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>Last synced {updatedAt ? new Date(updatedAt).toLocaleString('en-GB') : 'never'}.</div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ background: accent ? '#fffbeb' : '#fff', border: `1px solid ${accent ? '#fde68a' : '#e6e3dc'}`, borderRadius: 12, padding: '14px 18px', minWidth: 180 }}>
      <div style={{ fontSize: 12, color: '#888' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: accent ? '#92400e' : INK, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
const th = { padding: '10px 12px', fontSize: 12, color: '#777', fontWeight: 600, textAlign: 'right' }
const td = { padding: '9px 12px', textAlign: 'right' }
