import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../components/OperationsShell'
import { GOLD, INK, fmtDateTime, th, td, Loading, EmptyCard, Modal, linkBtn } from '../../components/opsUI'

const PAGE_SIZE = 50

export default function SubmissionsPage() {
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)

  // filters
  const [fProject, setFProject] = useState('')
  const [fType, setFType] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => { (async () => {
    try { const r = await fetch('/api/submissions'); const d = await r.json(); setSubs(d.submissions || []) } catch {}
    setLoading(false)
  })() }, [])

  // Deep link from Project Images: /operations/submissions?open=<id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('open')
    if (!id) return
    ;(async () => {
      try { const r = await fetch(`/api/submissions?id=${id}`); const d = await r.json(); if (d.submission) setOpen(d.submission) } catch {}
    })()
  }, [])

  // filter option lists
  const projects = useMemo(() => [...new Set(subs.map(s => s.projectName).filter(Boolean))].sort(), [subs])
  const types = useMemo(() => [...new Set(subs.map(s => s.formTitle).filter(Boolean))].sort(), [subs])

  const filtered = useMemo(() => {
    return subs.filter(s => {
      if (fProject && s.projectName !== fProject) return false
      if (fType && s.formTitle !== fType) return false
      if (fFrom && s.submittedAt < new Date(fFrom).getTime()) return false
      if (fTo && s.submittedAt > new Date(fTo).getTime() + 86400000) return false // inclusive of end day
      return true
    })
  }, [subs, fProject, fType, fFrom, fTo])

  useEffect(() => { setPage(0) }, [fProject, fType, fFrom, fTo])

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const hasFilters = fProject || fType || fFrom || fTo

  return (
    <OperationsShell active="submissions" title="Forms Submissions" wide>
      <PageHeading title="Forms Submissions" sub="Every form submitted from the Forms App" />

      {/* Filter bar */}
      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Filter label="Project">
          <select value={fProject} onChange={e => setFProject(e.target.value)} style={sel}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Filter>
        <Filter label="Form type">
          <select value={fType} onChange={e => setFType(e.target.value)} style={sel}>
            <option value="">All forms</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Filter>
        <Filter label="From">
          <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} style={sel} />
        </Filter>
        <Filter label="To">
          <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} style={sel} />
        </Filter>
        {hasFilters && (
          <button onClick={() => { setFProject(''); setFType(''); setFFrom(''); setFTo('') }}
            style={{ background: '#f2f2f0', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, color: '#555', cursor: 'pointer' }}>
            Reset
          </button>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>
          {filtered.length} {filtered.length === 1 ? 'submission' : 'submissions'}{hasFilters ? ' (filtered)' : ''}
        </div>
      </div>

      {loading ? <Loading /> : !filtered.length ? (
        <EmptyCard title={hasFilters ? 'No submissions match your filters' : 'No submissions yet'}
          body={hasFilters ? 'Try widening the date range or clearing filters.' : "When operatives submit forms on the Forms App, they'll appear here."} />
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#faf9f7' }}>
                {['Form', 'Project', 'Operative', 'Submitted', 'Flags', ''].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {pageRows.map(s => (
                  <tr key={s.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td style={td}><strong style={{ color: INK }}>{s.formTitle}</strong></td>
                    <td style={td}>{s.projectName || '—'}</td>
                    <td style={td}>{s.operative || '—'}</td>
                    <td style={{ ...td, color: '#999', whiteSpace: 'nowrap' }}>{fmtDateTime(s.submittedAt)}</td>
                    <td style={td}>{s.flagCount > 0
                      ? <span style={{ background: '#fef3c7', color: '#92400e', fontWeight: 600, borderRadius: 20, padding: '2px 10px', fontSize: 12 }}>⚠ {s.flagCount}</span>
                      : <span style={{ color: '#bbb' }}>—</span>}</td>
                    <td style={td}><button onClick={() => openSub(s.id, setOpen)} style={linkBtn}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={pageBtn(page === 0)}>‹ Prev</button>
              <span style={{ fontSize: 13, color: '#666' }}>Page {page + 1} of {pageCount}</span>
              <button disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)} style={pageBtn(page >= pageCount - 1)}>Next ›</button>
            </div>
          )}
        </>
      )}

      {open && <SubModal sub={open} onClose={() => setOpen(null)} />}
    </OperationsShell>
  )
}

async function openSub(id, setOpen) {
  try { const r = await fetch(`/api/submissions?id=${id}`); const d = await r.json(); setOpen(d.submission) } catch {}
}

function SubModal({ sub, onClose }) {
  return (
    <Modal onClose={onClose} title={sub.formTitle} wide>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        {sub.projectName} · {sub.operative} · {fmtDateTime(sub.submittedAt)}
      </div>
      {sub.flags?.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <strong style={{ color: '#92400e' }}>⚠️ Flags:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#92400e', fontSize: 13 }}>
            {sub.flags.map((f, i) => <li key={i}>{f.field}</li>)}
          </ul>
        </div>
      )}
      {Object.entries(sub.answers || {}).map(([k, v]) => {
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null
        const isPhotos = Array.isArray(v) && typeof v[0] === 'string' && /^https?:|^data:/.test(v[0])
        return (
          <div key={k} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f2f2f2' }}>
            <div style={{ fontSize: 11, color: '#999', textTransform: 'uppercase', letterSpacing: 0.4 }}>{k}</div>
            {isPhotos
              ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {v.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} style={{ height: 90, borderRadius: 6 }} /></a>)}
                </div>
              : <div style={{ fontSize: 14, color: INK, marginTop: 2 }}>
                  {typeof v === 'object' ? (v.name ? `${v.name} (${v.date})` : JSON.stringify(v)) : Array.isArray(v) ? v.join(', ') : String(v)}
                </div>}
          </div>
        )
      })}
    </Modal>
  )
}

const Filter = ({ label, children }) => (
  <div>
    <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{label}</div>
    {children}
  </div>
)
const sel = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', minWidth: 150 }
const pageBtn = (disabled) => ({ background: disabled ? '#f4f4f2' : '#fff', border: '1px solid #e0e0e0', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: disabled ? '#bbb' : '#333', cursor: disabled ? 'default' : 'pointer' })
