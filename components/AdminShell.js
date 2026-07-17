import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'

const TABS = [
  ['Portal Users', '/admin'],
  ['Templates', '/admin/templates'],
  ['Form Builder', '/operations/forms-builder'],
  ['Site App Users', '/operations/users'],
  ['Documents', '/admin/documents'],
  ['RAMS Director', '/admin/rams-director'],
  ['App Improvements', '/admin/problem-reports'],
]

// Chrome for Admin-area pages: dark bar + admin sub-nav, admin-gated.
export default function AdminShell({ active, title, children, wide, allow }) {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  // Roles permitted on this page. Defaults to admin-only; pages can widen it
  // (e.g. Bookkeeping upload/categorisation allow the Accounts role too).
  const allowed = allow || ['admin']
  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (!allowed.includes(d.user.role)) { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])
  if (!ok) return null
  const isBk = ['/admin/account-categorisation', '/admin/xero-upload', '/admin/data-management'].includes(active)
  return (
    <>
      <Head><title>Rock Roofing — {title || (isBk ? 'Bookkeeping' : 'Admin')}</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href={isBk ? '/bookkeeping' : '/'} style={{ color: '#888', fontSize: 13, textDecoration: 'none' }}>{isBk ? '← Bookkeeping' : '← Portal'}</a>
          <span style={{ color: '#3a3a38' }}>|</span>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{isBk ? 'Bookkeeping Tools' : 'Admin'}</span>
        </div>
        <div style={{ background: '#232321', padding: '0 24px', display: 'flex', gap: 4, height: 44, alignItems: 'center', overflowX: 'auto' }}>
          {isBk ? (
            <>
              {[['Account Categorisation', '/admin/account-categorisation'], ['Xero Upload', '/admin/xero-upload'], ['Data Management', '/admin/data-management']].map(([label, href]) => (
                <a key={href} href={href} style={{ fontSize: 13, textDecoration: 'none', padding: '8px 14px', whiteSpace: 'nowrap', color: active === href ? '#fff' : '#bbb', fontWeight: active === href ? 600 : 400, borderBottom: active === href ? '2px solid #ca8a04' : '2px solid transparent' }}>{label}</a>
              ))}
            </>
          ) : TABS.map(([label, href]) => (
            <a key={href} href={href} style={{ fontSize: 13, textDecoration: 'none', padding: '8px 14px', whiteSpace: 'nowrap', color: active === href ? '#fff' : '#bbb', fontWeight: active === href ? 600 : 400, borderBottom: active === href ? '2px solid #ca8a04' : '2px solid transparent' }}>{label}</a>
          ))}
        </div>
        <div style={{ maxWidth: wide ? 1600 : 1100, margin: '0 auto', padding: 24 }}>{children}</div>
      </div>
    </>
  )
}
