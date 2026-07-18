import { useState, useEffect, useMemo } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { computeRateTotals } from '../lib/contractRatesParser'

const fmt = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtRate = (n) => n == null || n === '' ? '' : (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ContractedRatesPage() {
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(false)
  const [cr, setCr] = useState(null)          // { items, locked, fileName, sourceTotal }
  const [items, setItems] = useState([])
  const [locked, setLocked] = useState(false)
  const [fileName, setFileName] = useState('')
  const [sourceTotal, setSourceTotal] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [uploading, setUploading] = useState(false)
  const [editRow, setEditRow] = useState(null)  // item id being edited
  const [confirmEdit, setConfirmEdit] = useState(false)

  useEffect(() => { (async () => {
    try {
      const [d, m] = await Promise.all([
        fetch('/api/dashboard').then(r => r.json()).catch(() => ({})),
        fetch('/api/portal-auth?action=me').then(r => r.json()).catch(() => null),
      ])
      const ps = (d.projects || []).map(p => ({ xeroId: String(p.xeroId), jobNo: p.jobNo || '', name: p.name || '' }))
        .sort((a, b) => (a.jobNo || '').localeCompare(b.jobNo || '', undefined, { numeric: true }))
      setProjects(ps)
      if (m && m.user) setMe(m.user)
    } catch {}
  })() }, [])

  async function loadRates(pid) {
    if (!pid) { setCr(null); setItems([]); return }
    setLoading(true); setMsg('')
    try {
      const d = await fetch(`/api/contracted-rates?projectId=${encodeURIComponent(pid)}`).then(r => r.json())
      applyCr(d.contractedRates)
    } catch { setMsg('Could not load contracted rates.') }
    setLoading(false)
  }
  function applyCr(rates) {
    setCr(rates || null)
    setItems(rates?.items ? rates.items.map(x => ({ ...x })) : [])
    setLocked(!!rates?.locked)
    setFileName(rates?.fileName || '')
    setSourceTotal(rates?.sourceTotal ?? null)
    setDirty(false)
    setEditRow(null)
  }
  function pickProject(pid) { setProjectId(pid); loadRates(pid) }

  const totals = useMemo(() => computeRateTotals(items), [items])
  const editable = !locked

  // ── Upload + parse ──
  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true); setMsg('')
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result).split(',')[1])
        r.onerror = () => rej(new Error('read failed'))
        r.readAsDataURL(file)
      })
      const d = await fetch('/api/contracted-rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'parse-upload', fileData: b64, fileName: file.name }),
      }).then(r => r.json())
      if (!d.ok) { setMsg(d.error || 'Could not parse the file.'); setUploading(false); return }
      setItems(d.items.map(x => ({ ...x })))
      setFileName(d.fileName || file.name)
      setSourceTotal(d.totals?.aboveTotal ?? null)
      setLocked(false)
      setDirty(true)
      setMsg(`Parsed ${d.items.filter(x => x.kind === 'item').length} rate lines from "${d.sheetName}". Review, then Save.`)
    } catch (err) { setMsg('Upload failed: ' + err.message) }
    setUploading(false)
  }

  // ── Row ops (only when editable) ──
  const update = (id, patch) => { setItems(list => list.map(x => x.id === id ? { ...x, ...patch } : x)); setDirty(true) }
  const move = (id, toSection) => update(id, { section: toSection })
  const toggleStruck = (id) => setItems(list => (setDirty(true), list.map(x => x.id === id ? { ...x, struck: !x.struck } : x)))
  const remove = (id) => { if (!confirm('Delete this line? (Use strike-through instead if you want to keep it on the document.)')) return; setItems(list => list.filter(x => x.id !== id)); setDirty(true) }
  const moveUpDown = (id, dir) => {
    setItems(list => {
      const i = list.findIndex(x => x.id === id); if (i === -1) return list
      const j = i + dir; if (j < 0 || j >= list.length) return list
      // only swap within the same section
      if (list[i].section !== list[j].section) return list
      const copy = [...list];[copy[i], copy[j]] = [copy[j], copy[i]]; return copy
    })
    setDirty(true)
  }
  function addLine(section) {
    setItems(list => [...list, { id: `cr_new_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, code: '', qty: null, unit: '', description: '', rate: null, total: null, matRate: null, labRate: null, rateOnly: section === 'below', section, kind: 'item', struck: false }])
    setDirty(true)
  }

  async function save() {
    if (!projectId) return
    setSaving(true); setMsg('')
    try {
      const d = await fetch('/api/contracted-rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', projectId, items, locked, fileName, sourceTotal, author: me?.name || '' }),
      }).then(r => r.json())
      if (!d.ok) { setMsg(d.error || 'Save failed.'); setSaving(false); return }
      applyCr(d.contractedRates)
      setMsg('Saved.')
    } catch { setMsg('Save failed.') }
    setSaving(false)
  }
  async function doLock(next) {
    // Save current edits and set lock together.
    setSaving(true); setMsg('')
    try {
      const d = await fetch('/api/contracted-rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', projectId, items, locked: next, fileName, sourceTotal, author: me?.name || '' }),
      }).then(r => r.json())
      if (!d.ok) { setMsg(d.error || 'Failed.'); setSaving(false); return }
      applyCr(d.contractedRates)
      setMsg(next ? 'Contracted rates locked.' : 'Unlocked for editing.')
    } catch { setMsg('Failed.') }
    setSaving(false)
    setConfirmEdit(false)
  }
  async function deleteAll() {
    if (!confirm('Delete the contracted rates for this project? You can upload a fresh file afterwards.')) return
    setSaving(true); setMsg('')
    try {
      await fetch('/api/contracted-rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', projectId }) })
      applyCr(null)
      setMsg('Deleted.')
    } catch { setMsg('Delete failed.') }
    setSaving(false)
  }

  const hasRates = items.length > 0
  const selProject = projects.find(p => p.xeroId === projectId)

  // Styles
  const th = { padding: '9px 8px', textAlign: 'left', fontWeight: 700, color: '#6b7280', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }
  const thR = { ...th, textAlign: 'right' }
  const thBudget = { ...thR, background: '#eef6ff', color: '#1e40af' }
  const td = { padding: '7px 8px', fontSize: 12.5, verticalAlign: 'middle' }
  const tdR = { ...td, textAlign: 'right' }
  const tdBudget = { ...tdR, background: '#f5faff', color: '#1e40af' }
  const cellInput = { width: '100%', padding: '4px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 12.5, boxSizing: 'border-box', fontFamily: 'inherit' }

  function renderSection(section, label) {
    const sectionItems = items.filter(x => x.section === section)
    return (
      <>
        <tr>
          <td colSpan={10} style={{ padding: '10px 8px 6px', fontSize: 12, fontWeight: 700, color: section === 'above' ? '#0f766e' : '#b45309', background: section === 'above' ? '#f0fdfa' : '#fffbeb', borderTop: '2px solid ' + (section === 'above' ? '#99f6e4' : '#fde68a') }}>
            {label} {section === 'below' && <span style={{ fontWeight: 400, color: '#a16207' }}>— optional / variation items (rate only)</span>}
          </td>
        </tr>
        {sectionItems.length === 0 && (
          <tr><td colSpan={10} style={{ padding: '10px 8px', fontSize: 12, color: '#aaa' }}>No {section === 'above' ? 'above' : 'below'}-the-line items.</td></tr>
        )}
        {sectionItems.map((x) => {
          const isEditing = editable && editRow === x.id
          const lineTotal = x.total != null ? x.total : ((x.qty || 0) * (x.rate || 0))
          const strike = x.struck ? { textDecoration: 'line-through', color: '#b91c1c', opacity: 0.7 } : {}
          if (x.kind === 'heading' && !isEditing) {
            return (
              <tr key={x.id} style={{ background: '#fafafa' }}>
                <td style={td}></td>
                <td style={{ ...td, fontWeight: 700, color: '#374151', ...strike }} colSpan={6}>{x.description || '—'}</td>
                <td colSpan={2}></td>
                <td style={tdR}>{editable && <RowMenu x={x} section={section} onEdit={() => setEditRow(x.id)} onMove={move} onStrike={toggleStruck} onDelete={remove} onUp={() => moveUpDown(x.id, -1)} onDown={() => moveUpDown(x.id, 1)} />}</td>
              </tr>
            )
          }
          return (
            <tr key={x.id} style={{ borderBottom: '1px solid #f0f0f0', background: x.struck ? '#fef2f2' : '#fff' }}>
              <td style={{ ...td, color: '#6b7280', fontWeight: 600 }}>
                {isEditing ? <input value={x.code || ''} onChange={e => update(x.id, { code: e.target.value })} style={{ ...cellInput, width: 46 }} /> : (x.code || '')}
              </td>
              <td style={{ ...td, minWidth: 220, maxWidth: 340, whiteSpace: 'normal', ...strike }}>
                {isEditing ? <input value={x.description || ''} onChange={e => update(x.id, { description: e.target.value })} style={cellInput} /> : (x.description || '—')}
              </td>
              <td style={tdR}>
                {isEditing ? <input type="number" value={x.qty ?? ''} onChange={e => update(x.id, { qty: e.target.value === '' ? null : parseFloat(e.target.value) })} style={{ ...cellInput, width: 64, textAlign: 'right' }} /> : (x.qty ?? '')}
              </td>
              <td style={{ ...td }}>
                {isEditing ? <input value={x.unit || ''} onChange={e => update(x.id, { unit: e.target.value })} style={{ ...cellInput, width: 48 }} /> : (x.unit || '')}
              </td>
              <td style={tdR}>
                {isEditing ? <input type="number" value={x.rate ?? ''} onChange={e => update(x.id, { rate: e.target.value === '' ? null : parseFloat(e.target.value) })} style={{ ...cellInput, width: 78, textAlign: 'right' }} /> : (x.rate != null ? fmtRate(x.rate) : '')}
              </td>
              <td style={{ ...tdR, fontWeight: 600 }}>{x.rateOnly ? <span style={{ color: '#a16207', fontStyle: 'italic', fontWeight: 400 }}>Rate only</span> : (lineTotal ? fmt(lineTotal) : '')}</td>
              <td style={tdBudget} title="Materials rate within the rate (budget)">
                {isEditing ? <input type="number" value={x.matRate ?? ''} onChange={e => update(x.id, { matRate: e.target.value === '' ? null : parseFloat(e.target.value) })} style={{ ...cellInput, width: 70, textAlign: 'right' }} /> : (x.matRate != null ? fmtRate(x.matRate) : '')}
              </td>
              <td style={tdBudget} title="Labour rate within the rate (budget)">
                {isEditing ? <input type="number" value={x.labRate ?? ''} onChange={e => update(x.id, { labRate: e.target.value === '' ? null : parseFloat(e.target.value) })} style={{ ...cellInput, width: 70, textAlign: 'right' }} /> : (x.labRate != null ? fmtRate(x.labRate) : '')}
              </td>
              <td style={tdR}>
                {isEditing
                  ? <button onClick={() => setEditRow(null)} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Done</button>
                  : (editable && <RowMenu x={x} section={section} onEdit={() => setEditRow(x.id)} onMove={move} onStrike={toggleStruck} onDelete={remove} onUp={() => moveUpDown(x.id, -1)} onDown={() => moveUpDown(x.id, 1)} />)}
              </td>
            </tr>
          )
        })}
        {editable && (
          <tr><td colSpan={10} style={{ padding: '6px 8px' }}>
            <button onClick={() => addLine(section)} style={{ background: '#f0f2f5', border: '1px dashed #cbd5e1', borderRadius: 6, padding: '5px 12px', fontSize: 11.5, cursor: 'pointer', color: '#475569' }}>+ Add {section === 'above' ? 'above-the-line' : 'below-the-line'} item</button>
          </td></tr>
        )}
      </>
    )
  }

  return (
    <>
      <Head><title>Rock Roofing — Contracted Rates · v1</title></Head>
      <div style={{ minHeight: '100vh', background: '#f5f6f8' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 56 }}>
            <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
            <a href="/commercial" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>← Commercial</a>
            <span style={{ color: '#444' }}>|</span>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Contracted Rates</span>
            <span style={{ color: '#444' }}>|</span>
            <Link href="/applications" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>Applications</Link>
            <span style={{ color: '#444' }}>|</span>
            <Link href="/variations" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>Variations</Link>
          </div>
        </div>

        <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
          {/* Project picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Project</label>
            <select value={projectId} onChange={e => pickProject(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #d5d9e0', borderRadius: 8, fontSize: 13, minWidth: 340, background: '#fff' }}>
              <option value="">— Select a project —</option>
              {projects.map(p => <option key={p.xeroId} value={p.xeroId}>{[p.jobNo, p.name].filter(Boolean).join(' — ')}</option>)}
            </select>
            {selProject && <Link href={`/project/${projectId}`} style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>Open project →</Link>}
          </div>

          {!projectId ? (
            <div style={{ background: '#fff', borderRadius: 12, padding: 48, textAlign: 'center', color: '#888', fontSize: 14 }}>Select a project to view or upload its contracted rates.</div>
          ) : loading ? (
            <div style={{ background: '#fff', borderRadius: 12, padding: 48, textAlign: 'center', color: '#888' }}>Loading…</div>
          ) : (
            <>
              {/* Toolbar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                {!hasRates ? (
                  <label style={{ background: '#0f766e', color: '#fff', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
                    {uploading ? 'Parsing…' : '⬆ Upload costings / contract rates (.xlsm / .xlsx)'}
                    <input type="file" accept=".xlsm,.xlsx" onChange={onFile} disabled={uploading} style={{ display: 'none' }} />
                  </label>
                ) : (
                  <>
                    {locked ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600 }}>🔒 Locked</span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600 }}>✎ Editable (not locked)</span>
                    )}
                    {editable && <button onClick={save} disabled={saving || !dirty} style={{ background: dirty ? '#0f766e' : '#e5e7eb', color: dirty ? '#fff' : '#9ca3af', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: dirty ? 'pointer' : 'default' }}>{saving ? 'Saving…' : 'Save'}</button>}
                    {editable && <button onClick={() => doLock(true)} disabled={saving} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>🔒 Lock contracted rates</button>}
                    {locked && <span onDoubleClick={() => setConfirmEdit(true)} title="Double-click to edit" style={{ fontSize: 12, color: '#6b7280', cursor: 'pointer', userSelect: 'none' }}>Double-click here to edit contracted rates</span>}
                    <div style={{ flex: 1 }} />
                    <button onClick={deleteAll} disabled={saving} style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 14px', fontSize: 12.5, cursor: 'pointer' }}>Delete &amp; re-upload</button>
                  </>
                )}
              </div>

              {msg && <div style={{ fontSize: 12.5, color: msg.includes('fail') || msg.includes('Could not') ? '#dc2626' : '#0f766e', marginBottom: 12 }}>{msg}</div>}

              {hasRates && (
                <>
                  {/* Summary cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                    <Card label="Above the line (contract works)" value={fmt(totals.aboveTotal)} sub={`${totals.aboveCount} items`} />
                    <Card label="Below the line (available)" value={fmt(totals.belowTotal)} sub={`${totals.belowCount} items`} muted />
                    <Card label="Materials budget (above)" value={fmt(totals.aboveMaterials)} budget />
                    <Card label="Labour budget (above)" value={fmt(totals.aboveLabour)} budget />
                  </div>
                  {sourceTotal != null && Math.abs((sourceTotal || 0) - totals.aboveTotal) > 0.5 && (
                    <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
                      Note: above-the-line total ({fmt(totals.aboveTotal)}) differs from the uploaded file's total ({fmt(sourceTotal)}). That's expected while you move items across the line to match the contract value.
                    </div>
                  )}

                  {/* Grid */}
                  <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
                            <th style={th}>Code</th>
                            <th style={th}>Description</th>
                            <th style={thR}>Qty</th>
                            <th style={th}>Unit</th>
                            <th style={thR}>Rate</th>
                            <th style={thR}>Total</th>
                            <th style={thBudget}>Mat rate</th>
                            <th style={thBudget}>Lab rate</th>
                            <th style={thR}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {renderSection('above', 'ABOVE THE LINE')}
                          {renderSection('below', 'BELOW THE LINE ITEMS')}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Blue columns are budget figures (materials &amp; labour within the rate) — for margin tracking, not the customer application.</div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Double-click edit confirm */}
      {confirmEdit && (
        <div onClick={() => setConfirmEdit(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 24, width: 420, maxWidth: '100%' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e', marginBottom: 8 }}>Edit contracted rates?</div>
            <div style={{ fontSize: 13.5, color: '#555', marginBottom: 20 }}>These rates are locked. Are you sure you want to edit this document? Unlocking lets you move items across the line, edit, strike through or delete lines.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setConfirmEdit(false)} style={{ background: '#fff', color: '#666', border: '1px solid #e5e5e5', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => doLock(false)} disabled={saving} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Yes, edit</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Card({ label, value, sub, budget, muted }) {
  return (
    <div style={{ background: budget ? '#f5faff' : '#fff', borderRadius: 10, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: budget ? '1px solid #dbeafe' : '1px solid transparent' }}>
      <div style={{ fontSize: 11, color: budget ? '#1e40af' : '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: budget ? '#1e40af' : (muted ? '#b45309' : '#1a1a2e') }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// Per-row action menu: move across line, up/down, strike, edit, delete.
function RowMenu({ x, section, onEdit, onMove, onStrike, onDelete, onUp, onDown }) {
  const [open, setOpen] = useState(false)
  const btn = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '4px 8px', textAlign: 'left', width: '100%', color: '#374151' }
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(o => !o)} style={{ background: '#f0f2f5', border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 8px', fontSize: 13, cursor: 'pointer', color: '#475569' }}>⋯</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
          <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.15)', zIndex: 11, minWidth: 190, overflow: 'hidden' }}>
            <button style={btn} onClick={() => { onEdit(); setOpen(false) }}>✎ Edit</button>
            <button style={btn} onClick={() => { onMove(x.id, section === 'above' ? 'below' : 'above'); setOpen(false) }}>{section === 'above' ? '↓ Move below the line' : '↑ Move above the line'}</button>
            <button style={btn} onClick={() => { onUp(); setOpen(false) }}>↑ Move up</button>
            <button style={btn} onClick={() => { onDown(); setOpen(false) }}>↓ Move down</button>
            <button style={btn} onClick={() => { onStrike(x.id); setOpen(false) }}>{x.struck ? '⟲ Remove strike-through' : '⌐ Strike through'}</button>
            <button style={{ ...btn, color: '#dc2626', borderTop: '1px solid #f0f0f0' }} onClick={() => { onDelete(x.id); setOpen(false) }}>🗑 Delete</button>
          </div>
        </>
      )}
    </div>
  )
}
