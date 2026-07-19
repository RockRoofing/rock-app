import Link from 'next/link'

// Shared Commercial Portal nav. Contracted Rates and Applications are only shown
// under Project Financials (/commercial) — or when that page is itself the active
// one — to keep the other commercial pages' nav uncluttered.
const ALL_LINKS = [
  { href: '/commercial', label: 'Project Financials' },
  { href: '/outstanding-invoices', label: 'Outstanding Invoices' },
  { href: '/retention', label: 'Retention' },
  { href: '/variations', label: 'Variations' },
  { href: '/contracted-rates', label: 'Contracted Rates', financialsOnly: true },
  { href: '/applications', label: 'Applications', financialsOnly: true },
  { href: '/application-calendar', label: 'Application Calendar' },
  { href: '/commercial-scorecard', label: 'Commercial Scorecard' },
]

export default function CommercialNav({ active, right = null }) {
  // Contracted Rates + Applications live under Project Financials. Show them there,
  // and also whenever you're on either of those two pages (so you can move between
  // them); hide them on the other commercial pages.
  const showFinancialsExtras = active === '/commercial' || active === '/contracted-rates' || active === '/applications'
  const LINKS = ALL_LINKS.filter(l => !l.financialsOnly || showFinancialsExtras)
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
        {right && <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>{right}</div>}
      </div>
    </div>
  )
}
