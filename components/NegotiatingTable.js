import { useEffect, useState } from 'react'

const fmt = (n) => n == null || n === '' ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)
const fmtNum = (n) => n == null || n === '' ? '—' : new Intl.NumberFormat('en-GB').format(n)
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
  const [expanded, setExpanded] = useState(null)

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

  const cols = [
    { h: 'Project', min: 190 },
    { h: 'Client', min: 150 },
    { h: 'Location', min: 130 },
    { h: 'm²', min: 70, right: true },
    { h: 'Value', min: 100, right: true },
    { h: 'Credit Score', min: 90, right: true },
    { h: 'Credit Limit', min: 100, right: true },
    { h: 'Credit Insurance', min: 110, right: true },
    { h: 'On Site', min: 100 },
    { h: 'Estimator', min: 110 },
    { h: 'Systems Priced', min: 140 },
    { h: 'Scope of Works', min: 220 },
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="Projects negotiating" value={data.count} accent={accent} />
        <Stat label="Total value" value={fmt(data.totalValue)} accent={accent} />
      </div>

      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1400 }}>
          <thead>
            <tr style={{ background: '#faf9f7', color: '#888', textAlign: 'left' }}>
              {cols.map(c => (
                <th key={c.h} style={{ padding: '11px 12px', fontWeight: 600, fontSize: 11.5, whiteSpace: 'nowrap', textAlign: c.right ? 'right' : 'left', minWidth: c.min }}>{c.h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.deals.map(d => {
              const isOpen = expanded === d.id
              return (
                <tr key={d.id} style={{ borderTop: '1px solid #f0f0f0', verticalAlign: 'top' }}>
                  <td style={{ ...cell, fontWeight: 600, color: '#1a1a19' }}>{d.title}</td>
                  <td style={{ ...cell, color: '#555' }}>{d.organizationName || '—'}</td>
                  <td style={{ ...cell, color: '#555' }}>{d.siteLocation || '—'}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{fmtNum(d.sizeM2)}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(d.value)}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{d.creditScore != null && d.creditScore !== '' ? d.creditScore : '—'}</td>
                  <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{d.creditLimit ? fmt(d.creditLimit) : '—'}</td>
                  <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{d.insuredCreditLimit ? fmt(d.insuredCreditLimit) : '—'}</td>
                  <td style={{ ...cell, whiteSpace: 'nowrap', color: d.roofingWorksOnSite ? '#1a1a19' : '#bbb' }}>{fmtDate(d.roofingWorksOnSite)}</td>
                  <td style={{ ...cell, color: '#555' }}>{d.estimator || '—'}</td>
                  <td style={{ ...cell, color: '#555' }}>{d.systemPriced || '—'}</td>
                  <td style={{ ...cell, color: '#555', maxWidth: 320 }}>
                    {d.scopeOfWorks
                      ? <span>
                          {isOpen || d.scopeOfWorks.length <= 90 ? d.scopeOfWorks : d.scopeOfWorks.slice(0, 90) + '… '}
                          {d.scopeOfWorks.length > 90 && (
                            <button onClick={() => setExpanded(isOpen ? null : d.id)}
                              style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontSize: 12, padding: 0 }}>
                              {isOpen ? 'less' : 'more'}
                            </button>
                          )}
                        </span>
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: '#999', marginTop: 10 }}>Scroll sideways to see all columns. Live from Pipedrive.</p>
    </div>
  )
}

const cell = { padding: '11px 12px' }

function Stat({ label, value, accent }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: '14px 18px', minWidth: 160 }}>
      <div style={{ fontSize: 12, color: '#999' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, marginTop: 2 }}>{value}</div>
    </div>
  )
}
