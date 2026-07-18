import Head from 'next/head'
import Link from 'next/link'

export default function ApplicationsPage() {
  return (
    <>
      <Head><title>Rock Roofing — Applications</title></Head>
      <div style={{ minHeight: '100vh', background: '#f5f6f8' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 56 }}>
            <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
            <a href="/commercial" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>← Commercial</a>
            <span style={{ color: '#444' }}>|</span>
            <Link href="/contracted-rates" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>Contracted Rates</Link>
            <span style={{ color: '#444' }}>|</span>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Applications</span>
          </div>
        </div>
        <div style={{ padding: 48, maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 48, color: '#555' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e', marginBottom: 10 }}>Applications — coming next</div>
            <p style={{ fontSize: 14, lineHeight: 1.6 }}>Lock a project's contracted rates first, then build an application from them here: contract works with % complete, variations, materials on site, PDF and send.</p>
            <Link href="/contracted-rates" style={{ color: '#2563eb', textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>Go to Contracted Rates →</Link>
          </div>
        </div>
      </div>
    </>
  )
}
