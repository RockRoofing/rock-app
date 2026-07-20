import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Shell } from '../index'
import { INK, BRAND, useMyProjects, ProjectPicker, ProjectHeader, fmtDate } from '../../../lib/cmSiteApp'

const money = (n) => (n || n === 0) ? `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
const num = (n) => (n || n === 0) ? Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const pct = (n) => (n || n === 0) ? `${Number(n)}%` : '—'

const STATUS_META = {
  draft: { label: 'Draft', bg: '#f3f4f6', fg: '#4b5563' },
  sent: { label: 'Sent', bg: '#dcfce7', fg: '#166534' },
  paid: { label: 'Paid', bg: '#dbeafe', fg: '#1e40af' },
}
function StatusPill({ status }) {
  const m = STATUS_META[status] || { label: status || '—', bg: '#f3f4f6', fg: '#4b5563' }
  return <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '2px 9px', background: m.bg, color: m.fg, whiteSpace: 'nowrap' }}>{m.label}</span>
}

// CM › Applications — project-first, READ-ONLY. Lists all applications (any status)
// for a project the user is CM on, and opens the full summary (all sections/columns).
export default function CmApplications() {
  const router = useRouter()
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false)
  const [proj, setProj] = useState(null)
  const [apps, setApps] = useState(null)
  const [xeroId, setXeroId] = useState(null)
  const [openApp, setOpenApp] = useState(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    setReady(true)
  }, [])

  const { myProjects, loading: projLoading } = useMyProjects(user)

  async function pick(p) {
    setProj(p); setApps(null); setOpenApp(null); setXeroId(null); setLoading(true)
    try {
      const matchKey = (x) => String(x.jobNo || x.projectNo || '').trim()
      let d = await fetch('/api/dashboard').then(r => r.json())
      let row = (d.projects || []).find(x => matchKey(x) === String(p.projectNo).trim())
      if (!row) {
        d = await fetch('/api/dashboard?sync=true').then(r => r.json())
        row = (d.projects || []).find(x => matchKey(x) === String(p.projectNo).trim())
      }
      if (row?.xeroId) {
        setXeroId(row.xeroId)
        const ad = await fetch(`/api/applications-view?projectId=${encodeURIComponent(row.xeroId)}`).then(r => r.json())
        setApps(ad.applications || [])
      } else { setApps([]) }
    } catch { setApps([]) }
    setLoading(false)
  }

  async function openApplication(id) {
    if (!xeroId) return
    setDetailLoading(true); setOpenApp(null)
    try {
      const d = await fetch(`/api/applications-view?projectId=${encodeURIComponent(xeroId)}&appId=${encodeURIComponent(id)}`).then(r => r.json())
      setOpenApp(d.application || null)
    } catch { setOpenApp(null) }
    setDetailLoading(false)
  }

  if (!ready) return <Shell user={user}><Loading /></Shell>

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={backLink}>‹ Home</button>
        <h2 style={{ fontSize: 18, color: INK, margin: '8px 0 10px' }}>Applications</h2>

        {!proj ? (
          projLoading ? <Loading /> : <ProjectPicker projects={myProjects} onPick={pick} subtitle="Select one of your projects." />
        ) : openApp ? (
          <ApplicationDetail app={openApp} loading={detailLoading} onBack={() => setOpenApp(null)} />
        ) : (
          <>
            <ProjectHeader project={proj} onBack={() => { setProj(null); setApps(null) }} />
            {loading ? <Loading /> : !apps || apps.length === 0 ? (
              <Empty>No applications for this project yet.</Empty>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr 96px 110px', gap: 6, padding: '9px 12px', background: '#f7f6f2', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  <div>App</div><div>Required date</div><div>Status</div><div style={{ textAlign: 'right' }}>This cert</div>
                </div>
                {apps.map(a => (
                  <button key={a.id} onClick={() => openApplication(a.id)}
                    style={{ display: 'grid', gridTemplateColumns: '54px 1fr 96px 110px', gap: 6, alignItems: 'center', width: '100%', textAlign: 'left', padding: '11px 12px', border: 'none', borderTop: '1px solid #f0eee8', background: '#fff', cursor: 'pointer' }}>
                    <div style={{ fontWeight: 800, color: BRAND, fontSize: 14 }}>{a.appNumber || '—'}</div>
                    <div style={{ fontSize: 13, color: '#374151' }}>{a.requiredDate ? fmtDate(a.requiredDate) : '—'}</div>
                    <div><StatusPill status={a.status} /></div>
                    <div style={{ textAlign: 'right', fontWeight: 700, color: '#111', fontSize: 13 }}>{money(a.thisCertValue)}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}

// Full application detail — Summary + Certificate + Contract Works + Variations +
// Materials, showing all columns and all sections.
function ApplicationDetail({ app, loading, onBack }) {
  if (loading || !app) return <div><button onClick={onBack} style={backLink}>‹ Applications</button><Loading /></div>
  const s = app.summary || {}
  const cert = [
    ['Gross', s.previously?.gross, s.current?.gross, s.thisCert?.gross],
    ['Main contractor discount', s.previously?.mcd, s.current?.mcd, s.thisCert?.mcd],
    ['Sub-total', s.previously?.subTotal, s.current?.subTotal, s.thisCert?.subTotal],
    ['Retention', s.previously?.retention, s.current?.retention, s.thisCert?.retention],
    ['Total', s.previously?.total, s.current?.total, s.thisCert?.total],
  ]
  return (
    <div>
      <button onClick={onBack} style={backLink}>‹ Applications</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 12px' }}>
        <h3 style={{ fontSize: 17, color: INK, margin: 0 }}>Application {app.appNumber}</h3>
        <StatusPill status={app.status} />
      </div>

      {/* Summary block */}
      <Card>
        <Row k="Required date" v={app.requiredDate ? fmtDate(app.requiredDate) : '—'} />
        <Row k="Valuation date" v={app.valuationDate ? fmtDate(app.valuationDate) : '—'} />
        <Row k="Payment date" v={app.paymentDate ? fmtDate(app.paymentDate) : '—'} />
        <Row k="Measured contract sum" v={money(s.measuredContractSum)} />
        <Row k="Variations (final)" v={money(s.variationsFinal)} />
        <Row k="Anticipated final account" v={money(s.anticipatedFinalAccount)} bold />
        <Row k="Application total (gross to date)" v={money(s.grossCurrent)} />
      </Card>

      {/* Certificate block — Previously / To date / This application */}
      <SectionTitle>Certificate</SectionTitle>
      <div style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 4, padding: '8px 10px', background: '#f7f6f2', fontSize: 10.5, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>
          <div></div><div style={{ textAlign: 'right' }}>Previously</div><div style={{ textAlign: 'right' }}>To date</div><div style={{ textAlign: 'right' }}>This app</div>
        </div>
        {cert.map(([label, prev, cur, tc], i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 4, padding: '8px 10px', borderTop: '1px solid #f0eee8', fontSize: 12.5, fontWeight: label === 'Total' ? 800 : 500, color: label === 'Total' ? INK : '#374151' }}>
            <div>{label}</div>
            <div style={{ textAlign: 'right' }}>{money(prev)}</div>
            <div style={{ textAlign: 'right' }}>{money(cur)}</div>
            <div style={{ textAlign: 'right' }}>{money(tc)}</div>
          </div>
        ))}
      </div>

      {/* Contract Works */}
      <SectionTitle>Contract Works</SectionTitle>
      <RowsTable
        rows={app.contractWorks}
        cols={[
          ['code', 'Item', 'left'],
          ['description', 'Description', 'left'],
          ['qty', 'Qty', 'right'],
          ['unit', 'Unit', 'left'],
          ['rate', 'Rate', 'right', money],
          ['total', 'Total', 'right', money],
          ['pctComplete', '% Comp', 'right', pct],
        ]}
        empty="No contract works lines."
      />

      {/* Variations */}
      <SectionTitle>Variations</SectionTitle>
      <RowsTable
        rows={app.variations}
        cols={[
          ['varNumber', 'VO', 'left'],
          ['description', 'Description', 'left'],
          ['instructed', 'Status', 'left', (v) => v ? 'Instructed' : 'Not instructed'],
          ['finalValue', 'Final value', 'right', money, (r) => r.materials != null || r.labour != null ? (Number(r.materials || 0) + Number(r.labour || 0) + Number(r.profit || 0)) : (r.finalValue ?? r.value)],
          ['pctComplete', '% Comp', 'right', (v) => v == null ? 'N/A' : pct(v)],
        ]}
        empty="No variations."
      />

      {/* Materials on site */}
      <SectionTitle>Materials on Site</SectionTitle>
      <RowsTable
        rows={app.materials}
        cols={[
          ['description', 'Description', 'left'],
          ['qty', 'Qty', 'right'],
          ['unit', 'Unit', 'left'],
          ['rate', 'Rate', 'right', money],
          ['total', 'Total', 'right', money],
          ['pctComplete', 'Claimed %', 'right', (v) => v == null ? '100%' : pct(v)],
        ]}
        empty="No materials on site."
      />
    </div>
  )
}

// Generic rows table. cols = [key, label, align, format?, valueGetter?]
function RowsTable({ rows = [], cols, empty }) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) return <Empty>{empty}</Empty>
  return (
    <div style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, overflow: 'auto', marginBottom: 14 }}>
      <div style={{ minWidth: 520 }}>
        <div style={{ display: 'flex', padding: '8px 10px', background: '#f7f6f2', fontSize: 10.5, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>
          {cols.map(([k, label, align]) => (
            <div key={k} style={{ flex: k === 'description' ? 2.4 : 1, textAlign: align, padding: '0 4px' }}>{label}</div>
          ))}
        </div>
        {list.map((r, i) => {
          if (r.kind === 'heading') {
            return <div key={r.id || i} style={{ padding: '8px 10px', borderTop: '1px solid #f0eee8', fontWeight: 700, color: '#374151', fontSize: 12.5, background: '#fbfaf7' }}>{r.description}</div>
          }
          return (
            <div key={r.id || i} style={{ display: 'flex', padding: '8px 10px', borderTop: '1px solid #f0eee8', fontSize: 12.5, color: '#374151' }}>
              {cols.map(([k, , align, fmt, getter]) => {
                let val = getter ? getter(r) : r[k]
                if (fmt) val = fmt(val)
                else if (val == null || val === '') val = '—'
                return <div key={k} style={{ flex: k === 'description' ? 2.4 : 1, textAlign: align, padding: '0 4px', whiteSpace: k === 'description' ? 'normal' : 'nowrap' }}>{val}</div>
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Card({ children }) { return <div style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: '4px 14px', marginBottom: 14 }}>{children}</div> }
function Row({ k, v, bold }) { return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f4f2ec', fontSize: 13 }}><span style={{ color: '#6b7280' }}>{k}</span><span style={{ fontWeight: bold ? 800 : 600, color: INK }}>{v}</span></div> }
function SectionTitle({ children }) { return <div style={{ fontSize: 13, fontWeight: 800, color: INK, textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0 8px' }}>{children}</div> }
function Loading() { return <div style={{ textAlign: 'center', color: '#999', fontSize: 14, padding: 30 }}>Loading…</div> }
function Empty({ children }) { return <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 22, textAlign: 'center', color: '#999', fontSize: 14, marginBottom: 14 }}>{children}</div> }
const backLink = { background: 'none', border: 'none', color: BRAND, fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: '4px 0' }
