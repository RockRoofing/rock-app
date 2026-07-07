import Head from 'next/head'
import { useEffect, useState } from 'react'

export default function ProjectFinancials() {
  const [height, setHeight] = useState('calc(100vh - 52px)')

  return (
    <>
      <Head><title>Rock Roofing — Project Financials</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        {/* Nav */}
        <div style={{ background: '#1a1a19', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 8, height: 52 }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <a href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>← Portal</a>
          <span style={{ color: '#444' }}>|</span>
          <a href="/sales" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Sales Dashboard</a>
          <span style={{ color: '#444' }}>|</span>
          <a href="/scorecard" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Scorecards</a>
          <span style={{ color: '#444' }}>|</span>
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Project Financials</span>
          <div style={{ flex: 1 }} />
        </div>

        {/* Iframe filling remaining height */}
        <iframe
          src="/commercial?mode=eom&embed=true"
          style={{
            width: '100%',
            height: height,
            border: 'none',
            display: 'block',
          }}
          title="Project Financials — EOM Report"
        />
      </div>
    </>
  )
}
