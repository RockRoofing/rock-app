import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'

// Xero rejects the ENTIRE authorize request with invalid_scope if one scope is
// unrecognised, so testing by editing the base list risks locking you out of
// reconnecting. This adds a scope for one attempt only.
//
// Module scope, not nested - a component declared inside another remounts every render
// and this holds a focused input.
function ScopeTester({ value, onChange }) {
  // Only scopes this app is actually PERMITTED, taken from its developer-portal list.
  // accounting.transactions is NOT on that list, which is why every attempt at it came
  // back invalid_scope - the name was never the problem, the app cannot have it.
  //
  // accounting.invoices.read and accounting.banktransactions.read are already granted
  // and already fail on Overpayments, so payments is the one candidate left.
  const OPTIONS = ['accounting.payments.read', 'accounting.payments']
  return (
    <div style={{ textAlign: 'left', background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
        Extra scope to request (optional). Only names on this app's permitted list can work - accounting.transactions is not one of them.
      </div>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="e.g. accounting.transactions"
        style={{ width: '100%', padding: '7px 9px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, marginBottom: 6 }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {OPTIONS.map(o => (
          <button key={o} onClick={() => onChange(o)} style={{ fontSize: 10.5, padding: '3px 7px', border: '1px solid #ddd', background: value === o ? '#e0f2fe' : '#fff', borderRadius: 5, cursor: 'pointer' }}>{o}</button>
        ))}
        <button onClick={() => onChange('')} style={{ fontSize: 10.5, padding: '3px 7px', border: '1px solid #ddd', background: '#fff', borderRadius: 5, cursor: 'pointer' }}>none</button>
      </div>
      <div style={{ fontSize: 10, color: '#aaa', marginTop: 6 }}>
        If Xero says invalid_scope, that name is wrong - clear it and connect again to restore the working connection.
      </div>
    </div>
  )
}

export default function ConnectPage() {
  const [connected, setConnected] = useState(null)
  const [loading, setLoading] = useState(true)
  // Extra scopes to try on the next authorize. Kept OUT of the base list so a rejected
  // scope can never leave you unable to reconnect - clear the box and connect again.
  const [extraScopes, setExtraScopes] = useState('')

  useEffect(() => {
    fetch('/api/xero/status')
      .then(r => r.json())
      .then(d => { setConnected(d.connected); setLoading(false) })
  }, [])

  function connectXero() {
const clientId = '934571EC178A488AAFFB4C7E8C4DDD43'
const redirectUri = encodeURIComponent(window.location.origin + '/xero-callback')
    // KNOWN-GOOD LIST. Do not edit this line to test a scope - Xero rejects the whole
    // authorize request with invalid_scope if ANY single scope is unrecognised, which
    // leaves you unable to reconnect at all. accounting.transactions.read did exactly
    // that, even though it is documented, so this app does not accept it.
    //
    // To try a scope, use the box below instead - it appends to this list for one
    // attempt without touching the code or needing a deploy.
    const BASE_SCOPES = 'openid offline_access accounting.invoices.read accounting.contacts.read accounting.reports.profitandloss.read accounting.settings.read accounting.manualjournals.read accounting.banktransactions.read projects.read'
    const scopeStr = [BASE_SCOPES, (extraScopes || '').trim()].filter(Boolean).join(' ')
    const scope = encodeURIComponent(scopeStr)
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
            <ScopeTester value={extraScopes} onChange={setExtraScopes} />
            <button onClick={connectXero} style={{ background: 'transparent', border: '1px solid #ddd', borderRadius: 8, padding: '10px 24px', fontSize: 13, color: '#666', cursor: 'pointer', width: '100%' }}>
              Reconnect Xero
            </button>
          </>
        ) : (
          <>
            <p style={{ color: '#666', marginBottom: 24, fontSize: 14, lineHeight: 1.6 }}>
              Connect your Xero account to pull live project data, costs and invoices automatically.
            </p>
            <ScopeTester value={extraScopes} onChange={setExtraScopes} />
            <button onClick={connectXero} style={{ background: '#13B5EA', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 24px', fontSize: 15, cursor: 'pointer', width: '100%', fontWeight: 600 }}>
              Connect to Xero
            </button>
          </>
        )}
      </div>
    </div>
  )
}
