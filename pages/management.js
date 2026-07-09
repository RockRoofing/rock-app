import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'

export default function ManagementPage() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (!['management', 'admin'].includes(d.user.role)) { router.replace('/'); return }
      setOk(true)
    })
  }, [])
  if (!ok) return null
  return (
    <>
      <Head><title>Rock Roofing — Management</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none' }}>← Portal</a>
          <span style={{ color: '#3a3a38' }}>|</span>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>Management</span>
        </div>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
          <div style={{ background: '#fff', border: '1px dashed #ddd', borderRadius: 14, padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1a1a19' }}>Management</div>
            <div style={{ color: '#999', fontSize: 14, marginTop: 8 }}>Management-only area — coming soon.</div>
          </div>
        </div>
      </div>
    </>
  )
}
