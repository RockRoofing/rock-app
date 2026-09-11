import { useState, useMemo, useRef, useEffect } from 'react'

// A SELECT YOU CAN TYPE INTO.
//
// A native <select> on a list of a couple of hundred projects is a scroll. Browsers do
// offer type-ahead on one, but only on the first characters of the option text - so
// typing a project NAME when the option starts with a job number finds nothing, which
// is the way round people actually remember jobs.
//
// Shared rather than written per page: the tracker filter, the tracker's add-variation
// modal and the builder all use it, and three copies of a dropdown is how they end up
// behaving differently from each other.
//
// Matches anywhere in the label, case-insensitively, and ranks a prefix match first so
// typing "J228" puts J228 at the top rather than a job that merely mentions it.
export default function SearchableSelect({
  options = [],            // [{ value, label }]
  value = '',
  onChange,
  placeholder = 'Select...',
  emptyLabel = 'No match',
  disabled = false,
  style = {},
  maxHeight = 280,
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const boxRef = useRef(null)

  const selected = options.find(o => String(o.value) === String(value)) || null

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return options
    const scored = []
    for (const o of options) {
      const label = String(o.label || '').toLowerCase()
      if (label.startsWith(s)) scored.push({ o, rank: 0 })
      else if (label.includes(s)) scored.push({ o, rank: 1 })
    }
    scored.sort((a, b) => a.rank - b.rank)
    return scored.map(x => x.o)
  }, [q, options])

  useEffect(() => { setHi(0) }, [q, open])

  // Close when the click lands anywhere else. onBlur alone is not enough here - the
  // list is inside the same box, so clicking an option blurs the input first.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setQ('') } }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = (o) => { onChange(o.value); setOpen(false); setQ('') }

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQ(''); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(i => Math.min(i + 1, matches.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(i - 1, 0)); return }
    if (e.key === 'Enter' && open) { e.preventDefault(); if (matches[hi]) pick(matches[hi]); return }
    if (e.key === 'Tab') setOpen(false)
  }

  const base = {
    width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: 13,
    fontFamily: 'inherit', border: '1px solid #e5e5e5', borderRadius: 6,
    background: disabled ? '#f5f5f5' : '#fff', color: '#1a1a2e',
  }

  return (
    <div ref={boxRef} style={{ position: 'relative', ...style }}>
      <input
        value={open ? q : (selected ? selected.label : '')}
        placeholder={selected ? selected.label : placeholder}
        disabled={disabled}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        // Opening clears the query so the whole list shows - you are choosing again,
        // not editing the name of what is already chosen.
        onFocus={() => { if (!disabled) { setOpen(true); setQ('') } }}
        onKeyDown={onKey}
        style={{ ...base, cursor: disabled ? 'default' : 'text' }} />
      {!disabled && (
        <span onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); setQ('') }}
          style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'auto', cursor: 'pointer', color: '#888', fontSize: 10 }}>
          &#9660;
        </span>
      )}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 80, background: '#fff',
          border: '1px solid #e5e5e5', borderRadius: 6, marginTop: 3,
          boxShadow: '0 6px 18px rgba(0,0,0,.14)', maxHeight, overflowY: 'auto', minWidth: 240,
        }}>
          {matches.length === 0 ? (
            <div style={{ padding: '8px 11px', fontSize: 12.5, color: '#888' }}>{emptyLabel}</div>
          ) : matches.map((o, i) => (
            <div key={String(o.value)}
              onMouseDown={(e) => { e.preventDefault(); pick(o) }}
              onMouseEnter={() => setHi(i)}
              style={{
                padding: '7px 11px', fontSize: 13, cursor: 'pointer',
                background: i === hi ? '#eef2ff' : '#fff',
                fontWeight: String(o.value) === String(value) ? 700 : 400,
                borderBottom: '1px solid #f4f5f7', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
