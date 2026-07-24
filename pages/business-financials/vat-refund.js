import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, GOLD, gbp, Card } from '../../components/BizNav'

const pad = (n) => String(n).padStart(2, '0')
function firstOfMonth(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` }
function lastOfMonth(d) { const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}` }

export default function VatRefund() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)

  // Default to the current month (Rock files monthly).
  const now = new Date()
  const [from, setFrom] = useState(firstOfMonth(now))
  const [to, setTo] = useState(lastOfMonth(now))

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/business-financials?view=vat&from=${from}&to=${to}`)
      setData(await r.json())
    } catch (e) { setData({ report: null, diag: { lastError: e.message } }) }
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  const report = data?.report
  const rows = flattenReport(report)

  if (!ok) return null

  return (
    <>
      <Head><title>VAT Refund - Rock Roofing</title></Head>
      <BizNav />
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 24px 80px' }}>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, color: INK, fontSize: 26 }}>Anticipated VAT Refund</h1>
          <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4 }}>The VAT return position straight from Xero. Rock files monthly - a negative "VAT owed" means a refund is due.</div>
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 18, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: 12 }}>
          <div><div style={flabel}>From</div><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={finput} /></div>
          <div><div style={flabel}>To</div><input type="date" value={to} onChange={e => setTo(e.target.value)} style={finput} /></div>
          <button onClick={() => { const d = new Date(); setFrom(firstOfMonth(d)); setTo(lastOfMonth(d)) }} style={miniBtn}>This month</button>
          <button onClick={load} disabled={loading} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>{loading ? 'Loading...' : 'Get VAT return'}</button>
        </div>

        {loading ? <div style={{ color: '#999', padding: 40 }}>Loading VAT return from Xero...</div> : (
          <>
            {!report && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 16, fontSize: 13, color: '#92400e', marginBottom: 16 }}>
                No VAT return came back from Xero for this period.
                {data?.diag?.hasTaxScope === false && <div style={{ marginTop: 8 }}><strong>The connection is missing the VAT-report permission.</strong> Reconnect Xero from the <a href="/connect" style={{ color: GOLD }}>connect page</a> and approve the tax reports permission, then try again.</div>}
                {data?.diag?.lastError && <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 11 }}>Detail: {data.diag.lastError}</div>}
              </div>
            )}

            {report && (
              <Card title={report.ReportName || 'VAT Return'} sub={report.ReportDate ? `As reported ${report.ReportDate}` : `${from} to ${to}`}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f2f0ec', background: r.bold ? '#faf9f7' : '#fff' }}>
                        <td style={{ padding: '9px 14px', fontWeight: r.bold ? 700 : 400, color: INK }}>{r.label}</td>
                        <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: r.bold ? 800 : 500, color: r.value < 0 ? '#16a34a' : INK }}>{r.value == null ? r.raw : gbp(r.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
                  Straight from Xero&apos;s VAT return report. A negative net VAT figure (shown green) means HMRC owes you - that&apos;s your anticipated refund for the period.
                </div>
              </Card>
            )}

            {/* Diagnostic - remove once field mapping is confirmed */}
            {data?.diag && (
              <div style={{ fontSize: 11, color: '#bbb', marginTop: 16, fontFamily: 'monospace', wordBreak: 'break-word' }}>
                diag: {JSON.stringify(data.diag)}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

// Turn a Xero report (Rows -> Rows -> Cells) into flat label/value rows. Robust to the
// exact VAT report shape; we refine the mapping once we see a live payload.
function flattenReport(report) {
  if (!report || !report.Rows) return []
  const out = []
  const walk = (rows) => {
    for (const row of rows) {
      if (row.RowType === 'Section' && row.Rows) walk(row.Rows)
      else if (row.Cells && row.Cells.length) {
        const label = row.Cells[0]?.Value || ''
        const last = row.Cells[row.Cells.length - 1]?.Value
        const num = parseFloat(String(last).replace(/[^0-9.-]/g, ''))
        if (label) out.push({ label, value: isNaN(num) ? null : num, raw: last, bold: row.RowType === 'SummaryRow' })
      }
    }
  }
  walk(report.Rows)
  return out
}

const flabel = { fontSize: 11, color: '#8a857c', marginBottom: 4 }
const finput = { padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, background: '#fff' }
const miniBtn = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer', color: '#666', height: 34 }
