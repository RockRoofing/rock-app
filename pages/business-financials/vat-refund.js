import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, monthLbl, Card } from '../../components/BizNav'

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const nowMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }

export default function VatRefund() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)

  // Default: trailing 12 months to end of current month.
  const now = new Date()
  const [from, setFrom] = useState(iso(new Date(now.getFullYear(), now.getMonth() - 11, 1)))
  const [to, setTo] = useState(iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)))

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
      const r = await fetch(`/api/business-financials?view=vat&from=${from}&to=${to}`)
      setData(await r.json())
    } catch (e) { setData({ months: {}, diag: { lastError: e.message } }) }
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  const months = data?.months || {}
  const rows = useMemo(() => Object.keys(months).sort().map(mk => ({ month: mk, ...months[mk] })), [months])
  const chart = useMemo(() => rows.map(r => ({ month: r.month, netVat: r.netVat, refund: r.refund, payable: r.payable })), [rows])

  const totalRefund = useMemo(() => rows.reduce((s, r) => s + (r.refund || 0), 0), [rows])
  const totalPayable = useMemo(() => rows.reduce((s, r) => s + (r.payable || 0), 0), [rows])
  const netAll = totalPayable - totalRefund
  const thisMonth = months[nowMonth()]

  if (!ok) return null

  return (
    <>
      <Head><title>VAT Refund - Rock Roofing</title></Head>
      <BizNav />
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px 80px' }}>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, color: INK, fontSize: 26 }}>Anticipated VAT Refund</h1>
          <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4 }}>The live VAT position - what a return would show if filed for each month. Output VAT on sales minus input VAT on purchases. Rock files monthly; a negative net (green) means a refund is due from HMRC.</div>
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 18, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: 12 }}>
          <div><div style={flabel}>From</div><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={finput} /></div>
          <div><div style={flabel}>To</div><input type="date" value={to} onChange={e => setTo(e.target.value)} style={finput} /></div>
          <button onClick={load} disabled={loading} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>{loading ? 'Loading...' : 'Refresh from Xero'}</button>
        </div>

        {loading ? <div style={{ color: '#999', padding: 40 }}>Calculating VAT position from Xero...</div> : (
          <>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
              <Stat label="This month's position" value={thisMonth ? (thisMonth.netVat < 0 ? gbp(thisMonth.refund) + ' refund' : gbp(thisMonth.payable) + ' to pay') : 'n/a'} accent={!!thisMonth && thisMonth.netVat < 0} sub={monthLbl(nowMonth())} />
              <Stat label="Total refunds (period)" value={gbp(totalRefund)} sub="Months in a refund position" green />
              <Stat label="Total payable (period)" value={gbp(totalPayable)} sub="Months where VAT is owed" />
              <Stat label="Net over period" value={gbp(Math.abs(netAll)) + (netAll < 0 ? ' refund' : ' to pay')} sub="Payable minus refunds" accent={netAll < 0} />
            </div>

            <Card title="Net VAT by month" sub="Bars below zero (green) are refunds due; bars above zero are VAT payable.">
              {chart.length === 0 ? <div style={{ color: '#bbb', padding: 30, textAlign: 'center' }}>No VAT activity for this period. If you expected data, check the diag line below.</div> : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chart} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="month" tickFormatter={monthLbl} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={52} />
                    <Tooltip formatter={(v) => gbp(v)} labelFormatter={monthLbl} />
                    <ReferenceLine y={0} stroke="#999" />
                    <Bar dataKey="netVat" name="Net VAT">
                      {chart.map((e) => <Cell key={e.month} fill={e.netVat < 0 ? '#16a34a' : '#dc2626'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                    <th style={{ ...th, textAlign: 'left' }}>Month</th>
                    <th style={th}>Sales (net)</th>
                    <th style={th}>Output VAT</th>
                    <th style={th}>Purchases (net)</th>
                    <th style={th}>Input VAT</th>
                    <th style={th}>Net VAT</th>
                    <th style={th}>Position</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#bbb', padding: 24 }}>No VAT data.</td></tr>}
                  {rows.map((r) => (
                    <tr key={r.month} style={{ borderBottom: '1px solid #f2f0ec', background: r.month === nowMonth() ? '#f5faff' : '#fff' }}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{monthLbl(r.month)}</td>
                      <td style={{ ...td, color: '#666' }}>{gbp(r.outputNet)}</td>
                      <td style={td}>{gbp(r.outputVat)}</td>
                      <td style={{ ...td, color: '#666' }}>{gbp(r.inputNet)}</td>
                      <td style={td}>{gbp(r.inputVat)}</td>
                      <td style={{ ...td, fontWeight: 700, color: r.netVat < 0 ? '#16a34a' : INK }}>{gbp(r.netVat)}</td>
                      <td style={{ ...td, fontWeight: 700, color: r.netVat < 0 ? '#16a34a' : '#dc2626' }}>{r.netVat < 0 ? `${gbp(r.refund)} refund` : `${gbp(r.payable)} to pay`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
              Live calculation from Xero transaction VAT (authorised/paid sales &amp; purchase invoices and credit notes) by transaction date. This is an anticipated figure to guide cash flow, not a filed return - always reconcile against Xero&apos;s VAT return before submitting to HMRC.
            </div>

            {data?.diag && (data.diag.lastError || (data.diag.counts && Object.values(data.diag.counts).every(v => !v))) && (
              <div style={{ fontSize: 11, color: '#bbb', marginTop: 12, fontFamily: 'monospace', wordBreak: 'break-word' }}>diag: {JSON.stringify(data.diag)}</div>
            )}
          </>
        )}
      </div>
    </>
  )
}

function Stat({ label, value, sub, accent, green }) {
  const bg = accent ? '#166534' : (green ? '#f0fdf4' : '#fff')
  const fg = accent ? '#fff' : INK
  return (
    <div style={{ flex: '1 1 200px', minWidth: 180, background: bg, color: fg, border: '1px solid ' + (green ? '#bbf7d0' : '#e6e3dc'), borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: accent ? '#bbf7d0' : '#8a857c' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: accent ? '#a7f3d0' : '#9a958c', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const th = { padding: '10px 14px', textAlign: 'right', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: '#9a958c', whiteSpace: 'nowrap' }
const td = { padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap' }
const flabel = { fontSize: 11, color: '#8a857c', marginBottom: 4 }
const finput = { padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, background: '#fff' }
