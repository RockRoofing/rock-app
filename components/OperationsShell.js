import Head from 'next/head'
import OperationsNav from './OperationsNav'

const INK = '#1a1a19'

// Standard chrome for every Operations page: title tag, nav, and a content
// container. Pass `wide` for full-width pages (tables, planning grids).
export default function OperationsShell({ active, section, title, children, wide }) {
  return (
    <>
      <Head><title>Rock Roofing — {title || 'Operations'}</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        <OperationsNav active={active} section={section} />
        <div style={{ maxWidth: wide ? 'none' : 1100, margin: '0 auto', padding: wide ? '24px' : '24px' }}>
          {children}
        </div>
      </div>
    </>
  )
}

// A friendly placeholder for sections not yet built.
export function ComingSoon({ title, note }) {
  return (
    <div style={{ background: '#fff', border: '1px dashed #ddd', borderRadius: 14, padding: 48, textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: INK }}>{title}</div>
      <div style={{ color: '#999', fontSize: 14, marginTop: 8, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}>
        {note || "We'll build this next."}
      </div>
    </div>
  )
}

// Section heading used across pages.
export function PageHeading({ title, sub, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, color: INK }}>{title}</h1>
        {sub && <div style={{ color: '#999', fontSize: 13, marginTop: 2 }}>{sub}</div>}
      </div>
      {action}
    </div>
  )
}

// Sub-tab bar for pages with internal sections (Projects, RAMS, Scorecards).
export function SubTabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)} style={{
          padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
          border: `1px solid ${active === t.key ? '#ca8a04' : '#e0e0e0'}`,
          background: active === t.key ? '#fffbeb' : '#fff',
          color: active === t.key ? '#92400e' : '#666',
          fontWeight: active === t.key ? 600 : 400,
        }}>{t.label}</button>
      ))}
    </div>
  )
}
