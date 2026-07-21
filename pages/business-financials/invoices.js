import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, monthLbl, fmtDate, Card } from '../../components/BizNav'

const monthKey = (s) => (s || '').slice(0, 7)
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function InvoicesOwed() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [items, setItems] = useState([])
  const [updatedAt, setUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  // Default range: 10 months back → 2 months forward (12 months, 2 in the future).
  const today = new Date()
  const defFrom = isoDay(new Date(today.getFullYear(), today.getMonth() - 10, 1))
  const defTo = isoDay(new Date(today.getFullYear(), today.getMonth() + 3, 0))
  const [from, setFrom] = useState(defFrom)
  const [to, setTo] = useState(defTo)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/business-financials?view=invoices').then(r => r.json()); setItems(d.items || []); setUpdatedAt(d.updatedAt) } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  async function sync() {
    setSyncing(true)
    try { await fetch('/api/business-financials?view=invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'invoices', sync: true }) }); await load() } catch {}
    setSyncing(false)
  }

  const inRange = useMemo(() => items.filter(i => i.dueDate && i.dueDate >= from && i.dueDate <= to), [items, from, to])
  const total = useMemo(() => inRange.reduce((s, i) => s + (i.amountDue || 0), 0), [inRange])
  const sorted = useMemo(() => [...inRange].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')), [inRange])
  const byMonth = useMemo(() => {
    const m = {}
    for (const i of inRange) { const k = monthKey(i.dueDate); m[k] = (m[k] || 0) + (i.amountDue || 0) }
    return Object.keys(m).sort().map(k => ({ month: k, amount: Math.round(m[k]) }))
  }, [inRange])
  const thisMonth = today.toISOString().slice(0, 7)

  if (!ok) return null
  return (
    <>
      <Head><title>Invoices Owed · Business Financials</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <BizNav />
        <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>Invoices Owed</h1>
            <button onClick={sync} disabled={syncing} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: syncing ? 0.6 : 1 }}>{syncing ? 'Syncing…' : '↻ Sync invoices'}</button>
          </div>

          {/* Date range filter */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: '#888' }}>Due between</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={dateInp} />
            <span style={{ fontSize: 12, color: '#888' }}>and</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={dateInp} />
            <button onClick={() => { setFrom(defFrom); setTo(defTo) }} style={{ background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: '#666' }}>Reset (12 mo, 2 ahead)</button>
            <span style={{ marginLeft: 'auto', fontSize: 13, color: '#555' }}>Total owed in range: <strong style={{ color: INK }}>{gbp(total)}</strong> · {inRange.length} invoices</span>
          </div>

          {loading ? <div style={{ color: '#999', padding: 40 }}>Loading…</div> : (
            <>
              <Card title="Invoices falling due by month" sub="Amount owed to us, by due month">
                {byMonth.length === 0 ? <div style={{ color: '#bbb', padding: 30, textAlign: 'center' }}>No invoices due in this range — try “Sync invoices” or widen the dates.</div> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={byMonth} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="month" tickFormatter={monthLbl} tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={48} />
                      <Tooltip formatter={(v) => gbp(v)} labelFormatter={monthLbl} />
                      <ReferenceLine x={thisMonth} stroke="#16a34a" strokeDasharray="4 3" label={{ value: 'now', fontSize: 10, fill: '#16a34a' }} />
                      <Bar dataKey="amount" name="Owed" fill="#16a34a" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

              <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                      <th style={{ ...th, textAlign: 'left' }}>Customer</th>
                      <th style={{ ...th, textAlign: 'left' }}>Invoice</th>
                      <th style={{ ...th, textAlign: 'left' }}>Due date</th>
                      <th style={th}>Amount due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(i => {
                      const overdue = i.dueDate && i.dueDate < today.toISOString().slice(0, 10)
                      return (
                        <tr key={i.id} style={{ borderBottom: '1px solid #f2f0ec' }}>
                          <td style={{ ...td, textAlign: 'left' }}>{i.contact || '—'}</td>
                          <td style={{ ...td, textAlign: 'left', color: '#888' }}>{i.number || '—'}</td>
                          <td style={{ ...td, textAlign: 'left', color: overdue ? '#dc2626' : '#555', fontWeight: overdue ? 600 : 400 }}>{fmtDate(i.dueDate)}{overdue ? ' · overdue' : ''}</td>
                          <td style={{ ...td, fontWeight: 600 }}>{gbp(i.amountDue)}</td>
                        </tr>
                      )
                    })}
                    {sorted.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#bbb', padding: 24 }}>No invoices due in this range.</td></tr>}
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

const th = { padding: '10px 12px', fontSize: 12, color: '#777', fontWeight: 600, textAlign: 'right' }
const td = { padding: '9px 12px', textAlign: 'right' }
const dateInp = { padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }
