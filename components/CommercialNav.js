import Link from 'next/link'

// Commercial Portal nav. Most items are single pages. Two items are GROUPS with their
// own sub-nav row: "Applications" and "Scorecards".
const GROUPS = {
  applications: {
    label: 'Applications',
    subs: [
      { href: '/applications', label: 'Applications for Payment' },
      { href: '/application-calendar', label: 'Application Calendar' },
    ],
  },
  scorecards: {
    label: 'Scorecards',
    subs: [
      { href: '/commercial-scorecard', label: 'Commercial Scorecard' },
      { href: '/weekly-tasks', label: 'Weekly Tasks' },
      { href: '/monthly-tasks', label: 'Monthly Tasks' },
    ],
  },
}

// Main nav order. Group entries reference GROUPS by key; the rest are plain pages.
const MAIN = [
  { href: '/commercial', label: 'Project Financials' },
  { href: '/outstanding-invoices', label: 'Outstanding Invoices' },
  { href: '/retention', label: 'Retention' },
  { href: '/variations', label: 'Variations' },
  { href: '/contracted-rates', label: 'Contracted Rates' },
  { group: 'applications' },
  { href: '/wip', label: 'WIP' },
  { href: '/project-cashflow', label: 'Cash Flow' },
  { group: 'scorecards' },
]

function groupForHref(href) {
  for (const [key, g] of Object.entries(GROUPS)) if (g.subs.some(s => s.href === href)) return key
  return null
}

export default function CommercialNav({ active, right = null }) {
  const activeGroup = groupForHref(active)

  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 20 }}>
      {/* Main row */}
      <div style={{ background: '#1a1a19', padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
            <a href="/" style={mainLink(false)}>&larr; Portal</a>
            {MAIN.map((item, i) => {
              if (item.group) {
                const g = GROUPS[item.group]
                const on = activeGroup === item.group
                // Header links to the first sub-page in the group.
                return (
                  <span key={item.group} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#444' }}>|</span>
                    <Link href={g.subs[0].href} style={mainLink(on)}>{g.label}</Link>
                  </span>
                )
              }
              const on = active === item.href
              return (
                <span key={item.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#444' }}>|</span>
                  {on ? <span style={mainActive}>{item.label}</span> : <Link href={item.href} style={mainLink(false)}>{item.label}</Link>}
                </span>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button onClick={() => window.dispatchEvent(new CustomEvent('open-report-problem'))}
              style={{ background: 'none', border: 'none', color: '#ca8a04', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>&#9888; Report app improvement</button>
            {right}
          </div>
        </div>
      </div>

      {/* Sub-nav row (only for grouped pages) */}
      {activeGroup && (
        <div style={{ background: '#2a2a28', padding: '0 24px', borderTop: '1px solid #000' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 42 }}>
            {GROUPS[activeGroup].subs.map(s => (
              <Link key={s.href} href={s.href} style={{
                fontSize: 13, textDecoration: 'none', padding: '8px 14px', whiteSpace: 'nowrap',
                color: active === s.href ? '#fff' : '#9a958c', fontWeight: active === s.href ? 700 : 400,
                borderBottom: active === s.href ? '2px solid #ca8a04' : '2px solid transparent',
              }}>{s.label}</Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const mainActive = { color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }
function mainLink(on) { return { color: on ? '#fff' : '#888', fontSize: 13, fontWeight: on ? 600 : 400, textDecoration: 'none', padding: '4px 10px', borderRadius: 6, background: on ? '#2a2a28' : 'none' } }
