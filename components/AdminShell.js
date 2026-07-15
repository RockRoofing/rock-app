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
  ['Account Categorisation', '/admin/account-categorisation'],
  ['App Improvements', '/admin/problem-reports'],
  ['Xero Upload', '/admin/xero-upload'],
]

// Chrome for Admin-area pages: dark bar + admin sub-nav, admin-gated.
export default function AdminShell({ active, title, children, wide }) {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])
  if (!ok) return null
  return (
    <>
      <Head><title>Rock Roofing — {title || 'Admin'}</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none' }}>← Portal</a>
          <span style={{ color: '#3a3a38' }}>|</span>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>Admin</span>
        </div>
        <div style={{ background: '#232321', padding: '0 24px', display: 'flex', gap: 4, height: 44, alignItems: 'center', overflowX: 'auto' }}>
          {TABS.map(([label, href]) => (
            <a key={href} href={href} style={{ fontSize: 13, textDecoration: 'none', padding: '8px 14px', whiteSpace: 'nowrap', color: active === href ? '#fff' : '#bbb', fontWeight: active === href ? 600 : 400, borderBottom: active === href ? '2px solid #ca8a04' : '2px solid transparent' }}>{label}</a>
          ))}
        </div>
        <div style={{ maxWidth: wide ? 1600 : 1100, margin: '0 auto', padding: 24 }}>{children}</div>
      </div>
    </>
  )
}
