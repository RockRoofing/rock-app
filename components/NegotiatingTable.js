import { useEffect, useState } from 'react'

const fmt = (n) => n == null || n === '' ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)
const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt)) return d
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Shared view of Pipedrive "Negotiating" deals. Rendered in both the
// Pre-Contract section and the Operations page so they stay identical.
export default function NegotiatingTable({ accent = '#ca8a04' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/negotiating')
        const d = await r.json()
        if (d.error) setErr(d.error)
        else setData(d)
      } catch (e) { setErr('Could not load deals') }
      setLoading(false)
    })()
  }, [])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#aaa' }}>Loading negotiating projects…</div>
  if (err) return <div style={{ padding: 24, color: '#dc2626', background: '#fef2f2', borderRadius: 12 }}>{err}</div>
  if (!data || !data.deals.length) {
    return (
      <div style={{ background: '#fff', border: '1px dashed #ddd', borderRadius: 14, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#1a1a19' }}>No projects in Negotiating</div>
        <div style={{ color: '#999', fontSize: 14, marginTop: 6 }}>Deals appear here when they reach the Negotiating stage in Pipedrive.</div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="Projects negotiating" value={data.count} accent={accent} />
        <Stat label="Total value" value={fmt(data.totalValue)} accent={accent} />
      </div>

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
          <thead>
            <tr style={{ background: '#faf9f7', color: '#888', textAlign: 'left' }}>
              {['Project', 'Client', 'Systems priced', 'On site', 'Est. close', 'Owner', 'Value'].map(h => (
                <th key={h} style={{ padding: '11px 14px', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.deals.map(d => (
              <tr key={d.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                <td style={{ padding: '11px 14px' }}><strong style={{ color: '#1a1a19' }}>{d.title}</strong></td>
                <td style={{ padding: '11px 14px', color: '#555' }}>{d.organizationName || '—'}</td>
                <td style={{ padding: '11px 14px', color: '#555' }}>{d.systemPriced || '—'}</td>
                <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', color: d.roofingWorksOnSite ? '#1a1a19' : '#bbb' }}>{fmtDate(d.roofingWorksOnSite)}</td>
                <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', color: '#999' }}>{fmtDate(d.expectedCloseDate)}</td>
                <td style={{ padding: '11px 14px', color: '#555' }}>{d.salesPerson || d.ownerName || '—'}</td>
                <td style={{ padding: '11px 14px', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: '14px 18px', minWidth: 160 }}>
      <div style={{ fontSize: 12, color: '#999' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, marginTop: 2 }}>{value}</div>
    </div>
  )
}
