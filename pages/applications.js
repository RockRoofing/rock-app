import Head from 'next/head'
import Link from 'next/link'
import CommercialNav from '../components/CommercialNav'

export default function ApplicationsPage() {
  return (
    <>
      <Head><title>Rock Roofing — Applications</title></Head>
      <div style={{ minHeight: '100vh', background: '#f5f6f8' }}>
        <CommercialNav active="/applications" />
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
