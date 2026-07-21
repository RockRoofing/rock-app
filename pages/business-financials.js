import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

const GOLD = '#ca8a04'
const INK = '#1a1a19'
const TABS = [
  ['Summary', '/business-financials'],
  ['Budgets', '/business-financials/budgets'],
  ['Bills to Pay', '/business-financials/bills'],
  ['Invoices Owed', '/business-financials/invoices'],
  ['Cash Flow', '/business-financials/cashflow'],
]

const gbp = (n) => `£${Math.round(n || 0).toLocaleString('en-GB')}`
const gbpK = (n) => { const v = n || 0; return Math.abs(v) >= 1000 ? `£${Math.round(v / 1000)}k` : `£${Math.round(v)}` }
const monthLbl = (mo) => { const [y, m] = mo.split('-'); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) }

export default function BusinessFinancials() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [months, setMonths] = useState(12)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/business-financials').then(r => r.json()); setData(d) } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  async function syncBank() {
    setSyncing(true)
    try {
      await fetch('/api/business-financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ syncBank: true, monthsBack: 18 }) })
      await load()
    } catch {}
    setSyncing(false)
  }

  if (!ok) return null

  const series = (data?.series || []).slice(-months)
  const pie = data?.costPie || { labour: 0, materials: 0, overheads: 0 }
  const pieData = [
    { name: 'Labour', value: Math.round(pie.labour), color: '#2563eb' },
    { name: 'Materials', value: Math.round(pie.materials), color: '#0f766e' },
    { name: 'Overheads', value: Math.round(pie.overheads), color: GOLD },
  ].filter(d => d.value > 0)

  const hasBank = series.some(s => s.cashIn || s.cashOut)

  return (
    <>
      <Head><title>Business Financials · Rock Roofing</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        {/* Nav */}
        <div style={{ background: INK, padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 56, flexWrap: 'wrap' }}>
            <a href="/" style={{ color: '#9a9a97', fontSize: 13, textDecoration: 'none', marginRight: 8 }}>← Portal</a>
            {TABS.map(([label, href]) => {
              const active = router.pathname === href
              return <a key={href} href={href} style={{ color: active ? '#fff' : '#9a9a97', background: active ? 'rgba(255,255,255,0.1)' : 'transparent', fontSize: 13, fontWeight: active ? 600 : 500, textDecoration: 'none', padding: '7px 12px', borderRadius: 7 }}>{label}</a>
            })}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => window.dispatchEvent(new CustomEvent('open-report-problem'))}
                style={{ background: 'none', border: 'none', color: GOLD, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>⚠ Report app improvement</button>
            </div>
          </div>
        </div>

        <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
            <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>Summary</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <select value={months} onChange={e => setMonths(Number(e.target.value))} style={sel}>
                {[6, 12, 18, 24].map(m => <option key={m} value={m}>Last {m} months</option>)}
              </select>
              <button onClick={syncBank} disabled={syncing} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.6 : 1 }}>{syncing ? 'Syncing…' : '↻ Sync bank'}</button>
            </div>
          </div>

          {loading ? <div style={{ color: '#999', padding: 40 }}>Loading…</div> : !series.length ? (
            <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 30, textAlign: 'center', color: '#999' }}>
              No financial data yet. Sync the Xero figures (Bookkeeping → Sync Xero figures) to populate the P&amp;L, then use “Sync bank” here for cash in/out.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))', gap: 16 }}>

              <Card title="Sales" sub="Invoiced sales at end of each month">
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={series} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="month" tickFormatter={monthLbl} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={48} />
                    <Tooltip formatter={(v) => gbp(v)} labelFormatter={monthLbl} />
                    <Line type="monotone" dataKey="sales" name="Sales" stroke={GOLD} strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              <Card title="Gross margin" sub="(Sales − cost of sales) ÷ sales, by month">
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={series} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="month" tickFormatter={monthLbl} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} width={40} />
                    <Tooltip formatter={(v) => v == null ? '—' : `${v}%`} labelFormatter={monthLbl} />
                    <Line type="monotone" dataKey="grossMarginPct" name="Gross margin" stroke="#0f766e" strokeWidth={2.5} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              <Card title="Direct wages vs sub-contract labour" sub="Monthly labour cost split">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={series} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="month" tickFormatter={monthLbl} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={48} />
                    <Tooltip formatter={(v) => gbp(v)} labelFormatter={monthLbl} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="directWages" name="Direct wages" fill="#2563eb" />
                    <Bar dataKey="subContract" name="Sub-contract labour" fill="#93c5fd" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card title="Cost of sale by category" sub="Total spend across the period">
                {pieData.length === 0 ? <Empty>No cost data.</Empty> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`} labelLine={false}>
                        {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => gbp(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </Card>

              <Card title="Cash in / cash out" sub={hasBank ? 'Actual money in and out each month' : 'No bank data yet — click “Sync bank”'} wide>
                {!hasBank ? <Empty>Click “Sync bank” above to pull actual cash movement from Xero.</Empty> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={series} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="month" tickFormatter={monthLbl} tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={48} />
                      <Tooltip formatter={(v) => gbp(v)} labelFormatter={monthLbl} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="cashIn" name="Cash in" fill="#16a34a" />
                      <Bar dataKey="cashOut" name="Cash out" fill="#dc2626" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

            </div>
          )}

          <div style={{ fontSize: 11, color: '#aaa', marginTop: 16 }}>
            P&amp;L figures: {data?.benchmarkUpdatedAt ? new Date(data.benchmarkUpdatedAt).toLocaleString('en-GB') : 'not synced'} · Bank: {data?.bankUpdatedAt ? new Date(data.bankUpdatedAt).toLocaleString('en-GB') : 'not synced'}
          </div>
        </div>
      </div>
    </>
  )
}

function Card({ title, sub, children, wide }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, padding: 16, gridColumn: wide ? '1 / -1' : 'auto' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: '#999', marginBottom: 10 }}>{sub}</div>}
      {children}
    </div>
  )
}
const Empty = ({ children }) => <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13, textAlign: 'center', padding: 12 }}>{children}</div>
const sel = { padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, background: '#fff' }
