import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'

export default function ConnectPage() {
  const [connected, setConnected] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/xero/status')
      .then(r => r.json())
      .then(d => { setConnected(d.connected); setLoading(false) })
  }, [])

  function connectXero() {
const clientId = '934571EC178A488AAFFB4C7E8C4DDD43'
const redirectUri = encodeURIComponent(window.location.origin + '/xero-callback')
    const scope = encodeURIComponent('openid offline_access accounting.invoices.read accounting.contacts.read accounting.reports.profitandloss.read accounting.settings.read accounting.manualjournals.read accounting.banktransactions.read projects.read')
    window.location.href = `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=xero_auth&prompt=consent`
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '40px 48px', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', maxWidth: 420 }}>
        <div style={{ width: 48, height: 48, background: '#1a1a2e', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: '#fff', fontWeight: 700, fontSize: 18 }}>RR</div>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Rock Roofing Financials</h1>
        {loading ? (
          <p style={{ color: '#888' }}>Checking connection...</p>
        ) : connected ? (
          <>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#16a34a', fontSize: 14 }}>
              ✓ Connected to Xero
            </div>
            <a href="/" style={{ display: 'block', background: '#1a1a2e', color: '#fff', padding: '12px 24px', borderRadius: 8, fontSize: 15, textDecoration: 'none', marginBottom: 10 }}>Go to Dashboard</a>
            <button onClick={connectXero} style={{ background: 'transparent', border: '1px solid #ddd', borderRadius: 8, padding: '10px 24px', fontSize: 13, color: '#666', cursor: 'pointer', width: '100%' }}>
              Reconnect Xero
            </button>
          </>
        ) : (
          <>
            <p style={{ color: '#666', marginBottom: 24, fontSize: 14, lineHeight: 1.6 }}>
              Connect your Xero account to pull live project data, costs and invoices automatically.
            </p>
            <button onClick={connectXero} style={{ background: '#13B5EA', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 24px', fontSize: 15, cursor: 'pointer', width: '100%', fontWeight: 600 }}>
              Connect to Xero
            </button>
          </>
        )}
      </div>
    </div>
  )
}
