import { useState, useEffect, useMemo, Fragment } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, GOLD, gbp } from '../../components/BizNav'

const fmtDMY = (iso) => { if (!iso) return '-'; const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${String(y).slice(2)}` }
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
// Middle value, not the mean. One customer who took 300 days on a disputed invoice would
// drag an average badly; the median says what normally happens.
const median = (arr) => {
  if (!arr.length) return 0
  const a = arr.slice().sort((x, y) => x - y)
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2)
}

const th = { padding: '7px 9px', fontSize: 11, color: '#888', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
const td = { padding: '6px 9px', fontSize: 12.5, textAlign: 'right', whiteSpace: 'nowrap' }

// Sortable header. Module scope, and the arrow only appears on the column in use - eight
// permanent arrows is noise, and you cannot tell at a glance which one is active.
function SortTh({ sk, sort, onSort, children, left, title }) {
  const on = sort.key === sk
  return (
    <th style={{ ...th, textAlign: left ? 'left' : 'right', cursor: 'pointer', userSelect: 'none', color: on ? INK : '#888' }}
      onClick={() => onSort(sk)} title={title || 'Click to sort'}>
      {children}
      <span style={{ fontSize: 9, marginLeft: 3, color: on ? '#b45309' : 'transparent' }}>{on && sort.dir === 'asc' ? '\u25B2' : '\u25BC'}</span>
    </th>
  )
}

export default function PaymentPerformance() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [offsets, setOffsets] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState(null)
  // Defaults to value descending - the biggest customers are the ones whose payment
  // behaviour actually moves the forecast.
  const [sort, setSort] = useState({ key: 'value', dir: 'desc' })

  // Clicking the column you are already on flips the direction, which is what everyone
  // expects. A new column starts descending EXCEPT the name, where A-Z is the useful way
  // round and Z-A almost never is.
  const clickSort = (key) => setSort(sc => sc.key === key
    ? { key, dir: sc.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: key === 'name' ? 'asc' : 'desc' })

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true); load()
    })
  }, [])

  async function load() {
    setLoading(true)
    try {
      const d = await fetch('/api/business-financials?view=payment-performance').then(r => r.json())
      setData(d); setOffsets(d.offsets || {})
    } catch {}
    setLoading(false)
  }

  async function refresh() {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/business-financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'payment-performance', action: 'refresh', monthsBack: 24 }),
      }).then(x => x.json())
      if (!r.ok) setMsg(r.error || 'Could not read from Xero.')
      else { setMsg(`${r.count} paid invoices read.`); await load() }
    } catch { setMsg('Could not reach Xero.') }
    setBusy(false)
  }

  async function saveOffsets(next) {
    setOffsets(next)
    try {
      await fetch('/api/business-financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'payment-performance', action: 'save-offsets', offsets: next }),
      })
    } catch {}
  }

  const rows = useMemo(() => {
    if (!data) return []
    const by = {}
    for (const inv of (data.invoices || [])) {
      const k = inv.contact || '(no customer)'
      const late = days(inv.dueDate, inv.paidDate)     // + = paid late, - = paid early
      const taken = days(inv.date, inv.paidDate)       // from issue to payment
      const e = by[k] || (by[k] = { name: k, lates: [], takens: [], value: 0, n: 0, worst: null, invoices: [] })
      e.lates.push(late); e.takens.push(taken); e.value += inv.total; e.n += 1
      if (!e.worst || late > e.worst.late) e.worst = { late, number: inv.number, paidDate: inv.paidDate }
      e.invoices.push({ ...inv, late, taken })
    }
    return Object.values(by).map(e => {
      const medLate = median(e.lates)
      const onTime = e.lates.filter(x => x <= 0).length
      return {
        ...e,
        medLate,
        medTaken: median(e.takens),
        onTimePct: e.n ? Math.round((onTime / e.n) * 100) : 0,
        // Spread between the quickest and slowest half - a customer who is reliably 20
        // days late is far easier to forecast than one who is anywhere from 0 to 60.
        spread: e.lates.length > 1 ? Math.max(...e.lates) - Math.min(...e.lates) : 0,
        invoices: e.invoices.sort((a, b) => b.paidDate.localeCompare(a.paidDate)),
      }
    }).sort((a, b) => {
      const k = sort.key
      const av = k === 'name' ? String(a.name).toLowerCase() : (a[k] || 0)
      const bv = k === 'name' ? String(b.name).toLowerCase() : (b[k] || 0)
      if (av === bv) return 0
      const cmp = av > bv ? 1 : -1
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [data, sort])

  const allLates = rows.flatMap(r => r.lates)
  const overall = median(allLates)

  if (!ok) return null

  return (
    <div style={{ minHeight: '100vh', background: '#f7f6f3' }}>
      <Head><title>Payment Performance - Business Financials</title></Head>
      <BizNav />
      <div style={{ padding: '22px 26px' }}>
        <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>Customer payment performance</h1>
        <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4, maxWidth: 940 }}>
          How long each customer ACTUALLY takes, measured against the due date on paid invoices. Terms tell you what was agreed; this tells
          you what happens. Set a days offset against a customer and every one of their invoices shifts by that many days in the 13-week
          cash flow, instead of being scheduled on a due date nobody has tested.
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '16px 0', flexWrap: 'wrap' }}>
          <button onClick={refresh} disabled={busy}
            style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Reading Xero...' : 'Read paid invoices from Xero'}
          </button>
          {data?.fetchedAt && <span style={{ fontSize: 12, color: '#8a857c' }}>{(data.invoices || []).length} invoices, last 24 months - read {String(data.fetchedAt).slice(0, 10)}</span>}
          {msg && <span style={{ fontSize: 12, fontWeight: 600, color: msg.includes('Could not') ? '#dc2626' : '#16a34a' }}>{msg}</span>}
          {rows.length > 0 && (
            <span style={{ fontSize: 12.5, color: '#5b7085' }}>
              Across everyone the middle invoice is paid <strong style={{ color: overall > 0 ? '#b45309' : '#16a34a' }}>{overall > 0 ? `${overall} days late` : `${Math.abs(overall)} days early`}</strong>
            </span>
          )}
        </div>

        {loading && <div style={{ color: '#999', padding: 30 }}>Loading...</div>}

        {!loading && rows.length === 0 && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#92400e' }}>
            No paid invoices yet - press &quot;Read paid invoices from Xero&quot;. Only invoices Xero marks PAID with a payment date can be
            measured; anything still outstanding tells you nothing about how long it will take.
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                <SortTh sk="name" sort={sort} onSort={clickSort} left>Customer</SortTh>
                <SortTh sk="n" sort={sort} onSort={clickSort}>Invoices</SortTh>
                <SortTh sk="value" sort={sort} onSort={clickSort}>Value</SortTh>
                <SortTh sk="medLate" sort={sort} onSort={clickSort} title="Middle invoice, not the average - one disputed invoice at 300 days would wreck a mean.">Typically paid</SortTh>
                <SortTh sk="medTaken" sort={sort} onSort={clickSort} title="Days from invoice date to payment, whatever the terms said.">Issue to cash</SortTh>
                <SortTh sk="onTimePct" sort={sort} onSort={clickSort}>On time</SortTh>
                <SortTh sk="spread" sort={sort} onSort={clickSort} title="Gap between their fastest and slowest payment. A customer reliably 20 days late is easy to forecast; one anywhere between 0 and 60 is not.">Spread</SortTh>
                <th style={th} title="Days to shift this customer's invoices by in the 13-week cash flow. Blank uses the due date.">Forecast offset</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const o = offsets[r.name]
                  return (
                    <Fragment key={i}>
                      <tr style={{ borderBottom: '1px solid #f2f0ec', cursor: 'pointer', background: open === r.name ? '#f7faf9' : 'transparent' }}
                        onClick={() => setOpen(open === r.name ? null : r.name)}>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>
                          <span style={{ fontSize: 9, color: '#999', marginRight: 4 }}>{open === r.name ? '\u25BC' : '\u25B6'}</span>{r.name}
                        </td>
                        <td style={{ ...td, color: '#999' }}>{r.n}</td>
                        <td style={td}>{gbp(r.value)}</td>
                        <td style={{ ...td, fontWeight: 700, color: r.medLate > 14 ? '#dc2626' : r.medLate > 0 ? '#b45309' : '#16a34a' }}>
                          {r.medLate > 0 ? `${r.medLate}d late` : r.medLate < 0 ? `${Math.abs(r.medLate)}d early` : 'on time'}
                        </td>
                        <td style={{ ...td, color: '#666' }}>{r.medTaken}d</td>
                        <td style={{ ...td, color: r.onTimePct >= 80 ? '#16a34a' : r.onTimePct >= 50 ? '#b45309' : '#dc2626' }}>{r.onTimePct}%</td>
                        <td style={{ ...td, color: r.spread > 45 ? '#dc2626' : '#999' }}>{r.spread}d</td>
                        <td style={td} onClick={e => e.stopPropagation()}>
                          <input type="number" value={o == null ? '' : o} placeholder={String(r.medLate)}
                            onChange={e => {
                              const next = { ...offsets }
                              if (e.target.value === '') delete next[r.name]; else next[r.name] = Number(e.target.value)
                              saveOffsets(next)
                            }}
                            style={{ width: 70, padding: '3px 6px', border: '1px solid ' + (o != null ? '#fed7aa' : '#e5e5e5'), borderRadius: 6, fontSize: 12, textAlign: 'right' }} />
                        </td>
                      </tr>
                      {open === r.name && (
                        <tr>
                          <td colSpan={8} style={{ background: '#fbfdfc', padding: '8px 14px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                              <thead><tr style={{ color: '#888' }}>
                                <th style={{ textAlign: 'left', padding: '3px 6px' }}>Invoice</th>
                                <th style={{ textAlign: 'left', padding: '3px 6px' }}>Due</th>
                                <th style={{ textAlign: 'left', padding: '3px 6px' }}>Paid</th>
                                <th style={{ textAlign: 'right', padding: '3px 6px' }}>Days late</th>
                                <th style={{ textAlign: 'right', padding: '3px 6px' }}>Value</th>
                              </tr></thead>
                              <tbody>
                                {r.invoices.slice(0, 20).map((x, k) => (
                                  <tr key={k} style={{ borderTop: '1px solid #eef3f0' }}>
                                    <td style={{ padding: '3px 6px' }}>{x.number || '-'}</td>
                                    <td style={{ padding: '3px 6px', color: '#777' }}>{fmtDMY(x.dueDate)}</td>
                                    <td style={{ padding: '3px 6px', color: '#777' }}>{fmtDMY(x.paidDate)}</td>
                                    <td style={{ padding: '3px 6px', textAlign: 'right', color: x.late > 14 ? '#dc2626' : x.late > 0 ? '#b45309' : '#16a34a' }}>
                                      {x.late > 0 ? `+${x.late}` : x.late}
                                    </td>
                                    <td style={{ padding: '3px 6px', textAlign: 'right' }}>{gbp(x.total)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {r.invoices.length > 20 && <div style={{ fontSize: 10.5, color: '#999', marginTop: 4 }}>Showing the 20 most recent of {r.invoices.length}.</div>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 10.5, color: '#8a857c', marginTop: 8, lineHeight: 1.45 }}>
              &quot;Typically paid&quot; is the MEDIAN, not the average - one disputed invoice sitting at 300 days would wreck a mean and
              make a reliable customer look terrible. SPREAD is the more useful number for a forecast: a customer who is reliably 20 days
              late can be planned around, one who is anywhere between 0 and 60 cannot, whatever their median says.
              Leaving the offset blank schedules that customer on the invoice due date, as now.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
