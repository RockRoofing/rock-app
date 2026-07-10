// Two-tier Operations navigation.
// Top row: main sections (no dropdowns). Clicking a section navigates to it.
// Sections with sub-pages render a SECOND ROW of tabs underneath (like the
// Sales Dashboard). Every sub-page has its own route.
export const NAV = [
  { key: 'forms', label: 'Forms', href: '/operations/forms' },
  { key: 'projects', label: 'Projects', href: '/operations/projects' },
  {
    key: 'pm', label: 'Project Management', href: '/operations/project-management/srat',
    children: [
      { key: 'pm:srat', label: 'SRAT', href: '/operations/project-management/srat' },
      { key: 'pm:report', label: 'Project Report', href: '/operations/project-management/report' },
      { key: 'pm:planning', label: 'Planning', href: '/operations/project-management/planning' },
      { key: 'pm:tasks', label: 'Live Tasks', href: '/operations/project-management/tasks' },
      { key: 'pm:risks', label: 'Risk Log', href: '/operations/project-management/risks' },
      { key: 'pm:procurement', label: 'Procurement', href: '/operations/project-management/procurement' },
      { key: 'pm:deliveries', label: 'Deliveries', href: '/operations/project-management/deliveries' },
      { key: 'pm:variations', label: 'Variations', href: '/operations/project-management/variations' },
      { key: 'pm:negotiating', label: 'Negotiating', href: '/operations/negotiating' },
    ],
  },
  {
    key: 'hs', label: 'H&S', href: '/operations/hs/rams-matrix',
    children: [
      { key: 'hs:rams-matrix', label: 'RAMS Matrix', href: '/operations/hs/rams-matrix' },
      { key: 'hs:hs-matrix', label: 'H&S Matrix', href: '/operations/hs/hs-matrix' },
      { key: 'hs:operatives', label: 'Operatives', href: '/operations/hs/operatives' },
      { key: 'hs:onboarding', label: 'Sub-Contractor Onboarding', href: '/operations/hs/onboarding' },
      { key: 'hs:pqqs', label: 'PQQs', href: '/operations/hs/pqqs' },
    ],
  },
  { key: 'negotiating', label: 'Negotiating', href: '/operations/negotiating', hidden: true },
  { key: 'scorecards', label: 'Scorecards', href: '/operations/scorecards' },
]

const RIGHT = []

export default function OperationsNav({ active, section }) {
  return (
    <div>
      {/* Top row: main sections */}
      <div style={{ background: '#1a1a19', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 0, height: 52, overflowX: 'auto' }}>
        <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 30, width: 30, borderRadius: 4, marginRight: 8, flexShrink: 0 }} />
        <a href="/" style={linkStyle}>← Portal</a>
        <Divider />
        {NAV.filter(n => !n.hidden).map((item) => {
          const isActive = section === item.key || active === item.key
          return (
            <span key={item.key} style={{ display: 'flex', alignItems: 'center' }}>
              {isActive ? <span style={activeStyle}>{item.label}</span> : <a href={item.href} style={linkStyle}>{item.label}</a>}
              <Divider />
            </span>
          )
        })}
        <div style={{ flex: 1, minWidth: 16 }} />
        {RIGHT.map((r) => (
          <span key={r.key} style={{ display: 'flex', alignItems: 'center' }}>
            {active === r.key ? <span style={activeStyle}>{r.label}</span> : <a href={r.href} style={linkStyle}>{r.label}</a>}
            <Divider />
          </span>
        ))}
        <a href="https://siteapp.rockroofing.co.uk" target="_blank" rel="noreferrer"
          style={{ ...linkStyle, color: '#ca8a04', whiteSpace: 'nowrap' }}>Open Site App ↗</a>
      </div>

      {/* Second row: sub-tabs for the active section (Sales Dashboard style) */}
      <SectionTabs active={active} section={section} />
    </div>
  )
}

function SectionTabs({ active, section }) {
  const parent = NAV.find(n => n.key === section && n.children)
  if (!parent) return null
  return (
    <div style={{ background: '#fff', borderBottom: '1px solid #ececec', padding: '0 24px', display: 'flex', gap: 4, overflowX: 'auto', height: 46, alignItems: 'center' }}>
      {parent.children.map(c => {
        const on = active === c.key
        return (
          <a key={c.key} href={c.href} style={{
            fontSize: 13.5, textDecoration: 'none', padding: '8px 14px', whiteSpace: 'nowrap',
            color: on ? '#1a1a19' : '#888', fontWeight: on ? 600 : 400,
            borderBottom: on ? '2px solid #ca8a04' : '2px solid transparent', marginBottom: -1,
          }}>{c.label}</a>
        )
      })}
    </div>
  )
}

const Divider = () => <span style={{ color: '#3a3a38', fontSize: 14, padding: '0 2px' }}>|</span>
const linkStyle = { color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6, whiteSpace: 'nowrap', cursor: 'pointer' }
const activeStyle = { color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28', whiteSpace: 'nowrap' }
