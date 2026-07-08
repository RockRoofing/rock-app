import Head from 'next/head'
import NegotiatingTable from '../components/NegotiatingTable'

const INK = '#1a1a19'

export default function Negotiating() {
  return (
    <>
      <Head><title>Rock Roofing — Negotiating</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        {/* Pre-Contract nav (matches Sales Dashboard) */}
        <div style={{ background: INK, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 8, height: 52 }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <a href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>← Portal</a>
          <a href="/sales" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Sales Dashboard</a>
          <a href="/scorecard" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Scorecards</a>
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Negotiating</span>
          <a href="/project-financials" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Project Financials</a>
        </div>

        <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <h1 style={{ margin: 0, fontSize: 22, color: INK }}>Projects in Negotiating</h1>
            <div style={{ color: '#999', fontSize: 13, marginTop: 2 }}>Live from Pipedrive — deals currently at the Negotiating stage</div>
          </div>
          <NegotiatingTable accent="#ca8a04" />
        </div>
      </div>
    </>
  )
}
