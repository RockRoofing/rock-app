import Link from 'next/link'

// Shared Commercial Portal nav. Every commercial page shows the FULL set of
// links; the current page is highlighted via `active`.
const LINKS = [
  { href: '/commercial', label: 'Project Financials' },
  { href: '/outstanding-invoices', label: 'Outstanding Invoices' },
  { href: '/retention', label: 'Retention' },
  { href: '/variations', label: 'Variations' },
  { href: '/contracted-rates', label: 'Contracted Rates' },
  { href: '/applications', label: 'Applications' },
  { href: '/application-calendar', label: 'Application Calendar' },
  { href: '/commercial-scorecard', label: 'Commercial Scorecard' },
]

export default function CommercialNav({ active, right = null }) {
  return (
    <div style={{ background: '#1a1a19', padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <a href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>← Portal</a>
          {LINKS.map((l, i) => (
            <span key={l.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#444' }}>|</span>
              {active === l.href
                ? <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>{l.label}</span>
                : <Link href={l.href} style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>{l.label}</Link>}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={() => window.dispatchEvent(new CustomEvent('open-report-problem'))}
            style={{ background: 'none', border: 'none', color: '#ca8a04', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>⚠ Report app improvement</button>
          {right}
        </div>
      </div>
    </div>
  )
}
