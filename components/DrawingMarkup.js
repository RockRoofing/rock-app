import { useState, useRef, useEffect } from 'react'

// SVG annotation overlay over a drawing image. Tools: arrow, rectangle, circle, line,
// freehand, text. Adjustable colour, opacity and stroke width. Coordinates are stored
// as fractions (0-1) of the image box so markup stays aligned at any size.
const TOOLS = [
  { key: 'select', label: 'Select' },
  { key: 'arrow', label: 'Arrow' },
  { key: 'rect', label: 'Box' },
  { key: 'circle', label: 'Circle' },
  { key: 'line', label: 'Line' },
  { key: 'free', label: 'Draw' },
  { key: 'text', label: 'Text' },
]
const COLOURS = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#111111']

export default function DrawingMarkup({ imageUrl, initial = [], canEdit, onSave }) {
  const [shapes, setShapes] = useState(initial)
  const [tool, setTool] = useState('select')
  const [colour, setColour] = useState('#dc2626')
  const [opacity, setOpacity] = useState(1)
  const [width, setWidth] = useState(3)
  const [draft, setDraft] = useState(null)
  const [selected, setSelected] = useState(null)
  const [dirty, setDirty] = useState(false)
  const wrapRef = useRef()

  useEffect(() => { setShapes(initial || []) }, [imageUrl])

  function rel(e) {
    const r = wrapRef.current.getBoundingClientRect()
    const t = e.touches ? e.touches[0] : e
    return { x: Math.min(1, Math.max(0, (t.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (t.clientY - r.top) / r.height)) }
  }

  function down(e) {
    if (!canEdit || tool === 'select') return
    e.preventDefault()
    const p = rel(e)
    if (tool === 'text') {
      const txt = prompt('Comment text:')
      if (txt) { setShapes(s => [...s, { id: id(), type: 'text', x: p.x, y: p.y, text: txt, colour, opacity, width }]); setDirty(true) }
      return
    }
    if (tool === 'free') { setDraft({ id: id(), type: 'free', pts: [p], colour, opacity, width }); return }
    setDraft({ id: id(), type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, colour, opacity, width })
  }
  function move(e) {
    if (!draft) return
    const p = rel(e)
    if (draft.type === 'free') setDraft(d => ({ ...d, pts: [...d.pts, p] }))
    else setDraft(d => ({ ...d, x2: p.x, y2: p.y }))
  }
  function up() {
    if (!draft) return
    setShapes(s => [...s, draft]); setDraft(null); setDirty(true)
  }

  function removeSelected() { if (selected) { setShapes(s => s.filter(x => x.id !== selected)); setSelected(null); setDirty(true) } }
  function undo() { setShapes(s => s.slice(0, -1)); setDirty(true) }
  async function save() { await onSave(shapes); setDirty(false) }

  const all = draft ? [...shapes, draft] : shapes

  return (
    <div>
      {canEdit && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10, background: '#faf9fd', border: '1px solid #ece9f5', borderRadius: 10, padding: 8 }}>
          {TOOLS.map(t => (
            <button key={t.key} onClick={() => setTool(t.key)} style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${tool === t.key ? '#7c3aed' : '#ddd'}`, background: tool === t.key ? '#7c3aed' : '#fff', color: tool === t.key ? '#fff' : '#333', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>{t.label}</button>
          ))}
          <span style={{ width: 1, height: 22, background: '#ddd' }} />
          {COLOURS.map(c => (
            <button key={c} onClick={() => setColour(c)} style={{ width: 22, height: 22, borderRadius: 5, background: c, border: colour === c ? '2px solid #111' : '1px solid #ccc', cursor: 'pointer' }} />
          ))}
          <span style={{ width: 1, height: 22, background: '#ddd' }} />
          <label style={{ fontSize: 12, color: '#666' }}>Thickness
            <input type="range" min="1" max="12" value={width} onChange={e => setWidth(Number(e.target.value))} style={{ verticalAlign: 'middle', marginLeft: 6, width: 80 }} />
          </label>
          <label style={{ fontSize: 12, color: '#666' }}>Opacity
            <input type="range" min="0.1" max="1" step="0.1" value={opacity} onChange={e => setOpacity(Number(e.target.value))} style={{ verticalAlign: 'middle', marginLeft: 6, width: 80 }} />
          </label>
          <span style={{ width: 1, height: 22, background: '#ddd' }} />
          <button onClick={undo} style={ghost}>Undo</button>
          {selected && <button onClick={removeSelected} style={{ ...ghost, color: '#dc2626' }}>Delete selected</button>}
          <button onClick={save} disabled={!dirty} style={{ ...ghost, background: dirty ? '#7c3aed' : '#eee', color: dirty ? '#fff' : '#999', border: 'none' }}>Save markup</button>
        </div>
      )}

      <div ref={wrapRef} onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}
        onTouchStart={down} onTouchMove={move} onTouchEnd={up}
        style={{ position: 'relative', width: '100%', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', touchAction: 'none', background: '#f4f4f4' }}>
        <img src={imageUrl} alt="drawing" style={{ display: 'block', width: '100%', pointerEvents: 'none' }} />
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">
              <polygon points="0 0, 10 4, 0 8" fill="context-stroke" />
            </marker>
          </defs>
          {all.map(sh => <Shape key={sh.id} sh={sh} selected={selected === sh.id}
            onClick={() => { if (canEdit && tool === 'select') setSelected(sh.id) }} />)}
        </svg>
      </div>
      {canEdit && <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 6 }}>Pick a tool, choose colour / thickness / opacity, then draw on the drawing. Use Select to click a shape and delete it. Remember to Save markup.</div>}
    </div>
  )
}

function Shape({ sh, selected, onClick }) {
  const S = 1000
  const stroke = sh.colour || '#dc2626'
  const common = { stroke, strokeWidth: (sh.width || 3), opacity: sh.opacity ?? 1, fill: 'none', style: { cursor: 'pointer' }, onClick }
  const sel = selected ? { filter: 'drop-shadow(0 0 2px #7c3aed)' } : {}
  if (sh.type === 'text') return (
    <text x={sh.x * S} y={sh.y * S} fill={stroke} opacity={sh.opacity ?? 1} fontSize={Math.max(12, (sh.width || 3) * 6)} onClick={onClick} style={{ cursor: 'pointer', ...sel }}>{sh.text}</text>
  )
  if (sh.type === 'free') return (
    <polyline points={(sh.pts || []).map(p => `${p.x * S},${p.y * S}`).join(' ')} {...common} strokeLinejoin="round" strokeLinecap="round" style={{ ...common.style, ...sel }} />
  )
  if (sh.type === 'rect') { const x = Math.min(sh.x1, sh.x2) * S, y = Math.min(sh.y1, sh.y2) * S, w = Math.abs(sh.x2 - sh.x1) * S, h = Math.abs(sh.y2 - sh.y1) * S; return <rect x={x} y={y} width={w} height={h} {...common} style={{ ...common.style, ...sel }} /> }
  if (sh.type === 'circle') { const cx = (sh.x1 + sh.x2) / 2 * S, cy = (sh.y1 + sh.y2) / 2 * S, rx = Math.abs(sh.x2 - sh.x1) / 2 * S, ry = Math.abs(sh.y2 - sh.y1) / 2 * S; return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...common} style={{ ...common.style, ...sel }} /> }
  // line + arrow
  const marker = sh.type === 'arrow' ? { markerEnd: 'url(#arrowhead)' } : {}
  return <line x1={sh.x1 * S} y1={sh.y1 * S} x2={sh.x2 * S} y2={sh.y2 * S} {...common} {...marker} strokeLinecap="round" style={{ ...common.style, ...sel }} />
}

function id() { return `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
const ghost = { background: '#fff', border: '1px solid #ddd', borderRadius: 6, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' }
