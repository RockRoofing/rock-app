import { useState } from 'react'
import AdminShell from '../../components/AdminShell'

const CARDS = [
  { type: 'bills', title: 'Bills (Costs)', desc: 'Deletes ALL project-tagged bill costs and untagged bills. Recompute project cost totals without bills.' },
  { type: 'wages', title: 'Direct Wages', desc: 'Deletes ALL project-tagged wages and untagged wage lump sums.' },
  { type: 'sales', title: 'Sales Invoices', desc: 'Deletes ALL sales invoices (per project and unassigned).' },
  { type: 'overheads', title: 'Overheads', desc: 'Deletes the untagged/overhead bills captured for the Overheads tab.' },
]

export default function DataManagement() {
  return (
    <AdminShell active="/admin/data-management">
      <div style={{ maxWidth: 820 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a2e', margin: '0 0 6px' }}>Data Management</h1>
        <p style={{ fontSize: 14, color: '#666', margin: '0 0 24px', lineHeight: 1.6 }}>
          Wipe financial data to start again (a "clean rebuild"). After clearing, re-upload the relevant Xero exports on the Xero Upload tab. <strong>These actions cannot be undone</strong> — each requires typing <code>CLEAR</code> to confirm. Nothing here affects your projects, forms, users or any non-financial data.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
          {CARDS.map(c => <WipeCard key={c.type} {...c} />)}
        </div>

        <div style={{ marginTop: 24 }}>
          <WipeCard type="all" title="Clear ALL financial data" danger
            desc="Deletes Bills, Direct Wages, Sales Invoices and Overheads in one go. Use only for a complete rebuild from scratch." />
        </div>
      </div>
    </AdminShell>
  )
}

function WipeCard({ type, title, desc, danger }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function run() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/clear-financial-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, confirm: 'CLEAR' }),
      })
      const d = await res.json()
      if (res.ok && d.ok) setMsg({ ok: true, text: `Cleared ${title} (${d.keysCleared ?? 0} record set(s) removed). Re-upload on the Xero Upload tab.` })
      else setMsg({ ok: false, text: d.error || 'Failed.' })
    } catch (e) { setMsg({ ok: false, text: e.message }) }
    setBusy(false); setText('')
  }

  return (
    <div style={{ background: '#fff', border: '1px solid ' + (danger ? '#fca5a5' : '#f0d5d5'), borderRadius: 12, padding: 18, background: danger ? '#fff5f5' : '#fff' }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#b91c1c', margin: '0 0 6px' }}>{title}</h3>
      <p style={{ fontSize: 13, color: '#7f5555', margin: '0 0 8px', lineHeight: 1.5 }}>{desc}</p>
      <div style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600, marginBottom: 10 }}>⚠ All {title === 'Clear ALL financial data' ? 'financial' : title} data will be permanently deleted.</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Type CLEAR"
          style={{ padding: '8px 10px', border: '1px solid #e0c0c0', borderRadius: 8, fontSize: 13, width: 120 }} />
        <button onClick={run} disabled={busy || text !== 'CLEAR'}
          style={{ background: text === 'CLEAR' ? '#dc2626' : '#e5b8b8', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: text === 'CLEAR' && !busy ? 'pointer' : 'default' }}>
          {busy ? 'Clearing…' : 'Delete'}
        </button>
      </div>
      {msg && <div style={{ marginTop: 10, fontSize: 13, color: msg.ok ? '#166534' : '#b91c1c' }}>{msg.text}</div>}
    </div>
  )
}
