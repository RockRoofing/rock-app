// v10 - wip valDate fix, colour key, label changes
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'

const fmt = (n) => n == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)
const fmtC = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n || 0)
const pct = (n) => n == null ? '—' : (n * 100).toFixed(1) + '%'

const ROLES = ['Contracts Manager', 'Operations Manager', 'Quantity Surveyor', 'Estimator']

function calcAtDate(costLines, invoiceLines, valDate, settings) {
  const vDateStr = valDate ? new Date(valDate.getTime() - valDate.getTimezoneOffset() * 60000).toISOString().split('T')[0] : null
  const costsToDate = vDateStr
    ? costLines.filter(l => l.date && l.date <= vDateStr).reduce((s, l) => s + (l.amount || 0), 0)
    : costLines.reduce((s, l) => s + (l.amount || 0), 0)
  const labourToDate = vDateStr
    ? costLines.filter(l => l.date && l.date <= vDateStr && ['321', '320'].includes(l.accountCode)).reduce((s, l) => s + (l.amount || 0), 0)
    : costLines.filter(l => ['321', '320'].includes(l.accountCode)).reduce((s, l) => s + (l.amount || 0), 0)
  const materialsToDate = costsToDate - labourToDate
  const invoicedToDate = vDateStr
    ? invoiceLines.filter(i => i.date && i.date <= vDateStr).reduce((s, i) => s + (i.total || 0), 0)
    : invoiceLines.reduce((s, i) => s + (i.total || 0), 0)
  const retPct = parseFloat(settings.retentionPct || 0)
  const retention = retPct > 0 ? invoicedToDate * retPct / (1 - retPct) : 0
  const grossInvoiced = invoicedToDate + retention
  const contractValue = parseFloat(settings.contractValue || 0)
  const instructedVars = (settings.variations || []).filter(v => v.instructed).reduce((s, v) => s + (parseFloat(v.materials || 0) + parseFloat(v.labour || 0) + parseFloat(v.profit || 0)), 0)
  const afa = contractValue + instructedVars
  const margin = grossInvoiced > 0 ? (grossInvoiced - costsToDate) / grossInvoiced : null
  const remainingToInvoice = afa - invoicedToDate
  const totalLabourBudget = parseFloat(settings.labourBudget || 0) + (settings.variations || []).filter(v => v.instructed).reduce((s, v) => s + parseFloat(v.labour || 0), 0)
  const totalMaterialsBudget = parseFloat(settings.materialsBudget || 0) + (settings.variations || []).filter(v => v.instructed).reduce((s, v) => s + parseFloat(v.materials || 0), 0)
  const totalBudget = totalLabourBudget + totalMaterialsBudget
  return { costsToDate, labourToDate, materialsToDate, invoicedToDate, grossInvoiced, retention, afa, margin, remainingToInvoice, totalBudget, totalLabourBudget, totalMaterialsBudget }
}

function getPastValuationDates(valuationDay, months = 12) {
  if (!valuationDay) return []
  const day = parseInt(valuationDay)
  const dates = []
  const now = new Date()
  for (let i = 0; i <= months; i++) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, day))
    if (d <= now) dates.push(d)
  }
  return dates
}

function marginColor(m) {
  if (m == null) return '#888'
  if (m >= 0.25) return '#16a34a'
  if (m >= 0.21) return '#ca8a04'
  return '#e63946'
}

function marginBg(m) {
  if (m == null) return '#f0f0f0'
  if (m >= 0.25) return '#f0fdf4'
  if (m >= 0.21) return '#fffbeb'
  return '#fef2f2'
}

export default function ProjectPage() {
  const router = useRouter()
  const { id } = router.query
  const [project, setProject] = useState(null)
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('overview')
  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState({})
  const [generating, setGenerating] = useState(false)
  const [teamMembers, setTeamMembers] = useState([])
  const [showAddMember, setShowAddMember] = useState(false)
  const [newMember, setNewMember] = useState({ firstName: '', lastName: '', role: 'Contracts Manager' })
  const [addingMember, setAddingMember] = useState(false)
  const [costLines, setCostLines] = useState([])
  const [invoiceLines, setInvoiceLines] = useState([])
  const [selectedVDate, setSelectedVDate] = useState(null)
  const [pastVDates, setPastVDates] = useState([])

  useEffect(() => { if (id) load() }, [id])
  useEffect(() => { loadTeam() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/project/${id}`)
      const data = await res.json()
      setProject(data.project)
      setSettings(data.settings || {})
      setForm(data.settings || {})
      setCostLines(data.costLines || [])
      setInvoiceLines(data.invoiceLines || [])
      const vDay = data.settings?.valuationDay
      if (vDay) {
        const dates = getPastValuationDates(vDay, 12)
        setPastVDates(dates)
        setSelectedVDate(dates[0] || null)
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function loadTeam() {
    try {
      const res = await fetch('/api/staff')
      const data = await res.json()
      setTeamMembers(data.members || [])
    } catch (e) { console.error(e) }
  }

  async function save() {
    setSaving(true)
    await fetch(`/api/project/${id}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setSettings(form)
    setEditMode(false)
    setSaving(false)
    load()
  }

  async function generateReport() {
    setGenerating(true)
    try {
      const res = await fetch(`/api/project/${id}/report`, { method: 'POST' })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${project?.jobNo || id}_Report_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
    } catch (e) { console.error(e) }
    setGenerating(false)
  }

  async function addTeamMember() {
    if (!newMember.firstName.trim() || !newMember.lastName.trim()) return
    setAddingMember(true)
    const fullName = `${newMember.firstName.trim()} ${newMember.lastName.trim()}`
    const updated = [...teamMembers, { name: fullName, role: newMember.role }]
    try {
      await fetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ members: updated }) })
      setTeamMembers(updated)
      setNewMember({ firstName: '', lastName: '', role: 'Contracts Manager' })
      setShowAddMember(false)
    } catch (e) { console.error(e) }
    setAddingMember(false)
  }

  async function removeTeamMember(name) {
    const updated = teamMembers.filter(m => m.name !== name)
    try {
      await fetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ members: updated }) })
      setTeamMembers(updated)
    } catch (e) { console.error(e) }
  }

  function addVariation() {
    const existing = form.variations || []
    const nums = existing.map(v => v.varNumber || '').filter(Boolean).map(n => parseInt(n.replace(/[^0-9]/g, ''))).filter(n => !isNaN(n))
    const max = nums.length ? Math.max(...nums) : 0
    const nextNum = `V${String(max + 1).padStart(2, '0')}`
    setForm({ ...form, variations: [...existing, { varNumber: nextNum, description: '', instructed: true }] })
  }

  function updateVariation(i, field, value) {
    const vars = [...(form.variations || [])]
    vars[i] = { ...vars[i], [field]: value }
    setForm({ ...form, variations: vars })
  }

  function removeVariation(i) {
    const vars = [...(form.variations || [])]
    vars.splice(i, 1)
    setForm({ ...form, variations: vars })
  }

  const afa = (parseFloat(form.contractValue) || 0) + (form.variations || []).filter(v => v.instructed).reduce((s, v) => s + (parseFloat(v.materials || 0) + parseFloat(v.labour || 0) + parseFloat(v.profit || 0)), 0)

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>
  if (!project) return <div style={{ padding: 40 }}>Project not found.</div>

  const p = { ...project, ...(project.calculated || {}) }
  const atDate = selectedVDate ? calcAtDate(costLines, invoiceLines, selectedVDate, settings || {}) : calcAtDate(costLines, invoiceLines, null, settings || {})
  const trendData = pastVDates.slice(0, 6).reverse().map(d => {
    const calc = calcAtDate(costLines, invoiceLines, d, settings || {})
    return { label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), margin: calc.margin, invoiced: calc.invoicedToDate, costs: calc.costsToDate }
  })
  const vDateLabel = selectedVDate ? selectedVDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'All time'

  return (
    <>
      <Head><title>{p.jobNo} — {p.name}</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <div style={{ background: '#1a1a2e', padding: '0 24px' }}>
          <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Link href="/commercial" style={{ color: '#888', fontSize: 13 }}>← Project Financials</Link>
              <span style={{ color: '#444' }}>|</span>
              <span style={{ color: '#fff', fontWeight: 600 }}>{p.jobNo} — {p.name}</span>
              <span style={{ background: p.status === 'INPROGRESS' ? '#16a34a' : '#888', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
                {p.status === 'INPROGRESS' ? 'In Progress' : 'Closed'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button onClick={() => setEditMode(!editMode)} style={{ background: 'transparent', border: '1px solid #444', color: '#ccc', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>
                {editMode ? 'Cancel' : 'Edit Project Details'}
              </button>
              <button onClick={generateReport} disabled={generating} style={{ background: '#e63946', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>
                {generating ? 'Generating...' : 'Download Report'}
              </button>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1400, margin: '0 auto', padding: 24 }}>
          {pastVDates.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, background: '#fff', borderRadius: 10, padding: '12px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <span style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Figures as at valuation date:</span>
              <select value={selectedVDate ? selectedVDate.toISOString() : ''} onChange={e => setSelectedVDate(e.target.value ? new Date(e.target.value) : null)} style={{ padding: '6px 12px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                {pastVDates.map(d => (
                  <option key={d.toISOString()} value={d.toISOString()}>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</option>
                ))}
              </select>
              <span style={{ fontSize: 12, color: '#888' }}>Valuation day: {settings?.valuationDay ? `${settings.valuationDay}th of each month` : '⚠ Not set'}</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'AFA', value: fmt(atDate.afa), sub: `CV: ${fmt(parseFloat(settings?.contractValue || 0))}` },
              { label: 'Gross Invoiced Inc. Retention', value: fmt(atDate.grossInvoiced), sub: `as at ${vDateLabel}` },
              { label: 'Total Spent', value: fmt(atDate.costsToDate), sub: `as at ${vDateLabel}` },
              { label: 'Total Budget', value: fmt(atDate.totalBudget), sub: atDate.totalBudget > 0 ? `${((atDate.costsToDate / atDate.totalBudget) * 100).toFixed(0)}% used` : '⚠ Set budget' },
              { label: 'Current Margin', value: atDate.margin != null ? (atDate.margin * 100).toFixed(1) + '%' : '—', sub: `as at ${vDateLabel}`, color: marginColor(atDate.margin), bg: marginBg(atDate.margin), showKey: true },
              { label: 'Remaining to Invoice', value: fmt(atDate.remainingToInvoice), color: atDate.remainingToInvoice > 0 ? '#2563eb' : '#e63946' },
            ].map(card => (
              <div key={card.label} style={{ background: card.bg || '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: card.bg ? `1px solid ${card.color}22` : 'none' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{card.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: card.color || '#1a1a1a' }}>{card.value}</div>
                {card.sub && <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>{card.sub}</div>}
                {card.showKey && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: '#16a34a' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#16a34a', display: 'inline-block' }} />≥25%</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: '#ca8a04' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#ca8a04', display: 'inline-block' }} />≥21%</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: '#e63946' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#e63946', display: 'inline-block' }} />&lt;21%</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>
            <div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#fff', borderRadius: 8, padding: 4, width: 'fit-content', border: '1px solid #eee' }}>
                {['overview', 'costs', 'income', 'wip', 'retention'].map(t => (
                  <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: tab === t ? '#1a1a2e' : 'transparent', color: tab === t ? '#fff' : '#555', cursor: 'pointer', fontSize: 13, textTransform: 'capitalize' }}>{t}</button>
                ))}
              </div>
              {tab === 'overview' && <OverviewTab p={p} settings={settings || {}} atDate={atDate} trendData={trendData} vDateLabel={vDateLabel} costLines={costLines} invoiceLines={invoiceLines} />}
              {tab === 'costs' && <CostsTab costLines={costLines} atDate={atDate} settings={settings || {}} />}
              {tab === 'income' && <IncomeTab invoiceLines={invoiceLines} atDate={atDate} />}
              {tab === 'wip' && <WipTab costLines={costLines} invoiceLines={invoiceLines} settings={settings || {}} pastVDates={pastVDates} selectedVDate={selectedVDate} id={id} onSettingsSaved={load} />}
              {tab === 'retention' && <RetentionTab p={p} settings={settings || {}} atDate={atDate} />}
            </div>

            {editMode && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px', overflowY: 'auto' }} onClick={() => setEditMode(false)}>
              <div style={{ background: '#fff', borderRadius: 12, padding: 32, width: '100%', maxWidth: 1100, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginTop: 20 }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>Project Details</h3>
                  <button onClick={() => setEditMode(false)} style={{ fontSize: 20, border: 'none', background: 'none', cursor: 'pointer', color: '#888', lineHeight: 1 }}>×</button>
                </div>
                <DetailsForm form={form} setForm={setForm} addVariation={addVariation} updateVariation={updateVariation} removeVariation={removeVariation} afa={afa} currentMargin={atDate.margin} teamMembers={teamMembers} onAddMember={() => setShowAddMember(true)} onRemoveMember={removeTeamMember} />
                <button onClick={save} disabled={saving} style={{ marginTop: 20, width: '100%', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 14 }}>
                  {saving ? 'Saving...' : 'Save Project Details'}
                </button>
              </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showAddMember && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 32, width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 16 }}>Add New Team Member</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>First Name</label>
              <input value={newMember.firstName} onChange={e => setNewMember({ ...newMember, firstName: e.target.value })} placeholder="First name" style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} autoFocus />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Last Name</label>
              <input value={newMember.lastName} onChange={e => setNewMember({ ...newMember, lastName: e.target.value })} placeholder="Last name" style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Role</label>
              <select value={newMember.role} onChange={e => setNewMember({ ...newMember, role: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={addTeamMember} disabled={addingMember || !newMember.firstName.trim() || !newMember.lastName.trim()} style={{ flex: 1, background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 13 }}>
                {addingMember ? 'Adding...' : 'Add Member'}
              </button>
              <button onClick={() => { setShowAddMember(false); setNewMember({ firstName: '', lastName: '', role: 'Contracts Manager' }) }} style={{ flex: 1, background: '#f0f2f5', color: '#555', border: 'none', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function OverviewTab({ p, settings, atDate, trendData, vDateLabel, costLines, invoiceLines }) {
  const { costsToDate: totalSpent, labourToDate: labourSpent, materialsToDate: materialsSpent, totalBudget, totalLabourBudget: labourBudget, totalMaterialsBudget: materialsBudget } = atDate

  function BarRow({ label, spent, budget, color }) {
    const pctUsed = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
    const over = spent > budget && budget > 0
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12 }}>
          <span style={{ color: '#555', fontWeight: 500 }}>{label}</span>
          <span style={{ color: over ? '#e63946' : '#555' }}>
            {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(spent)}
            {budget > 0 && <span style={{ color: '#888' }}> / {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(budget)}</span>}
          </span>
        </div>
        <div style={{ background: '#f0f0f0', borderRadius: 6, height: 10, overflow: 'hidden' }}>
          <div style={{ width: `${pctUsed}%`, background: over ? '#e63946' : color, height: '100%', borderRadius: 6, transition: 'width 0.5s' }} />
        </div>
        <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>
          {budget > 0 ? `${pctUsed.toFixed(0)}% used — ${new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(Math.max(budget - spent, 0))} remaining` : '⚠ Budget not set'}
        </div>
      </div>
    )
  }

  function Donut({ labour, materials }) {
    const total = labour + materials
    if (total === 0) return <div style={{ textAlign: 'center', color: '#888', padding: 20 }}>No cost data</div>
    const labourPct = (labour / total) * 100
    const r = 60, circ = 2 * Math.PI * r
    const labourDash = (labourPct / 100) * circ
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <svg width={140} height={140} viewBox="0 0 140 140">
          <circle cx={70} cy={70} r={r} fill="none" stroke="#fff7ed" strokeWidth={22} />
          <circle cx={70} cy={70} r={r} fill="none" stroke="#ea7c28" strokeWidth={22} strokeDasharray={`${(100 - labourPct) / 100 * circ} ${circ}`} strokeDashoffset={-labourDash} transform="rotate(-90 70 70)" />
          <circle cx={70} cy={70} r={r} fill="none" stroke="#16a34a" strokeWidth={22} strokeDasharray={`${labourDash} ${circ}`} transform="rotate(-90 70 70)" />
          <text x={70} y={65} textAnchor="middle" fontSize={11} fill="#555">Total</text>
          <text x={70} y={80} textAnchor="middle" fontSize={13} fontWeight="bold" fill="#1a1a2e">{new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', notation: 'compact', maximumFractionDigits: 0 }).format(total)}</text>
        </svg>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 12, height: 12, background: '#16a34a', borderRadius: 3 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Labour — {labourPct.toFixed(0)}%</div>
              <div style={{ fontSize: 11, color: '#888' }}>{new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(labour)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 12, background: '#ea7c28', borderRadius: 3 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Materials — {(100 - labourPct).toFixed(0)}%</div>
              <div style={{ fontSize: 11, color: '#888' }}>{new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(materials)}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function MonthlyChart({ costLines, invoiceLines }) {
    // Build monthly cost and income data from raw lines
    const monthlyMap = new Map()
    for (const l of costLines) {
      if (!l.date) continue
      const key = l.date.slice(0, 7)
      if (!monthlyMap.has(key)) monthlyMap.set(key, { costs: 0, income: 0 })
      monthlyMap.get(key).costs += l.amount || 0
    }
    for (const inv of invoiceLines) {
      if (!inv.date) continue
      const key = inv.date.slice(0, 7)
      if (!monthlyMap.has(key)) monthlyMap.set(key, { costs: 0, income: 0 })
      // Use gross invoiced (inc retention)
      monthlyMap.get(key).income += inv.total || 0
    }
    const months = Array.from(monthlyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, val]) => ({
        label: new Date(key + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
        costs: val.costs,
        income: val.income
      }))

    if (months.length === 0) return <div style={{ textAlign: 'center', color: '#888', padding: 20 }}>No data yet</div>

    const maxVal = Math.max(...months.map(m => Math.max(m.costs, m.income)), 1)
    const w = 500, h = 140, padL = 48, padB = 28, padT = 20, padR = 12
    const chartW = w - padL - padR
    const chartH = h - padT - padB
    const slotW = chartW / months.length
    const barW = Math.max(4, Math.min(16, slotW / 2 - 3))
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({ val: t * maxVal, y: padT + chartH - t * chartH }))

    return (
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
        {/* Grid lines + y axis labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={w - padR} y2={t.y} stroke="#f0f0f0" strokeWidth={1} />
            <text x={padL - 5} y={t.y + 4} textAnchor="end" fontSize={8} fill="#bbb">
              {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', notation: 'compact', maximumFractionDigits: 0 }).format(t.val)}
            </text>
          </g>
        ))}
        {/* Bars */}
        {months.map((m, i) => {
          const cx = padL + i * slotW + slotW / 2
          const costsH = Math.max((m.costs / maxVal) * chartH, m.costs > 0 ? 2 : 0)
          const incomeH = Math.max((m.income / maxVal) * chartH, m.income > 0 ? 2 : 0)
          const costsY = padT + chartH - costsH
          const incomeY = padT + chartH - incomeH
          return (
            <g key={i}>
              <rect x={cx - barW - 1} y={costsY} width={barW} height={costsH} rx={2} fill="#e63946" opacity={0.85} />
              <rect x={cx + 1} y={incomeY} width={barW} height={incomeH} rx={2} fill="#16a34a" opacity={0.85} />
              <text x={cx} y={padT + chartH + 14} textAnchor="middle" fontSize={8} fill="#888">{m.label}</text>
            </g>
          )
        })}
        {/* Axis */}
        <line x1={padL} y1={padT + chartH} x2={w - padR} y2={padT + chartH} stroke="#e0e0e0" strokeWidth={1} />
      </svg>
    )
  }

  function TrendLine({ data }) {
    if (!data || data.length < 2) return <div style={{ textAlign: 'center', color: '#888', padding: '20px 0', fontSize: 13 }}>Not enough historical data yet</div>
    const margins = data.map(d => d.margin || 0)
    const minM = Math.min(...margins, 0), maxM = Math.max(...margins, 0.3)
    const range = maxM - minM || 0.1
    const w = 400, h = 120, pad = 30
    const points = data.map((d, i) => ({ x: pad + (i / (data.length - 1)) * (w - pad * 2), y: h - pad - ((d.margin || 0) - minM) / range * (h - pad * 2), ...d }))
    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    const y25 = h - pad - (0.25 - minM) / range * (h - pad * 2)
    const y21 = h - pad - (0.21 - minM) / range * (h - pad * 2)
    return (
      <svg width="100%" viewBox={`0 0 ${w} ${h + 20}`}>
        {y25 > pad && y25 < h - pad && <line x1={pad} y1={y25} x2={w - pad} y2={y25} stroke="#16a34a" strokeWidth={1} strokeDasharray="4,3" opacity={0.5} />}
        {y21 > pad && y21 < h - pad && <line x1={pad} y1={y21} x2={w - pad} y2={y21} stroke="#ca8a04" strokeWidth={1} strokeDasharray="4,3" opacity={0.5} />}
        <path d={pathD} fill="none" stroke="#1a1a2e" strokeWidth={2} />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={4} fill={marginColor(p.margin)} stroke="#fff" strokeWidth={2} />
            <text x={p.x} y={h + 14} textAnchor="middle" fontSize={9} fill="#888">{p.label}</text>
            <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={9} fill={marginColor(p.margin)} fontWeight="600">{p.margin != null ? (p.margin * 100).toFixed(0) + '%' : ''}</text>
          </g>
        ))}
        <text x={pad - 4} y={y25 + 4} textAnchor="end" fontSize={8} fill="#16a34a">25%</text>
        {y21 !== y25 && <text x={pad - 4} y={y21 + 4} textAnchor="end" fontSize={8} fill="#ca8a04">21%</text>}
      </svg>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 16, color: '#1a1a2e' }}>Budget vs Spend</div>
        <BarRow label="Labour" spent={labourSpent} budget={labourBudget} color="#16a34a" />
        <BarRow label="Materials" spent={materialsSpent} budget={materialsBudget} color="#ea7c28" />
        <BarRow label="Total" spent={totalSpent} budget={totalBudget} color="#6366f1" />
      </div>
      <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 16, color: '#1a1a2e' }}>Cost Breakdown</div>
        <Donut labour={labourSpent} materials={materialsSpent} />
      </div>
      <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#1a1a2e' }}>Monthly Costs vs Income</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555' }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#e63946', display: 'inline-block' }} />Costs</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555' }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#16a34a', display: 'inline-block' }} />Gross Income</span>
          </div>
        </div>
        <MonthlyChart costLines={costLines} invoiceLines={invoiceLines} />
      </div>
      <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#1a1a2e' }}>Margin Trend</div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>Monthly margin at valuation date</div>
        <TrendLine data={trendData} />
      </div>
      <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#1a1a2e' }}>Project Details</div>
        {[['Job number', p.jobNo], ['Project name', p.name], ['Customer', settings.customerName || '—'], ['Address', settings.address || '—'], ['Region', settings.region || '—'], ['Order ref', settings.orderRef || '—'], ['Status', p.status === 'INPROGRESS' ? 'In Progress' : 'Closed']].map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13 }}>
            <span style={{ color: '#888' }}>{label}</span>
            <span style={{ fontWeight: 500 }}>{value || '—'}</span>
          </div>
        ))}
      </div>
      <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#1a1a2e' }}>Team</div>
        {[['Contracts Manager', settings.contractsManager], ['Operations Manager', settings.operationsManager], ['Estimator', settings.estimator], ['Quantity Surveyor', settings.qsName]].map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13 }}>
            <span style={{ color: '#888' }}>{label}</span>
            <span style={{ fontWeight: 500 }}>{value || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CostsTab({ costLines, atDate, settings }) {
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  const [fromDate, setFromDate] = useState(twoYearsAgo.toISOString().split('T')[0])
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0])
  const [typeFilter, setTypeFilter] = useState('all')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [sortCol, setSortCol] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [expandedInvoice, setExpandedInvoice] = useState(null)

  const dateFiltered = costLines.filter(l => {
    if (!l.date) return false
    if (fromDate && l.date < fromDate) return false
    if (toDate && l.date > toDate) return false
    return true
  })
  const suppliers = [...new Set(dateFiltered.map(l => l.supplier).filter(Boolean))].sort()
  const accounts = [...new Set(dateFiltered.map(l => l.accountName).filter(Boolean))].sort()
  const filtered = dateFiltered.filter(l => {
    if (typeFilter !== 'all' && l.type !== typeFilter) return false
    if (supplierFilter && l.supplier !== supplierFilter) return false
    if (accountFilter && l.accountName !== accountFilter) return false
    return true
  })

  const invoiceMap = new Map()
  for (const line of filtered) {
    const key = `${line.date}|${line.supplier}|${line.reference || 'no-ref'}`
    if (!invoiceMap.has(key)) {
      invoiceMap.set(key, { key, date: line.date, supplier: line.supplier, reference: line.reference || '', type: line.type, accountName: line.accountName, accountCode: line.accountCode, lines: [], total: 0 })
    }
    const g = invoiceMap.get(key)
    g.lines.push(line)
    g.total += line.amount || 0
    if (g.lines.length > 1 && g.lines[0].type !== line.type) { g.type = 'Mixed'; g.accountName = 'Multiple' }
  }
  const invoices = Array.from(invoiceMap.values())

  const sorted = [...invoices].sort((a, b) => {
    let av, bv
    if (sortCol === 'date') { av = a.date; bv = b.date }
    else if (sortCol === 'supplier') { av = a.supplier; bv = b.supplier }
    else if (sortCol === 'reference') { av = a.reference; bv = b.reference }
    else if (sortCol === 'account') { av = a.accountName; bv = b.accountName }
    else if (sortCol === 'type') { av = a.type; bv = b.type }
    else if (sortCol === 'amount') { av = a.total; bv = b.total }
    else { av = a.date; bv = b.date }
    if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc' ? String(av || '').localeCompare(String(bv || '')) : String(bv || '').localeCompare(String(av || ''))
  })

  const filteredTotal = filtered.reduce((s, l) => s + (l.amount || 0), 0)
  const labourBudget = atDate.totalLabourBudget
  const materialsBudget = atDate.totalMaterialsBudget
  const totalBudget = atDate.totalBudget
  const labourSpend = atDate.labourToDate
  const materialsSpend = atDate.materialsToDate
  const totalSpend = atDate.costsToDate

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function BudgetRow({ label, spend, budget, color, filterVal }) {
    const pctUsed = budget > 0 ? Math.min((spend / budget) * 100, 100) : 0
    const remaining = budget - spend
    const over = spend > budget && budget > 0
    const isActive = typeFilter === filterVal
    return (
      <tr onClick={() => setTypeFilter(isActive ? 'all' : filterVal)} style={{ cursor: 'pointer', background: isActive ? '#f0f2ff' : 'transparent', borderBottom: '1px solid #f0f0f0' }}>
        <td style={{ padding: '10px 12px', fontWeight: 600, fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
            {label}
            {isActive && <span style={{ fontSize: 10, background: '#1a1a2e', color: '#fff', padding: '1px 6px', borderRadius: 10 }}>filtered</span>}
          </div>
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13 }}>{fmtC(spend)}</td>
        <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: '#888' }}>{budget > 0 ? fmtC(budget) : '—'}</td>
        <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: over ? '#e63946' : remaining > 0 ? '#16a34a' : '#888' }}>{budget > 0 ? fmtC(remaining) : '—'}</td>
        <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: over ? '#e63946' : pctUsed > 90 ? '#ca8a04' : '#16a34a' }}>{budget > 0 ? `${(100 - pctUsed).toFixed(0)}%` : '—'}</td>
        <td style={{ padding: '10px 12px', width: 160 }}>
          <div style={{ background: '#f0f0f0', borderRadius: 4, height: 8, overflow: 'hidden' }}>
            <div style={{ width: `${pctUsed}%`, background: over ? '#e63946' : color, height: '100%', borderRadius: 4 }} />
          </div>
          <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{budget > 0 ? `${pctUsed.toFixed(0)}% used` : '⚠ No budget set'}</div>
        </td>
      </tr>
    )
  }

  return (
    <div>
      <div style={{ background: '#fff', borderRadius: 10, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #eee' }}>
              {['Category', 'Spend', 'Budget', 'Remaining £', 'Remaining %', 'Progress'].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Category' || h === 'Progress' ? 'left' : 'right', fontWeight: 600, color: '#555', fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <BudgetRow label="Labour" spend={labourSpend} budget={labourBudget} color="#16a34a" filterVal="Labour" />
            <BudgetRow label="Materials" spend={materialsSpend} budget={materialsBudget} color="#ea7c28" filterVal="Materials" />
            <BudgetRow label="Total" spend={totalSpend} budget={totalBudget} color="#6366f1" filterVal="all" />
          </tbody>
        </table>
        <div style={{ padding: '6px 12px', fontSize: 11, color: '#888', borderTop: '1px solid #f0f0f0' }}>Click a row to filter transactions below</div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#666' }}>From:</span>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#666' }}>To:</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12 }} />
        </div>
        <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} style={{ padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, background: '#fff' }}>
          <option value="">All suppliers</option>
          {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={accountFilter} onChange={e => setAccountFilter(e.target.value)} style={{ padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, background: '#fff' }}>
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        {(typeFilter !== 'all' || supplierFilter || accountFilter) && (
          <button onClick={() => { setTypeFilter('all'); setSupplierFilter(''); setAccountFilter('') }} style={{ padding: '5px 10px', background: '#f0f2f5', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#555' }}>Clear filters</button>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '8px 12px', background: '#f8f8f8', borderRadius: 8 }}>
        <span style={{ fontSize: 12, color: '#555' }}>
          <strong>{sorted.length}</strong> invoices · <strong>{filtered.length}</strong> line items
          {typeFilter !== 'all' && <span style={{ color: '#6366f1' }}> · {typeFilter} only</span>}
          {supplierFilter && <span style={{ color: '#6366f1' }}> · {supplierFilter}</span>}
          {accountFilter && <span style={{ color: '#6366f1' }}> · {accountFilter}</span>}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>Total: {fmtC(filteredTotal)}</span>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #eee' }}>
              <th style={{ width: 32 }} />
              {[{ label: 'Date', col: 'date' }, { label: 'Supplier', col: 'supplier' }, { label: 'Invoice Number', col: 'reference' }, { label: 'Account', col: 'account' }, { label: 'Type', col: 'type' }, { label: 'Amount', col: 'amount' }].map(({ label, col }) => (
                <th key={col} onClick={() => handleSort(col)} style={{ padding: '9px 12px', textAlign: col === 'amount' ? 'right' : 'left', fontWeight: 600, color: '#555', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  {label}{sortCol === col ? <span style={{ fontSize: 9, marginLeft: 3 }}>{sortDir === 'asc' ? '↑' : '↓'}</span> : <span style={{ fontSize: 9, marginLeft: 3, color: '#ccc' }}>↕</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#888' }}>No transactions found for selected filters</td></tr>
            ) : sorted.map((inv, i) => (
              <React.Fragment key={inv.key}>
                <tr onClick={() => setExpandedInvoice(expandedInvoice === inv.key ? null : inv.key)} style={{ borderBottom: expandedInvoice === inv.key ? 'none' : '1px solid #f5f5f5', background: expandedInvoice === inv.key ? '#f0f4ff' : i % 2 === 0 ? '#fff' : '#fafafa', cursor: inv.lines.length > 1 ? 'pointer' : 'default' }}>
                  <td style={{ padding: '8px 8px', textAlign: 'center', color: '#aaa', fontSize: 10 }}>{inv.lines.length > 1 && (expandedInvoice === inv.key ? '▼' : '▶')}</td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{inv.date || '—'}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 500 }}>{inv.supplier || '—'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: '#555' }}>{inv.reference || '—'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#888' }}>{inv.accountCode}</span>
                    <span style={{ marginLeft: 6, fontSize: 12, color: '#555' }}>{inv.accountName}</span>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 20, background: inv.type === 'Labour' ? '#f0fdf4' : inv.type === 'Materials' ? '#fff7ed' : '#f0f2f5', color: inv.type === 'Labour' ? '#16a34a' : inv.type === 'Materials' ? '#ea7c28' : '#555' }}>{inv.type}</span>
                    {inv.lines.length > 1 && <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>{inv.lines.length} lines</span>}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtC(inv.total)}</td>
                </tr>
                {expandedInvoice === inv.key && inv.lines.map((line, li) => (
                  <tr key={li} style={{ background: '#eef2ff', borderBottom: li === inv.lines.length - 1 ? '2px solid #c7d2fe' : '1px solid #dde4ff' }}>
                    <td />
                    <td style={{ padding: '6px 12px', color: '#888', fontSize: 12 }}>{line.date}</td>
                    <td colSpan={2} style={{ padding: '6px 12px', color: '#555', fontSize: 12 }}>{line.description}</td>
                    <td style={{ padding: '6px 12px', fontSize: 11 }}>
                      <span style={{ fontFamily: 'monospace', color: '#888' }}>{line.accountCode}</span>
                      <span style={{ marginLeft: 6, color: '#aaa' }}>{line.accountName}</span>
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 10, background: line.type === 'Labour' ? '#f0fdf4' : '#fff7ed', color: line.type === 'Labour' ? '#16a34a' : '#ea7c28' }}>{line.type}</span>
                    </td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 12, color: '#555' }}>{fmtC(line.amount)}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}

function IncomeTab({ invoiceLines, atDate }) {
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  const [fromDate, setFromDate] = useState(twoYearsAgo.toISOString().split('T')[0])
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0])

  const filtered = invoiceLines.filter(inv => {
    if (!inv.date) return false
    if (fromDate && inv.date < fromDate) return false
    if (toDate && inv.date > toDate) return false
    return true
  })
  const sorted = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const filteredTotal = filtered.reduce((s, i) => s + (i.total || 0), 0)

  const monthlyMap = new Map()
  for (const inv of filtered) {
    if (!inv.date) continue
    const monthKey = inv.date.slice(0, 7)
    monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + (inv.total || 0))
  }
  const monthlyData = Array.from(monthlyMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([key, value]) => ({ key, label: new Date(key + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), value }))
  const maxVal = Math.max(...monthlyData.map(d => d.value), 1)
  const w = 420, h = 140, padL = 50, padB = 28, padT = 24, padR = 16
  const chartW = w - padL - padR
  const chartH = h - padT - padB
  const barW = Math.max(8, Math.min(32, chartW / (monthlyData.length || 1) - 6))
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({ val: t * maxVal, y: padT + chartH - t * chartH }))

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#666' }}>From:</span>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#666' }}>To:</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12 }} />
        </div>
        <span style={{ fontSize: 12, color: '#888' }}>{filtered.length} invoices · {fmtC(filteredTotal)} total</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 16, marginBottom: 16 }}>
        <div style={{ background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#1a1a2e' }}>Monthly Invoicing</div>
          {monthlyData.length > 0 ? (
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
              {yTicks.map((t, i) => (
                <g key={i}>
                  <line x1={padL} y1={t.y} x2={w - padR} y2={t.y} stroke="#f0f0f0" strokeWidth={1} />
                  <text x={padL - 6} y={t.y + 4} textAnchor="end" fontSize={8} fill="#aaa">{new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', notation: 'compact', maximumFractionDigits: 0 }).format(t.val)}</text>
                </g>
              ))}
              {monthlyData.map((d, i) => {
                const slotW = chartW / monthlyData.length
                const x = padL + i * slotW + (slotW - barW) / 2
                const barH2 = Math.max((d.value / maxVal) * chartH, 2)
                const y = padT + chartH - barH2
                const isLatest = i === monthlyData.length - 1
                return (
                  <g key={i}>
                    <rect x={x} y={y} width={barW} height={barH2} rx={3} fill={isLatest ? '#1a1a2e' : '#16a34a'} opacity={0.9} />
                    {barH2 > 20
                      ? <text x={x + barW / 2} y={y + barH2 / 2 + 4} textAnchor="middle" fontSize={8} fill="#fff" fontWeight="600">{new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', notation: 'compact', maximumFractionDigits: 0 }).format(d.value)}</text>
                      : <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={8} fill="#555" fontWeight="600">{new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', notation: 'compact', maximumFractionDigits: 0 }).format(d.value)}</text>
                    }
                    <text x={x + barW / 2} y={padT + chartH + 14} textAnchor="middle" fontSize={8} fill="#888">{d.label}</text>
                  </g>
                )
              })}
              <line x1={padL} y1={padT + chartH} x2={w - padR} y2={padT + chartH} stroke="#e0e0e0" strokeWidth={1} />
            </svg>
          ) : <div style={{ textAlign: 'center', color: '#888', padding: 20 }}>No data</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'Total Invoiced', value: atDate.invoicedToDate, color: '#16a34a' },
            { label: 'Retention Held', value: atDate.retention, color: '#ca8a04' },
            { label: 'Gross Invoiced', value: atDate.grossInvoiced, color: '#1a1a2e' },
          ].map(card => (
            <div key={card.label} style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', flex: 1 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{card.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: card.color }}>{fmtC(card.value)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #eee' }}>
              {['Date', 'Invoice No', 'Reference', 'Contact', 'Amount', 'Status'].map(h => (
                <th key={h} style={{ padding: '9px 12px', textAlign: h === 'Amount' ? 'right' : 'left', fontWeight: 600, color: '#555' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#888' }}>No invoices found for selected date range</td></tr>
            ) : sorted.map((inv, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>{inv.date || '—'}</td>
                <td style={{ padding: '7px 12px', fontFamily: 'monospace', fontSize: 12 }}>{inv.invoiceNumber || '—'}</td>
                <td style={{ padding: '7px 12px', color: '#555' }}>{inv.reference || '—'}</td>
                <td style={{ padding: '7px 12px', color: '#555' }}>{inv.contact || '—'}</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 500, color: '#16a34a' }}>{fmtC(inv.total)}</td>
                <td style={{ padding: '7px 12px' }}>
                  <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: inv.status === 'Paid' ? '#f0fdf4' : '#fefce8', color: inv.status === 'Paid' ? '#16a34a' : '#ca8a04', fontWeight: 600 }}>{inv.status || '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function WipTab({ costLines, invoiceLines, settings, pastVDates, selectedVDate, id, onSettingsSaved }) {
  const [wipVDate, setWipVDate] = useState(selectedVDate)
  const [typeFilter, setTypeFilter] = useState('all')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [sortCol, setSortCol] = useState('date')
  const [sortDir, setSortDir] = useState('asc')
  const [expandedInvoice, setExpandedInvoice] = useState(null)
  const [marginOverride, setMarginOverride] = useState(settings.wipMarginOverride || '')
  const [savingMargin, setSavingMargin] = useState(false)
  const [adjustments, setAdjustments] = useState([])
  const [adjForm, setAdjForm] = useState({ type: 'Cost', description: '', amount: '' })
  const [adjMonth, setAdjMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [savingAdj, setSavingAdj] = useState(false)

  React.useEffect(() => { if (selectedVDate && !wipVDate) setWipVDate(selectedVDate) }, [selectedVDate])

  React.useEffect(() => { loadAdjustments() }, [id])

  async function loadAdjustments() {
    try {
      const res = await fetch(`/api/project/${id}/wip-adjustments`)
      const data = await res.json()
      setAdjustments(data.adjustments || [])
    } catch {}
  }

  async function addAdjustment() {
    if (!adjForm.amount || !adjForm.description) return
    setSavingAdj(true)
    try {
      const res = await fetch(`/api/project/${id}/wip-adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...adjForm, month: adjMonth })
      })
      const data = await res.json()
      setAdjustments(data.adjustments || [])
      setAdjForm({ type: 'Cost', description: '', amount: '' })
    } catch {}
    setSavingAdj(false)
  }

  async function deleteAdjustment(adjId) {
    try {
      const res = await fetch(`/api/project/${id}/wip-adjustments`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjId })
      })
      const data = await res.json()
      setAdjustments(data.adjustments || [])
    } catch {}
  }

  const vDateStr = wipVDate ? new Date(wipVDate.getTime() - wipVDate.getTimezoneOffset() * 60000).toISOString().split('T')[0] : null

  const endOfMonth = new Date()
  endOfMonth.setMonth(endOfMonth.getMonth() + 1, 0)
  const toDateStr = endOfMonth.toISOString().split('T')[0]

  const atVDate = calcAtDate(costLines, invoiceLines, wipVDate, settings)
  const effectiveMargin = marginOverride ? parseFloat(marginOverride) / 100 : atVDate.margin

  const dateFiltered = costLines.filter(l => {
    if (!l.date || !vDateStr) return false
    if (l.date <= vDateStr) return false
    if (l.date > toDateStr) return false
    return true
  })

  const suppliers = [...new Set(dateFiltered.map(l => l.supplier).filter(Boolean))].sort()
  const accounts = [...new Set(dateFiltered.map(l => l.accountName).filter(Boolean))].sort()

  const filtered = dateFiltered.filter(l => {
    if (typeFilter !== 'all' && l.type !== typeFilter) return false
    if (supplierFilter && l.supplier !== supplierFilter) return false
    if (accountFilter && l.accountName !== accountFilter) return false
    return true
  })

  const invoiceMap = new Map()
  for (const line of filtered) {
    const key = `${line.date}|${line.supplier}|${line.reference || 'no-ref'}`
    if (!invoiceMap.has(key)) {
      invoiceMap.set(key, { key, date: line.date, supplier: line.supplier, reference: line.reference || '', type: line.type, accountName: line.accountName, accountCode: line.accountCode, lines: [], total: 0 })
    }
    const g = invoiceMap.get(key)
    g.lines.push(line)
    g.total += line.amount || 0
    if (g.lines.length > 1 && g.lines[0].type !== line.type) { g.type = 'Mixed'; g.accountName = 'Multiple' }
  }
  const invoices = Array.from(invoiceMap.values())

  const sorted = [...invoices].sort((a, b) => {
    let av, bv
    if (sortCol === 'date') { av = a.date; bv = b.date }
    else if (sortCol === 'supplier') { av = a.supplier; bv = b.supplier }
    else if (sortCol === 'reference') { av = a.reference; bv = b.reference }
    else if (sortCol === 'account') { av = a.accountName; bv = b.accountName }
    else if (sortCol === 'type') { av = a.type; bv = b.type }
    else if (sortCol === 'amount') { av = a.total; bv = b.total }
    else { av = a.date; bv = b.date }
    if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc' ? String(av || '').localeCompare(String(bv || '')) : String(bv || '').localeCompare(String(av || ''))
  })

  const postValTotal = dateFiltered.reduce((s, l) => s + (l.amount || 0), 0)
  const filteredTotal = filtered.reduce((s, l) => s + (l.amount || 0), 0)

  // Adjustments for the currently selected WIP month
  const wipMonthKey = wipVDate
    ? `${wipVDate.getFullYear()}-${String(wipVDate.getMonth() + 1).padStart(2, '0')}`
    : null
  const monthAdjustments = wipMonthKey
    ? adjustments.filter(a => a.month === wipMonthKey)
    : []
  const adjCostTotal = monthAdjustments.filter(a => a.type === 'Cost').reduce((s, a) => s + a.amount, 0)
  const adjInvoiceTotal = monthAdjustments.filter(a => a.type === 'Invoice').reduce((s, a) => s + a.amount, 0)
  const adjustedPostValCosts = postValTotal + adjCostTotal
  const wipValue = effectiveMargin != null && effectiveMargin < 1 && adjustedPostValCosts > 0 ? adjustedPostValCosts / (1 - effectiveMargin) : 0

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  async function saveMarginOverride(val) {
    setSavingMargin(true)
    const v = val !== undefined ? val : marginOverride
    const newSettings = { ...settings, wipMarginOverride: v || null }
    await fetch(`/api/project/${id}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSettings) })
    if (onSettingsSaved) onSettingsSaved()
    setSavingMargin(false)
  }

  const vDateLabel = wipVDate ? wipVDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not set'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, background: '#fff', borderRadius: 10, padding: '12px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <span style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>WIP from valuation date:</span>
        <select value={wipVDate ? wipVDate.toISOString() : ''} onChange={e => { setWipVDate(e.target.value ? new Date(e.target.value) : null); setExpandedInvoice(null) }} style={{ padding: '6px 12px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, background: '#fff' }}>
          <option value="">— Select valuation date —</option>
          {(pastVDates || []).map(d => (
            <option key={d.toISOString()} value={d.toISOString()}>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: '#888' }}>Showing costs after {vDateLabel} to end of month</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div style={{ background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Post-Valuation Costs</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#2563eb' }}>{fmtC(postValTotal)}</div>
          <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>after {vDateLabel}</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>WIP Value</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a' }}>{fmtC(wipValue)}</div>
          <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>costs / (1 - {effectiveMargin != null ? (effectiveMargin * 100).toFixed(1) + '%' : '—'})</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Margin Override</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: marginColor(effectiveMargin) }}>{effectiveMargin != null ? (effectiveMargin * 100).toFixed(1) + '%' : '—'}</div>
            <div style={{ fontSize: 10, color: '#888' }}>{marginOverride ? 'override' : 'auto'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" min="0" max="100" step="0.1" value={marginOverride} onChange={e => setMarginOverride(e.target.value)} placeholder={atVDate.margin != null ? `Auto: ${(atVDate.margin * 100).toFixed(1)}%` : 'Auto'} style={{ width: 80, padding: '4px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12 }} />
            <span style={{ fontSize: 11, color: '#888' }}>%</span>
            <button onClick={() => saveMarginOverride()} disabled={savingMargin} style={{ padding: '4px 10px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>{savingMargin ? '...' : 'Save'}</button>
            {marginOverride && <button onClick={() => { setMarginOverride(''); saveMarginOverride('') }} style={{ padding: '4px 8px', background: '#f0f2f5', color: '#555', border: 'none', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>Clear</button>}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} style={{ padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, background: '#fff' }}>
          <option value="">All suppliers</option>
          {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={accountFilter} onChange={e => setAccountFilter(e.target.value)} style={{ padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, background: '#fff' }}>
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <button onClick={() => setTypeFilter(typeFilter === 'Labour' ? 'all' : 'Labour')} style={{ padding: '5px 10px', background: typeFilter === 'Labour' ? '#f0fdf4' : '#f0f2f5', border: `1px solid ${typeFilter === 'Labour' ? '#16a34a' : '#ddd'}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', color: typeFilter === 'Labour' ? '#16a34a' : '#555' }}>Labour</button>
        <button onClick={() => setTypeFilter(typeFilter === 'Materials' ? 'all' : 'Materials')} style={{ padding: '5px 10px', background: typeFilter === 'Materials' ? '#fff7ed' : '#f0f2f5', border: `1px solid ${typeFilter === 'Materials' ? '#ea7c28' : '#ddd'}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', color: typeFilter === 'Materials' ? '#ea7c28' : '#555' }}>Materials</button>
        {(typeFilter !== 'all' || supplierFilter || accountFilter) && (
          <button onClick={() => { setTypeFilter('all'); setSupplierFilter(''); setAccountFilter('') }} style={{ padding: '5px 10px', background: '#f0f2f5', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#555' }}>Clear</button>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '8px 12px', background: '#f8f8f8', borderRadius: 8 }}>
        <span style={{ fontSize: 12, color: '#555' }}><strong>{sorted.length}</strong> invoices · <strong>{filtered.length}</strong> line items</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>Total: {fmtC(filteredTotal)}</span>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #eee' }}>
              <th style={{ width: 32 }} />
              {[{ label: 'Date', col: 'date' }, { label: 'Supplier', col: 'supplier' }, { label: 'Invoice Number', col: 'reference' }, { label: 'Account', col: 'account' }, { label: 'Type', col: 'type' }, { label: 'Amount', col: 'amount' }].map(({ label, col }) => (
                <th key={col} onClick={() => handleSort(col)} style={{ padding: '9px 12px', textAlign: col === 'amount' ? 'right' : 'left', fontWeight: 600, color: '#555', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  {label}{sortCol === col ? <span style={{ fontSize: 9, marginLeft: 3 }}>{sortDir === 'asc' ? '↑' : '↓'}</span> : <span style={{ fontSize: 9, marginLeft: 3, color: '#ccc' }}>↕</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#888' }}>No post-valuation costs found for this period</td></tr>
            ) : sorted.map((inv, i) => (
              <React.Fragment key={inv.key}>
                <tr onClick={() => setExpandedInvoice(expandedInvoice === inv.key ? null : inv.key)} style={{ borderBottom: expandedInvoice === inv.key ? 'none' : '1px solid #f5f5f5', background: expandedInvoice === inv.key ? '#f0f4ff' : i % 2 === 0 ? '#fff' : '#fafafa', cursor: inv.lines.length > 1 ? 'pointer' : 'default' }}>
                  <td style={{ padding: '8px 8px', textAlign: 'center', color: '#aaa', fontSize: 10 }}>{inv.lines.length > 1 && (expandedInvoice === inv.key ? '▼' : '▶')}</td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{inv.date || '—'}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 500 }}>{inv.supplier || '—'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: '#555' }}>{inv.reference || '—'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#888' }}>{inv.accountCode}</span>
                    <span style={{ marginLeft: 6, fontSize: 12, color: '#555' }}>{inv.accountName}</span>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 20, background: inv.type === 'Labour' ? '#f0fdf4' : inv.type === 'Materials' ? '#fff7ed' : '#f0f2f5', color: inv.type === 'Labour' ? '#16a34a' : inv.type === 'Materials' ? '#ea7c28' : '#555' }}>{inv.type}</span>
                    {inv.lines.length > 1 && <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>{inv.lines.length} lines</span>}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtC(inv.total)}</td>
                </tr>
                {expandedInvoice === inv.key && inv.lines.map((line, li) => (
                  <tr key={li} style={{ background: '#eef2ff', borderBottom: li === inv.lines.length - 1 ? '2px solid #c7d2fe' : '1px solid #dde4ff' }}>
                    <td />
                    <td style={{ padding: '6px 12px', color: '#888', fontSize: 12 }}>{line.date}</td>
                    <td colSpan={2} style={{ padding: '6px 12px', color: '#555', fontSize: 12 }}>{line.description}</td>
                    <td style={{ padding: '6px 12px', fontSize: 11 }}>
                      <span style={{ fontFamily: 'monospace', color: '#888' }}>{line.accountCode}</span>
                      <span style={{ marginLeft: 6, color: '#aaa' }}>{line.accountName}</span>
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 10, background: line.type === 'Labour' ? '#f0fdf4' : '#fff7ed', color: line.type === 'Labour' ? '#16a34a' : '#ea7c28' }}>{line.type}</span>
                    </td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 12, color: '#555' }}>{fmtC(line.amount)}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>


      {/* ── Manual WIP Adjustments ── */}
      <div style={{ marginTop: 24, background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Manual Adjustments</h3>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#888' }}>One-off cost or invoice adjustments for a specific month only — never carried forward</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#666' }}>Month:</span>
            <select value={adjMonth} onChange={e => setAdjMonth(e.target.value)}
              style={{ padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12 }}>
              {Array.from({ length: 24 }, (_, i) => {
                const d = new Date()
                d.setMonth(d.getMonth() - i)
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                const label = d.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
                return <option key={key} value={key}>{label}</option>
              })}
            </select>
          </div>
        </div>

        {adjustments.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
            <thead>
              <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
                {['Month', 'Type', 'Description', 'Amount', ''].map(h => (
                  <th key={h} style={{ padding: '7px 10px', textAlign: h === 'Amount' ? 'right' : 'left', fontWeight: 600, color: '#555', fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...adjustments].sort((a, b) => b.month.localeCompare(a.month)).map(adj => (
                <tr key={adj.id} style={{ borderBottom: '1px solid #f0f0f0', background: adj.month === wipMonthKey ? '#fffbeb' : 'inherit' }}>
                  <td style={{ padding: '7px 10px', color: '#555' }}>
                    {adj.month === wipMonthKey && <span style={{ marginRight: 4, fontSize: 9, background: '#fde68a', color: '#92400e', borderRadius: 4, padding: '1px 4px', fontWeight: 600 }}>CURRENT</span>}
                    {new Date(adj.month + '-01').toLocaleString('en-GB', { month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, background: adj.type === 'Cost' ? '#fff7ed' : '#f0fdf4', color: adj.type === 'Cost' ? '#c2410c' : '#15803d' }}>{adj.type}</span>
                  </td>
                  <td style={{ padding: '7px 10px', color: '#333' }}>{adj.description}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: adj.amount >= 0 ? '#333' : '#e63946' }}>{fmtC(adj.amount)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                    <button onClick={() => deleteAdjustment(adj.id)} style={{ background: 'none', border: 'none', color: '#e63946', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#f8f9fa', borderRadius: 8, padding: '10px 12px' }}>
          <select value={adjForm.type} onChange={e => setAdjForm({ ...adjForm, type: e.target.value })}
            style={{ padding: '6px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, width: 90 }}>
            <option value="Cost">Cost</option>
            <option value="Invoice">Invoice</option>
          </select>
          <input placeholder="Description" value={adjForm.description} onChange={e => setAdjForm({ ...adjForm, description: e.target.value })}
            style={{ flex: 1, padding: '6px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12 }} />
          <input placeholder="Amount (£)" type="number" value={adjForm.amount} onChange={e => setAdjForm({ ...adjForm, amount: e.target.value })}
            style={{ width: 120, padding: '6px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12 }}
            onKeyDown={e => e.key === 'Enter' && addAdjustment()} />
          <button onClick={addAdjustment} disabled={savingAdj || !adjForm.description || !adjForm.amount}
            style={{ padding: '6px 14px', background: (!adjForm.description || !adjForm.amount) ? '#ddd' : '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: (!adjForm.description || !adjForm.amount) ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
            {savingAdj ? 'Saving...' : `+ Add to ${adjMonth}`}
          </button>
        </div>

        {monthAdjustments.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 16, fontSize: 12 }}>
            <span style={{ color: '#888' }}>Adjustments for {new Date(adjMonth + '-01').toLocaleString('en-GB', { month: 'long', year: 'numeric' })}:</span>
            {adjCostTotal !== 0 && <span style={{ color: '#c2410c', fontWeight: 600 }}>Costs: {fmtC(adjCostTotal)}</span>}
            {adjInvoiceTotal !== 0 && <span style={{ color: '#15803d', fontWeight: 600 }}>Invoices: {fmtC(adjInvoiceTotal)}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function RetentionTab({ p, settings, atDate }) {
  const totalRetention = atDate.retention
  const firstRelease = totalRetention / 2
  const secondRelease = totalRetention / 2
  const now = new Date()
  const pc1 = settings.pcDate ? new Date(settings.pcDate) : null
  const pc2 = settings.defectsDate ? new Date(settings.defectsDate) : null
  const released = (pc1 && pc1 <= now ? firstRelease : 0) + (pc2 && pc2 <= now ? secondRelease : 0)
  const outstanding = totalRetention - released
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[{ label: `Total retention (${((parseFloat(settings.retentionPct || 0)) * 100).toFixed(0)}%)`, value: totalRetention }, { label: 'Released', value: released, color: '#16a34a' }, { label: 'Outstanding', value: outstanding, color: outstanding > 0 ? '#ca8a04' : '#888' }].map(card => (
          <div key={card.label} style={{ background: '#fff', borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: '#888' }}>{card.label}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: card.color || '#1a1a2e' }}>{fmtC(card.value)}</div>
          </div>
        ))}
      </div>
      <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              {['Release', 'Amount', 'Release date', 'Status'].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#555' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[{ label: '1st half — on PC', amount: firstRelease, date: pc1, released: pc1 && pc1 <= now }, { label: '2nd half — after defects', amount: secondRelease, date: pc2, released: pc2 && pc2 <= now }].map((row, i) => (
              <tr key={i} style={{ borderBottom: i === 0 ? '1px solid #f5f5f5' : 'none' }}>
                <td style={{ padding: '9px 12px' }}>{row.label}</td>
                <td style={{ padding: '9px 12px', fontWeight: 500 }}>{fmtC(row.amount)}</td>
                <td style={{ padding: '9px 12px' }}>{row.date ? row.date.toLocaleDateString('en-GB') : '⚠ Not set'}</td>
                <td style={{ padding: '9px 12px' }}>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: row.released ? '#f0fdf4' : '#fef9c3', color: row.released ? '#16a34a' : '#ca8a04', fontWeight: 600 }}>{row.released ? 'Released' : 'Pending'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DetailsForm({ form, setForm, addVariation, updateVariation, removeVariation, afa, currentMargin, teamMembers, onAddMember, onRemoveMember }) {
  const f = (field) => (e) => setForm({ ...form, [field]: e.target.value })
  const [showDateOverrides, setShowDateOverrides] = React.useState(false)
  const inputStyle = { width: '100%', padding: '7px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }
  const labelStyle = { fontSize: 11, color: '#888', marginBottom: 2, display: 'block' }
  const sectionStyle = { marginBottom: 20 }
  const headingStyle = { fontSize: 12, fontWeight: 700, color: '#1a1a2e', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #eee', textTransform: 'uppercase', letterSpacing: '0.05em' }
  const byRole = (role) => teamMembers.filter(m => m.role === role).map(m => m.name)

  return (
    <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: 8 }}>
      <div style={sectionStyle}>
        <div style={headingStyle}>Financial</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 8 }}>
          <div>
            <label style={labelStyle}>Application day of month</label>
            <input type="number" min="1" max="31" value={form.applicationDay || ''} onChange={f('applicationDay')} style={inputStyle} placeholder="e.g. 25" />
          </div>
          <div>
            <label style={labelStyle}>Valuation day of month</label>
            <input type="number" min="1" max="31" value={form.valuationDay || ''} onChange={f('valuationDay')} style={inputStyle} placeholder="e.g. 28" />
          </div>
          <div>
            <label style={labelStyle}>Payment day of month</label>
            <input type="number" min="1" max="31" value={form.paymentDay || ''} onChange={f('paymentDay')} style={inputStyle} placeholder="e.g. 14" />
          </div>
        </div>
        <button type="button" onClick={() => setShowDateOverrides(!showDateOverrides)}
          style={{ fontSize: 12, padding: '5px 12px', border: '1px solid #e5e5e5', borderRadius: 6, background: '#f8f9fa', cursor: 'pointer', marginBottom: 12, fontFamily: 'inherit', color: '#555' }}>
          {showDateOverrides ? '▲ Hide' : '▼ Show'} monthly date overrides (12 months ahead)
        </button>
        {showDateOverrides && (
          <div style={{ marginBottom: 12, border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e5e5', fontWeight: 600, color: '#555' }}>Month</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e5e5', fontWeight: 600, color: '#555' }}>Application Date</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e5e5', fontWeight: 600, color: '#555' }}>Valuation Date</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e5e5', fontWeight: 600, color: '#555' }}>Payment Date</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 12 }, (_, i) => {
                  const d = new Date()
                  d.setDate(1)
                  d.setMonth(d.getMonth() + i)
                  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                  const label = d.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
                  const overrides = form.dateOverrides || {}
                  const row = overrides[key] || {}
                  return (
                    <tr key={key} style={{ borderBottom: '0.5px solid #f0f0f0' }}>
                      <td style={{ padding: '6px 10px', fontWeight: 500, color: '#1a1a2e', whiteSpace: 'nowrap' }}>{label}</td>
                      {['applicationDate', 'valuationDate', 'paymentDate'].map(field => (
                        <td key={field} style={{ padding: '4px 8px' }}>
                          <input type="date" value={row[field] || ''}
                            onChange={e => {
                              const newOverrides = { ...overrides, [key]: { ...row, [field]: e.target.value || undefined } }
                              // Clean up empty rows
                              if (!newOverrides[key].applicationDate && !newOverrides[key].valuationDate && !newOverrides[key].paymentDate) delete newOverrides[key]
                              setForm({ ...form, dateOverrides: newOverrides })
                            }}
                            style={{ fontSize: 11, padding: '3px 6px', border: '1px solid #e5e5e5', borderRadius: 4, fontFamily: 'inherit', width: '100%' }} />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <label style={labelStyle}>Original contract value (£)</label>
        <input type="number" value={form.contractValue || ''} onChange={f('contractValue')} style={inputStyle} placeholder="0.00" />
        <label style={labelStyle}>Labour budget (£)</label>
        <input type="number" value={form.labourBudget || ''} onChange={f('labourBudget')} style={inputStyle} placeholder="0.00" />
        <label style={labelStyle}>Materials budget (£)</label>
        <input type="number" value={form.materialsBudget || ''} onChange={f('materialsBudget')} style={inputStyle} placeholder="0.00" />
        <label style={labelStyle}>WIP margin override % (optional)</label>
        <input type="number" min="0" max="100" step="0.1" value={form.wipMarginOverride || ''} onChange={f('wipMarginOverride')} style={inputStyle} placeholder={currentMargin ? `Leave blank to use current (${(currentMargin * 100).toFixed(1)}%)` : 'Leave blank to use current margin'} />
      </div>
      <div style={sectionStyle}>
        <div style={headingStyle}>Variations</div>
        {(form.variations || []).map((v, i) => {
          const total = parseFloat(v.materials || 0) + parseFloat(v.labour || 0) + parseFloat(v.profit || 0)
          return (
            <div key={i} style={{ background: '#f8f8f8', borderRadius: 8, padding: '10px 12px', marginBottom: 10, border: '1px solid #eee' }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                <input value={v.varNumber || ''} onChange={e => updateVariation(i, 'varNumber', e.target.value)} placeholder="V01" style={{ ...inputStyle, marginBottom: 0, width: 70, flexShrink: 0 }} />
                <input value={v.description || ''} onChange={e => updateVariation(i, 'description', e.target.value)} placeholder="Variation description" style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
                <select value={v.instructed ? 'yes' : 'no'} onChange={e => updateVariation(i, 'instructed', e.target.value === 'yes')} style={{ ...inputStyle, marginBottom: 0, width: 130 }}>
                  <option value="yes">Instructed</option>
                  <option value="no">Not instructed</option>
                </select>
                <button onClick={() => removeVariation(i)} style={{ background: '#fee2e2', color: '#e63946', border: 'none', borderRadius: 6, padding: '7px 10px', cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
                {[['Materials', 'materials'], ['Labour', 'labour'], ['Profit', 'profit']].map(([label, key]) => (
                  <div key={key}>
                    <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>{label} (£)</div>
                    <input type="number" value={v[key] || ''} onChange={e => updateVariation(i, key, e.target.value)} placeholder="0.00" style={{ ...inputStyle, marginBottom: 0 }} />
                  </div>
                ))}
                <div>
                  <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Total</div>
                  <div style={{ ...inputStyle, marginBottom: 0, background: '#fff', display: 'flex', alignItems: 'center', fontWeight: 600, color: v.instructed ? '#16a34a' : '#888' }}>{fmtC(total)}</div>
                </div>
              </div>
            </div>
          )
        })}
        <button onClick={addVariation} style={{ background: '#f0f2f5', border: '1px dashed #ccc', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontSize: 13, width: '100%', color: '#555' }}>+ Add variation</button>
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#f0fdf4', borderRadius: 6, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ color: '#555' }}>Instructed variations:</span>
            <strong>{fmtC(afa - (parseFloat(form.contractValue) || 0))}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#555' }}>AFA:</span>
            <strong style={{ color: '#16a34a' }}>{fmtC(afa)}</strong>
          </div>
        </div>
      </div>
      <div style={sectionStyle}>
        <div style={headingStyle}>Retention</div>
        <label style={labelStyle}>Retention %</label>
        <input type="number" value={(form.retentionPct || 0) * 100} onChange={e => setForm({ ...form, retentionPct: parseFloat(e.target.value) / 100 })} style={inputStyle} placeholder="e.g. 3" />
        <label style={labelStyle}>PC date (1st half release)</label>
        <input type="date" value={form.pcDate || ''} onChange={f('pcDate')} style={inputStyle} />
        <label style={labelStyle}>Defects liability end date (2nd half release)</label>
        <input type="date" value={form.defectsDate || ''} onChange={f('defectsDate')} style={inputStyle} />
        <label style={labelStyle}>Retention comments</label>
        <textarea value={form.retentionComments || ''} onChange={f('retentionComments')} rows={5}
          style={{ ...inputStyle, minHeight: 96, resize: 'vertical', fontFamily: 'inherit' }}
          placeholder="Notes about retention — e.g. confirmations, chase history, agreed release terms…" />
      </div>
      <div style={sectionStyle}>
        <div style={headingStyle}>Project Details</div>
        <label style={labelStyle}>Customer name</label>
        <input value={form.customerName || ''} onChange={f('customerName')} style={inputStyle} />
        <label style={labelStyle}>Address</label>
        <input value={form.address || ''} onChange={f('address')} style={inputStyle} />
        <label style={labelStyle}>Region</label>
        <input value={form.region || ''} onChange={f('region')} style={inputStyle} />
        <label style={labelStyle}>Order reference</label>
        <input value={form.orderRef || ''} onChange={f('orderRef')} style={inputStyle} />
      </div>
      <div style={sectionStyle}>
        <div style={{ ...headingStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Team</span>
          <button onClick={onAddMember} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>+ Add new team member</button>
        </div>
        {ROLES.map(role => {
          const members = byRole(role)
          const fieldKey = role === 'Contracts Manager' ? 'contractsManager' : role === 'Operations Manager' ? 'operationsManager' : role === 'Estimator' ? 'estimator' : 'qsName'
          return (
            <div key={role}>
              <label style={labelStyle}>{role}</label>
              <select value={form[fieldKey] || ''} onChange={f(fieldKey)} style={inputStyle}>
                <option value="">— Select {role} —</option>
                {members.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          )
        })}
        {teamMembers.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Manage team members:</div>
            {teamMembers.map(m => (
              <div key={m.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', background: '#f8f9fa', borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                <span>{m.name} <span style={{ color: '#888' }}>— {m.role}</span></span>
                <button onClick={() => onRemoveMember(m.name)} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={sectionStyle}>
        <div style={headingStyle}>Customer Contact</div>
        <label style={labelStyle}>Contact name</label>
        <input value={form.customerContact || ''} onChange={f('customerContact')} style={inputStyle} />
        <label style={labelStyle}>Email</label>
        <input value={form.customerEmail || ''} onChange={f('customerEmail')} style={inputStyle} />
        <label style={labelStyle}>Phone</label>
        <input value={form.customerPhone || ''} onChange={f('customerPhone')} style={inputStyle} />
      </div>
    </div>
  )
}

export async function getServerSideProps() {
  return { props: {} }
}
