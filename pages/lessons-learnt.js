import Head from 'next/head'

export default function Page() {
  return (
    <>
      <Head><title>Rock Roofing — Lessons Learnt</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none' }}>← Portal</a>
          <span style={{ color: '#3a3a38' }}>|</span>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>Lessons Learnt</span>
        </div>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
          <div style={{ background: '#fff', border: '1px dashed #ddd', borderRadius: 14, padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1a1a19' }}>Lessons Learnt</div>
            <div style={{ color: '#999', fontSize: 14, marginTop: 8 }}>Coming soon — we'll build this out next.</div>
          </div>
        </div>
      </div>
    </>
  )
}
