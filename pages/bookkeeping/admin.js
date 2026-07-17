import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'

const INK = '#1a1a2e'

const CARDS = [
  {
    href: '/admin/account-categorisation',
    title: 'Account Categorisation',
    desc: 'Set each Xero account code to Labour, Materials or Ignore (overheads). Drives how costs split across Project Financials and the Bookkeeping tabs.',
    color: '#7c3aed',
  },
  {
    href: '/admin/xero-upload',
    title: 'Xero Upload',
    desc: 'Upload Bills, Sales Invoices and Direct Wages exports from Xero. Bills use exact per-day replace; select all columns including the Projects tracking category.',
    color: '#0f766e',
  },
  {
    href: '/admin/data-management',
    title: 'Data Management',
    desc: 'Wipe financial data (Bills, Wages, Sales, Overheads or all) for a clean rebuild. Requires typed confirmation. Does not touch non-financial data.',
    color: '#b91c1c',
    adminOnly: true,
  },
]

export default function BookkeepingAdminHub() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [role, setRole] = useState('')
  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (!['accounts', 'management', 'admin'].includes(d.user.role)) { router.replace('/bookkeeping'); return }
      setRole(d.user.role)
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])
  if (!ok) return null
  const cards = CARDS.filter(c => !c.adminOnly || role === 'admin')

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#f0f2f5' }}>
      <div style={{ background: INK, padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 56, gap: 8 }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <Link href="/bookkeeping" style={{ color: '#aaa', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>← Bookkeeping</Link>
          <span style={{ color: '#444' }}>|</span>
          <span style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>Bookkeeping Tools</span>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '28px auto', padding: '0 24px' }}>
        <p style={{ color: '#666', fontSize: 14, margin: '0 0 20px' }}>
          Financial tools for uploading and categorising Xero data.{role === 'admin' ? ' Data Management (wipe) is admin-only.' : ''}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {cards.map(c => (
            <a key={c.href} href={c.href} style={{ textDecoration: 'none', background: '#fff', borderRadius: 14, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #eee', display: 'block' }}>
              <div style={{ width: 40, height: 6, background: c.color, borderRadius: 3, marginBottom: 12 }} />
              <div style={{ fontSize: 16, fontWeight: 700, color: INK, marginBottom: 6 }}>{c.title}</div>
              <div style={{ fontSize: 13, color: '#777', lineHeight: 1.55 }}>{c.desc}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
