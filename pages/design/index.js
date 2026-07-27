import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { canAccessArea, normRole } from '../../lib/roles'

const INK = '#1a1a19'
const PURPLE = '#7c3aed'

// Design portal pages. `internalOnly` = hidden from external customer users and the
// designer-facing "builder" tools; `soon` = placeholder until its phase is built.
const PAGES = [
  { key: 'rfis', label: "RFIs", href: '/design/rfis', desc: 'Track Requests for Information', soon: true },
  { key: 'tech-sub-builder', label: 'Tech Sub Builder', href: '/design/tech-sub-builder', desc: 'Build technical submissions from the document library', internalOnly: true, soon: true },
  { key: 'tech-sub', label: 'Tech Sub', href: '/design/tech-sub', desc: 'View the latest technical submission', soon: true },
  { key: 'contract-drawings', label: 'Contract Drawings', href: '/design/contract-drawings', desc: 'Architect contract drawings', soon: true },
  { key: 'rock-drawings', label: 'Rock Drawings', href: '/design/rock-drawings', desc: 'Our own drawings, markup & comments', soon: true },
  { key: 'calculations', label: 'Calculations', href: '/design/calculations', desc: 'Wind load, U-value, pull-out tests, moisture maps & reports', soon: true },
  { key: 'leak-test-builder', label: 'Leak Test Cert Builder', href: '/design/leak-test-builder', desc: 'Build leak test certificates', internalOnly: true, soon: true },
  { key: 'leak-test-certs', label: 'Leak Test Certs', href: '/design/leak-test-certs', desc: 'View & download leak test certificates', soon: true },
  { key: 'warranties', label: 'Warranties', href: '/design/warranties', desc: 'Manufacturer warranty documents', soon: true },
  { key: 'oms', label: "O&Ms", href: '/design/oms', desc: 'Operation & Maintenance manuals', soon: true },
]

export default function DesignHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => { (async () => {
    try {
      const me = await fetch('/api/portal-auth?action=me').then(r => r.json()).catch(() => null)
      if (!me || !me.user) { router.replace('/login'); return }
      if (!canAccessArea(me.user.role, 'design')) { router.replace('/'); return }
      setUser(me.user)
      setReady(true)
    } catch { router.replace('/') }
  })() }, [])

  if (!ready) return null
  const isInternal = ['designer', 'post-contract', 'management', 'admin'].includes(normRole(user.role))
  const pages = PAGES.filter(p => !p.internalOnly || isInternal)

  return (
    <>
      <Head><title>Design Portal — Rock Roofing</title></Head>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <Link href="/" style={{ color: '#888', fontSize: 14, textDecoration: 'none' }}>‹ Portal</Link>
        </div>
        <h1 style={{ margin: '4px 0 2px', color: INK, fontSize: 28 }}>Design Portal</h1>
        <p style={{ color: '#8a857c', fontSize: 14, marginTop: 4 }}>Drawings, RFIs, technical submissions, calculations, certificates, O&amp;Ms and warranties.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14, marginTop: 24 }}>
          {pages.map(p => (
            <Link key={p.key} href={p.soon ? '#' : p.href}
              onClick={e => { if (p.soon) e.preventDefault() }}
              style={{ textDecoration: 'none', cursor: p.soon ? 'default' : 'pointer' }}>
              <div style={{ background: '#fff', border: '1px solid #ece9f5', borderLeft: `3px solid ${PURPLE}`, borderRadius: 12, padding: '16px 18px', opacity: p.soon ? 0.6 : 1, height: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>{p.label}</div>
                  {p.soon && <span style={{ fontSize: 10.5, color: PURPLE, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 20, padding: '2px 8px', fontWeight: 700 }}>SOON</span>}
                  {p.internalOnly && !p.soon && <span style={{ fontSize: 10.5, color: '#666', background: '#f3f4f6', borderRadius: 20, padding: '2px 8px', fontWeight: 700 }}>INTERNAL</span>}
                </div>
                <div style={{ fontSize: 13, color: '#8a857c', marginTop: 4 }}>{p.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
