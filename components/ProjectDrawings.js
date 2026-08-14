import { useState, useEffect, useRef } from 'react'
import { INK, Loading, EmptyCard, linkBtn } from './opsUI'

// Ops > Projects > Drawings. READ-ONLY view of the Design Portal's Rock Drawings.
//
// There is no upload here on purpose: drawings are uploaded and revised in the Design
// Portal, and this reads that same store live. Only the newest revision of each drawing
// is shown - superseded revisions stay in the Design Portal as history.

const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
const isImage = (f) => (f.contentType || '').startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(f.name || '')
const isPdf = (f) => (f.contentType || '').includes('pdf') || /\.pdf$/i.test(f.name || f.url || '')

export default function ProjectDrawings({ projectNo }) {
  const [drawings, setDrawings] = useState([])
  const [counts, setCounts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(null)

  useEffect(() => { load() }, [projectNo])
  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/project-drawings?no=${encodeURIComponent(projectNo)}`)
      const d = await r.json()
      setDrawings(d.drawings || []); setCounts(d.counts || null)
    } catch { setDrawings([]); setCounts(null) }
    setLoading(false)
  }

  const dl = (d) => `/api/download?url=${encodeURIComponent(d.url)}&name=${encodeURIComponent(d.name)}`

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Project drawings</div>
        <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>
          Pulled live from the Design Portal (Rock Drawings). Upload and revise them there - this page is view and download only.
          Only drawings marked <strong>Construction Issue</strong> reach operatives in the Site App.
        </div>
      </div>

      {counts && counts.total > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <Banner tone="green" head={`${counts.approved} of ${counts.total} approved`}
            body={counts.notApproved > 0 ? `${counts.notApproved} still awaiting customer approval` : 'All drawings approved'} />
          <Banner tone="blue" head={`${counts.constructionIssue} of ${counts.total} Construction Issue`}
            body={counts.notConstructionIssue > 0 ? `${counts.notConstructionIssue} not released to site` : 'All drawings released to site'} />
        </div>
      )}

      {loading ? <Loading /> : !drawings.length ? (
        <EmptyCard title="No drawings yet" body="Nothing has been uploaded to Rock Drawings in the Design Portal for this project." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 14 }}>
          {drawings.map(d => (
            <div key={d.id} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div onClick={() => setPreview(d)} style={{ height: 130, background: '#f7f6f4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {isImage(d) ? <img src={d.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : isPdf(d) ? <PdfThumb url={d.url} />
                    : <div style={{ textAlign: 'center', color: '#bbb' }}><div style={{ fontSize: 32 }}>&#128206;</div><div style={{ fontSize: 11, marginTop: 4 }}>FILE</div></div>}
              </div>
              <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div title={d.title} style={{ fontSize: 13, color: INK, fontWeight: 600, wordBreak: 'break-word', lineHeight: 1.3 }}>{d.title}</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                  {d.revision && <Pill c="#4338ca" bg="#eef2ff">Rev {d.revision}</Pill>}
                  {d.approved ? <Pill c="#15803d" bg="#dcfce7">Approved</Pill> : <Pill c="#b45309" bg="#fef3c7">Not approved</Pill>}
                  {d.constructionIssue
                    ? <Pill c="#2563eb" bg="#dbeafe">Construction Issue</Pill>
                    : <Pill c="#6b7280" bg="#f3f4f6">Not for site</Pill>}
                </div>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>
                  {d.approved && d.approvedAt ? `Approved ${fmtDate(d.approvedAt)}` : `Uploaded ${fmtDate(d.uploadedAt)}`}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button onClick={() => setPreview(d)} style={linkBtn}>View</button>
                  <a href={dl(d)} style={{ ...linkBtn, textDecoration: 'none' }}>Download</a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', color: '#fff', gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{preview.title}{preview.revision ? ` - Rev ${preview.revision}` : ''}</div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <a href={dl(preview)} style={{ color: '#fff', fontSize: 14 }} onClick={e => e.stopPropagation()}>Download</a>
              <button onClick={() => setPreview(null)} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 26, cursor: 'pointer', lineHeight: 1 }}>&times;</button>
            </div>
          </div>
          <div onClick={e => e.stopPropagation()} style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            {isImage(preview)
              ? <img src={preview.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              : <iframe src={`/api/download?url=${encodeURIComponent(preview.url)}&name=${encodeURIComponent(preview.name)}&inline=1`} title={preview.name} style={{ width: '100%', height: '100%', border: 'none', background: '#fff', borderRadius: 8 }} />}
          </div>
        </div>
      )}
    </div>
  )
}

function Pill({ c, bg, children }) {
  return <span style={{ color: c, background: bg, borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>{children}</span>
}

function Banner({ tone, head, body }) {
  const t = tone === 'green'
    ? { bg: '#f0fdf4', br: '#bbf7d0', c: '#15803d' }
    : { bg: '#eff6ff', br: '#bfdbfe', c: '#1d4ed8' }
  return (
    <div style={{ flex: '1 1 240px', background: t.bg, border: `1px solid ${t.br}`, borderRadius: 12, padding: '10px 14px' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: t.c }}>{head}</div>
      <div style={{ fontSize: 12.5, color: '#666', marginTop: 2 }}>{body}</div>
    </div>
  )
}

// First page of a PDF as a thumbnail (pdf.js from CDN), same approach as ProjectFiles.
function PdfThumb({ url }) {
  const canvasRef = useRef()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script')
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
            s.onload = resolve; s.onerror = reject
            document.body.appendChild(s)
          })
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        }
        const pdf = await window.pdfjsLib.getDocument(url).promise
        const page = await pdf.getPage(1)
        if (cancelled) return
        const canvas = canvasRef.current
        if (!canvas) return
        const vp0 = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: 260 / vp0.width })
        canvas.width = viewport.width; canvas.height = viewport.height
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      } catch (e) { if (!cancelled) setFailed(true) }
    })()
    return () => { cancelled = true }
  }, [url])
  if (failed) return <div style={{ textAlign: 'center', color: '#bbb' }}><div style={{ fontSize: 32 }}>&#128196;</div><div style={{ fontSize: 11, marginTop: 4 }}>PDF</div></div>
  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
}
