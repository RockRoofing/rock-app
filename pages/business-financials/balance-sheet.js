import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, GOLD, gbp } from '../../components/BizNav'

const pad = (n) => String(n).padStart(2, '0')
const nowMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const monthsBetween = (a, b) => {
  if (!a || !b) return null
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am) + 1
}

const inp = { padding: '5px 7px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12.5, fontFamily: 'inherit' }
const th = { padding: '7px 8px', fontSize: 11, color: '#888', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
const td = { padding: '6px 8px', fontSize: 12.5, textAlign: 'right', whiteSpace: 'nowrap' }

// NOTHING IS HARD-CODED TO ROCK ROOFING'S CHART OF ACCOUNTS.
//
// Accounts are whatever Xero's Balance Sheet returns for the connected tenant, grouped by
// whatever sections that report produces. A different company with different codes works
// unchanged - which is the point if this is ever sold on. The only judgement the page
// makes is a SUGGESTION of which sections usually contain payable liabilities, and that
// is a hint on screen, never a filter.
const LIKELY = ['liabilit', 'payable', 'loan', 'creditor', 'tax', 'paye', 'hire', 'finance']
const looksPayable = (section, name) => {
  const s = `${section} ${name}`.toLowerCase()
  return LIKELY.some(w => s.includes(w))
}

export default function BalanceSheetPage() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState([])
  const [items, setItems] = useState([])
  const [asAt, setAsAt] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

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
      const d = await fetch('/api/business-financials?view=balance-sheet').then(r => r.json())
      setAccounts(Array.isArray(d.accounts) ? d.accounts : [])
      setItems(Array.isArray(d.items) ? d.items : [])
      setAsAt(d.asAt || null); setFetchedAt(d.fetchedAt || null)
    } catch {}
    setLoading(false)
  }

  async function refresh() {
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/business-financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'balance-sheet', action: 'refresh' }),
      })
      const d = await res.json()
      if (!d.ok) setMsg(d.error || 'Could not read the balance sheet from Xero.')
      else { setAccounts(d.accounts || []); setAsAt(d.asAt); setMsg(`${(d.accounts || []).length} accounts read from Xero.`) }
    } catch (e) { setMsg('Could not reach Xero.') }
    setBusy(false)
  }

  async function saveItems(next) {
    setItems(next)
    try {
      const res = await fetch('/api/business-financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'balance-sheet', action: 'save-items', items: next }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) setMsg('NOT SAVED - check your connection.')
    } catch { setMsg('NOT SAVED - check your connection.') }
  }

  const tracked = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  function track(a) {
    if (tracked.has(a.id)) return
    // Liability seeded from Xero as a POSITIVE amount owed. The Balance Sheet carries
    // liabilities negative, and typing "how much do we owe" as a minus is a trap.
    saveItems([...items, {
      id: a.id, name: a.name, section: a.section,
      liability: Math.abs(a.balance || 0),
      monthly: '', day: 28, start: nowMonth(), end: '', note: '', inForecast: true,
    }])
  }
  const untrack = (id) => saveItems(items.filter(i => i.id !== id))
  const upd = (id, patch) => saveItems(items.map(i => i.id === id ? { ...i, ...patch } : i))

  const bySection = useMemo(() => {
    const m = {}
    for (const a of accounts) { (m[a.section || 'Other'] = m[a.section || 'Other'] || []).push(a) }
    return m
  }, [accounts])

  const monthlyTotal = items.filter(i => i.inForecast !== false).reduce((s, i) => s + (Number(i.monthly) || 0), 0)
  const liabilityTotal = items.reduce((s, i) => s + (Number(i.liability) || 0), 0)

  if (!ok) return null

  return (
    <div style={{ minHeight: '100vh', background: '#f7f6f3' }}>
      <Head><title>Balance Sheet - Business Financials</title></Head>
      <BizNav />
      <div style={{ padding: '22px 26px' }}>
        <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>Balance sheet - financing &amp; tax</h1>
        <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4, maxWidth: 900 }}>
          Cash that leaves the bank but never appears in the P&amp;L: loan and HP CAPITAL repayments, HMRC arrears, corporation tax, dividends.
          The cost was recognised when it arose, so paying the liability down is a balance sheet movement only - put it in overheads and you
          would count the same money twice. Anything ticked here feeds the &quot;Financing &amp; tax&quot; column on the 13-week cash flow.
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '16px 0', flexWrap: 'wrap' }}>
          <button onClick={refresh} disabled={busy}
            style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Reading Xero...' : 'Read balance sheet from Xero'}
          </button>
          {asAt && <span style={{ fontSize: 12, color: '#8a857c' }}>as at {asAt}{fetchedAt ? ` - read ${String(fetchedAt).slice(0, 10)}` : ''}</span>}
          {msg && <span style={{ fontSize: 12, fontWeight: 600, color: msg.includes('NOT') || msg.includes('Could not') ? '#dc2626' : '#16a34a' }}>{msg}</span>}
        </div>

        {/* TRACKED ITEMS - what feeds the forecast */}
        <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>Tracked ({items.length})</div>
            <div style={{ fontSize: 12, color: '#8a857c' }}>
              {gbp(liabilityTotal)} outstanding &middot; <strong>{gbp(monthlyTotal)}/month</strong> into the forecast
            </div>
          </div>
          {items.length === 0 && <div style={{ fontSize: 12.5, color: '#aaa', padding: '10px 0' }}>Nothing tracked yet. Pick accounts from the list below.</div>}
          {items.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <thead><tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                <th style={{ ...th, textAlign: 'left' }}>Account</th>
                <th style={th} title="What is owed. Seeded from Xero as a positive figure, and editable - the ledger balance and the amount you have agreed to clear are not always the same.">Outstanding</th>
                <th style={th}>Per month</th>
                <th style={th}>Day</th>
                <th style={{ ...th, textAlign: 'left' }}>From</th>
                <th style={{ ...th, textAlign: 'left' }}>To</th>
                <th style={th} title="Months needed to clear the outstanding balance at this monthly amount. If it does not reach zero by the end month, that is worth knowing now.">Clears in</th>
                <th style={{ ...th, textAlign: 'left' }}>Note</th>
                <th style={{ ...th, textAlign: 'center' }}>In forecast</th>
                <th style={th}></th>
              </tr></thead>
              <tbody>
                {items.map(i => {
                  const monthly = Number(i.monthly) || 0
                  const liab = Number(i.liability) || 0
                  const needed = monthly > 0 ? Math.ceil(liab / monthly) : null
                  const scheduled = monthsBetween(i.start, i.end)
                  // The schedule not clearing the balance is the thing worth flagging -
                  // it is a arrangement that will not actually finish.
                  const shortfall = needed != null && scheduled != null && scheduled < needed
                  return (
                    <tr key={i.id} style={{ borderBottom: '1px solid #f2f0ec', opacity: i.inForecast === false ? 0.55 : 1 }}>
                      <td style={{ ...td, textAlign: 'left' }}>{i.name}<div style={{ fontSize: 10, color: '#aaa' }}>{i.section}</div></td>
                      <td style={td}><input type="number" value={i.liability} onChange={e => upd(i.id, { liability: e.target.value })} style={{ ...inp, width: 110, textAlign: 'right' }} /></td>
                      <td style={td}><input type="number" value={i.monthly} placeholder="0.00" onChange={e => upd(i.id, { monthly: e.target.value })} style={{ ...inp, width: 100, textAlign: 'right' }} /></td>
                      <td style={td}><input type="number" min={1} max={28} value={i.day} onChange={e => upd(i.id, { day: e.target.value })} style={{ ...inp, width: 56, textAlign: 'right' }} /></td>
                      <td style={{ ...td, textAlign: 'left' }}><input type="month" value={i.start || ''} onChange={e => upd(i.id, { start: e.target.value })} style={{ ...inp, width: 130 }} /></td>
                      <td style={{ ...td, textAlign: 'left' }}><input type="month" value={i.end || ''} onChange={e => upd(i.id, { end: e.target.value })} style={{ ...inp, width: 130 }} /></td>
                      <td style={{ ...td, color: shortfall ? '#dc2626' : '#8a857c', fontWeight: shortfall ? 700 : 400 }}
                        title={shortfall ? `At ${gbp(monthly)} a month this needs ${needed} months, but only ${scheduled} are scheduled - it will not clear.` : ''}>
                        {needed == null ? '-' : `${needed} mo`}{shortfall ? ' !' : ''}
                      </td>
                      <td style={{ ...td, textAlign: 'left' }}><input value={i.note || ''} placeholder="e.g. time to pay agreement" onChange={e => upd(i.id, { note: e.target.value })} style={{ ...inp, width: 190 }} /></td>
                      <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={i.inForecast !== false} onChange={e => upd(i.id, { inForecast: e.target.checked })} /></td>
                      <td style={td}><button onClick={() => untrack(i.id)} title="Stop tracking" style={{ border: 'none', background: 'none', color: '#c66', cursor: 'pointer', fontSize: 16 }}>&times;</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* EVERY BALANCE SHEET ACCOUNT, grouped by whatever sections Xero returns */}
        <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 2 }}>Balance sheet accounts</div>
          <div style={{ fontSize: 11.5, color: '#8a857c', marginBottom: 10 }}>
            Straight from Xero, grouped by its own sections - nothing here is specific to any one chart of accounts.
            Rows likely to be payable liabilities are marked, but that is a hint only; track anything you like.
          </div>
          {loading && <div style={{ color: '#999', padding: 20 }}>Loading...</div>}
          {!loading && accounts.length === 0 && (
            <div style={{ fontSize: 12.5, color: '#b45309', padding: '10px 0' }}>
              No accounts yet - press &quot;Read balance sheet from Xero&quot;. If that fails with a scope error, reconnect Xero from /connect:
              the balance sheet permission was only added recently and does not apply to an existing connection.
            </div>
          )}
          {Object.entries(bySection).map(([section, list]) => (
            <div key={section} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#5b7085', margin: '8px 0 4px' }}>{section}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {list.map(a => {
                    const on = tracked.has(a.id)
                    const hint = looksPayable(a.section, a.name)
                    return (
                      <tr key={a.id} style={{ borderBottom: '1px solid #f5f4f1' }}>
                        <td style={{ ...td, textAlign: 'left', width: '55%' }}>
                          {a.name}
                          {hint && !on && <span style={{ marginLeft: 6, fontSize: 9.5, color: '#b45309', border: '1px solid #fde68a', borderRadius: 4, padding: '0 4px' }}>likely payable</span>}
                        </td>
                        <td style={{ ...td, color: a.balance < 0 ? '#dc2626' : INK }}>{gbp(a.balance)}</td>
                        <td style={{ ...td, width: 120 }}>
                          {on
                            ? <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>tracked</span>
                            : <button onClick={() => track(a)} style={{ background: '#f2f2f0', border: '1px solid #e2e2de', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer' }}>Track</button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
