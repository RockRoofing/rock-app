import { useState } from 'react'

// Two-tier Operations navigation.
// Top-level menus, several with dropdown subfolders. Mirrors the Sales
// Dashboard pattern: click/hover a parent to reveal its sub-pages. Every
// sub-page has its own route so it can be linked and back-buttoned.
//
// `active` is the current page key (e.g. 'pm:risks'); `section` is the parent
// key used to highlight the top-level item (e.g. 'pm').
export const NAV = [
  { key: 'forms', label: 'Forms', href: '/operations/forms' },
  {
    key: 'projects', label: 'Projects', href: '/operations/projects',
    // Project subfolders live INSIDE a project (routed per project), shown for
    // reference in the dropdown but they open the projects list where you pick one.
    children: [
      { key: 'projects', label: 'All Projects', href: '/operations/projects' },
    ],
  },
  {
    key: 'pm', label: 'Project Management',
    children: [
      { key: 'pm:srat', label: 'SRAT', href: '/operations/project-management/srat' },
      { key: 'pm:report', label: 'Project Report', href: '/operations/project-management/report' },
      { key: 'pm:planning', label: 'Planning', href: '/operations/project-management/planning' },
      { key: 'pm:tasks', label: 'Live Tasks', href: '/operations/project-management/tasks' },
      { key: 'pm:risks', label: 'Risk Log', href: '/operations/project-management/risks' },
      { key: 'pm:procurement', label: 'Procurement', href: '/operations/project-management/procurement' },
      { key: 'pm:variations', label: 'Variations', href: '/operations/project-management/variations' },
    ],
  },
  {
    key: 'hs', label: 'H&S',
    children: [
      { key: 'hs:rams-matrix', label: 'RAMS Matrix', href: '/operations/hs/rams-matrix' },
      { key: 'hs:hs-matrix', label: 'H&S Matrix', href: '/operations/hs/hs-matrix' },
      { key: 'hs:operatives', label: 'Operatives', href: '/operations/hs/operatives' },
      { key: 'hs:onboarding', label: 'Sub-Contractor Onboarding', href: '/operations/hs/onboarding' },
      { key: 'hs:pqqs', label: 'PQQs', href: '/operations/hs/pqqs' },
    ],
  },
  { key: 'negotiating', label: 'Negotiating', href: '/operations/negotiating' },
  { key: 'scorecards', label: 'Scorecards', href: '/operations/scorecards' },
]

// Right-side items
const RIGHT = [
  { key: 'team', label: 'Team Members', href: '/operations/team' },
  { key: 'users', label: 'Forms Users', href: '/operations/users' },
  { key: 'forms-builder', label: 'Form Builder', href: '/operations/forms-builder' },
]

export default function OperationsNav({ active, section }) {
  const [open, setOpen] = useState(null)   // which dropdown is open

  return (
    <div style={{ background: '#1a1a19', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 0, height: 52, position: 'relative', zIndex: 50 }}>
      <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 30, width: 30, borderRadius: 4, marginRight: 8, flexShrink: 0 }} />
      <a href="/" style={linkStyle}>← Portal</a>
      <Divider />

      {NAV.map((item, i) => {
        const isActive = section === item.key || active === item.key
        if (!item.children) {
          return (
            <span key={item.key} style={{ display: 'flex', alignItems: 'center' }}>
              {active === item.key ? <span style={activeStyle}>{item.label}</span> : <a href={item.href} style={linkStyle}>{item.label}</a>}
              <Divider />
            </span>
          )
        }
        return (
          <span key={item.key}
            onMouseEnter={() => setOpen(item.key)} onMouseLeave={() => setOpen(null)}
            style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
            <a href={item.href || item.children[0].href}
              style={isActive ? activeStyle : linkStyle}
              onClick={(e) => { if (!item.href) { e.preventDefault(); setOpen(open === item.key ? null : item.key) } }}>
              {item.label} <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
            </a>
            {open === item.key && (
              <div style={dropdownStyle}>
                {item.children.map(c => (
                  <a key={c.key} href={c.href} style={{ ...dropItem, ...(active === c.key ? dropItemActive : {}) }}>{c.label}</a>
                ))}
              </div>
            )}
            <Divider />
          </span>
        )
      })}

      <div style={{ flex: 1, minWidth: 16 }} />

      {RIGHT.map((r, i) => (
        <span key={r.key} style={{ display: 'flex', alignItems: 'center' }}>
          {active === r.key ? <span style={activeStyle}>{r.label}</span> : <a href={r.href} style={linkStyle}>{r.label}</a>}
          <Divider />
        </span>
      ))}
      <a href="https://siteapp.rockroofing.co.uk" target="_blank" rel="noreferrer"
        style={{ ...linkStyle, color: '#ca8a04', whiteSpace: 'nowrap' }}>Open Site App ↗</a>
    </div>
  )
}

const Divider = () => <span style={{ color: '#3a3a38', fontSize: 14, padding: '0 2px' }}>|</span>
const linkStyle = { color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6, whiteSpace: 'nowrap', cursor: 'pointer' }
const activeStyle = { color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28', whiteSpace: 'nowrap', cursor: 'pointer' }
const dropdownStyle = { position: 'absolute', top: '100%', left: 0, background: '#232321', borderRadius: 8, padding: '6px 0', minWidth: 210, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', zIndex: 100 }
const dropItem = { color: '#bbb', fontSize: 13, textDecoration: 'none', padding: '9px 16px', whiteSpace: 'nowrap' }
const dropItemActive = { color: '#fff', background: '#2f2f2c', fontWeight: 500 }
