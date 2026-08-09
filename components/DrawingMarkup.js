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
  const [fontSize, setFontSize] = useState(18)
  const [bold, setBold] = useState(false)
  const [underline, setUnderline] = useState(false)
  const [editingId, setEditingId] = useState(null)   // id of the text box being typed into
  const [drag, setDrag] = useState(null)             // active edit drag: { id, mode, handle, start, orig }
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
  const updateShape = (sid, patch) => setShapes(s => s.map(x => x.id === sid ? { ...x, ...patch } : x))
  // Apply a style patch (colour, fontSize, bold, underline, width) to the selected shape.
  const applyTextStyle = (patch) => { if (selected) updateShape(selected, patch) }

  // Translate every coordinate of a shape by (dx, dy) in normalised space.
  function moveShape(sh, dx, dy) {
    const c = (v) => Math.min(1, Math.max(0, v))
    if (sh.pts) return { ...sh, pts: sh.pts.map(p => ({ x: c(p.x + dx), y: c(p.y + dy) })) }
    const out = { ...sh }
    if (sh.x1 != null) { out.x1 = c(sh.x1 + dx); out.x2 = c(sh.x2 + dx); out.y1 = c(sh.y1 + dy); out.y2 = c(sh.y2 + dy) }
    else if (sh.x != null) { out.x = c(sh.x + dx); out.y = c(sh.y + dy) }
    return out
  }

  function rel(e) {
    const r = wrapRef.current.getBoundingClientRect()
    const t = e.touches ? e.touches[0] : e
    return { x: Math.min(1, Math.max(0, (t.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (t.clientY - r.top) / r.height)) }
  }
  function down(e) {
    if (!canEdit) return
    // SELECT mode: clicking empty canvas clears selection. Shape/handle drags are started
    // by the shapes' own handlers (see startMove / startHandle), which call setDrag.
    if (tool === 'select') { if (!drag) setSelected(null); return }
    e.preventDefault()
    const p = rel(e)
    if (tool === 'free') { setDraft({ id: id(), type: 'free', pts: [p], colour, opacity, width }); return }
    if (tool === 'highlight') { setDraft({ id: id(), type: 'highlight', pts: [p], colour, opacity: Math.min(opacity, 0.4), width: Math.max(width * 4, 14) }); return }
    if (tool === 'text') { setDraft({ id: id(), type: 'text', x1: p.x, y1: p.y, x2: p.x, y2: p.y, text: '', colour, opacity, fontSize, bold, underline }); return }
    setDraft({ id: id(), type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, colour, opacity, width })
  }
  function move(e) {
    // Editing an existing shape (move or handle drag).
    if (drag) {
      e.preventDefault()
      const p = rel(e)
      if (drag.mode === 'move') {
        const dx = p.x - drag.start.x, dy = p.y - drag.start.y
        updateShape(drag.id, moveShape(drag.orig, dx, dy))
      } else if (drag.mode === 'handle') {
        const c = (v) => Math.min(1, Math.max(0, v))
        updateShape(drag.id, drag.handle === 1 ? { x1: c(p.x), y1: c(p.y) } : { x2: c(p.x), y2: c(p.y) })
      }
      return
    }
    if (!draft) return
    const p = rel(e)
    if (draft.type === 'free' || draft.type === 'highlight') setDraft(d => ({ ...d, pts: [...d.pts, p] }))
    else setDraft(d => ({ ...d, x2: p.x, y2: p.y }))
  }
  function up() {
    if (drag) { setDrag(null); return }
    if (!draft) return
    if (draft.type === 'text') {
      let d = draft
      if (Math.abs(d.x2 - d.x1) < 0.04 || Math.abs(d.y2 - d.y1) < 0.02) d = { ...d, x2: d.x1 + 0.18, y2: d.y1 + 0.06 }
      setShapes(s => [...s, d]); setDraft(null); setEditingId(d.id); setSelected(d.id)
      return
    }
    setShapes(s => [...s, draft]); setDraft(null)
  }

  // Start moving a shape (drag its body). Records the original so movement is relative.
  function startMove(e, sh) {
    if (!canEdit || tool !== 'select') return
    e.stopPropagation(); e.preventDefault()
    setSelected(sh.id)
    setDrag({ id: sh.id, mode: 'move', start: rel(e), orig: sh })
  }
  // Start dragging an endpoint/corner handle (handle 1 = start, 2 = end).
  function startHandle(e, sh, handle) {
    if (!canEdit || tool !== 'select') return
    e.stopPropagation(); e.preventDefault()
    setSelected(sh.id)
    setDrag({ id: sh.id, mode: 'handle', handle, start: rel(e), orig: sh })
  }

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
          {COLOURS.map(c => <button key={c} onMouseDown={e => e.preventDefault()} onClick={() => { setColour(c); applyTextStyle({ colour: c }) }} style={{ width: 22, height: 22, borderRadius: 5, background: c, border: colour === c ? '2px solid #111' : '1px solid #ccc', cursor: 'pointer' }} />)}
          <span style={{ width: 1, height: 22, background: '#ddd' }} />
          <label style={{ fontSize: 12, color: '#666' }}>Thickness<input type="range" min="1" max="12" value={width} onChange={e => { const v = Number(e.target.value); setWidth(v); if (selected) { const sh = shapes.find(x => x.id === selected); if (sh && sh.type !== 'text') applyTextStyle({ width: v }) } }} style={{ verticalAlign: 'middle', marginLeft: 6, width: 80 }} /></label>
          <label style={{ fontSize: 12, color: '#666' }}>Opacity<input type="range" min="0.1" max="1" step="0.1" value={opacity} onChange={e => setOpacity(Number(e.target.value))} style={{ verticalAlign: 'middle', marginLeft: 6, width: 80 }} /></label>
          {(tool === 'text' || (selected && shapes.find(x => x.id === selected)?.type === 'text')) && (
            <>
              <span style={{ width: 1, height: 22, background: '#ddd' }} />
              <label style={{ fontSize: 12, color: '#666' }}>Text size
                <select value={fontSize} onMouseDown={e => e.stopPropagation()} onChange={e => { const v = Number(e.target.value); setFontSize(v); applyTextStyle({ fontSize: v }) }} style={{ marginLeft: 6, padding: '3px 6px', borderRadius: 6, border: '1px solid #ddd', fontSize: 12.5 }}>
                  {[12, 14, 16, 18, 22, 28, 36, 48].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <button onMouseDown={e => e.preventDefault()} onClick={() => { const v = !bold; setBold(v); applyTextStyle({ bold: v }) }} style={{ ...ghost, fontWeight: 800, background: bold ? '#7c3aed' : '#fff', color: bold ? '#fff' : '#333', border: 'none' }}>B</button>
              <button onMouseDown={e => e.preventDefault()} onClick={() => { const v = !underline; setUnderline(v); applyTextStyle({ underline: v }) }} style={{ ...ghost, textDecoration: 'underline', background: underline ? '#7c3aed' : '#fff', color: underline ? '#fff' : '#333', border: 'none' }}>U</button>
            </>
          )}
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
            {all.filter(sh => sh.type !== 'text').map(sh => <Shape key={sh.id} sh={sh} selected={selected === sh.id} tool={tool} canEdit={canEdit}
              onSelect={() => { if (canEdit && tool === 'select') setSelected(sh.id) }}
              onStartMove={(e) => startMove(e, sh)} onStartHandle={(e, h) => startHandle(e, sh, h)} />)}
          </svg>
        )}
        {/* Text boxes as HTML overlays (crisp fonts, native editing) */}
        {pdfState === 'ok' && all.filter(sh => sh.type === 'text').map(sh => {
          // Support legacy text shapes that only had a single x/y point.
          const x1 = sh.x1 != null ? sh.x1 : (sh.x || 0), y1 = sh.y1 != null ? sh.y1 : (sh.y || 0)
          const x2 = sh.x2 != null ? sh.x2 : (x1 + 0.2), y2 = sh.y2 != null ? sh.y2 : (y1 + 0.06)
          const L = Math.min(x1, x2) * 100, T = Math.min(y1, y2) * 100
          const W = Math.abs(x2 - x1) * 100, H = Math.abs(y2 - y1) * 100
          const editing = editingId === sh.id
          const boxStyle = {
            position: 'absolute', left: `${L}%`, top: `${T}%`, width: `${W}%`, minHeight: `${H}%`,
            color: sh.colour || '#dc2626', opacity: sh.opacity ?? 1,
            fontSize: (sh.fontSize || 18), fontWeight: sh.bold ? 700 : 400, textDecoration: sh.underline ? 'underline' : 'none',
            lineHeight: 1.25, padding: '2px 4px', boxSizing: 'border-box',
            border: (editing || selected === sh.id) ? '1px dashed #7c3aed' : '1px solid transparent',
            background: editing ? 'rgba(255,255,255,0.7)' : 'transparent',
            overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }
          if (editing) return (
            <textarea key={sh.id} autoFocus value={sh.text || ''}
              onChange={e => updateShape(sh.id, { text: e.target.value })}
              onBlur={() => { if (!(sh.text || '').trim()) setShapes(s => s.filter(x => x.id !== sh.id)); setEditingId(null) }}
              onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}
              placeholder="Type here..."
              style={{ ...boxStyle, resize: 'none', outline: 'none', fontFamily: 'inherit' }} />
          )
          const editable = canEdit && tool === 'select'
          return (
            <div key={sh.id} style={{ ...boxStyle, cursor: editable ? (selected === sh.id ? 'move' : 'pointer') : 'default' }}
              onMouseDown={e => { if (!editable) return; e.stopPropagation(); setSelected(sh.id); setDrag({ id: sh.id, mode: 'move', start: rel(e), orig: sh }) }}
              onTouchStart={e => { if (!editable) return; e.stopPropagation(); setSelected(sh.id); setDrag({ id: sh.id, mode: 'move', start: rel(e), orig: sh }) }}
              onDoubleClick={e => { if (!canEdit) return; e.stopPropagation(); setSelected(sh.id); setEditingId(sh.id) }}>
              {sh.text || <span style={{ color: '#bbb' }}>(empty)</span>}
              {editable && selected === sh.id && (
                <span onMouseDown={e => { e.stopPropagation(); setDrag({ id: sh.id, mode: 'handle', handle: 2, start: rel(e), orig: sh }) }}
                  onTouchStart={e => { e.stopPropagation(); setDrag({ id: sh.id, mode: 'handle', handle: 2, start: rel(e), orig: sh }) }}
                  style={{ position: 'absolute', right: -6, bottom: -6, width: 14, height: 14, borderRadius: '50%', background: '#fff', border: '3px solid #7c3aed', cursor: 'nwse-resize' }} />
              )}
            </div>
          )
        })}
      </div>
      {canEdit && <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 6 }}>Draw with a tool, or use Select to edit: click a mark to select it, drag it to move, drag its end/corner handles to resize or reshape, and use the colour / thickness / text controls to restyle it. Double-click a text box to edit its words. Delete selected removes a mark. Markup saves per page - remember to Save markup.</div>}
    </div>
  )
}

function Shape({ sh, selected, tool, canEdit, onSelect, onStartMove, onStartHandle }) {
  const S = 1000
  const stroke = sh.colour || '#dc2626'
  const editable = canEdit && tool === 'select'
  // In select mode, pressing on the shape body starts a move (and selects it).
  const bodyDown = (e) => { if (editable) onStartMove(e) }
  const cursor = editable ? (selected ? 'move' : 'pointer') : 'pointer'
  const common = { stroke, strokeWidth: (sh.width || 3), opacity: sh.opacity ?? 1, fill: 'none', onMouseDown: bodyDown, onTouchStart: bodyDown, onClick: onSelect, style: { cursor } }
  const sel = selected ? { filter: 'drop-shadow(0 0 2px #7c3aed)' } : {}
  if (sh.type === 'text') return null

  // A fat invisible hit-line makes thin lines/arrows easy to grab.
  const hit = (children) => <g>{children}</g>

  if (sh.type === 'free' || sh.type === 'highlight') {
    const pts = (sh.pts || []).map(p => `${p.x * S},${p.y * S}`).join(' ')
    const isHl = sh.type === 'highlight'
    return hit(<>
      <polyline points={pts} stroke="transparent" strokeWidth={Math.max((sh.width || 3) + 14, 18)} fill="none" onMouseDown={bodyDown} onTouchStart={bodyDown} onClick={onSelect} style={{ cursor }} />
      <polyline points={pts} stroke={stroke} strokeWidth={isHl ? (sh.width || 16) : (sh.width || 3)} opacity={isHl ? (sh.opacity ?? 0.35) : (sh.opacity ?? 1)} fill="none" strokeLinejoin="round" strokeLinecap="round" style={{ ...sel, pointerEvents: 'none' }} />
    </>)
  }
  if (sh.type === 'rect') {
    const x = Math.min(sh.x1, sh.x2) * S, y = Math.min(sh.y1, sh.y2) * S, w = Math.abs(sh.x2 - sh.x1) * S, h = Math.abs(sh.y2 - sh.y1) * S
    return hit(<>
      <rect x={x} y={y} width={w} height={h} {...common} style={{ ...common.style, ...sel }} />
      {selected && editable && cornerHandles(sh, S, onStartHandle)}
    </>)
  }
  if (sh.type === 'circle') {
    const cx = (sh.x1 + sh.x2) / 2 * S, cy = (sh.y1 + sh.y2) / 2 * S, rx = Math.abs(sh.x2 - sh.x1) / 2 * S, ry = Math.abs(sh.y2 - sh.y1) / 2 * S
    return hit(<>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...common} style={{ ...common.style, ...sel }} />
      {selected && editable && cornerHandles(sh, S, onStartHandle)}
    </>)
  }
  // line / arrow
  const marker = sh.type === 'arrow' ? { markerEnd: 'url(#arrowhead)' } : {}
  return hit(<>
    <line x1={sh.x1 * S} y1={sh.y1 * S} x2={sh.x2 * S} y2={sh.y2 * S} stroke="transparent" strokeWidth={16} onMouseDown={bodyDown} onTouchStart={bodyDown} onClick={onSelect} style={{ cursor }} />
    <line x1={sh.x1 * S} y1={sh.y1 * S} x2={sh.x2 * S} y2={sh.y2 * S} {...common} {...marker} strokeLinecap="round" style={{ ...common.style, ...sel, pointerEvents: 'none' }} />
    {selected && editable && <>
      {endHandle(sh.x1 * S, sh.y1 * S, (e) => onStartHandle(e, 1))}
      {endHandle(sh.x2 * S, sh.y2 * S, (e) => onStartHandle(e, 2))}
    </>}
  </>)
}

// Draggable endpoint handle (for lines/arrows).
function endHandle(cx, cy, onDown) {
  return <circle cx={cx} cy={cy} r={11} fill="#fff" stroke="#7c3aed" strokeWidth={3}
    onMouseDown={onDown} onTouchStart={onDown} style={{ cursor: 'crosshair' }} />
}
// Two opposite corner handles for rect/circle (handle 1 = x1/y1 corner, 2 = x2/y2 corner).
function cornerHandles(sh, S, onStartHandle) {
  return <>
    {endHandle(sh.x1 * S, sh.y1 * S, (e) => onStartHandle(e, 1))}
    {endHandle(sh.x2 * S, sh.y2 * S, (e) => onStartHandle(e, 2))}
  </>
}

function id() { return `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
const ghost = { background: '#fff', border: '1px solid #ddd', borderRadius: 6, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' }
