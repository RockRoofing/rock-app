import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'

const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n || 0)
const INK = '#1a1a2e'

const th = { textAlign: 'left', padding: '10px 12px', fontSize: 11, color: '#777', fontWeight: 600, borderBottom: '2px solid #eee', whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #f2f0ec' }

export default function BookkeepingPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('bills')       // bills | invoices | wages
  const [month, setMonth] = useState('')        // '' = all months
  const [supplier, setSupplier] = useState('')
  const [code, setCode] = useState('')          // account code filter

  useEffect(() => {
    fetch('/api/bookkeeping').then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    return tab === 'bills' ? data.bills : tab === 'wages' ? data.wages : data.invoices
  }, [data, tab])

  // Filter options
  const months = useMemo(() => [...new Set((rows || []).map(r => r.month).filter(Boolean))].sort().reverse(), [rows])
  const suppliers = useMemo(() => [...new Set((rows || []).map(r => (r.supplier || r.contact || '').trim()).filter(Boolean))].sort(), [rows])
  const codes = useMemo(() => [...new Set((rows || []).map(r => String(r.accountCode || '')).filter(Boolean))].sort(), [rows])

  const filtered = useMemo(() => {
    return (rows || []).filter(r => {
      if (month && r.month !== month) return false
      if (supplier && (r.supplier || r.contact || '').trim() !== supplier) return false
      if (code && String(r.accountCode || '') !== code) return false
      return true
    })
  }, [rows, month, supplier, code])

  const untaggedTotal = useMemo(() => filtered.reduce((s, r) => s + (r.amount != null ? r.amount : (r.total || 0)), 0), [filtered])

  // ── Reconciliation figures (for the selected month; needs a benchmark) ──
  const recon = useMemo(() => {
    if (!data) return null
    const bm = data.benchmark?.months || {}
    // App categorised totals per month
    const app = data.appCategorised || {}
    const monthsToSum = month ? [month] : Object.keys({ ...bm, ...app })
    let xeroCost = 0, xeroSales = 0, appCost = 0, appSales = 0
    for (const m of monthsToSum) {
      const acc = bm[m] || {}
      // Sum P&L accounts: treat "Sales"/"Income" style positive as sales; cost-of-sale as cost.
      // We approximate: any account the app knows as cost-of-sale contributes to xeroCost.
      for (const [name, val] of Object.entries(acc)) {
        const lname = name.toLowerCase()
        if (lname.includes('sales') || lname.includes('income') || lname.includes('revenue')) xeroSales += val
        else xeroCost += val
      }
      appCost += (app[m]?.cost || 0)
      appSales += (app[m]?.sales || 0)
    }
    return { xeroCost, xeroSales, appCost, appSales, hasBenchmark: Object.keys(bm).length > 0 }
  }, [data, month])

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#f0f2f5' }}>
      <div style={{ background: INK, padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 56, gap: 8, overflowX: 'auto' }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <Link href="/" style={{ color: '#aaa', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>← Portal</Link>
          <span style={{ color: '#444' }}>|</span>
          <span style={{ color: '#fff', fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap' }}>Bookkeeping</span>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 24px' }}>
        <p style={{ color: '#666', fontSize: 14, margin: '0 0 20px' }}>
          Transactions in Xero that have <strong>no project tracking category</strong> — so they aren't attributed to a project in the app. Reconcile the app against Xero each month and tag anything missing at source.
        </p>

        {loading ? <div style={{ color: '#aaa', padding: 40 }}>Loading…</div> : !data ? <div style={{ color: '#b91c1c', padding: 40 }}>Could not load.</div> : (
          <>
            {/* Reconciliation summary */}
            <ReconSummary recon={recon} month={month} untaggedTotal={untaggedTotal} tab={tab}
              missingCodes={data.missingCodes} benchmarkUpdatedAt={data.benchmarkUpdatedAt} />

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, margin: '20px 0 0' }}>
              {[['bills', 'Costs (Bills)'], ['invoices', 'Sales Invoices'], ['wages', 'Direct Wages']].map(([id, label]) => (
                <button key={id} onClick={() => { setTab(id); setSupplier(''); setCode('') }}
                  style={{ padding: '9px 16px', fontSize: 13, fontWeight: tab === id ? 700 : 500, border: 'none', borderRadius: '8px 8px 0 0', cursor: 'pointer',
                    background: tab === id ? '#fff' : '#e8e8ea', color: tab === id ? INK : '#777' }}>{label}</button>
              ))}
            </div>

            {/* Filters */}
            <div style={{ background: '#fff', borderRadius: '0 8px 8px 8px', padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
                <select value={month} onChange={e => setMonth(e.target.value)} style={sel}>
                  <option value="">All months</option>
                  {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
                <select value={supplier} onChange={e => setSupplier(e.target.value)} style={sel}>
                  <option value="">{tab === 'invoices' ? 'All customers' : 'All suppliers'}</option>
                  {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {tab !== 'invoices' && (
                  <select value={code} onChange={e => setCode(e.target.value)} style={sel}>
                    <option value="">All account codes</option>
                    {codes.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                {(month || supplier || code) && (
                  <button onClick={() => { setMonth(''); setSupplier(''); setCode('') }} style={{ ...sel, cursor: 'pointer', color: '#b45309', border: '1px solid #fde68a', background: '#fffbeb' }}>Clear filters</button>
                )}
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 13, color: '#555' }}>
                  {filtered.length} item{filtered.length !== 1 ? 's' : ''} · <strong>{fmt(untaggedTotal)}</strong> untagged
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Date</th>
                      <th style={th}>{tab === 'invoices' ? 'Customer' : 'Supplier'}</th>
                      <th style={th}>{tab === 'invoices' ? 'Invoice' : 'Reference'}</th>
                      <th style={th}>Description</th>
                      {tab !== 'invoices' && <th style={th}>Code</th>}
                      <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={6} style={{ ...td, color: '#aaa', textAlign: 'center', padding: 30 }}>Nothing untagged here — everything in this view is attributed to a project. 👍</td></tr>
                    ) : filtered.map((r, i) => (
                      <tr key={i} style={{ background: i % 2 ? '#fcfbf9' : '#fff' }}>
                        <td style={td}>{r.date || '—'}</td>
                        <td style={td}>{r.supplier || r.contact || '—'}</td>
                        <td style={td}>{r.invoiceNumber || r.reference || '—'}</td>
                        <td style={{ ...td, maxWidth: 320, whiteSpace: 'normal' }}>{r.description || '—'}</td>
                        {tab !== 'invoices' && (
                          <td style={td}>
                            {r.accountCode || '—'}
                            {r.accountCode && !r.hasCode && <span title="This account code isn't set up in the app's Account Categorisation" style={{ marginLeft: 6, fontSize: 9, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>NOT IN APP</span>}
                          </td>
                        )}
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt(r.amount != null ? r.amount : r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ReconSummary({ recon, month, untaggedTotal, tab, missingCodes, benchmarkUpdatedAt }) {
  if (!recon) return null
  const isSales = tab === 'invoices'
  const xero = isSales ? recon.xeroSales : recon.xeroCost
  const app = isSales ? recon.appSales : recon.appCost
  const diff = xero - app
  const matches = Math.abs(diff) < 1

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
      <Card label={`In Xero (${isSales ? 'sales' : 'cost of sale'})`} value={recon.hasBenchmark ? fmt(xero) : '—'}
        sub={month ? monthLabel(month) : 'all months'} />
      <Card label="Categorised in app" value={fmt(app)} sub="attributed to projects" />
      <Card label="Difference (Xero − app)" value={recon.hasBenchmark ? fmt(diff) : '—'}
        color={!recon.hasBenchmark ? '#999' : matches ? '#16a34a' : '#dc2626'}
        sub={!recon.hasBenchmark ? 'benchmark pending' : matches ? 'reconciles ✓' : 'does not match'} />
      <Card label="Untagged in this view" value={fmt(untaggedTotal)} color="#b45309" sub="needs a project tag in Xero" />
      {missingCodes && missingCodes.length > 0 && (
        <div style={{ gridColumn: '1 / -1', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#b91c1c' }}>
          <strong>{missingCodes.length} cost-of-sale account code{missingCodes.length !== 1 ? 's' : ''} not set up in the app:</strong> {missingCodes.join(', ')} — add them in Admin → Account Categorisation so their costs are captured.
        </div>
      )}
      {!recon.hasBenchmark && (
        <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#999' }}>
          The Xero benchmark refreshes overnight (first run after deploy). Until then, the "in Xero" and "difference" figures show once available.
        </div>
      )}
      {benchmarkUpdatedAt && <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#bbb' }}>Xero figures as of {new Date(benchmarkUpdatedAt).toLocaleString('en-GB')}</div>}
    </div>
  )
}

function Card({ label, value, sub, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || INK }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

const sel = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff' }
function monthLabel(m) {
  if (!m) return ''
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}
