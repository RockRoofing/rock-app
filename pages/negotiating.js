import Head from 'next/head'
import NegotiatingTable from '../components/NegotiatingTable'
import PreContractNav from '../components/PreContractNav'

const INK = '#1a1a19'

export default function Negotiating() {
  return (
    <>
      <Head><title>Rock Roofing — Negotiating</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        <PreContractNav active="negotiating" />

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
