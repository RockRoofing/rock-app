// Shared top navigation for all Pre-Contract pages.
// Fixed order, a divider between every tab, and the current page highlighted.
// Order: Portal | Sales Dashboard | Scorecards | Negotiating | Project Financials
export default function PreContractNav({ active, children }) {
  const tabs = [
    { key: 'sales', label: 'Sales Dashboard', href: '/sales' },
    { key: 'scorecard', label: 'Scorecards', href: '/scorecard' },
    { key: 'negotiating', label: 'Negotiating', href: '/negotiating' },
    { key: 'financials', label: 'Project Financials', href: '/project-financials' },
    { key: 'handover', label: 'Internal Handover Minutes', href: '/handover' },
    { key: 'procurement-savings', label: 'Procurement Savings', href: '/procurement-savings' },
  ]
  return (
    <div style={{ background: '#1a1a19', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 0, height: 52, overflowX: 'auto' }}>
      <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4, marginRight: 8 }} />
      <a href="/" style={linkStyle}>← Portal</a>
      <Divider />
      {tabs.map((t, i) => (
        <span key={t.key} style={{ display: 'flex', alignItems: 'center' }}>
          {active === t.key
            ? <span style={activeStyle}>{t.label}</span>
            : <a href={t.href} style={linkStyle}>{t.label}</a>}
          {i < tabs.length - 1 && <Divider />}
        </span>
      ))}
      {children && <><div style={{ flex: 1 }} />{children}</>}
    </div>
  )
}

const Divider = () => <span style={{ color: '#3a3a38', fontSize: 14, padding: '0 2px' }}>|</span>
const linkStyle = { color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 12px', borderRadius: 6, whiteSpace: 'nowrap' }
const activeStyle = { color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 12px', borderRadius: 6, background: '#2a2a28', whiteSpace: 'nowrap' }
