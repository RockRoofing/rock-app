import Head from 'next/head'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { canAccessArea } from '../lib/roles'

const departments = [
  {
    key: 'pre-contract',
    label: 'Pre-Contract',
    description: 'Sales dashboard, scorecards, pipeline & strike rates',
    href: '/sales',
    color: '#2a78d6',
    lightColor: '#eff6ff',
    borderColor: '#bfdbfe',
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect x="6" y="8" width="28" height="24" rx="3" stroke="#2a78d6" strokeWidth="2" fill="none"/>
        <line x1="11" y1="15" x2="29" y2="15" stroke="#2a78d6" strokeWidth="2" strokeLinecap="round"/>
        <line x1="11" y1="20" x2="29" y2="20" stroke="#2a78d6" strokeWidth="2" strokeLinecap="round"/>
        <line x1="11" y1="25" x2="21" y2="25" stroke="#2a78d6" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="31" cy="29" r="6" fill="#2a78d6"/>
        <polyline points="28,29 30,31 34,27" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'commercial',
    label: 'Commercial',
    description: 'Budget tracker, project financials & Xero integration',
    href: '/commercial',
    color: '#16a34a',
    lightColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect x="6" y="6" width="28" height="28" rx="3" stroke="#16a34a" strokeWidth="2" fill="none"/>
        <line x1="13" y1="27" x2="13" y2="20" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="20" y1="27" x2="20" y2="14" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="27" y1="27" x2="27" y2="18" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round"/>
        <polyline points="10,22 17,16 24,20 30,13" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 1"/>
      </svg>
    ),
  },
  {
    key: 'operations',
    label: 'Operations',
    description: 'Forms, users, site submissions & planning',
    href: '/operations',
    color: '#ca8a04',
    lightColor: '#fffbeb',
    borderColor: '#fde68a',
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="13" stroke="#ca8a04" strokeWidth="2" fill="none"/>
        <circle cx="20" cy="20" r="4" stroke="#ca8a04" strokeWidth="2" fill="none"/>
        <line x1="20" y1="7" x2="20" y2="11" stroke="#ca8a04" strokeWidth="2" strokeLinecap="round"/>
        <line x1="20" y1="29" x2="20" y2="33" stroke="#ca8a04" strokeWidth="2" strokeLinecap="round"/>
        <line x1="7" y1="20" x2="11" y2="20" stroke="#ca8a04" strokeWidth="2" strokeLinecap="round"/>
        <line x1="29" y1="20" x2="33" y2="20" stroke="#ca8a04" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    key: 'lessons-learnt',
    label: 'Lessons Learnt',
    description: 'Shared learnings and continuous improvement',
    href: '/lessons-learnt',
    minRole: 'standard',
    color: '#0891b2',
    lightColor: '#ecfeff',
    borderColor: '#a5f3fc',
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <path d="M20 6l3 8h8l-6.5 5 2.5 8-7-5-7 5 2.5-8L5 14h8z" stroke="#0891b2" strokeWidth="2" strokeLinejoin="round" fill="none"/>
      </svg>
    ),
  },
  {
    key: 'management',
    label: 'Management',
    description: 'Management reporting & oversight',
    href: '/management',
    minRole: 'management',
    color: '#be123c',
    lightColor: '#fff1f2',
    borderColor: '#fecdd3',
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect x="7" y="16" width="26" height="18" rx="2" stroke="#be123c" strokeWidth="2" fill="none"/>
        <path d="M15 16v-3a5 5 0 0110 0v3" stroke="#be123c" strokeWidth="2" fill="none"/>
        <circle cx="20" cy="25" r="2.5" fill="#be123c"/>
      </svg>
    ),
  },
  {
    key: 'hr',
    label: 'HR',
    description: 'Coming soon',
    href: null,
    color: '#7c3aed',
    lightColor: '#f5f3ff',
    borderColor: '#ddd6fe',
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="14" r="6" stroke="#7c3aed" strokeWidth="2" fill="none"/>
        <path d="M8 33c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" fill="none"/>
      </svg>
    ),
  },
  {
    key: 'business-financials',
    label: 'Business Financials',
    description: 'Company P&L, overheads & turnover (Admin only) — coming soon',
    href: null,
    color: '#0f766e',
    lightColor: '#f0fdfa',
    borderColor: '#99f6e4',
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect x="7" y="7" width="26" height="26" rx="3" stroke="#0f766e" strokeWidth="2" fill="none"/>
        <line x1="14" y1="26" x2="14" y2="18" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="20" y1="26" x2="20" y2="13" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="26" y1="26" x2="26" y2="21" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    ),
  },
]

export default function Portal() {
  const router = useRouter()
  const [user, setUser] = useState(null)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      setUser(d.user)
    }).catch(() => router.replace('/login'))
  }, [])

  async function logout() {
    await fetch('/api/portal-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) })
    router.replace('/login')
  }

  const visible = departments.filter(d => user && canAccessArea(user.role, d.key))

  return (
    <>
      <Head><title>Rock Roofing — Portal</title></Head>
      <div style={{
        fontFamily: 'system-ui,-apple-system,sans-serif',
        minHeight: '100vh',
        background: '#0f0f0e',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          background: '#1a1a19',
          borderBottom: '1px solid #2a2a28',
          padding: '0 32px',
          height: 60,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 36, width: 36, borderRadius: 6 }} />
          <div>
            <div style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>Rock Roofing</div>
            <div style={{ color: '#555', fontSize: 11 }}>Company Portal</div>
          </div>
          <div style={{ flex: 1 }} />
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {user.role === 'admin' && <a href="/admin" style={{ color: '#ca8a04', fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>Admin</a>}
              <span style={{ color: '#888', fontSize: 13 }}>{user.name} · {user.role}</span>
              <button onClick={logout} style={{ background: '#2a2a28', color: '#ccc', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>Log out</button>
            </div>
          )}
        </div>

        {/* Main content */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 24px',
        }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 600, margin: '0 0 8px' }}>
              Welcome back
            </h1>
            <p style={{ color: '#555', fontSize: 15, margin: 0 }}>
              Select a department to get started
            </p>
          </div>

          {/* Department tiles */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 300px)',
            gap: 20,
            maxWidth: 640,
            width: '100%',
          }}>
            {visible.map(dept => {
              const isComingSoon = !dept.href
              return (
                <div
                  key={dept.key}
                  onClick={() => dept.href && router.push(dept.href)}
                  style={{
                    background: '#1a1a19',
                    border: `1px solid ${isComingSoon ? '#2a2a28' : '#2a2a28'}`,
                    borderRadius: 12,
                    padding: '28px 24px',
                    cursor: isComingSoon ? 'default' : 'pointer',
                    opacity: isComingSoon ? 0.5 : 1,
                    transition: 'all 0.15s',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                  onMouseEnter={e => {
                    if (!isComingSoon) {
                      e.currentTarget.style.border = `1px solid ${dept.color}44`
                      e.currentTarget.style.background = '#222220'
                      e.currentTarget.style.transform = 'translateY(-2px)'
                      e.currentTarget.style.boxShadow = `0 8px 32px ${dept.color}22`
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isComingSoon) {
                      e.currentTarget.style.border = '1px solid #2a2a28'
                      e.currentTarget.style.background = '#1a1a19'
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = 'none'
                    }
                  }}
                >
                  {/* Coloured top accent */}
                  <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0,
                    height: 3,
                    background: isComingSoon ? '#333' : dept.color,
                    borderRadius: '12px 12px 0 0',
                  }} />

                  {/* Icon */}
                  <div style={{ marginBottom: 16, marginTop: 4 }}>
                    {dept.icon}
                  </div>

                  {/* Label */}
                  <div style={{
                    color: isComingSoon ? '#555' : '#fff',
                    fontSize: 18,
                    fontWeight: 600,
                    marginBottom: 6,
                  }}>
                    {dept.label}
                  </div>

                  {/* Description */}
                  <div style={{
                    color: isComingSoon ? '#444' : '#888',
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}>
                    {dept.description}
                  </div>

                  {/* Arrow for active tiles */}
                  {!isComingSoon && (
                    <div style={{
                      position: 'absolute',
                      bottom: 24,
                      right: 24,
                      color: dept.color,
                      fontSize: 18,
                      opacity: 0.6,
                    }}>
                      →
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 32px',
          borderTop: '1px solid #1f1f1e',
          display: 'flex',
          justifyContent: 'center',
        }}>
          <span style={{ color: '#333', fontSize: 11 }}>Rock Roofing Ltd — Internal Portal</span>
        </div>
      </div>
    </>
  )
}
