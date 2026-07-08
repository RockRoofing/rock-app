// Shared top navigation for all Operations pages.
// Mirrors PreContractNav: dark bar, fixed order, divider between every tab,
// current page highlighted. Main sections on the left; Users and the Forms
// app link pushed to the right.
// Order (left): Forms Submissions | Projects | Project Planning | SRATs |
//   Live Project Tasks | Project Report | H&S Training Matrix | RAMS | Scorecards
// Right: Users | Open Forms App
export default function OperationsNav({ active }) {
  const tabs = [
    { key: 'submissions', label: 'Forms Submissions', href: '/operations/submissions' },
    { key: 'projects', label: 'Projects', href: '/operations/projects' },
    { key: 'planning', label: 'Project Planning', href: '/operations/planning' },
    { key: 'srats', label: 'SRATs', href: '/operations/srats' },
    { key: 'tasks', label: 'Live Project Tasks', href: '/operations/tasks' },
    { key: 'risks', label: 'Risk Log', href: '/operations/risks' },
    { key: 'report', label: 'Project Report', href: '/operations/report' },
    { key: 'training', label: 'H&S Training Matrix', href: '/operations/training' },
    { key: 'rams', label: 'RAMS', href: '/operations/rams' },
    { key: 'scorecards', label: 'Scorecards', href: '/operations/scorecards' },
  ]
  return (
    <div style={{ background: '#1a1a19', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 0, height: 52, overflowX: 'auto' }}>
      <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 30, width: 30, borderRadius: 4, marginRight: 8, flexShrink: 0 }} />
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
      <div style={{ flex: 1, minWidth: 16 }} />
      {active === 'team'
        ? <span style={activeStyle}>Team Members</span>
        : <a href="/operations/team" style={linkStyle}>Team Members</a>}
      <Divider />
      {active === 'users'
        ? <span style={activeStyle}>Users</span>
        : <a href="/operations/users" style={linkStyle}>Users</a>}
      <Divider />
      {active === 'forms-builder'
        ? <span style={activeStyle}>Forms Builder</span>
        : <a href="/operations/forms-builder" style={linkStyle}>Forms Builder</a>}
      <Divider />
      <a href="https://forms.rockroofing.co.uk" target="_blank" rel="noreferrer"
        style={{ ...linkStyle, color: '#ca8a04', whiteSpace: 'nowrap' }}>Open Forms App ↗</a>
    </div>
  )
}

const Divider = () => <span style={{ color: '#3a3a38', fontSize: 14, padding: '0 2px' }}>|</span>
const linkStyle = { color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6, whiteSpace: 'nowrap' }
const activeStyle = { color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28', whiteSpace: 'nowrap' }
