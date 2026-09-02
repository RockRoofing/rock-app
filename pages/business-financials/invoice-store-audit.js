import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, gbp } from '../../components/BizNav'

const th = { padding: '7px 9px', fontSize: 11, color: '#888', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
const thL = { ...th, textAlign: 'left' }
const td = { padding: '6px 9px', fontSize: 12.5, textAlign: 'right', whiteSpace: 'nowrap' }
const tdL = { ...td, textAlign: 'left' }
const btn = { background: '#fff', border: '1px solid #ddd9d2', borderRadius: 6, padding: '5px 11px', fontSize: 12, cursor: 'pointer', color: '#57534e' }

function csv(rows) {
  return rows.map(r => r.map(c => {
    const v = c == null ? '' : String(c)
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }).join(',')).join('\n')
}
function download(name, text) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  a.download = name; a.click(); URL.revokeObjectURL(a.href)
}
const fmtDMY = (s) => { if (!s) return '-'; const d = new Date(s); return isNaN(d) ? '-' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) }

export default function InvoiceStoreAudit() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [data, setData] = useState(null)
  const [onlyFlagged, setOnlyFlagged] = useState(true)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(async d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
      try {
        const r = await fetch('/api/invoice-store-audit').then(x => x.json())
        if (r.error) setErr(r.error); else setData(r)
      } catch (e) { setErr(e.message) }
      setLoading(false)
    }).catch(e => { setErr(String(e.message || e)); setLoading(false) })
  }, [])

  const projRows = useMemo(() => {
    const list = (data && data.projects) || []
    return onlyFlagged ? list.filter(p => p.flagged > 0) : list
  }, [data, onlyFlagged])

  const byBasis = useMemo(() => {
    const f = (data && data.flagged) || []
    return { id: f.filter(x => x.basis === 'id').length, contact: f.filter(x => x.basis === 'contact').length }
  }, [data])

  if (!ok) return null

  const c = (data && data.counts) || {}
  const t = (data && data.totals) || {}

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f7' }}>
      <Head><title>Invoice Store Audit</title></Head>
      <BizNav />
      <div style={{ padding: '18px 20px 60px' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, color: INK }}>Invoice Store Audit</h1>
        <div style={{ fontSize: 12.5, color: '#7a756c', maxWidth: 860, lineHeight: 1.5 }}>
          Read-only. Every row in the sales invoice store (<code>invoiced:lines:</code>) checked against
          the supplier bills we already hold, by Xero InvoiceID. Nothing is written, and the dashboard
          cache is not touched, so opening this page will not change the Cash Flow.
        </div>

        {loading && <div style={{ marginTop: 20, fontSize: 13, color: '#888' }}>Scanning the store...</div>}
        {err && <div style={{ marginTop: 16, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, color: '#991b1b' }}>{err}</div>}

        {data && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0 6px' }}>
              <Card label="Rows in store" value={String(c.rowsScanned || 0)} />
              <Card label="Supplier bills found in it" value={String(c.flaggedRows || 0)} bad={(c.flaggedRows || 0) > 0} />
              <Card label="Projects affected" value={String(c.projectsAffected || 0)} bad={(c.projectsAffected || 0) > 0} />
              <Card label="Still outstanding" value={gbp(t.flaggedDue)} bad={(t.flaggedDue || 0) > 0}
                hint="What the Cash Flow arrears row picks up as money in" />
              <Card label="Full value" value={gbp(t.flaggedValue)} bad={(t.flaggedValue || 0) > 0}
                hint="What inflates invoiced totals, WIP and margin" />
            </div>

            <div style={{ fontSize: 11.5, color: '#8a857c', marginBottom: 14 }}>
              {byBasis.id} matched on Xero InvoiceID (certain). {byBasis.contact} matched on supplier
              name only (likely, but check before deleting). Scanned {c.lineKeys || 0} project stores
              against {c.billIds || 0} known bill IDs.
            </div>

            {(c.flaggedRows || 0) === 0 && (
              <div style={{ padding: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13, color: '#166534' }}>
                No supplier bills found in the sales invoice store. If the Cash Flow is still wrong on the
                dashboard-cache path, the cause is elsewhere and I should not have looked here.
              </div>
            )}

            {(c.flaggedRows || 0) > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0 6px' }}>
                  <h2 style={{ margin: 0, fontSize: 15, color: INK }}>By project</h2>
                  <label style={{ fontSize: 12, color: '#7a756c', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input type="checkbox" checked={onlyFlagged} onChange={e => setOnlyFlagged(e.target.checked)} />
                    affected only
                  </label>
                  <button onClick={() => download('invoice-store-audit-projects.csv', csv([
                    ['Job', 'Project', 'Rows', 'Bills found', 'Outstanding', 'Full value', 'Stored invoiced total'],
                    ...projRows.map(p => [p.jobNo, p.project, p.rows, p.flagged, p.flaggedDue, p.flaggedValue, p.invoicedTotal]),
                  ]))} style={btn}>Export CSV</button>
                </div>
                <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #eceae5', borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ borderBottom: '1px solid #eceae5' }}>
                      <th style={thL}>Job</th><th style={thL}>Project</th>
                      <th style={th}>Rows</th><th style={th}>Bills found</th>
                      <th style={th}>Outstanding</th><th style={th}>Full value</th>
                      <th style={th}>Stored invoiced total</th>
                    </tr></thead>
                    <tbody>
                      {projRows.map((p, i) => (
                        <tr key={p.projectId + i} style={{ borderBottom: '1px solid #f5f4f1' }}>
                          <td style={tdL}>{p.jobNo || '-'}</td>
                          <td style={tdL}>{p.project}</td>
                          <td style={td}>{p.rows}</td>
                          <td style={{ ...td, color: p.flagged ? '#dc2626' : '#ccc', fontWeight: p.flagged ? 600 : 400 }}>{p.flagged || '-'}</td>
                          <td style={{ ...td, color: p.flaggedDue ? '#dc2626' : '#ccc' }}>{p.flaggedDue ? gbp(p.flaggedDue) : '-'}</td>
                          <td style={{ ...td, color: p.flaggedValue ? '#b45309' : '#ccc' }}>{p.flaggedValue ? gbp(p.flaggedValue) : '-'}</td>
                          <td style={td}>{gbp(p.invoicedTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0 6px' }}>
                  <h2 style={{ margin: 0, fontSize: 15, color: INK }}>Every row found</h2>
                  <button onClick={() => download('invoice-store-audit-rows.csv', csv([
                    ['Basis', 'Job', 'Project', 'Contact', 'Number', 'Reference', 'Date', 'Due', 'Total', 'Outstanding', 'Status', 'Xero ID'],
                    ...(data.flagged || []).map(r => [r.basis, r.jobNo, r.project, r.contact, r.number, r.reference, r.date, r.dueDate, r.total, r.amountDue, r.status, r.xeroId]),
                  ]))} style={btn}>Export CSV</button>
                </div>
                <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #eceae5', borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ borderBottom: '1px solid #eceae5' }}>
                      <th style={thL}>Match</th><th style={thL}>Supplier</th><th style={thL}>Job</th>
                      <th style={thL}>Reference</th><th style={th}>Date</th><th style={th}>Due</th>
                      <th style={th}>Total</th><th style={th}>Outstanding</th><th style={thL}>Status</th>
                    </tr></thead>
                    <tbody>
                      {(data.flagged || []).map((r, i) => (
                        <tr key={r.xeroId + i} style={{ borderBottom: '1px solid #f5f4f1' }}>
                          <td style={{ ...tdL, color: r.basis === 'id' ? '#dc2626' : '#b45309', fontWeight: 600, fontSize: 11 }}>
                            {r.basis === 'id' ? 'ID' : 'name'}
                          </td>
                          <td style={tdL}>{r.contact || '-'}</td>
                          <td style={tdL}>{r.jobNo || r.project}</td>
                          <td style={{ ...tdL, color: '#999' }}>{r.number || r.reference || '-'}</td>
                          <td style={td}>{fmtDMY(r.date)}</td>
                          <td style={td}>{fmtDMY(r.dueDate)}</td>
                          <td style={td}>{gbp(r.total)}</td>
                          <td style={{ ...td, color: r.amountDue ? '#dc2626' : '#ccc' }}>{r.amountDue ? gbp(r.amountDue) : '-'}</td>
                          <td style={{ ...tdL, color: '#999', fontSize: 11 }}>{r.status || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Card({ label, value, bad, hint }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${bad ? '#fecaca' : '#eceae5'}`, borderRadius: 8, padding: '10px 14px', minWidth: 150 }}>
      <div style={{ fontSize: 10.5, color: '#8a857c', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: bad ? '#dc2626' : INK, marginTop: 2 }}>{value}</div>
      {hint ? <div style={{ fontSize: 10, color: '#a8a49c', marginTop: 2, maxWidth: 190, lineHeight: 1.3 }}>{hint}</div> : null}
    </div>
  )
}

