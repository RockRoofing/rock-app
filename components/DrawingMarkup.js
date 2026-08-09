import { useState, useRef, useEffect } from 'react'

// Annotation overlay for a drawing. Works on IMAGES and PDFs.
// - Images: single page, drawn straight over the <img>.
// - PDFs: rendered to a canvas via pdf.js (mobile browsers won't inline PDFs); the
//   markup overlay sits on top. Any page of a multi-page PDF can be annotated.
// Markup for a PDF is stored PER PAGE: { "1": [shapes], "2": [shapes], ... }
// Markup for an image is stored as a flat array (back-compatible).
// Coordinates are fractions (0-1) of the page box so they stay aligned at any size.

const TOOLS = [
  { key: 'select', label: 'Select' },
  { key: 'arrow', label: 'Arrow' },
  { key: 'rect', label: 'Box' },
  { key: 'circle', label: 'Circle' },
  { key: 'line', label: 'Line' },
  { key: 'free', label: 'Draw' },
  { key: 'highlight', label: 'Highlight' },
  { key: 'text', label: 'Text' },
]
const COLOURS = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#111111']

const isImageUrl = (url, contentType) => (contentType || '').startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(url || '')

// Normalise stored markup into a { page: shapes[] } map. Legacy flat arrays -> page 1.
function toMap(initial) {
  if (Array.isArray(initial)) return { 1: initial }
  if (initial && typeof initial === 'object') {
    const out = {}
    for (const k of Object.keys(initial)) out[k] = Array.isArray(initial[k]) ? initial[k] : []
    return out
  }
  return {}
}

export default function DrawingMarkup({ imageUrl, contentType, initial, canEdit, onSave, fileName }) {
  const isImg = isImageUrl(imageUrl, contentType)
  const [map, setMap] = useState(() => toMap(initial))
  const [page, setPage] = useState(1)
  const [numPages, setNumPages] = useState(1)
  const [tool, setTool] = useState('select')
  const [colour, setColour] = useState('#dc2626')
  const [opacity, setOpacity] = useState(1)
  const [width, setWidth] = useState(3)
  const [draft, setDraft] = useState(null)
  const [selected, setSelected] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [pdfState, setPdfState] = useState(isImg ? 'ok' : 'loading')
  const wrapRef = useRef()
  const canvasHolderRef = useRef()
  const pdfDocRef = useRef(null)

  useEffect(() => { setMap(toMap(initial)); setPage(1); setDirty(false) }, [imageUrl])

  // Load + render PDF page.
  useEffect(() => {
    if (isImg) return
    let cancelled = false
    ;(async () => {
      try {
        setPdfState('loading')
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script')
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
            s.onload = resolve; s.onerror = reject; document.body.appendChild(s)
          })
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        }
        if (!pdfDocRef.current) {
          pdfDocRef.current = await window.pdfjsLib.getDocument(imageUrl).promise
          if (cancelled) return
          setNumPages(pdfDocRef.current.numPages)
        }
        const pdf = pdfDocRef.current
        const pg = await pdf.getPage(page)
        if (cancelled) return
        const holder = canvasHolderRef.current; if (!holder) return
        holder.innerHTML = ''
        const maxW = Math.min(holder.clientWidth || 1000, 1400)
        const vp0 = pg.getViewport({ scale: 1 })
        const scale = (maxW / vp0.width) * (window.devicePixelRatio || 1)
        const viewport = pg.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width; canvas.height = viewport.height
        canvas.style.width = '100%'; canvas.style.height = 'auto'; canvas.style.display = 'block'
        holder.appendChild(canvas)
        await pg.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        if (!cancelled) setPdfState('ok')
      } catch { if (!cancelled) setPdfState('failed') }
    })()
    return () => { cancelled = true }
  }, [imageUrl, page, isImg])

  const shapes = map[page] || []
  const setShapes = (updater) => {
    setMap(m => { const cur = m[page] || []; const next = typeof updater === 'function' ? updater(cur) : updater; return { ...m, [page]: next } })
    setDirty(true)
  }

  function rel(e) {
    const r = wrapRef.current.getBoundingClientRect()
    const t = e.touches ? e.touches[0] : e
    return { x: Math.min(1, Math.max(0, (t.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (t.clientY - r.top) / r.height)) }
  }
  function down(e) {
    if (!canEdit || tool === 'select') return
    e.preventDefault()
    const p = rel(e)
    if (tool === 'text') { const txt = prompt('Comment text:'); if (txt) setShapes(s => [...s, { id: id(), type: 'text', x: p.x, y: p.y, text: txt, colour, opacity, width }]); return }
    if (tool === 'free') { setDraft({ id: id(), type: 'free', pts: [p], colour, opacity, width }); return }
    // Highlighter: freehand, thick and semi-transparent so it reads like a marker.
    if (tool === 'highlight') { setDraft({ id: id(), type: 'highlight', pts: [p], colour, opacity: Math.min(opacity, 0.4), width: Math.max(width * 4, 14) }); return }
    setDraft({ id: id(), type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, colour, opacity, width })
  }
  function move(e) {
    if (!draft) return
    const p = rel(e)
    if (draft.type === 'free' || draft.type === 'highlight') setDraft(d => ({ ...d, pts: [...d.pts, p] }))
    else setDraft(d => ({ ...d, x2: p.x, y2: p.y }))
  }
  function up() { if (!draft) return; setShapes(s => [...s, draft]); setDraft(null) }

  function removeSelected() { if (selected) { setShapes(s => s.filter(x => x.id !== selected)); setSelected(null) } }
  function undo() { setShapes(s => s.slice(0, -1)) }
  async function save() {
    // Save images as a flat array (page 1) for back-compat; PDFs as the page map.
    const payload = isImg ? (map[1] || []) : map
    await onSave(payload); setDirty(false)
  }

  const all = draft ? [...shapes, draft] : shapes

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <a href={`/api/download?url=${encodeURIComponent(imageUrl)}&name=${encodeURIComponent(fileName || 'file')}`}
          style={{ ...ghost, textDecoration: 'none', color: '#7c3aed', fontWeight: 600 }}>Download</a>
      </div>
      {canEdit && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10, background: '#faf9fd', border: '1px solid #ece9f5', borderRadius: 10, padding: 8 }}>
          {TOOLS.map(t => (
            <button key={t.key} onClick={() => setTool(t.key)} style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${tool === t.key ? '#7c3aed' : '#ddd'}`, background: tool === t.key ? '#7c3aed' : '#fff', color: tool === t.key ? '#fff' : '#333', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>{t.label}</button>
          ))}
          <span style={{ width: 1, height: 22, background: '#ddd' }} />
          {COLOURS.map(c => <button key={c} onClick={() => setColour(c)} style={{ width: 22, height: 22, borderRadius: 5, background: c, border: colour === c ? '2px solid #111' : '1px solid #ccc', cursor: 'pointer' }} />)}
          <span style={{ width: 1, height: 22, background: '#ddd' }} />
          <label style={{ fontSize: 12, color: '#666' }}>Thickness<input type="range" min="1" max="12" value={width} onChange={e => setWidth(Number(e.target.value))} style={{ verticalAlign: 'middle', marginLeft: 6, width: 80 }} /></label>
          <label style={{ fontSize: 12, color: '#666' }}>Opacity<input type="range" min="0.1" max="1" step="0.1" value={opacity} onChange={e => setOpacity(Number(e.target.value))} style={{ verticalAlign: 'middle', marginLeft: 6, width: 80 }} /></label>
          <span style={{ width: 1, height: 22, background: '#ddd' }} />
          <button onClick={undo} style={ghost}>Undo</button>
          {selected && <button onClick={removeSelected} style={{ ...ghost, color: '#dc2626' }}>Delete selected</button>}
          <button onClick={save} disabled={!dirty} style={{ ...ghost, background: dirty ? '#7c3aed' : '#eee', color: dirty ? '#fff' : '#999', border: 'none' }}>Save markup</button>
        </div>
      )}

      {!isImg && numPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={ghost}>‹ Prev</button>
          <span style={{ fontSize: 13, color: '#666' }}>Page {page} of {numPages}</span>
          <button onClick={() => setPage(p => Math.min(numPages, p + 1))} disabled={page >= numPages} style={ghost}>Next ›</button>
          {(map[page] || []).length > 0 && <span style={{ fontSize: 11.5, color: '#9333ea', fontWeight: 600 }}>{(map[page] || []).length} mark(s) on this page</span>}
        </div>
      )}

      <div ref={wrapRef} onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}
        onTouchStart={down} onTouchMove={move} onTouchEnd={up}
        style={{ position: 'relative', width: '100%', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', touchAction: 'none', background: '#f4f4f4', minHeight: isImg ? 0 : 200 }}>
        {isImg
          ? <img src={imageUrl} alt="drawing" style={{ display: 'block', width: '100%', pointerEvents: 'none' }} />
          : <div ref={canvasHolderRef} style={{ width: '100%' }} />}
        {pdfState === 'loading' && <div style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>Loading drawing…</div>}
        {pdfState === 'failed' && <div style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>Couldn't render this drawing - use Download to view it.</div>}
        {pdfState === 'ok' && (
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">
                <polygon points="0 0, 10 4, 0 8" fill="context-stroke" />
              </marker>
            </defs>
            {all.map(sh => <Shape key={sh.id} sh={sh} selected={selected === sh.id} onClick={() => { if (canEdit && tool === 'select') setSelected(sh.id) }} />)}
          </svg>
        )}
      </div>
      {canEdit && <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 6 }}>Pick a tool, choose colour / thickness / opacity, then draw on the drawing. Use Select to click a shape and delete it. Markup saves per page - remember to Save markup.</div>}
    </div>
  )
}

function Shape({ sh, selected, onClick }) {
  const S = 1000
  const stroke = sh.colour || '#dc2626'
  const common = { stroke, strokeWidth: (sh.width || 3), opacity: sh.opacity ?? 1, fill: 'none', style: { cursor: 'pointer' }, onClick }
  const sel = selected ? { filter: 'drop-shadow(0 0 2px #7c3aed)' } : {}
  if (sh.type === 'text') return <text x={sh.x * S} y={sh.y * S} fill={stroke} opacity={sh.opacity ?? 1} fontSize={Math.max(12, (sh.width || 3) * 6)} onClick={onClick} style={{ cursor: 'pointer', ...sel }}>{sh.text}</text>
  if (sh.type === 'free') return <polyline points={(sh.pts || []).map(p => `${p.x * S},${p.y * S}`).join(' ')} {...common} strokeLinejoin="round" strokeLinecap="round" style={{ ...common.style, ...sel }} />
  if (sh.type === 'highlight') return <polyline points={(sh.pts || []).map(p => `${p.x * S},${p.y * S}`).join(' ')} stroke={stroke} strokeWidth={sh.width || 16} opacity={sh.opacity ?? 0.35} fill="none" strokeLinejoin="round" strokeLinecap="round" onClick={onClick} style={{ cursor: 'pointer', ...sel }} />
  if (sh.type === 'rect') { const x = Math.min(sh.x1, sh.x2) * S, y = Math.min(sh.y1, sh.y2) * S, w = Math.abs(sh.x2 - sh.x1) * S, h = Math.abs(sh.y2 - sh.y1) * S; return <rect x={x} y={y} width={w} height={h} {...common} style={{ ...common.style, ...sel }} /> }
  if (sh.type === 'circle') { const cx = (sh.x1 + sh.x2) / 2 * S, cy = (sh.y1 + sh.y2) / 2 * S, rx = Math.abs(sh.x2 - sh.x1) / 2 * S, ry = Math.abs(sh.y2 - sh.y1) / 2 * S; return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...common} style={{ ...common.style, ...sel }} /> }
  const marker = sh.type === 'arrow' ? { markerEnd: 'url(#arrowhead)' } : {}
  return <line x1={sh.x1 * S} y1={sh.y1 * S} x2={sh.x2 * S} y2={sh.y2 * S} {...common} {...marker} strokeLinecap="round" style={{ ...common.style, ...sel }} />
}

function id() { return `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
const ghost = { background: '#fff', border: '1px solid #ddd', borderRadius: 6, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' }
