// Small shared UI primitives used across Operations pages.
export const GOLD = '#ca8a04'
export const INK = '#1a1a19'

export const fmtDateTime = ts => ts
  ? new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—'
export const fmtDate = ts => ts
  ? new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—'

export const th = { padding: '10px 14px', fontWeight: 600, fontSize: 12, textAlign: 'left', color: '#888', whiteSpace: 'nowrap' }
export const td = { padding: '11px 14px', fontSize: 13 }
export const inp2 = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14 }
export const primaryBtn = { background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }
export const ghostBtn = { background: '#f2f2f0', color: '#555', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, cursor: 'pointer' }
export const linkBtn = { background: 'none', border: 'none', color: '#2a78d6', cursor: 'pointer', fontSize: 13, padding: '0 8px' }

export const Loading = () => <div style={{ padding: 40, textAlign: 'center', color: '#aaa' }}>Loading…</div>

export const EmptyCard = ({ title, body }) => (
  <div style={{ background: '#fff', border: '1px dashed #ddd', borderRadius: 14, padding: 40, textAlign: 'center' }}>
    <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>{title}</div>
    {body && <div style={{ color: '#999', fontSize: 14, marginTop: 6 }}>{body}</div>}
  </div>
)

export const Lbl = ({ children }) => <div style={{ fontSize: 12, color: '#888', margin: '12px 0 4px' }}>{children}</div>

export function Modal({ title, children, onClose, wide }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: wide ? 900 : 560, width: '100%', maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, color: INK }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
