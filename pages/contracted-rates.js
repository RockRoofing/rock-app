import { useState, useEffect, useMemo } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { upload } from '@vercel/blob/client'
import CommercialNav from '../components/CommercialNav'
import { computeRateTotals, sumItems, lineRateTotal, lineMatTotal, lineLabTotal } from '../lib/contractRatesParser'

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
  const [discountPct, setDiscountPct] = useState(0)      // MCD / main-contractor discount %
  const [showNet, setShowNet] = useState(false)          // view toggle: show rates net of discount
  const [fileName, setFileName] = useState('')
  const [sourceTotal, setSourceTotal] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [uploading, setUploading] = useState(false)
  const [editRow, setEditRow] = useState(null)  // item id being edited
  const [confirmEdit, setConfirmEdit] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [variations, setVariations] = useState([])

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
      // Deep-link: ?projectId=… pre-selects a project (e.g. "Set up" from the
      // Applications upcoming table) so the costing doc can be uploaded straight away.
      try {
        const qp = new URLSearchParams(window.location.search).get('projectId')
        if (qp && ps.some(p => p.xeroId === String(qp))) { setProjectId(String(qp)); loadRates(String(qp)) }
      } catch {}
    } catch {}
  })() }, [])

  async function loadRates(pid) {
    if (!pid) { setCr(null); setItems([]); return }
    setLoading(true); setMsg('')
    try {
      const d = await fetch(`/api/contracted-rates?projectId=${encodeURIComponent(pid)}`).then(r => r.json())
      applyCr(d.contractedRates)
      setVariations(d.variations || [])
    } catch { setMsg('Could not load contracted rates.') }
    setLoading(false)
  }
  function applyCr(rates) {
    setCr(rates || null)
    setItems(rates?.items ? rates.items.map(x => ({ ...x })) : [])
    setLocked(!!rates?.locked)
    setFileName(rates?.fileName || '')
    setSourceTotal(rates?.sourceTotal ?? null)
    setDiscountPct(rates?.discountPct != null ? rates.discountPct : 0)
    setDirty(false)
    setEditRow(null)
    setSelected(new Set())
  }
  function pickProject(pid) { setProjectId(pid); loadRates(pid) }

  const totals = useMemo(() => computeRateTotals(items), [items])
  const editable = !locked

  // When the "net of discount" view is on, displayed rates/totals are reduced by
  // the discount %. Stored values remain gross; this is view-only.
  const discFactor = showNet ? (1 - (parseFloat(discountPct) || 0) / 100) : 1
  const dRate = (v) => v == null ? v : v * discFactor
  const dMoney = (v) => (v || 0) * discFactor

  // Selection: totals for ticked items, split by section.
  const toggleSel = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const aboveItemsAll = items.filter(x => x.section === 'above' && x.kind === 'item' && !x.struck)
  const belowItemsAll = items.filter(x => x.section === 'below' && x.kind === 'item' && !x.struck)
  // Select-all across BOTH sections (item rows only; headings/struck aren't tickable).
  const allSelectable = [...aboveItemsAll, ...belowItemsAll]
  const allSelected = allSelectable.length > 0 && allSelectable.every(x => selected.has(x.id))
  const someSelected = selected.size > 0 && !allSelected
  const toggleSelectAll = () => setSelected(() => allSelected ? new Set() : new Set(allSelectable.map(x => x.id)))
  const aboveSelIds = aboveItemsAll.filter(x => selected.has(x.id))
  const belowSelIds = belowItemsAll.filter(x => selected.has(x.id))
  const aboveSel = sumItems(aboveSelIds)
  const belowSel = sumItems(belowSelIds)
  const hasAboveSel = aboveSelIds.length > 0
  const hasBelowSel = belowSelIds.length > 0
  const anySel = selected.size > 0
  const overallSel = sumItems([...aboveSelIds, ...belowSelIds])
  // True when EVERY selected line has the given format (drives the on/off button look).
  const selArr = items.filter(x => selected.has(x.id))
  const allSelHave = (key) => selArr.length > 0 && selArr.every(x => !!x[key])
  const clearSel = () => setSelected(new Set())

  // ── Upload + parse ──
  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true); setMsg('')
    try {
      // Direct browser -> Blob upload (avoids the ~4.5MB serverless body limit),
      // then the server fetches the blob and parses it.
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/blob-upload',
        contentType: file.type || undefined,
      })
      const d = await fetch('/api/contracted-rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'parse-upload', fileUrl: blob.url, fileName: file.name }),
      }).then(r => r.json())
      if (!d.ok) { setMsg(d.error || 'Could not parse the file.'); setUploading(false); return }
      setItems(d.items.map(x => ({ ...x })))
      setFileName(d.fileName || file.name)
      setSourceTotal(d.totals?.aboveTotal ?? null)
      setLocked(false)
      setDirty(true)
      setMsg(`Parsed ${d.items.filter(x => x.kind === 'item').length} rate lines from "${d.sheetName}". Review, then Save.`)
    } catch (err) { setMsg('Upload failed: ' + (err?.message || err)) }
    setUploading(false)
  }

  // ── Row ops (only when editable) ──
  const update = (id, patch) => { setItems(list => list.map(x => x.id === id ? { ...x, ...patch } : x)); setDirty(true) }
  const move = (id, toSection) => {
    // Move across the line and place at the END of the target section so it
    // lands somewhere sensible and is then freely re-orderable.
    setItems(list => {
      const it = list.find(x => x.id === id); if (!it) return list
      const rest = list.filter(x => x.id !== id)
      const moved = { ...it, section: toSection }
      // insert after the last item of the target section
      let lastIdx = -1
      rest.forEach((x, i) => { if (x.section === toSection) lastIdx = i })
      const copy = [...rest]
      copy.splice(lastIdx + 1, 0, moved)
      return copy
    })
    setDirty(true)
  }
  const toggleStruck = (id) => setItems(list => (setDirty(true), list.map(x => x.id === id ? { ...x, struck: !x.struck } : x)))
  const toggleHeadingStyle = (id) => setItems(list => (setDirty(true), list.map(x => x.id === id ? { ...x, plainHeading: !x.plainHeading } : x)))
  const toggleStyle = (id, key) => setItems(list => (setDirty(true), list.map(x => x.id === id ? { ...x, [key]: !x[key] } : x)))
  // Bulk-format all currently selected lines (above and below). If every selected
  // line already has the format, turn it off for all; otherwise turn it on for all.
  const bulkStyle = (key) => {
    if (!selected.size) return
    setItems(list => {
      const sel = list.filter(x => selected.has(x.id))
      const allOn = sel.length > 0 && sel.every(x => !!x[key])
      return list.map(x => selected.has(x.id) ? { ...x, [key]: !allOn } : x)
    })
    setDirty(true)
  }
  const remove = (id) => { if (!confirm('Delete this line? (Use strike-through instead if you want to keep it on the document.)')) return; setItems(list => list.filter(x => x.id !== id)); setDirty(true) }

  // Move all selected items currently in `fromSection` to the other side,
  // appended (in their current order) after the last item of the target section.
  const bulkMove = (fromSection) => {
    const toSection = fromSection === 'above' ? 'below' : 'above'
    setItems(list => {
      const movingIds = list.filter(x => selected.has(x.id) && x.section === fromSection).map(x => x.id)
      if (!movingIds.length) return list
      const movingSet = new Set(movingIds)
      const moved = list.filter(x => movingSet.has(x.id)).map(x => ({ ...x, section: toSection }))
      const rest = list.filter(x => !movingSet.has(x.id))
      let lastIdx = -1
      rest.forEach((x, i) => { if (x.section === toSection) lastIdx = i })
      const copy = [...rest]
      copy.splice(lastIdx + 1, 0, ...moved)
      return copy
    })
    setDirty(true)
  }

  // Reorder within a section by moving item `id` up/down among its section peers.
  const moveUpDown = (id, dir) => {
    setItems(list => {
      const it = list.find(x => x.id === id); if (!it) return list
      const section = it.section
      const order = list.filter(x => x.section === section)
      const pos = order.findIndex(x => x.id === id)
      const np = pos + dir
      if (np < 0 || np >= order.length) return list
      const reordered = [...order];[reordered[pos], reordered[np]] = [reordered[np], reordered[pos]]
      return rebuildWithSectionOrder(list, section, reordered)
    })
    setDirty(true)
  }

  // Drag-and-drop reorder within a section.
  const [dragId, setDragId] = useState(null)
  const onDrop = (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); return }
    setItems(list => {
      const src = list.find(x => x.id === dragId)
      const tgt = list.find(x => x.id === targetId)
      if (!src || !tgt || src.section !== tgt.section) return list
      const section = src.section
      const order = list.filter(x => x.section === section).filter(x => x.id !== dragId)
      const tpos = order.findIndex(x => x.id === targetId)
      order.splice(tpos, 0, src)
      return rebuildWithSectionOrder(list, section, order)
    })
    setDragId(null); setDirty(true)
  }
  // Rebuild the full list, replacing the given section's items with `orderedSubset`
  // (in order) while keeping the other section's items in their original slots.
  function rebuildWithSectionOrder(list, section, orderedSubset) {
    const out = []
    let k = 0
    for (const x of list) {
      if (x.section === section) { out.push(orderedSubset[k++]) }
      else out.push(x)
    }
    // if the section grew/shrank (shouldn't here), append any leftovers
    while (k < orderedSubset.length) out.push(orderedSubset[k++])
    return out
  }

  function addLine(section) {
    // Insert at the END of its own section (not the very end of the array), so a
    // new above-the-line line sits under the last above-the-line item and can be
    // dragged/moved up straight away.
    setItems(list => {
      const newItem = { id: `cr_new_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, code: '', qty: null, unit: '', description: '', rate: null, total: null, totalMode: 'calc', totalText: '', matRate: null, labRate: null, rateOnly: section === 'below', section, kind: 'item', struck: false }
      let lastIdx = -1
      list.forEach((x, i) => { if (x.section === section) lastIdx = i })
      const copy = [...list]
      copy.splice(lastIdx + 1, 0, newItem)
      return copy
    })
    setDirty(true)
  }

  // Turn a below-the-line item into a variation on the project (variation tracker).
  const [varBusy, setVarBusy] = useState(null)
  const [varModal, setVarModal] = useState(null)  // { items:[...], varNumber, description }

  // Open the variation modal for a single item or a group of items.
  // Next variation number for this project: V01, V02, … based on existing ones.
  function nextVarNumber() {
    let max = 0
    for (const v of (variations || [])) {
      const m = String(v.varNumber || '').match(/(\d+)/)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    return `V${String(max + 1).padStart(2, '0')}`
  }

  // Build a description. Full = each line verbatim (used by the Application so it
  // mirrors the CRs). If that's very long, the tracker gets a shorter summary
  // that names the schedule item codes + a trimmed lead description.
  function buildDescriptions(list) {
    const full = list.map(x => `${x.code ? x.code + ' — ' : ''}${x.description || ''}`.trim()).join('\n')
    if (list.length === 1) return { description: list[0].description || '', full: list[0].description || '' }
    const SUMMARY_LIMIT = 140
    if (full.length <= SUMMARY_LIMIT) return { description: full, full }
    const codes = list.map(x => x.code).filter(Boolean)
    const lead = (list[0].description || '').slice(0, 60).trim()
    const codePart = codes.length ? `Items ${codes.join(', ')}` : `${list.length} rate items`
    const summary = `${codePart}: ${lead}${lead ? '…' : ''} (+${list.length - 1} more)`
    return { description: summary, full }
  }

  function openVariation(itemsArr) {
    const list = itemsArr.filter(x => x && x.kind === 'item')
    if (!list.length) return
    const { description, full } = buildDescriptions(list)
    setVarModal({ items: list, varNumber: nextVarNumber(), description, descriptionFull: full, autoSummarised: description !== full })
  }

  async function submitVariation() {
    if (!projectId || !varModal) return
    const { items: list, varNumber, description, descriptionFull } = varModal
    const matTotal = list.reduce((s, x) => s + lineMatTotal(x), 0)
    const labTotal = list.reduce((s, x) => s + lineLabTotal(x), 0)
    const rateTotal = list.reduce((s, x) => s + lineRateTotal(x), 0)
    const profit = Math.max(0, rateTotal - matTotal - labTotal)
    setVarBusy('modal')
    try {
      const d = await fetch('/api/contracted-rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'to-variation', projectId,
          variation: {
            varNumber: varNumber || '',
            description: description || '',
            // Verbatim, line-per-item description for the Application (mirrors the CRs).
            descriptionFull: descriptionFull || description || '',
            // The schedule lines this variation was built from, so the Application
            // can reproduce them exactly.
            sourceItems: list.map(x => ({ code: x.code || '', description: x.description || '', qty: x.qty ?? null, unit: x.unit || '', rate: x.rate ?? null })),
            instructed: false,
            materials: String(Math.round(matTotal * 100) / 100),
            labour: String(Math.round(labTotal * 100) / 100),
            profit: String(Math.round(profit * 100) / 100),
          },
        }),
      }).then(r => r.json())
      if (!d.ok) { setMsg(d.error || 'Could not create the variation.'); setVarBusy(null); return }
      if (d.variations) setVariations(d.variations)
      setMsg(`Added ${varNumber} to variations (not instructed).`)
      setVarModal(null)
      setSelected(new Set())
    } catch (e) { setMsg('Could not create the variation.') }
    setVarBusy(null)
  }

  async function save() {
    if (!projectId) return
    setSaving(true); setMsg('')
    try {
      const d = await fetch('/api/contracted-rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', projectId, items, locked, fileName, sourceTotal, discountPct, author: me?.name || '' }),
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
        body: JSON.stringify({ action: 'save', projectId, items, locked: next, fileName, sourceTotal, discountPct, author: me?.name || '' }),
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

  // Styles. Vertical separators via right borders. Materials = light blue,
  // Labour = darker blue.
  const SEP = '1px solid #e8eaed'
  const MAT_HEAD = '#e0f2fe', MAT_HEAD_INK = '#0369a1', MAT_CELL = '#f0f9ff', MAT_INK = '#0369a1'
  const LAB_HEAD = '#bfdbfe', LAB_HEAD_INK = '#1e3a8a', LAB_CELL = '#dbeafe', LAB_INK = '#1e3a8a'
  const th = { padding: '9px 8px', textAlign: 'left', fontWeight: 700, color: '#6b7280', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap', borderRight: SEP }
  const thR = { ...th, textAlign: 'right' }
  const thC = { ...th, textAlign: 'center', width: 34, padding: '9px 4px' }
  const thMat = { ...thR, background: MAT_HEAD, color: MAT_HEAD_INK }
  const thLab = { ...thR, background: LAB_HEAD, color: LAB_HEAD_INK }
  const td = { padding: '7px 8px', fontSize: 12.5, verticalAlign: 'middle', borderRight: SEP }
  const tdR = { ...td, textAlign: 'right' }
  const tdC = { ...td, textAlign: 'center', padding: '7px 4px' }
  const tdMat = { ...tdR, background: MAT_CELL, color: MAT_INK }
  const tdLab = { ...tdR, background: LAB_CELL, color: LAB_INK }
  const cellInput = { width: '100%', padding: '4px 6px', border: '1px solid #d5d9e0', borderRadius: 5, fontSize: 12.5, boxSizing: 'border-box', fontFamily: 'inherit' }
  const COLSPAN = 12
  // keep old names used elsewhere pointing at materials styling
  const thBudget = thMat, tdBudget = tdMat

  function totalCell(x, isEditing) {
    // Text-mode lines (TBC / Rate only / custom) show the text; calc lines show qty*rate.
    if (isEditing) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
          <select value={x.totalMode || 'calc'} onChange={e => update(x.id, { totalMode: e.target.value })} style={{ ...cellInput, width: 92, fontSize: 11 }}>
            <option value="calc">Calculate</option>
            <option value="text">Text (TBC…)</option>
          </select>
          {x.totalMode === 'text'
            ? <input value={x.totalText || ''} onChange={e => update(x.id, { totalText: e.target.value })} placeholder="TBC / Rate only" style={{ ...cellInput, width: 92, textAlign: 'right' }} />
            : <span style={{ fontWeight: 600 }}>{fmt(lineRateTotal(x))}</span>}
        </div>
      )
    }
    if (x.totalMode === 'text') return <span style={{ color: '#a16207', fontStyle: 'italic' }}>{x.totalText || 'TBC'}</span>
    const v = dMoney(lineRateTotal(x))
    return v ? fmt(v) : ''
  }

  function sectionTotalRow(section) {
    const all = section === 'above' ? aboveItemsAll : belowItemsAll
    const allSum = sumItems(all)
    const sel = section === 'above' ? aboveSel : belowSel
    const hasSel = section === 'above' ? hasAboveSel : hasBelowSel
    // Above: always show the full total; when items are ticked, show the selected subtotal.
    // Below: show the selected subtotal when items are ticked (else full total, greyed).
    const show = hasSel ? sel : allSum
    const label = hasSel
      ? `${section === 'above' ? 'Above' : 'Below'} the line — ${show.count} selected`
      : `${section === 'above' ? 'Above the line total' : 'Below the line total'}`
    const bg = section === 'above' ? '#ecfdf5' : '#fffbeb'
    const bd = section === 'above' ? '#0f766e' : '#b45309'
    return (
      <tr style={{ background: bg, borderTop: `2px solid ${bd}55`, fontWeight: 700 }}>
        <td style={tdC}></td>
        <td style={{ ...td, color: bd }} colSpan={5}>{label}{hasSel && <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 6, fontSize: 11 }}>(ticked)</span>}</td>
        <td style={{ ...tdR, color: bd }}>{fmt(dMoney(show.rate))}</td>
        <td style={tdMat}></td>
        <td style={{ ...tdMat, fontWeight: 700 }}>{fmt(dMoney(show.materials))}</td>
        <td style={tdLab}></td>
        <td style={{ ...tdLab, fontWeight: 700 }}>{fmt(dMoney(show.labour))}</td>
        <td style={td}></td>
      </tr>
    )
  }

  function renderSection(section, label) {
    const sectionItems = items.filter(x => x.section === section)
    return (
      <>
        <tr>
          <td colSpan={COLSPAN} style={{ padding: '10px 8px 6px', fontSize: 12, fontWeight: 700, color: section === 'above' ? '#0f766e' : '#b45309', background: section === 'above' ? '#f0fdfa' : '#fffbeb', borderTop: '2px solid ' + (section === 'above' ? '#99f6e4' : '#fde68a') }}>
            {label} {section === 'below' && <span style={{ fontWeight: 400, color: '#a16207' }}>— optional / variation items</span>}
          </td>
        </tr>
        {sectionItems.length === 0 && (
          <tr><td colSpan={COLSPAN} style={{ padding: '10px 8px', fontSize: 12, color: '#aaa' }}>No {section === 'above' ? 'above' : 'below'}-the-line items.</td></tr>
        )}
        {sectionItems.map((x) => {
          const isEditing = editable && editRow === x.id
          const strike = x.struck ? { textDecoration: 'line-through', color: '#b91c1c', opacity: 0.7 } : {}
          // Per-line manual formatting (independent of strike/heading).
          const fmtStyle = {
            ...(x.bold ? { fontWeight: 700 } : {}),
            ...(x.underline ? { textDecoration: 'underline' } : {}),
            ...(x.red ? { color: '#dc2626' } : {}),
          }
          const isSel = selected.has(x.id)
          if (x.kind === 'heading' && !isEditing) {
            const headStyle = x.plainHeading
              ? { fontWeight: 400, color: '#374151' }
              : { fontWeight: 700, color: '#111827', textDecoration: 'underline' }
            return (
              <tr key={x.id}
                draggable={editable}
                onDragStart={() => editable && setDragId(x.id)}
                onDragOver={e => editable && e.preventDefault()}
                onDrop={() => editable && onDrop(x.id)}
                style={{ background: dragId === x.id ? '#eef2ff' : '#fafafa' }}>
                <td style={tdC}>{editable && <span title="Drag to reorder" style={{ cursor: 'grab', color: '#cbd5e1' }}>⋮⋮</span>}</td>
                <td style={{ ...td, ...headStyle, ...fmtStyle, ...strike }} colSpan={9}>{x.code ? <span style={{ color: '#9ca3af', marginRight: 6, fontWeight: 400, textDecoration: 'none' }}>{x.code}</span> : null}{x.description || '—'}</td>
                <td style={tdMat}></td>
                <td style={tdR}>{editable && <RowMenu x={x} section={section} onEdit={() => setEditRow(x.id)} onMove={move} onStrike={toggleStruck} onDelete={remove} onUp={() => moveUpDown(x.id, -1)} onDown={() => moveUpDown(x.id, 1)} onToggleHeading={toggleHeadingStyle} onToggleStyle={toggleStyle} />}</td>
              </tr>
            )
          }
          return (
            <tr key={x.id}
              draggable={editable && !isEditing}
              onDragStart={() => editable && !isEditing && setDragId(x.id)}
              onDragOver={e => editable && e.preventDefault()}
              onDrop={() => editable && onDrop(x.id)}
              style={{ borderBottom: '1px solid #f0f0f0', background: dragId === x.id ? '#e0e7ff' : (isSel ? '#eef2ff' : (x.struck ? '#fef2f2' : '#fff')) }}>
              <td style={tdC}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                  {editable && !isEditing && <span title="Drag to reorder" style={{ cursor: 'grab', color: '#cbd5e1', fontSize: 12 }}>⋮⋮</span>}
                  <input type="checkbox" checked={isSel} onChange={() => toggleSel(x.id)} style={{ cursor: 'pointer' }} />
                </div>
              </td>
              <td style={{ ...td, color: '#6b7280', fontWeight: 600 }}>
                {isEditing ? <input value={x.code || ''} onChange={e => update(x.id, { code: e.target.value })} style={{ ...cellInput, width: 46 }} /> : (x.code || '')}
              </td>
              <td style={{ ...td, minWidth: 200, maxWidth: 320, whiteSpace: 'normal', ...fmtStyle, ...strike }}>
                {isEditing ? <input value={x.description || ''} onChange={e => update(x.id, { description: e.target.value })} style={cellInput} /> : (x.description || '—')}
              </td>
              <td style={tdR}>
                {isEditing ? <input type="number" value={x.qty ?? ''} onChange={e => update(x.id, { qty: e.target.value === '' ? null : parseFloat(e.target.value) })} style={{ ...cellInput, width: 60, textAlign: 'right' }} /> : (x.qty ?? '')}
              </td>
              <td style={td}>
                {isEditing ? <input value={x.unit || ''} onChange={e => update(x.id, { unit: e.target.value })} style={{ ...cellInput, width: 44 }} /> : (x.unit || '')}
              </td>
              <td style={tdR}>
                {isEditing ? <input type="number" value={x.rate ?? ''} onChange={e => update(x.id, { rate: e.target.value === '' ? null : parseFloat(e.target.value) })} style={{ ...cellInput, width: 74, textAlign: 'right' }} /> : (x.rate != null ? fmtRate(dRate(x.rate)) : '')}
              </td>
              <td style={{ ...tdR, fontWeight: 600 }}>{totalCell(x, isEditing)}</td>
              <td style={tdMat} title="Materials rate within the rate (budget)">
                {isEditing ? <input type="number" value={x.matRate ?? ''} onChange={e => update(x.id, { matRate: e.target.value === '' ? null : parseFloat(e.target.value) })} style={{ ...cellInput, width: 66, textAlign: 'right' }} /> : (x.matRate != null ? fmtRate(dRate(x.matRate)) : '')}
              </td>
              <td style={{ ...tdMat, fontWeight: 600 }} title="Materials total (qty × mat rate)">{lineMatTotal(x) ? fmt(dMoney(lineMatTotal(x))) : ''}</td>
              <td style={tdLab} title="Labour rate within the rate (budget)">
                {isEditing ? <input type="number" value={x.labRate ?? ''} onChange={e => update(x.id, { labRate: e.target.value === '' ? null : parseFloat(e.target.value) })} style={{ ...cellInput, width: 66, textAlign: 'right' }} /> : (x.labRate != null ? fmtRate(dRate(x.labRate)) : '')}
              </td>
              <td style={{ ...tdLab, fontWeight: 600 }} title="Labour total (qty × lab rate)">{lineLabTotal(x) ? fmt(dMoney(lineLabTotal(x))) : ''}</td>
              <td style={tdR}>
                {isEditing
                  ? <button onClick={() => setEditRow(null)} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Done</button>
                  : (editable && <RowMenu x={x} section={section} onEdit={() => setEditRow(x.id)} onMove={move} onStrike={toggleStruck} onDelete={remove} onUp={() => moveUpDown(x.id, -1)} onDown={() => moveUpDown(x.id, 1)} onToggleHeading={x.kind === 'heading' ? toggleHeadingStyle : null} onToggleStyle={toggleStyle} onToVariation={section === 'below' ? () => openVariation([x]) : null} />)}
              </td>
            </tr>
          )
        })}
        {sectionTotalRow(section)}
        {editable && (
          <tr><td colSpan={COLSPAN} style={{ padding: '6px 8px' }}>
            <button onClick={() => addLine(section)} style={{ background: '#f0f2f5', border: '1px dashed #cbd5e1', borderRadius: 6, padding: '5px 12px', fontSize: 11.5, cursor: 'pointer', color: '#475569' }}>+ Add {section === 'above' ? 'above-the-line' : 'below-the-line'} item</button>
          </td></tr>
        )}
      </>
    )
  }

  return (
    <>
      <Head><title>Rock Roofing — Contracted Rates · v16</title></Head>
      <div style={{ minHeight: '100vh', background: '#f5f6f8' }}>
        <CommercialNav active="/contracted-rates" />

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
                  {/* Discount applicable + view toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: '#fff', borderRadius: 10, padding: '12px 16px', marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ fontSize: 12.5, color: '#555', fontWeight: 600 }}>Discount applicable (MCD)</label>
                      <input type="number" min="0" max="100" step="0.1" value={discountPct} disabled={!editable}
                        onChange={e => { setDiscountPct(e.target.value === '' ? 0 : parseFloat(e.target.value)); setDirty(true) }}
                        style={{ width: 72, padding: '6px 8px', border: '1px solid #d5d9e0', borderRadius: 6, fontSize: 13, textAlign: 'right', background: editable ? '#fff' : '#f5f5f5' }} />
                      <span style={{ fontSize: 13, color: '#555' }}>%</span>
                      {editable && <button onClick={save} disabled={saving || !dirty} style={{ background: dirty ? '#0f766e' : '#e5e7eb', color: dirty ? '#fff' : '#9ca3af', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: dirty ? 'pointer' : 'default', marginLeft: 4 }}>{saving ? 'Saving…' : 'Save'}</button>}
                    </div>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#555', cursor: 'pointer' }}>
                      <input type="checkbox" checked={showNet} onChange={e => setShowNet(e.target.checked)} />
                      Show rates net of discount {discountPct ? `(−${discountPct}%)` : ''}
                    </label>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      {showNet ? 'Showing rates AFTER discount (view only — stored rates stay gross).' : 'Showing gross rates. Applications stay gross; discount is applied separately on the Summary.'}
                    </span>
                  </div>

                  {/* Summary cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                    <Card label={`Above the line${showNet ? ' (net)' : ''}`} value={fmt(dMoney(totals.aboveTotal))} sub={`${totals.aboveCount} items`} />
                    <Card label="Below the line (available)" value={fmt(dMoney(totals.belowTotal))} sub={`${totals.belowCount} items`} muted />
                    <Card label="Materials budget (above)" value={fmt(dMoney(totals.aboveMaterials))} tone="mat" />
                    <Card label="Labour budget (above)" value={fmt(dMoney(totals.aboveLabour))} tone="lab" />
                  </div>
                  {sourceTotal != null && Math.abs((sourceTotal || 0) - totals.aboveTotal) > 0.5 && (
                    <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
                      Note: above-the-line total ({fmt(totals.aboveTotal)}) differs from the uploaded file's total ({fmt(sourceTotal)}). That's expected while you move items across the line to match the contract value.
                    </div>
                  )}

                  {/* Selection summary bar — sticky so Combine stays reachable while scrolling */}
                  {anySel && (
                    <div style={{ position: 'sticky', top: 8, zIndex: 30, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 10, padding: '10px 16px', marginBottom: 14, boxShadow: '0 4px 14px rgba(79,70,229,0.18)' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#4f46e5' }}>{overallSel.count} selected</span>
                      <span style={{ fontSize: 13, color: '#4338ca' }}>Total rate: <strong>{fmt(overallSel.rate)}</strong></span>
                      <span style={{ fontSize: 13, color: '#1e40af' }}>Materials: <strong>{fmt(overallSel.materials)}</strong></span>
                      <span style={{ fontSize: 13, color: '#1e40af' }}>Labour: <strong>{fmt(overallSel.labour)}</strong></span>
                      <div style={{ flex: 1 }} />
                      {editable && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRight: '1px solid #c7d2fe', paddingRight: 12, marginRight: 4 }}>
                          <span style={{ fontSize: 11, color: '#6b7280' }}>Format:</span>
                          <button title="Bold selected lines" onClick={() => bulkStyle('bold')} style={{ background: allSelHave('bold') ? '#4f46e5' : '#fff', border: '1px solid ' + (allSelHave('bold') ? '#4f46e5' : '#c7d2fe'), color: allSelHave('bold') ? '#fff' : '#1a1a2e', borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: allSelHave('bold') ? 'inset 0 1px 2px rgba(0,0,0,0.25)' : 'none' }}>B</button>
                          <button title="Underline selected lines" onClick={() => bulkStyle('underline')} style={{ background: allSelHave('underline') ? '#4f46e5' : '#fff', border: '1px solid ' + (allSelHave('underline') ? '#4f46e5' : '#c7d2fe'), color: allSelHave('underline') ? '#fff' : '#1a1a2e', borderRadius: 6, padding: '4px 10px', fontSize: 13, textDecoration: 'underline', cursor: 'pointer', boxShadow: allSelHave('underline') ? 'inset 0 1px 2px rgba(0,0,0,0.25)' : 'none' }}>U</button>
                          <button title="Red selected lines" onClick={() => bulkStyle('red')} style={{ background: allSelHave('red') ? '#dc2626' : '#fff', border: '1px solid ' + (allSelHave('red') ? '#dc2626' : '#fecaca'), color: allSelHave('red') ? '#fff' : '#dc2626', borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: allSelHave('red') ? 'inset 0 1px 2px rgba(0,0,0,0.25)' : 'none' }}>A</button>
                        </span>
                      )}
                      {editable && hasBelowSel && (
                        <button onClick={() => bulkMove('below')} style={{ background: '#fff', border: '1px solid #99f6e4', color: '#0f766e', borderRadius: 6, padding: '4px 12px', fontSize: 12.5, cursor: 'pointer', fontWeight: 600 }}>
                          ↑ Move {belowSelIds.length} above the line
                        </button>
                      )}
                      {editable && hasAboveSel && (
                        <button onClick={() => bulkMove('above')} style={{ background: '#fff', border: '1px solid #fde68a', color: '#b45309', borderRadius: 6, padding: '4px 12px', fontSize: 12.5, cursor: 'pointer', fontWeight: 600 }}>
                          ↓ Move {aboveSelIds.length} below the line
                        </button>
                      )}
                      {editable && hasBelowSel && (
                        <button onClick={() => openVariation(belowSelIds)} style={{ background: '#0f766e', border: 'none', color: '#fff', borderRadius: 6, padding: '5px 14px', fontSize: 12.5, cursor: 'pointer', fontWeight: 700 }}>
                          ➜ Combine {belowSelIds.length} below-line item{belowSelIds.length === 1 ? '' : 's'} into one variation
                        </button>
                      )}
                      <button onClick={clearSel} style={{ background: '#fff', border: '1px solid #c7d2fe', color: '#4f46e5', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Deselect rows</button>
                    </div>
                  )}

                  {/* Grid */}
                  <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
                            <th style={thC}><input type="checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected }} onChange={toggleSelectAll} title="Select all (above & below the line)" style={{ cursor: 'pointer' }} /></th>
                            <th style={th}>Code</th>
                            <th style={th}>Description</th>
                            <th style={thR}>Qty</th>
                            <th style={th}>Unit</th>
                            <th style={thR}>Rate</th>
                            <th style={thR}>Total</th>
                            <th style={thMat}>Mat rate</th>
                            <th style={thMat}>Mat total</th>
                            <th style={thLab}>Lab rate</th>
                            <th style={thLab}>Lab total</th>
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
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Blue columns are budget figures (materials &amp; labour within the rate) — for margin tracking, not the customer application. Tick lines to total a group; the above-the-line total always shows the full contract-works value.</div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Turn item(s) into a variation */}
      {varModal && (
        <div onClick={() => setVarModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 24, width: 520, maxWidth: '100%', maxHeight: '88vh', overflow: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e', marginBottom: 4 }}>{varModal.items.length > 1 ? `Combine ${varModal.items.length} items into one variation` : 'Turn into a variation'}</div>
            <div style={{ fontSize: 12.5, color: '#777', marginBottom: 16 }}>Adds a single variation to this project (Variation Tracker), starting as <strong>not instructed</strong>.</div>

            <label style={{ fontSize: 11, fontWeight: 700, color: '#888', display: 'block', marginBottom: 4 }}>VARIATION No.<span style={{ fontWeight: 400, color: '#aaa', marginLeft: 6 }}>(auto — next in sequence)</span></label>
            <input value={varModal.varNumber} onChange={e => setVarModal(m => ({ ...m, varNumber: e.target.value }))} placeholder="e.g. V01" style={{ width: '100%', padding: '8px 10px', border: '1px solid #d5d9e0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', marginBottom: 12 }} />

            <label style={{ fontSize: 11, fontWeight: 700, color: '#888', display: 'block', marginBottom: 4 }}>DESCRIPTION{varModal.autoSummarised && <span style={{ fontWeight: 400, color: '#b45309', marginLeft: 6 }}>(summarised)</span>}</label>
            <textarea value={varModal.description} onChange={e => setVarModal(m => ({ ...m, description: e.target.value }))} rows={varModal.items.length > 1 ? 4 : 3} style={{ width: '100%', padding: '8px 10px', border: '1px solid #d5d9e0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical', marginBottom: varModal.autoSummarised ? 6 : 14 }} />
            {varModal.autoSummarised && (
              <div style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', marginBottom: 14 }}>
                The combined description was long, so this is a short summary for the Variation Tracker. The full item-by-item detail is kept and will appear in the Application exactly as in the Contracted Rates.
              </div>
            )}

            {(() => {
              const list = varModal.items
              const mat = list.reduce((s, x) => s + lineMatTotal(x), 0)
              const lab = list.reduce((s, x) => s + lineLabTotal(x), 0)
              const rate = list.reduce((s, x) => s + lineRateTotal(x), 0)
              const profit = Math.max(0, rate - mat - lab)
              return (
                <div style={{ background: '#f8f9fa', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                  {list.length > 1 && (
                    <div style={{ fontSize: 11.5, color: '#666', marginBottom: 8 }}>
                      Combining: {list.map(x => x.code || (x.description || '').slice(0, 18)).join(', ')}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 18, fontSize: 13, flexWrap: 'wrap' }}>
                    <span style={{ color: '#0369a1' }}>Materials <strong>{fmt(mat)}</strong></span>
                    <span style={{ color: '#1e3a8a' }}>Labour <strong>{fmt(lab)}</strong></span>
                    <span style={{ color: '#0f766e' }}>Profit <strong>{fmt(profit)}</strong></span>
                    <span style={{ color: '#1a1a2e', marginLeft: 'auto', fontWeight: 700 }}>Value {fmt(mat + lab + profit)}</span>
                  </div>
                </div>
              )
            })()}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setVarModal(null)} style={{ background: '#fff', color: '#666', border: '1px solid #e5e5e5', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={submitVariation} disabled={varBusy === 'modal'} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: varBusy === 'modal' ? 'default' : 'pointer', opacity: varBusy === 'modal' ? 0.6 : 1 }}>{varBusy === 'modal' ? 'Adding…' : 'Add variation'}</button>
            </div>
          </div>
        </div>
      )}

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

function Card({ label, value, sub, tone, muted }) {
  const tones = {
    mat: { bg: '#f0f9ff', border: '#bae6fd', ink: '#0369a1' },
    lab: { bg: '#dbeafe', border: '#93c5fd', ink: '#1e3a8a' },
  }
  const t = tone ? tones[tone] : null
  return (
    <div style={{ background: t ? t.bg : '#fff', borderRadius: 10, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: t ? `1px solid ${t.border}` : '1px solid transparent' }}>
      <div style={{ fontSize: 11, color: t ? t.ink : '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: t ? t.ink : (muted ? '#b45309' : '#1a1a2e') }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// Per-row action menu: move across line, up/down, strike, edit, delete,
// heading-style toggle, and (below the line) turn into a variation.
function RowMenu({ x, section, onEdit, onMove, onStrike, onDelete, onUp, onDown, onToggleHeading, onToggleStyle, onToVariation, varBusy }) {
  const [open, setOpen] = useState(false)
  const btn = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '4px 8px', textAlign: 'left', width: '100%', color: '#374151' }
  const on = { background: '#eef2ff', color: '#4f46e5', fontWeight: 700 }
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(o => !o)} style={{ background: '#f0f2f5', border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 8px', fontSize: 13, cursor: 'pointer', color: '#475569' }}>⋯</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
          <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.15)', zIndex: 11, minWidth: 210, overflow: 'hidden' }}>
            <button style={btn} onClick={() => { onEdit(); setOpen(false) }}>✎ Edit text / values</button>
            {onToVariation && <button style={{ ...btn, color: '#0f766e', fontWeight: 600 }} disabled={varBusy} onClick={() => { onToVariation(); setOpen(false) }}>{varBusy ? '… adding' : '➜ Turn into variation'}</button>}
            {onToggleStyle && (
              <div style={{ borderTop: '1px solid #f0f0f0', padding: '4px 0' }}>
                <div style={{ fontSize: 10, color: '#9ca3af', padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Format line</div>
                <button style={{ ...btn, ...(x.bold ? on : {}) }} onClick={() => onToggleStyle(x.id, 'bold')}><strong>B</strong>&nbsp;&nbsp;Bold {x.bold ? '✓' : ''}</button>
                <button style={{ ...btn, ...(x.underline ? on : {}) }} onClick={() => onToggleStyle(x.id, 'underline')}><span style={{ textDecoration: 'underline' }}>U</span>&nbsp;&nbsp;Underline {x.underline ? '✓' : ''}</button>
                <button style={{ ...btn, ...(x.red ? on : {}) }} onClick={() => onToggleStyle(x.id, 'red')}><span style={{ color: '#dc2626', fontWeight: 700 }}>A</span>&nbsp;&nbsp;Red {x.red ? '✓' : ''}</button>
              </div>
            )}
            <div style={{ borderTop: '1px solid #f0f0f0' }} />
            <button style={btn} onClick={() => { onMove(x.id, section === 'above' ? 'below' : 'above'); setOpen(false) }}>{section === 'above' ? '↓ Move below the line' : '↑ Move above the line'}</button>
            <button style={btn} onClick={() => { onUp(); setOpen(false) }}>↑ Move up</button>
            <button style={btn} onClick={() => { onDown(); setOpen(false) }}>↓ Move down</button>
            {onToggleHeading && <button style={btn} onClick={() => { onToggleHeading(x.id); setOpen(false) }}>{x.plainHeading ? 'B̲ Make heading bold + underlined' : '⇥ Plain heading (no bold/underline)'}</button>}
            <button style={btn} onClick={() => { onStrike(x.id); setOpen(false) }}>{x.struck ? '⟲ Remove strike-through' : '⌐ Strike through'}</button>
            <button style={{ ...btn, color: '#dc2626', borderTop: '1px solid #f0f0f0' }} onClick={() => { onDelete(x.id); setOpen(false) }}>🗑 Delete</button>
          </div>
        </>
      )}
    </div>
  )
}
