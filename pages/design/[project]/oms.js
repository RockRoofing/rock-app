import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { useDesignProjectAuth, DesignNav, PURPLE, INK } from '../../../lib/designShell'
import DrawingMarkup from '../../../components/DrawingMarkup'

const fmtDateTime = (ts) => ts ? new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

export default function OMsPage() {
  const router = useRouter()
  const projectNo = router.query.project ? String(router.query.project) : ''
  const auth = useDesignProjectAuth(projectNo)
  const [manual, setManual] = useState(null)
  const [available, setAvailable] = useState([])
  const [readiness, setReadiness] = useState(null)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { if (auth.ready && projectNo) load() }, [auth.ready, projectNo])

  async function load() {
    setLoading(true); setErr('')
    try {
      const d = await fetch(`/api/design-oms?no=${encodeURIComponent(projectNo)}`).then(r => r.json())
      setManual(d.manual || null); setAvailable(d.available || []); setCanEdit(!!d.canEdit); setReadiness(d.readiness || null)
    } catch { setErr('Could not load') }
    setLoading(false)
  }

  async function build() {
    if (building) return
    // Warn if items are missing or not yet Construction Issue - check with the Design Manager.
    if (readiness && !readiness.ready) {
      const lines = []
      if (readiness.warnings && readiness.warnings.length) lines.push('Still to be marked Construction Issue:\n  - ' + readiness.warnings.join('\n  - '))
      if (readiness.missing && readiness.missing.length) lines.push('Missing sections (nothing to include):\n  - ' + readiness.missing.join('\n  - '))
      const msg = 'The O&M Manual may not be ready to compile.\n\n' + lines.join('\n\n') + '\n\nPlease check with your Rock Roofing Design Manager that the O&Ms are ready to be compiled.\n\nBuild anyway?'
      if (!confirm(msg)) return
    } else if (manual && !confirm('Rebuild the O&M Manual? This replaces the current version.')) {
      return
    }
    setBuilding(true); setErr('')
    try {
      const r = await fetch('/api/design-oms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo, action: 'build' }) })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Could not build'); setBuilding(false); return }
      setManual(d.manual)
    } catch { setErr('Could not build') }
    setBuilding(false)
  }

  if (!auth.ready) return null
  const totalDocs = available.reduce((a, s) => a + s.count, 0)

  return (
    <>
      <Head><title>O&amp;Ms - Design</title></Head>
      <DesignNav active="oms" projectNo={projectNo} projectName={auth.project && auth.project.name} isInternal={auth.isInternal} />
      <div style={{ width: '100%', margin: 0, padding: '22px 24px 60px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ margin: '0 0 2px', color: INK, fontSize: 24 }}>O&amp;M Manual</h1>
            <p style={{ color: '#8a857c', fontSize: 14, margin: 0 }}>A single Operation &amp; Maintenance Manual combining the Technical Submittal, Construction Issue drawings, Calculations, Leak Test Certs and Warranties.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {manual && <a href={`/api/download?url=${encodeURIComponent(manual.url)}&name=${encodeURIComponent(`${projectNo}-OM-Manual.pdf`)}`} style={{ ...btnGhost, color: PURPLE, textDecoration: 'none' }}>Download</a>}
            {canEdit && <button onClick={build} disabled={building} style={{ ...btnPrimary, opacity: building ? 0.6 : 1 }}>{building ? 'Building...' : (manual ? 'Rebuild O&M Manual' : 'Build O&M Manual')}</button>}
          </div>
        </div>
        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        {canEdit && readiness && !readiness.ready && (available.length > 0 || (readiness.missing && readiness.missing.length > 0)) && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '12px 14px', fontSize: 13, marginBottom: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>&#9888; Check before compiling</div>
            {readiness.warnings && readiness.warnings.map((w, i) => <div key={`w${i}`} style={{ marginTop: 2 }}>&bull; {w}</div>)}
            {readiness.missing && readiness.missing.length > 0 && <div style={{ marginTop: 2 }}>&bull; No documents yet for: {readiness.missing.join(', ')}</div>}
            <div style={{ marginTop: 8, fontWeight: 600 }}>Please check with your Rock Roofing Design Manager that the O&amp;Ms are ready to be compiled. Only Construction Issue drawings and calculations are included.</div>
          </div>
        )}

        {loading ? <div style={{ color: '#999', padding: 20 }}>Loading...</div> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: manual ? '300px 1fr' : '1fr', gap: 18, alignItems: 'start' }}>
              <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 10 }}>What will be included</div>
                {available.length === 0
                  ? <div style={{ fontSize: 13, color: '#aaa' }}>Nothing yet. Add Tech Subs, Construction Issue drawings, Calculations, Leak Test Certs or Warranties, then build.</div>
                  : available.map((s, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f4f4f4', fontSize: 13 }}>
                      <span style={{ color: '#333' }}>{i + 1}. {s.title}</span>
                      <span style={{ color: '#888' }}>{s.count} doc{s.count === 1 ? '' : 's'}</span>
                    </div>
                  ))}
                {available.length > 0 && <div style={{ marginTop: 10, fontSize: 12, color: '#999' }}>{totalDocs} document{totalDocs === 1 ? '' : 's'} across {available.length} section{available.length === 1 ? '' : 's'}.</div>}
                {manual && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #eee', fontSize: 12, color: '#888' }}>
                    Last built {fmtDateTime(manual.builtAt)}{manual.builtBy ? ` by ${manual.builtBy}` : ''}.
                    {canEdit && <div style={{ marginTop: 4 }}>Rebuild after adding or approving more documents to refresh it.</div>}
                  </div>
                )}
              </div>

              {manual && (
                <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 12, minHeight: 400 }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Combined O&amp;M Manual - view only</span>
                    <a href={`/api/download?url=${encodeURIComponent(manual.url)}&name=${encodeURIComponent(`${projectNo}-OM-Manual.pdf`)}`} style={{ color: PURPLE, fontWeight: 600, textDecoration: 'none' }}>Download PDF</a>
                  </div>
                  <DrawingMarkup key={manual.url} imageUrl={manual.url} contentType="application/pdf" initial={null} canEdit={false} onSave={() => {}} fileName={`${projectNo}-OM-Manual.pdf`} docLabel="manual" />
                </div>
              )}
            </div>
            {!manual && available.length > 0 && !canEdit && <div style={{ marginTop: 16, color: '#999', fontSize: 13 }}>The O&amp;M Manual has not been built yet.</div>}
          </>
        )}
      </div>
    </>
  )
}

const btnPrimary = { background: PURPLE, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const btnGhost = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
