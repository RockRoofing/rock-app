import Link from 'next/link'
import ReportImprovementLink from './ReportImprovementLink'

const INK = '#1a1a2e'
const SUBS = [
  { href: '/bookkeeping', label: 'Bookkeeping' },
  { href: '/bookkeeping-weekly-tasks', label: 'Weekly Tasks' },
  { href: '/bookkeeping-monthly-tasks', label: 'Monthly Tasks' },
]

export default function BookkeepingNav({ active }) {
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 20 }}>
      <div style={{ background: INK, padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 56, gap: 8 }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <Link href="/" style={{ color: '#aaa', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>&larr; Portal</Link>
          <span style={{ color: '#444' }}>|</span>
          <span style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>Bookkeeping</span>
          <div style={{ flex: 1 }} />
          <ReportImprovementLink />
        </div>
      </div>
      {/* Sub-nav (Ops style: white bar, gold underline) */}
      <div style={{ background: '#fff', borderBottom: '1px solid #ececec', padding: '0 24px', display: 'flex', gap: 4, height: 46, alignItems: 'center' }}>
        {SUBS.map(s => {
          const on = active === s.href
          return (
            <Link key={s.href} href={s.href} style={{
              fontSize: 13, textDecoration: 'none', padding: '8px 14px', whiteSpace: 'nowrap',
              color: on ? '#1a1a19' : '#888', fontWeight: on ? 600 : 400,
              borderBottom: on ? '2px solid #ca8a04' : '2px solid transparent', marginBottom: -1,
            }}>{s.label}</Link>
          )
        })}
      </div>
    </div>
  )
}
