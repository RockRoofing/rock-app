import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'

export default function XeroCallback() {
  const router = useRouter()
  const [status, setStatus] = useState('Connecting to Xero...')
  const [error, setError] = useState(null)

  useEffect(() => {
    const { code, error: xeroError } = router.query
    if (!router.isReady) return
    if (xeroError) { setError('Xero denied access: ' + xeroError); return }
    if (!code) return
    
    fetch('/api/xero/callback?code=' + code)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setStatus('Connected! Redirecting...')
          setTimeout(() => router.push('/'), 1500)
        } else {
          setError(data.error || 'Connection failed')
        }
      })
      .catch(e => setError(e.message))
  }, [router.isReady, router.query])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '40px 48px', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', maxWidth: 400 }}>
        <div style={{ width: 48, height: 48, background: '#1a1a2e', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: '#fff', fontWeight: 700, fontSize: 18 }}>RR</div>
        {error ? (
          <>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#e63946', marginBottom: 8 }}>Connection failed</div>
            <div style={{ color: '#666', fontSize: 14, marginBottom: 20 }}>{error}</div>
            <a href="/connect" style={{ background: '#1a1a2e', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 14, textDecoration: 'none' }}>Try again</a>
          </>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{status}</div>
            <div style={{ color: '#888', fontSize: 14 }}>Please wait...</div>
          </>
        )}
      </div>
    </div>
  )
}
