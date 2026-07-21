import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../components/OperationsShell'
import { GOLD, INK, fmtDateTime, th, td, Loading, EmptyCard, Modal, linkBtn } from '../../components/opsUI'
import SubmissionModal from '../../components/SubmissionModal'

const PAGE_SIZE = 50

export default function SubmissionsPage() {
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)
  const [labels, setLabels] = useState({})   // formId -> { fieldId: label }

  // filters
  const [fProject, setFProject] = useState('')
  const [fType, setFType] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [page, setPage] = useState(0)
  const [sel, setSel] = useState({})
  const [downloading, setDownloading] = useState(false)
  const [selNote, setSelNote] = useState('')
  const [chooseDownload, setChooseDownload] = useState(false)

  useEffect(() => { (async () => {
    try { const r = await fetch('/api/submissions'); const d = await r.json(); setSubs((d.submissions || []).filter(s => !s.isIssue)) } catch {}
    try {
      const rf = await fetch('/api/forms'); const df = await rf.json()
      const map = {}
      for (const f of (df.forms || [])) { const lm = {}; for (const fld of (f.fields || [])) if (fld.id) lm[fld.id] = fld.label || fld.id; map[f.id] = lm }
      setLabels(map)
    } catch {}
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
  const selIds = Object.keys(sel).filter(k => sel[k])

  // Fetch a PDF for a set of ids as a single (combined) document.
  async function fetchPdfBlob(ids) {
    const res = await fetch('/api/submissions-pdf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, labels }),
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'PDF failed') }
    return res.blob()
  }
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }
  const safeName = (s) => String(s || 'form-submission').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'form-submission'
  // yyyy-mm-dd for the submitted date.
  const dateStr = (ts) => { try { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` } catch { return '' } }
  // [Project Number] [Project Name] - [Form Name] [Date Submitted]
  // (projectName already holds "J190 — Russell Hill", i.e. number + name.)
  const fileNameFor = (meta) => {
    if (!meta) return 'form-submission'
    const proj = meta.projectName || ''
    const form = meta.formTitle || 'Form'
    const dt = dateStr(meta.submittedAt)
    return safeName(`${proj} - ${form} ${dt}`.trim())
  }

  function downloadSelected() {
    if (!selIds.length) { setSelNote('Select the forms you want to download first.'); return }
    setSelNote('')
    if (selIds.length === 1) { doDownload('combined'); return }
    setChooseDownload(true)   // 2+ selected: ask combined vs separate
  }

  async function doDownload(mode) {
    setChooseDownload(false)
    setDownloading(true)
    try {
      if (mode === 'combined') {
        const blob = await fetchPdfBlob(selIds)
        // Name the combined file after the EARLIEST-dated selected form, marked Combined.
        const metas = selIds.map(id => subs.find(s => s.id === id)).filter(Boolean)
        const earliest = metas.slice().sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0))[0]
        const name = selIds.length === 1
          ? `${fileNameFor(metas[0])}.pdf`
          : `${safeName(`${(earliest?.projectName) || ''} - ${(earliest?.formTitle) || 'Form'} ${dateStr(earliest?.submittedAt)} Combined`)}.pdf`
        saveBlob(blob, name)
      } else {
        // Separate: one PDF file per selected submission, named per spec.
        for (const id of selIds) {
          const meta = subs.find(s => s.id === id)
          const blob = await fetchPdfBlob([id])
          saveBlob(blob, `${fileNameFor(meta)}.pdf`)
          await new Promise(r => setTimeout(r, 300))   // stagger so browsers don't block
        }
      }
    } catch (e) { alert(e?.message || 'Could not prepare download') }
    setDownloading(false)
  }

  return (
    <OperationsShell active="forms:completed" section="forms" title="Forms" wide>
      <PageHeading title="Forms" sub="Every form submitted from the Site App" />

      {/* Filter bar */}
      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Filter label="Project">
          <select value={fProject} onChange={e => setFProject(e.target.value)} style={sel2}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Filter>
        <Filter label="Form type">
          <select value={fType} onChange={e => setFType(e.target.value)} style={sel2}>
            <option value="">All forms</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Filter>
        <Filter label="From">
          <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} style={sel2} />
        </Filter>
        <Filter label="To">
          <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} style={sel2} />
        </Filter>
        {hasFilters && (
          <button onClick={() => { setFProject(''); setFType(''); setFFrom(''); setFTo('') }}
            style={{ background: '#f2f2f0', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, color: '#555', cursor: 'pointer' }}>
            Reset
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={downloadSelected} disabled={downloading} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{downloading ? 'Preparing…' : selIds.length ? `Download ${selIds.length} PDF` : 'Download as PDF'}</button>
        <div style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>
          {filtered.length} {filtered.length === 1 ? 'submission' : 'submissions'}{hasFilters ? ' (filtered)' : ''}
        </div>
      </div>
      {selNote && <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{selNote}</div>}

      {loading ? <Loading /> : !filtered.length ? (
        <EmptyCard title={hasFilters ? 'No submissions match your filters' : 'No submissions yet'}
          body={hasFilters ? 'Try widening the date range or clearing filters.' : "When operatives submit forms on the Forms App, they'll appear here."} />
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#faf9f7' }}>
                <th style={{ ...th, width: 40 }}><input type="checkbox" checked={pageRows.length > 0 && pageRows.every(r => sel[r.id])} onChange={e => { setSelNote(''); const n = { ...sel }; pageRows.forEach(r => { if (e.target.checked) n[r.id] = true; else delete n[r.id] }); setSel(n) }} /></th>
                {['Form', 'Project', 'Operative', 'Submitted', 'Flags', ''].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {pageRows.map(s => (
                  <tr key={s.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td style={td}><input type="checkbox" checked={!!sel[s.id]} onChange={() => { setSelNote(''); setSel(p => ({ ...p, [s.id]: !p[s.id] })) }} /></td>
                    <td style={td}><strong style={{ color: INK }}>{s.formTitle}</strong></td>
                    <td style={td}>{s.projectName || '—'}</td>
                    <td style={td}>{s.operative || '—'}</td>
                    <td style={{ ...td, color: '#999', whiteSpace: 'nowrap' }}>{fmtDateTime(s.submittedAt)}</td>
                    <td style={td}>{s.flagCount > 0
                      ? <span style={{ background: '#fef3c7', color: '#92400e', fontWeight: 600, borderRadius: 20, padding: '2px 10px', fontSize: 12 }}>⚠ {s.flagCount}</span>
                      : <span style={{ color: '#bbb' }}>—</span>}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button onClick={() => openSub(s.id, setOpen)} style={linkBtn}>View / Edit</button>
                      <button onClick={() => deleteSub(s, setSubs)} style={{ ...linkBtn, color: '#dc2626', marginLeft: 12 }}>Delete</button>
                    </td>
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

      {open && <SubmissionModal sub={open} labels={labels} onClose={() => setOpen(null)} onSaved={(s) => setOpen(s)} onDownload={(s) => printSubmissions([s], labels)} />}
      {chooseDownload && (
        <Modal onClose={() => setChooseDownload(false)} title={`Download ${selIds.length} forms`}>
          <p style={{ fontSize: 14, color: '#555', margin: '0 0 18px' }}>
            How would you like these {selIds.length} forms downloaded?
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={() => doDownload('separate')}
              style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '11px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
              Separate files<div style={{ fontSize: 12, fontWeight: 400, opacity: 0.9, marginTop: 2 }}>One PDF per form, downloaded individually.</div>
            </button>
            <button onClick={() => doDownload('combined')}
              style={{ background: '#fff', color: INK, border: '1px solid #ddd', borderRadius: 8, padding: '11px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
              Combined file<div style={{ fontSize: 12, fontWeight: 400, color: '#777', marginTop: 2 }}>All forms in a single PDF.</div>
            </button>
          </div>
        </Modal>
      )}
    </OperationsShell>
  )
}

async function openSub(id, setOpen) {
  try { const r = await fetch(`/api/submissions?id=${id}`); const d = await r.json(); setOpen(d.submission) } catch {}
}

async function deleteSub(s, setSubs) {
  if (!window.confirm(`Delete this "${s.formTitle}" submission? This removes it from the Forms page and the project's Project Forms tab. This cannot be undone.`)) return
  try {
    const r = await fetch(`/api/submissions?id=${s.id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error('failed')
    setSubs(prev => prev.filter(x => x.id !== s.id))
  } catch { window.alert('Could not delete the submission.') }
}

function SubModal({ sub, labels, onClose }) {
  const lbl = (k) => (labels && labels[sub.formId] && labels[sub.formId][k]) || k
  return (
    <Modal onClose={onClose} title={sub.formTitle} wide>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        {sub.projectName} · {sub.operative} · {fmtDateTime(sub.submittedAt)}
      </div>
      <div style={{ marginBottom: 14 }}><button onClick={() => printSubmissions([sub], labels)} style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: INK }}>Download PDF</button></div>
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
            <div style={{ fontSize: 12, color: '#888', marginBottom: 3 }}>{lbl(k)}</div>
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

// Download one or more submissions as a real PDF file via the server endpoint.
async function printSubmissions(subs, labels) {
  const list = Array.isArray(subs) ? subs : [subs]
  const ids = list.map(s => s && s.id).filter(Boolean)
  if (!ids.length) { alert('Nothing to download'); return }
  try {
    const res = await fetch('/api/submissions-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, labels }),
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'PDF failed') }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // Single: [Project Number] [Project Name] - [Form Name] [Date Submitted].
    const clean = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 90)
    const dstr = (ts) => { try { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` } catch { return '' } }
    if (ids.length === 1) {
      const m = list[0]
      a.download = `${clean(`${m.projectName || ''} - ${m.formTitle || 'Form'} ${dstr(m.submittedAt)}`) || 'form-submission'}.pdf`
    } else {
      const earliest = list.slice().sort((x, y) => (x.submittedAt || 0) - (y.submittedAt || 0))[0]
      a.download = `${clean(`${earliest?.projectName || ''} - ${earliest?.formTitle || 'Form'} ${dstr(earliest?.submittedAt)} Combined`) || 'form-submissions'}.pdf`
    }
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  } catch (e) { alert(e?.message || 'Could not prepare download') }
}

// (legacy print-to-PDF removed — kept below for reference, now unused)
function _legacyPrintSubmissions(subs, labels) {
  const logo = `${window.location.origin}/rock-logo.jpg`
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const fmt = ts => new Date(ts).toLocaleString('en-GB')
  const lbl = (formId, k) => (labels && labels[formId] && labels[formId][k]) || k
  const answerHtml = (v) => {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '<em style="color:#999">—</em>'
    const isPhotos = Array.isArray(v) && typeof v[0] === 'string' && /^https?:|^data:/.test(v[0])
    if (isPhotos) return `<div class="imgs">${v.map(u => `<img src="${esc(u)}" />`).join('')}</div>`
    if (typeof v === 'object' && !Array.isArray(v)) return esc(v.name ? `${v.name} (${v.date || ''})` : JSON.stringify(v))
    if (Array.isArray(v)) return v.map(esc).join(', ')
    return esc(v)
  }
  const body = subs.map(sub => `
    <section class="doc">
      <header><img class="logo" src="${logo}" /><div class="meta">
        <h1>${esc(sub.formTitle)}</h1><div>${esc(sub.projectName || '')}</div>
        <div>Operative: ${esc(sub.operative || '—')}</div><div>Submitted: ${esc(fmt(sub.submittedAt))}</div>
      </div></header>
      ${Object.entries(sub.answers || {}).filter(([, v]) => !(v == null || v === '' || (Array.isArray(v) && !v.length)))
        .map(([k, v]) => `<div class="row"><div class="q">${esc(lbl(sub.formId, k))}</div><div class="a">${answerHtml(v)}</div></div>`).join('')}
    </section>`).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Rock Roofing — Submission</title><style>
    *{box-sizing:border-box}body{font-family:system-ui,Arial,sans-serif;color:#1a1a19;margin:0}
    .doc{padding:32px 36px;page-break-after:always}.doc:last-child{page-break-after:auto}
    header{display:flex;align-items:center;gap:20px;border-bottom:3px solid #ca8a04;padding-bottom:16px;margin-bottom:20px}
    .logo{height:60px}.meta h1{margin:0 0 4px;font-size:20px}.meta div{font-size:12.5px;color:#555}
    .row{display:flex;gap:16px;padding:9px 0;border-bottom:1px solid #eee}
    .q{width:34%;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#888}
    .a{flex:1;font-size:13.5px}.imgs{display:flex;flex-wrap:wrap;gap:6px}.imgs img{height:130px;border-radius:6px;border:1px solid #ddd}
    </style></head><body>${body}<script>window.onload=()=>{setTimeout(()=>window.print(),400)}</script></body></html>`
  const w = window.open('', '_blank'); if (!w) { alert('Please allow pop-ups to download the PDF.'); return }
  w.document.write(html); w.document.close()
}

const Filter = ({ label, children }) => (
  <div>
    <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{label}</div>
    {children}
  </div>
)
const sel2 = { padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', minWidth: 150 }
const pageBtn = (disabled) => ({ background: disabled ? '#f4f4f2' : '#fff', border: '1px solid #e0e0e0', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: disabled ? '#bbb' : '#333', cursor: disabled ? 'default' : 'pointer' })
