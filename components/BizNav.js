import { useRouter } from 'next/router'
import { useState } from 'react'

export const GOLD = '#ca8a04'
export const INK = '#1a1a19'
export const gbp = (n) => `£${Math.round(n || 0).toLocaleString('en-GB')}`
export const gbpK = (n) => { const v = n || 0; return Math.abs(v) >= 1000 ? `£${Math.round(v / 1000)}k` : `£${Math.round(v)}` }
export const monthLbl = (mo) => { const [y, m] = String(mo).split('-'); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) }
export const fmtDate = (s) => { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }

const TABS = [
  ['Summary', '/business-financials'],
  ['Sales', '/business-financials/sales'],
  ['Margin', '/business-financials/margin'],
  ['Bills to Pay', '/business-financials/bills'],
  ['Invoices Owed', '/business-financials/invoices'],
  ['Retentions Due', '/business-financials/retentions-due'],
  ['VAT Refund', '/business-financials/vat-refund'],
  ['Budgets', '/business-financials/budgets'],
  ['Cash Schedule', '/business-financials/cash-schedule'],
  ['Cash Flow', '/business-financials/cashflow'],
  ['Invoice Finance', '/business-financials/invoice-finance'],
]

export function BizNav() {
  const router = useRouter()
  return (
    <div style={{ background: INK, padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 56, flexWrap: 'wrap' }}>
        <a href="/" style={{ color: '#9a9a97', fontSize: 13, textDecoration: 'none', marginRight: 8 }}>← Portal</a>
        {TABS.map(([label, href]) => {
          const active = router.pathname === href
          return <a key={href} href={href} style={{ color: active ? '#fff' : '#9a9a97', background: active ? 'rgba(255,255,255,0.1)' : 'transparent', fontSize: 13, fontWeight: active ? 600 : 500, textDecoration: 'none', padding: '7px 12px', borderRadius: 7 }}>{label}</a>
        })}
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => window.dispatchEvent(new CustomEvent('open-report-problem'))}
            style={{ background: 'none', border: 'none', color: GOLD, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>⚠ Report app improvement</button>
        </div>
      </div>
    </div>
  )
}

// Client-side admin gate hook — returns true when authorised.
export function useAdminGate() {
  return true // gate is enforced per-page; kept for future central use
}

export const sel = { padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, background: '#fff' }
export function Card({ title, sub, children, wide }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, padding: 16, gridColumn: wide ? '1 / -1' : 'auto' }}>
      {title && <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{title}</div>}
      {sub && <div style={{ fontSize: 12, color: '#999', marginBottom: 10 }}>{sub}</div>}
      {children}
    </div>
  )
}

// Reusable "Sync from Xero" button for Business Financials pages. Posts to `endpoint`
// with { months } and calls onDone() after a successful sync so the page can reload.
export function SyncButton({ endpoint, label = 'Sync from Xero', months = 6, onDone, buildMsg }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function run() {
    setBusy(true); setMsg('')
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months }) })
      const d = await res.json().catch(() => ({}))
      if (res.ok && (d.ok || d.success)) {
        setMsg(buildMsg ? buildMsg(d) : 'Synced.')
        if (onDone) await onDone(d)
        setTimeout(() => setMsg(''), 4000)
      } else {
        setMsg(d.error || 'Sync failed.')
      }
    } catch (e) {
      setMsg('Sync failed.')
    }
    setBusy(false)
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <button onClick={run} disabled={busy}
        style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Syncing...' : label}
      </button>
      {msg && <span style={{ fontSize: 12, color: '#6b6b6b' }}>{msg}</span>}
    </span>
  )
}
