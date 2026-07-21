import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'

const fmt = (n) => n == null || n === '' || isNaN(n) ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(parseFloat(n))
const fmtN = (n) => n == null || n === '' ? 0 : parseFloat(n) || 0

function nextVarNumber(variations) {
  const nums = (variations || [])
    .map(v => v.varNumber || '')
    .filter(Boolean)
    .map(n => parseInt(n.replace(/[^0-9]/g, '')))
    .filter(n => !isNaN(n))
  const max = nums.length ? Math.max(...nums) : 0
  return `V${String(max + 1).padStart(2, '0')}`
}

export default function VariationTracker() {
  const router = useRouter()
  const isEmbed = router.query.embed === 'true'
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Filters
  const [filterProject, setFilterProject] = useState('All')
  const [filterCustomer, setFilterCustomer] = useState('All')
  const [filterCM, setFilterCM] = useState('All')
  const [filterEstimator, setFilterEstimator] = useState('All')
  const [filterInstructed, setFilterInstructed] = useState('All')

  // Sort
  const [sortCol, setSortCol] = useState('varNumber')
  const [sortDir, setSortDir] = useState('asc')

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  // Add variation modal
  const [showAdd, setShowAdd] = useState(false)
  const [addProjectId, setAddProjectId] = useState('')
  const [addForm, setAddForm] = useState({ varNumber: '', description: '', instructed: 'yes', materials: '', labour: '', profit: '' })

  // Edit variation modal
  const [editModal, setEditModal] = useState(null) // { projectId, varIndex, form }
  const [editSaving, setEditSaving] = useState(false)

  useEffect(() => { loadProjects() }, [])

  function openEdit(r) {
    // Find the project and variation index
    const project = projects.find(p => p.xeroId === r.projectId)
    if (!project) return
    const vars = project.variations || project.settings?.variations || []
    // Find by varNumber + description match
    const varIndex = vars.findIndex(v =>
      (v.varNumber === r.varNumber || (!v.varNumber && r.varNumber === '—')) &&
      v.description === r.description
    )
    if (varIndex === -1) return
    const v = vars[varIndex]
    setEditModal({
      projectId: r.projectId,
      varIndex,
      project,
      form: {
        varNumber: v.varNumber || '',
        description: v.description || '',
        instructed: v.instructed ? 'yes' : 'no',
        materials: v.materials || '',
        labour: v.labour || '',
        profit: v.profit || '',
      }
    })
  }

  async function saveEdit() {
    if (!editModal) return
    setEditSaving(true)
    try {
      const { projectId, varIndex, form } = editModal
      const res = await fetch(`/api/project/${projectId}`)
      const data = await res.json()
      const settings = data.settings || {}
      const vars = [...(settings.variations || [])]
      vars[varIndex] = {
        ...vars[varIndex],
        varNumber: form.varNumber,
        description: form.description,
        instructed: form.instructed === 'yes',
        materials: form.materials || '0',
        labour: form.labour || '0',
        profit: form.profit || '0',
      }
      await fetch(`/api/project/${projectId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, variations: vars }),
      })
      await loadProjects()
      setEditModal(null)
    } catch (e) { console.error(e) }
    setEditSaving(false)
  }

  // Set Instructed/Not Instructed inline from the row's dropdown, saving immediately.
  async function setInstructed(r, value) {
    // optimistic local update so the change is instant and obvious
    setProjects(prev => prev.map(p => {
      if (p.xeroId !== r.projectId) return p
      const vars = (p.settings?.variations || p.variations || []).map(v =>
        ((v.varNumber === r.varNumber || (!v.varNumber && r.varNumber === '—')) && v.description === r.description)
          ? { ...v, instructed: value } : v)
      const settings = { ...(p.settings || {}), variations: vars }
      return { ...p, settings, variations: vars }
    }))
    try {
      const res = await fetch(`/api/project/${r.projectId}`)
      const data = await res.json()
      const settings = data.settings || {}
      const vars = [...(settings.variations || [])]
      const idx = vars.findIndex(v => (v.varNumber === r.varNumber || (!v.varNumber && r.varNumber === '—')) && v.description === r.description)
      if (idx < 0) return
      vars[idx] = { ...vars[idx], instructed: value }
      await fetch(`/api/project/${r.projectId}/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, variations: vars }),
      })
    } catch (e) { console.error(e); loadProjects() }
  }

  // Inline add-row (persistent, below the header). Same save path as the modal.
  const [inlineAdd, setInlineAdd] = useState({ projectId: '', varNumber: '', description: '', instructed: 'no', materials: '', labour: '', profit: '' })
  const [inlineSaving, setInlineSaving] = useState(false)
  const inlineProject = projects.find(p => p.xeroId === inlineAdd.projectId)

  async function saveInlineAdd() {
    if (!inlineAdd.projectId || !inlineAdd.description) { alert('Pick a project and enter a description.'); return }
    setInlineSaving(true)
    try {
      const res = await fetch(`/api/project/${inlineAdd.projectId}`)
      const data = await res.json()
      const settings = data.settings || {}
      const vars = settings.variations || []
      const newVar = {
        varNumber: inlineAdd.varNumber || nextVarNumber(vars),
        description: inlineAdd.description,
        instructed: inlineAdd.instructed === 'yes',
        materials: inlineAdd.materials || '0',
        labour: inlineAdd.labour || '0',
        profit: inlineAdd.profit || '0',
      }
      await fetch(`/api/project/${inlineAdd.projectId}/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, variations: [...vars, newVar] }),
      })
      await loadProjects()
      setInlineAdd({ projectId: '', varNumber: '', description: '', instructed: 'no', materials: '', labour: '', profit: '' })
    } catch (e) { console.error(e); alert('Could not add variation.') }
    setInlineSaving(false)
  }

  async function deleteVariation(r) {
    if (!confirm(`Delete variation ${r.varNumber} — ${r.description}?`)) return
    try {
      const project = projects.find(p => p.xeroId === r.projectId)
      if (!project) return
      const res = await fetch(`/api/project/${r.projectId}`)
      const data = await res.json()
      const settings = data.settings || {}
      const vars = (settings.variations || []).filter((v, i) => {
        const matchNum = v.varNumber === r.varNumber || (!v.varNumber && r.varNumber === '—')
        const matchDesc = v.description === r.description
        return !(matchNum && matchDesc)
      })
      await fetch(`/api/project/${r.projectId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, variations: vars }),
      })
      await loadProjects()
    } catch (e) { console.error(e) }
  }

  async function loadProjects() {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard?sync=true')
      const data = await res.json()
      // Only live/in-progress projects
      setProjects((data.projects || []).filter(p => p.status === 'INPROGRESS'))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function saveVariation() {
    if (!addProjectId || !addForm.description) return
    setSaving(true)
    try {
      // Get current settings for the project
      const res = await fetch(`/api/project/${addProjectId}`)
      const data = await res.json()
      const currentSettings = data.settings || {}
      const currentVariations = currentSettings.variations || []

      const newVar = {
        varNumber: addForm.varNumber || nextVarNumber(currentVariations),
        description: addForm.description,
        instructed: addForm.instructed === 'yes',
        materials: addForm.materials || '0',
        labour: addForm.labour || '0',
        profit: addForm.profit || '0',
      }

      const updatedSettings = {
        ...currentSettings,
        variations: [...currentVariations, newVar],
      }

      await fetch(`/api/project/${addProjectId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings),
      })

      await loadProjects()
      setShowAdd(false)
      setAddForm({ varNumber: '', description: '', instructed: 'yes', materials: '', labour: '', profit: '' })
      setAddProjectId('')
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  // Build flat list of all variations across all live projects
  const allRows = []
  for (const p of projects) {
    const variations = p.variations || p.settings?.variations || []
    for (const v of variations) {
      allRows.push({
        projectId: p.xeroId,
        jobNo: p.jobNo || '—',
        projectName: p.name || '—',
        customer: p.customer || p.customerName || '—',
        estimator: p.estimator || '—',
        cm: p.contractsManager || '—',
        varNumber: v.varNumber || '—',
        description: v.description || '—',
        instructed: v.instructed,
        materials: fmtN(v.materials),
        labour: fmtN(v.labour),
        profit: fmtN(v.profit),
        total: fmtN(v.materials) + fmtN(v.labour) + fmtN(v.profit),
      })
    }
  }

  // Filter options
  const uniq = (arr, key) => ['All', ...new Set(arr.map(r => r[key]).filter(Boolean))].sort((a, b) => a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b))

  // For project filter: show "J228 — J228-Farmstead Drive" style options
  const projectOptions = ['All', ...new Set(allRows.map(r => `${r.jobNo} — ${r.projectName}`).filter(Boolean))].sort((a, b) => a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b))

  const filtered = allRows.filter(r => {
    if (filterProject !== 'All' && `${r.jobNo} — ${r.projectName}` !== filterProject) return false
    if (filterCustomer !== 'All' && r.customer !== filterCustomer) return false
    if (filterCM !== 'All' && r.cm !== filterCM) return false
    if (filterEstimator !== 'All' && r.estimator !== filterEstimator) return false
    if (filterInstructed !== 'All') {
      if (filterInstructed === 'Instructed' && !r.instructed) return false
      if (filterInstructed === 'Not Instructed' && r.instructed) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol]
    if (typeof av === 'string') av = av.toLowerCase()
    if (typeof bv === 'string') bv = bv.toLowerCase()
    if (av == null) return 1
    if (bv == null) return -1
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const totalMaterials = filtered.reduce((s, r) => s + r.materials, 0)
  const totalLabour = filtered.reduce((s, r) => s + r.labour, 0)
  const totalProfit = filtered.reduce((s, r) => s + r.profit, 0)
  const totalTotal = filtered.reduce((s, r) => s + r.total, 0)

  const thS = { padding: '8px 10px', fontWeight: 600, color: '#555', textAlign: 'left', fontSize: 12, borderBottom: '2px solid #e5e5e5', whiteSpace: 'nowrap', background: '#f8f9fa' }
  const tdS = { padding: '8px 10px', fontSize: 12, borderBottom: '1px solid #f0f0f0', verticalAlign: 'middle' }
  const selS = { fontSize: 12, padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff', fontFamily: 'inherit', cursor: 'pointer' }
  const inlineCell = { fontSize: 12, padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }
  const inputS = { width: '100%', padding: '7px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' }

  // For add modal: get selected project's existing variations to compute next var number
  const selectedProject = projects.find(p => p.xeroId === addProjectId)
  const nextNum = selectedProject ? nextVarNumber(selectedProject.variations || selectedProject.settings?.variations || []) : 'V01'

  return (
    <>
      <Head><title>Rock Roofing — Variation Tracker</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#f0f2f5' }}>

        {/* Nav */}
        <div style={{ background: '#1a1a19', padding: '0 24px', position: 'sticky', top: 0, zIndex: 20, display: isEmbed ? 'none' : 'block' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', flex: 1, minWidth: 0 }}>
              <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
              <Link href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>← Portal</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/commercial" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Project Financials</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/outstanding-invoices" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Outstanding Invoices</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/retention" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Retention</Link>
              <span style={{ color: '#444' }}>|</span>
              <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Variations</span>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/contracted-rates" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Contracted Rates</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/applications" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Applications</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/application-calendar" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Application Calendar</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/wip" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>WIP</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/commercial-scorecard" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Commercial Scorecard</Link>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => window.dispatchEvent(new CustomEvent('open-report-problem'))}
                style={{ background: 'none', border: 'none', color: '#ca8a04', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>⚠ Report app improvement</button>
              <button
                onClick={() => { setShowAdd(true); setAddForm({ varNumber: '', description: '', instructed: 'yes', materials: '', labour: '', profit: '' }); setAddProjectId('') }}
                style={{ background: '#e63946', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                + Add Variation
              </button>
            </div>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1a1a2e' }}>Variation Tracker</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12, color: '#888' }}>Live & in-progress projects only · {filtered.length} variation{filtered.length !== 1 ? 's' : ''}</span>
              {isEmbed && (
                <button
                  onClick={() => { setShowAdd(true); setAddForm({ varNumber: '', description: '', instructed: 'yes', materials: '', labour: '', profit: '' }); setAddProjectId('') }}
                  style={{ background: '#e63946', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                  + Add Variation
                </button>
              )}
            </div>
          </div>

          {/* Filters */}
          <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {[
              { label: 'Project', value: filterProject, set: setFilterProject, opts: projectOptions },
              { label: 'Customer', value: filterCustomer, set: setFilterCustomer, opts: uniq(allRows, 'customer') },
              { label: 'CM', value: filterCM, set: setFilterCM, opts: uniq(allRows, 'cm') },
              { label: 'Estimator', value: filterEstimator, set: setFilterEstimator, opts: uniq(allRows, 'estimator') },
            ].map(f => (
              <div key={f.label}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{f.label}</div>
                <select value={f.value} onChange={e => f.set(e.target.value)} style={selS}>
                  {f.opts.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
            ))}
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Instructed?</div>
              <select value={filterInstructed} onChange={e => setFilterInstructed(e.target.value)} style={selS}>
                {['All', 'Instructed', 'Not Instructed'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <button onClick={() => { setFilterProject('All'); setFilterCustomer('All'); setFilterCM('All'); setFilterEstimator('All'); setFilterInstructed('All') }}
              style={{ fontSize: 12, padding: '5px 12px', border: '1px solid #e5e5e5', borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: '#555' }}>
              Reset
            </button>
          </div>

          {/* Summary totals */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Total Materials', value: fmt(totalMaterials) },
              { label: 'Total Labour', value: fmt(totalLabour) },
              { label: 'Total Profit', value: fmt(totalProfit), color: totalProfit >= 0 ? '#16a34a' : '#e63946' },
              { label: 'Total Value', value: fmt(totalTotal), color: '#1a1a2e' },
            ].map(c => (
              <div key={c.label} style={{ background: '#fff', borderRadius: 10, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: c.color || '#1a1a2e' }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* Table */}
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>No variations found.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {[
                        { label: 'Variation Number', col: 'varNumber' },
                        { label: 'Project No', col: 'jobNo' },
                        { label: 'Project Name', col: 'projectName' },
                        { label: 'Customer', col: 'customer' },
                        { label: 'Estimator', col: 'estimator' },
                        { label: 'CM', col: 'cm' },
                        { label: 'Description', col: 'description' },
                        { label: 'Instructed?', col: 'instructed' },
                        { label: 'Materials £', col: 'materials' },
                        { label: 'Labour £', col: 'labour' },
                        { label: 'Profit £', col: 'profit' },
                        { label: 'Total £', col: 'total' },
                        { label: '', col: 'actions' },
                      ].map(({ label, col }) => (
                        <th key={col} onClick={() => toggleSort(col)}
                          style={{ ...thS, textAlign: ['materials', 'labour', 'profit', 'total'].includes(col) ? 'right' : 'left', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                          {label} {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{ color: '#ccc' }}>↕</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Persistent inline add-row */}
                    <tr style={{ background: '#fffbeb', borderBottom: '2px solid #fde68a' }}>
                      <td style={{ ...tdS, whiteSpace: 'nowrap' }}>
                        <input value={inlineAdd.varNumber} onChange={e => setInlineAdd(a => ({ ...a, varNumber: e.target.value }))} placeholder="auto" style={{ ...inlineCell, width: 60 }} />
                      </td>
                      <td style={{ ...tdS, whiteSpace: 'nowrap' }} colSpan={2}>
                        <select value={inlineAdd.projectId} onChange={e => setInlineAdd(a => ({ ...a, projectId: e.target.value }))} style={{ ...inlineCell, minWidth: 220 }}>
                          <option value="">Select project…</option>
                          {projects.map(p => <option key={p.xeroId} value={p.xeroId}>{[p.jobNo, p.name].filter(Boolean).join(' — ')}</option>)}
                        </select>
                      </td>
                      <td style={{ ...tdS, whiteSpace: 'nowrap', color: '#888' }}>{inlineProject ? (inlineProject.customer || inlineProject.customerName || '—') : '—'}</td>
                      <td style={{ ...tdS, whiteSpace: 'nowrap', color: '#888' }}>{inlineProject ? (inlineProject.estimator || '—') : '—'}</td>
                      <td style={{ ...tdS, whiteSpace: 'nowrap', color: '#888' }}>{inlineProject ? (inlineProject.contractsManager || '—') : '—'}</td>
                      <td style={tdS}>
                        <input value={inlineAdd.description} onChange={e => setInlineAdd(a => ({ ...a, description: e.target.value }))} placeholder="Description" style={{ ...inlineCell, minWidth: 180 }} />
                      </td>
                      <td style={{ ...tdS, textAlign: 'center' }}>
                        <button onClick={() => setInlineAdd(a => ({ ...a, instructed: a.instructed === 'yes' ? 'no' : 'yes' }))}
                          style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 10, border: 'none', cursor: 'pointer', background: inlineAdd.instructed === 'yes' ? '#dcfce7' : '#fee2e2', color: inlineAdd.instructed === 'yes' ? '#16a34a' : '#e63946' }}>
                          {inlineAdd.instructed === 'yes' ? 'Instructed' : 'Not Instructed'}
                        </button>
                      </td>
                      <td style={{ ...tdS, textAlign: 'right' }}><input value={inlineAdd.materials} onChange={e => setInlineAdd(a => ({ ...a, materials: e.target.value }))} placeholder="0" style={{ ...inlineCell, width: 80, textAlign: 'right' }} inputMode="decimal" /></td>
                      <td style={{ ...tdS, textAlign: 'right' }}><input value={inlineAdd.labour} onChange={e => setInlineAdd(a => ({ ...a, labour: e.target.value }))} placeholder="0" style={{ ...inlineCell, width: 80, textAlign: 'right' }} inputMode="decimal" /></td>
                      <td style={{ ...tdS, textAlign: 'right' }}><input value={inlineAdd.profit} onChange={e => setInlineAdd(a => ({ ...a, profit: e.target.value }))} placeholder="0" style={{ ...inlineCell, width: 80, textAlign: 'right' }} inputMode="decimal" /></td>
                      <td style={tdS}></td>
                      <td style={{ ...tdS, whiteSpace: 'nowrap' }}>
                        <button onClick={saveInlineAdd} disabled={inlineSaving}
                          style={{ fontSize: 11, padding: '4px 12px', border: 'none', borderRadius: 4, background: '#e63946', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>{inlineSaving ? 'Adding…' : '+ Add'}</button>
                      </td>
                    </tr>
                    {sorted.map((r, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={{ ...tdS, fontWeight: 600, color: '#1a1a2e', whiteSpace: 'nowrap' }}>{r.varNumber || '—'}</td>
                        <td style={{ ...tdS, whiteSpace: 'nowrap' }}>
                          <Link href={`/project/${r.projectId}`} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}>{r.jobNo}</Link>
                        </td>
                        <td style={{ ...tdS, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.projectName}</td>
                        <td style={{ ...tdS, whiteSpace: 'nowrap' }}>{r.customer}</td>
                        <td style={{ ...tdS, whiteSpace: 'nowrap' }}>{r.estimator}</td>
                        <td style={{ ...tdS, whiteSpace: 'nowrap' }}>{r.cm}</td>
                        <td style={{ ...tdS, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                        <td style={{ ...tdS, textAlign: 'center' }}>
                          <select value={r.instructed ? 'yes' : 'no'} onClick={e => e.stopPropagation()} onChange={e => { e.stopPropagation(); setInstructed(r, e.target.value === 'yes') }}
                            style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 8, cursor: 'pointer', border: '1px solid ' + (r.instructed ? '#bbf7d0' : '#fecaca'), background: r.instructed ? '#dcfce7' : '#fee2e2', color: r.instructed ? '#16a34a' : '#e63946' }}>
                            <option value="yes">Instructed</option>
                            <option value="no">Not Instructed</option>
                          </select>
                        </td>
                        <td style={{ ...tdS, textAlign: 'right' }}>{fmt(r.materials)}</td>
                        <td style={{ ...tdS, textAlign: 'right' }}>{fmt(r.labour)}</td>
                        <td style={{ ...tdS, textAlign: 'right', color: r.profit >= 0 ? '#16a34a' : '#e63946' }}>{fmt(r.profit)}</td>
                        <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{fmt(r.total)}</td>
                        <td style={{ ...tdS, whiteSpace: 'nowrap' }}>
                          <button onClick={e => { e.stopPropagation(); openEdit(r) }}
                            style={{ fontSize: 11, padding: '3px 8px', border: '1px solid #e5e5e5', borderRadius: 4, background: '#f8f9fa', cursor: 'pointer', marginRight: 4, color: '#555' }}>Edit</button>
                          <button onClick={e => { e.stopPropagation(); deleteVariation(r) }}
                            style={{ fontSize: 11, padding: '3px 8px', border: '1px solid #fecaca', borderRadius: 4, background: '#fef2f2', cursor: 'pointer', color: '#e63946' }}>Delete</button>
                        </td>
                      </tr>
                    ))}
                    {/* Totals row */}
                    <tr style={{ background: '#f8f9fa', borderTop: '2px solid #e5e5e5' }}>
                      <td colSpan={8} style={{ ...tdS, fontWeight: 700, color: '#1a1a2e' }}>TOTALS ({filtered.length})</td>
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>{fmt(totalMaterials)}</td>
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>{fmt(totalLabour)}</td>
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 700, color: totalProfit >= 0 ? '#16a34a' : '#e63946' }}>{fmt(totalProfit)}</td>
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>{fmt(totalTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Edit Variation Modal */}
        {editModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setEditModal(null)}>
            <div style={{ background: '#fff', borderRadius: 12, padding: 32, width: '100%', maxWidth: 620, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: '#1a1a2e' }}>Edit Variation — {editModal.project?.jobNo}</h3>
                <button onClick={() => setEditModal(null)} style={{ fontSize: 20, border: 'none', background: 'none', cursor: 'pointer', color: '#888' }}>×</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Variation Number</label>
                  <input value={editModal.form.varNumber} onChange={e => setEditModal(m => ({ ...m, form: { ...m.form, varNumber: e.target.value } }))}
                    style={inputS} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Description</label>
                  <input value={editModal.form.description} onChange={e => setEditModal(m => ({ ...m, form: { ...m.form, description: e.target.value } }))}
                    style={inputS} />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Instructed?</label>
                <select value={editModal.form.instructed} onChange={e => setEditModal(m => ({ ...m, form: { ...m.form, instructed: e.target.value } }))} style={inputS}>
                  <option value="yes">Instructed</option>
                  <option value="no">Not Instructed</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
                {[['materials', 'Materials (£)'], ['labour', 'Labour / Lodge (£)'], ['profit', 'Profit (£)']].map(([key, label]) => (
                  <div key={key}>
                    <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>{label}</label>
                    <input type="number" value={editModal.form[key]}
                      onChange={e => setEditModal(m => ({ ...m, form: { ...m.form, [key]: e.target.value } }))}
                      placeholder="0.00" style={inputS} />
                  </div>
                ))}
              </div>

              {(editModal.form.materials || editModal.form.labour || editModal.form.profit) ? (
                <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13 }}>
                  Total: <strong style={{ color: '#16a34a' }}>{fmt(fmtN(editModal.form.materials) + fmtN(editModal.form.labour) + fmtN(editModal.form.profit))}</strong>
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={saveEdit} disabled={editSaving}
                  style={{ flex: 1, background: editSaving ? '#ccc' : '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', cursor: editSaving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 500 }}>
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
                <button onClick={() => setEditModal(null)}
                  style={{ padding: '10px 20px', border: '1px solid #e5e5e5', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14, color: '#555' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Variation Modal */}
        {showAdd && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setShowAdd(false)}>
            <div style={{ background: '#fff', borderRadius: 12, padding: 32, width: '100%', maxWidth: 600, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: '#1a1a2e' }}>Add Variation</h3>
                <button onClick={() => setShowAdd(false)} style={{ fontSize: 20, border: 'none', background: 'none', cursor: 'pointer', color: '#888' }}>×</button>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Project *</label>
                <select value={addProjectId} onChange={e => {
                  setAddProjectId(e.target.value)
                  const proj = projects.find(p => p.xeroId === e.target.value)
                  const vars = proj?.variations || proj?.settings?.variations || []
                  setAddForm(f => ({ ...f, varNumber: nextVarNumber(vars) }))
                }} style={{ ...inputS }}>
                  <option value="">Select project...</option>
                  {projects.map(p => <option key={p.xeroId} value={p.xeroId}>{p.jobNo} — {p.name}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Var Number</label>
                  <input value={addForm.varNumber} onChange={e => setAddForm(f => ({ ...f, varNumber: e.target.value }))}
                    placeholder={addProjectId ? nextNum : 'V01'}
                    style={inputS} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Description *</label>
                  <input value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Variation description" style={inputS} />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Instructed?</label>
                <select value={addForm.instructed} onChange={e => setAddForm(f => ({ ...f, instructed: e.target.value }))} style={inputS}>
                  <option value="yes">Instructed</option>
                  <option value="no">Not Instructed</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
                {[['materials', 'Materials (£)'], ['labour', 'Labour / Lodge (£)'], ['profit', 'Profit (£)']].map(([key, label]) => (
                  <div key={key}>
                    <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>{label}</label>
                    <input type="number" value={addForm[key]} onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder="0.00" style={inputS} />
                  </div>
                ))}
              </div>

              {addForm.materials || addForm.labour || addForm.profit ? (
                <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13 }}>
                  Total: <strong style={{ color: '#16a34a' }}>{fmt(fmtN(addForm.materials) + fmtN(addForm.labour) + fmtN(addForm.profit))}</strong>
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={saveVariation} disabled={saving || !addProjectId || !addForm.description}
                  style={{ flex: 1, background: saving || !addProjectId || !addForm.description ? '#ccc' : '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', cursor: saving || !addProjectId || !addForm.description ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 500 }}>
                  {saving ? 'Saving...' : 'Save Variation'}
                </button>
                <button onClick={() => setShowAdd(false)}
                  style={{ padding: '10px 20px', border: '1px solid #e5e5e5', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14, color: '#555' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
