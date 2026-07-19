import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import SyncBar from '../components/SyncBar'

const fmt = (n) => n == null || n === '' ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)
const fmtC = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n || 0)

const EMPTY_ENTRY = {
  ourRef: '', customerName: '', projectName: '', projectValue: '', finalAccount: '',
  retentionPct: '', completionDate: '', pcType: '',
  qsName: '', qsEmail: '',
  release1Value: '', release1Date: '', release1Received: false,
  release2Value: '', release2Date: '', release2Received: false,
  comments: '',
  trackerOnly: true,   // entries created via the Add form live ONLY in the tracker
}

// Parse a numeric VAT rate from a VAT-type label. Reverse charge / zero-rated /
// exempt / no-VAT all = 0. "20%" -> 0.20, "5%" -> 0.05.
function vatRateFromLabel(label) {
  const s = (label || '').toLowerCase()
  if (s.includes('reverse charge') || s.includes('zero') || s.includes('exempt') || s.includes('no vat')) return 0
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(label || '')
  return m ? parseFloat(m[1]) / 100 : 0
}
// VAT = Final Account × rate (per the VAT type). Reverse charge / 0% = £0.
// If the VAT type is "Mixed" (invoices carry different treatments), a single rate
// can't be applied — VAT must be entered manually (vatManual).
function vatIsMixed(entry) {
  return (entry.vatRateLabel || '').toLowerCase() === 'mixed'
}
function vatNeedsManual(entry) {
  // Mixed, or a VAT type we can't turn into a rate, with no manual figure yet.
  if (entry.vatManual != null && entry.vatManual !== '') return false
  return vatIsMixed(entry)
}
function calcVat(entry) {
  // A manual VAT figure always wins (used for Mixed, or to override).
  if (entry.vatManual != null && entry.vatManual !== '' && !isNaN(parseFloat(entry.vatManual))) {
    return parseFloat(entry.vatManual)
  }
  if (vatIsMixed(entry)) return 0   // unknown until entered manually
  const fa = parseFloat(entry.finalAccount || entry.projectValue || 0) || 0
  return fa * vatRateFromLabel(entry.vatRateLabel)
}
// Total Due = Final Account + VAT.
function calcTotalDue(entry) {
  const fa = parseFloat(entry.finalAccount || entry.projectValue || 0) || 0
  return fa + calcVat(entry)
}
// Account Remaining = Final Account − Invoiced Net (ex-VAT).
function calcAccountRemaining(entry) {
  const fa = parseFloat(entry.finalAccount || entry.projectValue || 0) || 0
  const invNet = parseFloat(entry.invoicedNet != null ? entry.invoicedNet : entry.invoiced || 0) || 0
  return fa - invNet
}
// Total Remaining (Check) = Total Due (inc VAT) − Total Paid (inc VAT).
// Hits £0 when everything (incl. VAT) has been paid → retention closed.
function calcTotalRemaining(entry) {
  return calcTotalDue(entry) - (parseFloat(entry.paid || 0) || 0)
}
// Retention lifecycle status: 'live' -> 'defects' -> 'complete' (all manual, gated).
// Older records used a markedComplete boolean; treat that as 'complete'.
const retStatusOf = (entry) => entry.retStatus || (entry.markedComplete ? 'complete' : 'live')
const isClosed = (entry) => retStatusOf(entry) === 'complete'

function calcBalance(entry) {
  const r1 = parseFloat(entry.release1Value || 0)
  const r2 = parseFloat(entry.release2Value || 0)
  const total = r1 + r2
  const received = (entry.release1Received ? r1 : 0) + (entry.release2Received ? r2 : 0)
  return total - received
}

// Final-account balance = Final Account (ex-VAT) minus amount paid (ex-VAT).
// Reaches £0 once the whole final account has been paid. VAT sits outside the
// Final Account, so we compare paid ex-VAT (paid inc-VAT minus VAT charged).
function calcFinalBalance(entry) {
  const fa = parseFloat(entry.finalAccount || entry.projectValue || 0) || 0
  const paidIncVat = parseFloat(entry.paid || 0) || 0
  const vat = parseFloat(entry.vat || 0) || 0
  const paidExVat = paidIncVat - vat
  return fa - paidExVat
}

function statusBadge(entry) {
  const now = new Date().toISOString().split('T')[0]
  const r1Due = entry.release1Date && !entry.release1Received && entry.release1Date < now
  const r2Due = entry.release2Date && !entry.release2Received && entry.release2Date < now
  if (r1Due || r2Due) return { label: 'Overdue', bg: '#fef2f2', color: '#e63946' }
  if (entry.release1Received && entry.release2Received) return { label: 'Released', bg: '#f0fdf4', color: '#16a34a' }
  if (entry.release1Received) return { label: 'Part released', bg: '#fffbeb', color: '#ca8a04' }
  return { label: 'Pending', bg: '#f0f2f5', color: '#888' }
}

export default function RetentionPage() {
  const [entries, setEntries] = useState([])
  const [xeroEntries, setXeroEntries] = useState([])
  const [hiddenIds, setHiddenIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_ENTRY)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_ENTRY)
  const [saving, setSaving] = useState(false)
  const [sortKey, setSortKey] = useState('ref')   // default sort by Ref
  const [sortDir, setSortDir] = useState('asc')
  const [filter, setFilter] = useState(() => new Set(['live'])) // multi-select: live | defects | complete
  const [qsOptions, setQsOptions] = useState([])
  const [allProjects, setAllProjects] = useState([])   // for the "add existing project" picker

  const [search, setSearch] = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      // QS dropdown options: portal users with post-contract / management / admin access.
      try {
        const rt = await fetch('/api/team'); const dt = await rt.json()
        const allowed = ['post-contract', 'management', 'admin']
        setQsOptions((dt.members || []).filter(m => m.active !== false && allowed.includes(m.accessRole) && m.name).map(m => m.name).sort((a, b) => a.localeCompare(b)))
      } catch {}
      // Load manual entries
      const r1 = await fetch('/api/retention')
      const d1 = await r1.json()
      setEntries(d1.entries || [])

      // Load Xero projects with retention
      const r2 = await fetch('/api/dashboard')
      const d2 = await r2.json()
      // Shared hidden-projects list (set on Project Financials) — applied here too.
      let hiddenIds = []
      try { hiddenIds = (await fetch('/api/hidden-projects').then(r => r.json())).hidden || [] } catch {}
      setHiddenIds(hiddenIds)
      const hiddenSet = new Set(hiddenIds.map(String))
      const visibleProjects = (d2.projects || []).filter(p => !hiddenSet.has(String(p.xeroId)))
      // Full project list for the "add existing project" picker (all projects,
      // regardless of retention filter, so you can add one before it's invoiced).
      setAllProjects(visibleProjects.map(p => ({
        xeroId: p.xeroId,
        ourRef: p.jobNo || '',
        customerName: p.customer || '',
        projectName: p.name || '',
        projectValue: p.contractValue || 0,
        finalAccount: p.afa || 0,
        retentionPct: (p.retentionPct || 0) * 100,
        completionDate: p.completionDate || p.pcDate || '',
        qsName: p.qsName || p.estimator || '',
        comments: p.retentionComments || '',
      })).sort((a, b) => (a.ourRef || '').localeCompare(b.ourRef || '', undefined, { numeric: true })))
      // (a retention % set), plus any that already have retention outstanding or
      // invoicing under way. This mirrors the project details / EOM data rather
      // than waiting for a project to be invoiced.
      // Show EVERY in-progress project on the register — even before anything is
      // invoiced (values show £0), so it's a complete list. Closed/defects still
      // included so nothing disappears.
      const withRetention = visibleProjects
        .map(p => ({
          id: p.xeroId,
          xeroId: p.xeroId,
          ourRef: p.jobNo || '',
          customerName: p.customer || '',
          projectName: p.name || '',
          projectValue: p.contractValue || 0,
          finalAccount: p.afa || 0,
          retentionPct: (p.retentionPct || 0) * 100,
          completionDate: p.completionDate || p.pcDate || '',
          pcType: '',
          qsName: p.qsName || p.estimator || '',
          qsEmail: '',
          comments: p.retentionComments || p.comment || '',
          invoiced: p.totalInvoiced || 0,
          invoicedNet: p.grossInvoiced || p.invoicedExVat || 0,
          vat: p.vat || 0,
          vatRateLabel: p.vatRateLabel || '—',
          paid: p.paid || 0,
          appliedFor: '',
          retentionOwed: p.totalRetention || 0,               // invoiced (200-sales) × retention %
          retention612Allocated: p.retention612Allocated || 0, // actually deducted to code 612
          release1Value: (p.totalRetention || 0) / 2 || 0,
          release1Date: '',
          release1Received: false,
          release2Value: (p.totalRetention || 0) / 2 || 0,
          release2Date: '',
          release2Received: false,
          manual: false,
          status: p.status,
        }))
      setXeroEntries(withRetention)
    } catch (e) { console.error(e) }
    setLoading(false)
  }



  async function saveEntry(entry) {
    setSaving(true)
    try {
      // A Xero-derived row has manual:false and its id set to the xeroId. Editing
      // it must create/update a MANUAL OVERRIDE keyed by xeroId, not try to update
      // a record by that id (which doesn't exist in the manual store). Find any
      // existing override for this xeroId and reuse its real id; otherwise create
      // a new override (drop the id so the server generates one) but keep xeroId.
      let toSave = entry
      if (entry.manual === false) {
        const existingOverride = entries.find(e => e.xeroId === entry.xeroId)
        toSave = {
          ...entry,
          id: existingOverride ? existingOverride.id : undefined,
          xeroId: entry.xeroId || entry.id,
          manual: false,        // still sourced from Xero, but now has manual overrides
        }
      }
      const res = await fetch('/api/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry: toSave })
      })
      const data = await res.json()
      setEntries(data.entries || [])
      setEditingId(null)
      setShowAddForm(false)
      setAddForm(EMPTY_ENTRY)
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  // Retention lifecycle transitions (all manual, gated):
  //  • live -> defects: only when Final Account reconciles with invoiced value.
  //  • defects -> complete: only from defects (can't skip the defects period).
  //  • re-open steps back one stage.
  async function setRetStatus(entry, next) {
    const fa = parseFloat(entry.finalAccount || entry.projectValue || 0) || 0
    const invNet = entry.invoicedNet != null ? parseFloat(entry.invoicedNet) : (entry.invoiced != null ? parseFloat(entry.invoiced) : null)
    const faMatches = fa > 0 && invNet != null && Math.abs(fa - (invNet || 0)) < 1
    if (next === 'defects') {
      if (!faMatches) { alert('Cannot move to Defects Liability: the Final Account and the invoiced value must match first. Reconcile them, then try again.'); return }
      if (!confirm(`Move ${entry.ourRef || 'this project'} to Defects Liability? (Waiting for the final retention release.)`)) return
    }
    if (next === 'complete') {
      if (retStatusOf(entry) !== 'defects') { alert('A project must go through Defects Liability before it can be marked Complete.'); return }
      if (!confirm(`Mark ${entry.ourRef || 'this project'} as Complete?`)) return
    }
    if (next === 'live') {
      if (!confirm(`Move ${entry.ourRef || 'this project'} back to ${retStatusOf(entry) === 'complete' ? 'Defects Liability' : 'Live Project'}?`)) return
    }
    await saveEntry({ ...entry, retStatus: next, markedComplete: next === 'complete', completedAt: next === 'complete' ? Date.now() : null })
  }

  async function deleteEntry(id) {
    if (!confirm('Delete this entry?')) return
    try {
      const res = await fetch('/api/retention', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      })
      const data = await res.json()
      setEntries(data.entries || [])
    } catch (e) { console.error(e) }
  }

  // Merge xero + manual. A manual OVERRIDE (entry with an xeroId) keeps the
  // manual fields (received flags, dates, comments) but the live Xero financials
  // (invoiced/vat/vatRateLabel/paid/final account etc.) are always layered on top
  // so they stay current after each sync and never show stale/zero values.
  const xeroByXid = new Map(xeroEntries.map(x => [x.xeroId, x]))
  const mergedEntries = entries.map(e => {
    if (e.xeroId && xeroByXid.has(e.xeroId)) {
      const x = xeroByXid.get(e.xeroId)
      return {
        ...e,
        invoiced: x.invoiced, invoicedNet: x.invoicedNet, vat: x.vat, vatRateLabel: x.vatRateLabel, paid: x.paid,
        retentionOwed: x.retentionOwed, retention612Allocated: x.retention612Allocated,
        finalAccount: e.finalAccount || x.finalAccount,
        projectValue: e.projectValue || x.projectValue,
        retentionPct: e.retentionPct || x.retentionPct,
        completionDate: e.completionDate || x.completionDate,
        qsName: e.qsName || x.qsName,
        comments: x.comments != null && x.comments !== '' ? x.comments : e.comments,
        // markedComplete is a manual saved flag on `e` — keep it.
      }
    }
    return e
  })
  const manualIds = new Set(entries.map(e => e.xeroId).filter(Boolean))
  const hiddenEntrySet = new Set(hiddenIds.map(String))
  const allEntries = [
    ...xeroEntries.filter(x => !manualIds.has(x.xeroId) && !entries.find(e => e.id === x.xeroId)),
    ...mergedEntries
  ].filter(e => !(e.xeroId && hiddenEntrySet.has(String(e.xeroId)))).filter(e => {
    // Multi-select status filter: show a row if its status is among the ticked
    // filters. No filters ticked -> show nothing (prompt shown separately).
    if (!filter || filter.size === 0) return true
    return filter.has(retStatusOf(e))
  }).filter(e => {
    if (!search) return true
    const q = search.toLowerCase()
    return e.ourRef?.toLowerCase().includes(q) || e.customerName?.toLowerCase().includes(q) || e.projectName?.toLowerCase().includes(q)
  })

  // Sortable columns. Each key maps to a value getter; strings sort case-insensitively
  // (numeric-aware for refs), numbers/dates naturally.
  const sortVal = (e, key) => {
    switch (key) {
      case 'ref': return e.ourRef || ''
      case 'customer': return e.customerName || ''
      case 'project': return e.projectName || ''
      case 'finalAccount': return parseFloat(e.finalAccount || 0) || 0
      case 'appliedFor': return parseFloat(e.appliedFor || 0) || 0
      case 'invoiced': return parseFloat(e.invoicedNet != null ? e.invoicedNet : e.invoiced || 0) || 0
      case 'retentionOwed': return parseFloat(e.retentionOwed || 0) || 0
      case 'r612': return parseFloat(e.retention612Allocated || 0) || 0
      case 'retPct': return parseFloat(e.retentionPct || 0) || 0
      case 'pcType': return e.pcType || ''
      case 'qs': return e.qsName || ''
      case 'paid': return parseFloat(e.paid || 0) || 0
      case 'r1date': return e.release1Date || ''
      case 'r2date': return e.release2Date || ''
      default: return e.ourRef || ''
    }
  }
  const sortedEntries = [...allEntries].sort((a, b) => {
    const va = sortVal(a, sortKey), vb = sortVal(b, sortKey)
    let cmp
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb
    else cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' })
    return sortDir === 'asc' ? cmp : -cmp
  })
  const toggleSort = (key) => {
    if (!key) return
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const totals = {
    total: allEntries.reduce((s, e) => s + (parseFloat(e.release1Value || 0) + parseFloat(e.release2Value || 0)), 0),
    remaining: allEntries.reduce((s, e) => s + (calcTotalDue(e) ? calcTotalRemaining(e) : 0), 0),
    closed: allEntries.filter(isClosed).length,
  }

  const inputStyle = { padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, width: '100%', boxSizing: 'border-box' }

  // Projects already present in the tracker (so the "add existing project"
  // autocomplete won't offer duplicates). Match on xeroId for auto/linked rows,
  // and on ref/name for manual rows (which carry no xeroId).
  const existingXeroIds = new Set(allEntries.map(e => e.xeroId).filter(Boolean))
  const existingKeys = new Set(
    allEntries.flatMap(e => [
      (e.ourRef || '').trim().toLowerCase(),
      (e.projectName || '').trim().toLowerCase(),
    ].filter(Boolean))
  )

  return (
    <>
      <Head><title>Rock Roofing — Retention Tracker</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', flex: 1, minWidth: 0 }}>
              <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
              <Link href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>← Portal</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/commercial" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Project Financials</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/outstanding-invoices" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Outstanding Invoices</Link>
              <span style={{ color: '#444' }}>|</span>
              <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Retention</span>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/variations" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Variations</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/contracted-rates" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Contracted Rates</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/applications" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Applications</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/application-calendar" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Application Calendar</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/commercial-scorecard" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Commercial Scorecard</Link>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => window.dispatchEvent(new CustomEvent('open-report-problem'))}
                style={{ background: 'none', border: 'none', color: '#ca8a04', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>⚠ Report app improvement</button>
              <SyncBar show={['invoices']} months={12} onDone={() => loadAll()} />
              <button onClick={() => { setShowAddForm(true); setAddForm(EMPTY_ENTRY) }}
                style={{ background: '#e63946', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>
                + Add Manual Entry
              </button>
            </div>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Total Retention', value: fmtC(totals.total), color: '#1a1a2e' },
              { label: 'Total Remaining (to be paid)', value: fmtC(totals.remaining), color: totals.remaining > 1 ? '#dc2626' : '#16a34a' },
              { label: 'Closed', value: totals.closed, raw: true, color: '#16a34a' },
              { label: 'Projects shown', value: allEntries.length, raw: true },
            ].map(card => (
              <div key={card.label} style={{ background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{card.label}</div>
                <div style={{ fontSize: card.raw ? 28 : 20, fontWeight: 700, color: card.color }}>{card.value}</div>
              </div>
            ))}
          </div>

          {/* Add form */}
          {showAddForm && (
            <EntryForm form={addForm} setForm={setAddForm}
              onSave={saveEntry} saving={saving} qsOptions={qsOptions} allProjects={allProjects} inputStyle={inputStyle}
              existingXeroIds={existingXeroIds} existingKeys={existingKeys}
              onCancel={() => { setShowAddForm(false); setAddForm(EMPTY_ENTRY) }} />
          )}

          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: '#f0f2f5', borderRadius: 8, overflow: 'hidden' }}>
              {[['live', 'Live Project'], ['defects', 'Defects Liability'], ['complete', 'Complete']].map(([key, label]) => {
                const on = filter.has(key)
                return (
                  <button key={key} onClick={() => setFilter(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })}
                    title="Tick any combination"
                    style={{ padding: '6px 16px', border: 'none', background: on ? '#1a1a2e' : 'transparent', color: on ? '#fff' : '#555', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    {on ? '✓ ' : ''}{label}
                  </button>
                )
              })}
            </div>
            <input placeholder="Search ref, customer, project..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 200, padding: '7px 12px', border: '1px solid #e5e5e5', borderRadius: 8, fontSize: 12 }} />
            <span style={{ fontSize: 12, color: '#888' }}>{allEntries.length} entries</span>
            {/* Colour key */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, color: '#666', width: '100%', marginTop: 4 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#fff3e0', border: '1px solid #ffb74d' }} /> Release due — not yet paid</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#e8f5e9', border: '1px solid #66bb6a' }} /> Release paid (amount paid covers it & FA reconciles)</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#dcfce7', border: '1px solid #16a34a' }} /> Row green = marked Complete (manual)</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#e0f2fe', border: '1px solid #0369a1' }} /> Live</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#fef9c3', border: '1px solid #a16207' }} /> Defects Liability (awaiting final retention)</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#a16207' }}>⚠ check FA = paid but Final Account ≠ invoiced (won’t go green until reconciled)</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#c77700' }}>⚠ TBC = release date not confirmed</span>
            </div>
          </div>

          {/* Table */}
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>
            ) : allEntries.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>{filter.size === 0 ? 'No status filters selected — tick Live Project, Defects Liability or Complete above.' : 'No retention entries match the current filters.'}</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
                      {[
                        ['Ref', 'left', 'Project reference (job number) from project details.', 'ref'],
                        ['Customer', 'left', 'Customer name from project details.', 'customer'],
                        ['Project', 'left', 'Project name from project details.', 'project'],
                        ['Final Account', 'right', 'Agreed Final Account (AFA) from project details = contract value + instructed variations.', 'finalAccount'],
                        ['Applied for', 'right', 'Amount applied for. Manual for now; will auto-populate from the Application tab once built.', 'appliedFor'],
                        ['Invoiced', 'right', 'Total invoiced on the project: sum of the Sales (account code 200) lines from Xero. NET of VAT, and INCLUDING retention (retention is posted to a separate account, so the Sales total already includes it). From Xero for synced projects, or the imported Xero CSV.', 'invoiced'],
                        ['✓', 'center', 'Match check: green tick when Applied for equals Invoiced, red flag when they differ.', null],
                        ['Account Remaining', 'right', 'Final Account − Invoiced. What is still to be invoiced against the final account.', null],
                        ['Retention Owed', 'right', 'Retention owed based on invoiced value: invoiced (Sales, code 200) × retention %.', 'retentionOwed'],
                        ['612 Allocated', 'right', 'Retention actually deducted on invoices under account code 612. Re-sync invoices to populate.', 'r612'],
                        ['✓', 'center', 'Match check: green tick when Retention Owed equals 612 Allocated, red flag when they differ.', null],
                        ['Ret %', 'center', 'Retention percentage from project details.', 'retPct'],
                        ['PC Type', 'left', 'Practical completion type (manual).', 'pcType'],
                        ['QS', 'left', 'Quantity Surveyor from project details (falls back to Estimator).', 'qs'],
                        ['1st Value', 'right', 'First retention release (half of total retention). Orange = due/not paid, green = settled.', null],
                        ['1st Date', 'left', 'Due date of the first retention release (manual).', 'r1date'],
                        ['2nd Value', 'right', 'Second retention release (half of total retention). Orange = due/not paid, green = settled.', null],
                        ['2nd Date', 'left', 'Due date of the second retention release (manual).', 'r2date'],
                        ['VAT', 'right', 'VAT on the Final Account = Final Account × VAT-type rate. Reverse charge / 0% = £0.', null],
                        ['VAT Type', 'left', 'VAT treatment from Xero: reverse charge, 5%, 20%, zero-rated, etc.', null],
                        ['Total Due', 'right', 'Final Account + VAT. The full amount due including VAT.', null],
                        ['Total Paid', 'right', 'Total received from the customer (including VAT). From Xero / the imported CSV.', 'paid'],
                        ['Total Remaining (Check)', 'right', 'Total Due − Total Paid.', null],
                        ['Comments', 'left', 'Synced with the Retention comments box in Project Details.', null],
                        ['', 'left', '', null],
                      ].map(([h, align, tip, key]) => (
                        <th key={(h || 'actions') + (key || '')} title={tip || undefined}
                          onClick={() => key && toggleSort(key)}
                          style={{ padding: '9px 10px', textAlign: align, fontWeight: 600, color: sortKey === key ? '#1a1a2e' : '#555', whiteSpace: 'nowrap', cursor: key ? 'pointer' : (tip ? 'help' : 'default'), userSelect: 'none' }}>
                          {h}{key && sortKey === key ? <span style={{ marginLeft: 3, fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span> : (tip ? <span style={{ color: '#bbb', marginLeft: 3, fontSize: 10 }}>ⓘ</span> : null)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((entry, i) => {
                      const isEditing = editingId === entry.id
                      const closed = isClosed(entry)
                      const rowBg = closed ? '#dcfce7' : (i % 2 === 0 ? '#fff' : '#fafafa')
                      const fa = parseFloat(entry.finalAccount || entry.projectValue || 0) || 0
                      const invNet = entry.invoicedNet != null ? parseFloat(entry.invoicedNet) : (entry.invoiced != null ? parseFloat(entry.invoiced) : null)
                      const accRemaining = fa ? fa - (invNet || 0) : null
                      const vatVal = calcVat(entry)
                      const totalDue = calcTotalDue(entry)
                      const totalRemaining = calcTotalRemaining(entry)
                      const hasPaid = entry.paid != null && entry.paid !== ''
                      // Release "received" is now DERIVED from what's actually been paid
                      // (no manual tick box):
                      //  • 1st release is settled once only the 2nd half remains to pay
                      //    (remaining <= 2nd release value).
                      //  • 2nd release is settled once the account is paid in full.
                      const r1v = parseFloat(entry.release1Value || 0) || 0
                      const r2v = parseFloat(entry.release2Value || 0) || 0
                      const paidKnown = hasPaid && fa
                      // Final Account vs Invoiced. Releases should only go green once the
                      // FA and the invoiced value reconcile; if invoiced exceeds FA the
                      // FA is understated (warning shown on the FA cell).
                      const faKnown = fa > 0 && invNet != null
                      const faMatchesInvoiced = faKnown && Math.abs(fa - (invNet || 0)) < 1
                      const faBelowInvoiced = faKnown && (invNet || 0) - fa > 1
                      const settledSecond = paidKnown ? (totalRemaining < 1) : false
                      const settledFirst = paidKnown ? (settledSecond || totalRemaining <= r2v + 1) : false
                      // Only allow the green "settled" state when FA reconciles to invoiced.
                      const secondReceived = settledSecond && faMatchesInvoiced
                      const firstReceived = settledFirst && faMatchesInvoiced
                      // A release that WOULD be settled but is blocked by an FA/invoiced
                      // mismatch shows an amber warning instead of green.
                      const releaseWarn = (settledFirst || settledSecond) && !faMatchesInvoiced
                      // Release cell: green when settled AND FA reconciles; amber warning
                      // when settled but FA≠Invoiced; orange "due" otherwise.
                      const releaseCell = (val, received, warn) => {
                        const has = val != null && val !== '' && !isNaN(parseFloat(val))
                        if (!has) return <td style={{ padding: '8px 10px', textAlign: 'right', color: '#bbb' }}>—</td>
                        if (warn && !received) {
                          return (
                            <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap', background: '#fef9c3' }} title="Paid, but Final Account doesn't match the invoiced value — reconcile before treating as released.">
                              <div style={{ fontWeight: 600, color: '#a16207' }}>{fmt(parseFloat(val))}</div>
                              <div style={{ fontSize: 9.5, color: '#a16207', fontWeight: 600 }}>⚠ check FA</div>
                            </td>
                          )
                        }
                        return (
                          <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap', background: received ? '#e8f5e9' : '#fff3e0' }}>
                            <div style={{ fontWeight: 600, color: received ? '#166534' : '#b26a00' }}>{fmt(parseFloat(val))}</div>
                            <div style={{ fontSize: 9.5, color: received ? '#16a34a' : '#c77700', fontWeight: 600 }}>{received ? 'released' : 'due'}</div>
                          </td>
                        )
                      }
                      // Match indicator: green tick when the two values agree (within
                      // £1), red flag when they differ. Grey dash if either is missing.
                      const matchCell = (a, b, hasBoth, mismatchTip) => {
                        if (!hasBoth) return <td style={{ padding: '8px 6px', textAlign: 'center', color: '#cbd5e1' }}>—</td>
                        const ok = Math.abs((parseFloat(a) || 0) - (parseFloat(b) || 0)) < 1
                        return <td style={{ padding: '8px 6px', textAlign: 'center' }} title={ok ? 'Match' : (mismatchTip || 'Mismatch — figures differ')}>
                          <span style={{ fontSize: 14, color: ok ? '#16a34a' : '#dc2626' }}>{ok ? '✓' : '🚩'}</span>
                        </td>
                      }
                      return (
                        <>
                          <tr key={entry.id} style={{ borderBottom: '1px solid #f0f0f0', background: rowBg }}>
                            {/* Ref */}
                            <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1a1a2e', whiteSpace: 'nowrap' }}>
                              {entry.manual === false && entry.xeroId
                                ? <Link href={`/project/${entry.xeroId}`} style={{ color: '#2563eb' }}>{entry.ourRef}</Link>
                                : entry.ourRef || '—'}
                              {!entry.manual && <span style={{ marginLeft: 4, fontSize: 9, background: '#eef2ff', color: '#4f46e5', borderRadius: 4, padding: '1px 4px' }}>Xero</span>}
                              {(() => {
                                const st = retStatusOf(entry)
                                const meta = st === 'complete' ? { t: 'Complete', bg: '#dcfce7', c: '#166534' }
                                  : st === 'defects' ? { t: 'Defects', bg: '#fef9c3', c: '#a16207' }
                                  : { t: 'Live', bg: '#e0f2fe', c: '#0369a1' }
                                return <span style={{ marginLeft: 4, fontSize: 9, background: meta.bg, color: meta.c, borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>{meta.t}</span>
                              })()}
                            </td>
                            {/* Customer */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{entry.customerName || '—'}</td>
                            {/* Project */}
                            <td style={{ padding: '8px 10px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.projectName || '—'}</td>
                            {/* Final Account */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: faBelowInvoiced ? '#dc2626' : undefined, fontWeight: faBelowInvoiced ? 700 : undefined }}>
                              {fmt(fa || null)}
                              {faBelowInvoiced && <div style={{ fontSize: 9.5, color: '#dc2626', fontWeight: 600 }}>⚠ FA lower than invoiced</div>}
                            </td>
                            {/* Applied for (manual override) */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{entry.appliedFor != null && entry.appliedFor !== '' ? fmt(parseFloat(entry.appliedFor)) : '—'}</td>
                            {/* Invoiced Net */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{invNet != null ? fmt(invNet) : '—'}</td>
                            {/* Applied-for vs Invoiced match (right of Invoiced) */}
                            {matchCell(entry.appliedFor, invNet, entry.appliedFor != null && entry.appliedFor !== '' && invNet != null, 'Mismatch, applied for and invoiced differ')}
                            {/* Account Remaining */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: accRemaining == null ? '#bbb' : Math.abs(accRemaining) < 1 ? '#16a34a' : '#2563eb' }}>{accRemaining == null ? '—' : fmtC(accRemaining)}</td>
                            {/* Retention Owed (invoiced × ret %) */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{entry.retentionOwed ? fmt(parseFloat(entry.retentionOwed)) : fmt(0)}</td>
                            {/* 612 Allocated */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{entry.retention612Allocated ? fmt(parseFloat(entry.retention612Allocated)) : fmt(0)}</td>
                            {/* Retention Owed vs 612 Allocated match (right of 612) */}
                            {matchCell(entry.retentionOwed, entry.retention612Allocated, (parseFloat(entry.retentionOwed) || 0) > 0 || (parseFloat(entry.retention612Allocated) || 0) > 0, 'Mismatch, retention owed and Xero allocated retention differs')}
                            {/* Ret % */}
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>{entry.retentionPct ? `${parseFloat(entry.retentionPct).toFixed(0)}%` : '—'}</td>
                            {/* PC Type */}
                            <td style={{ padding: '8px 10px', color: '#555' }}>{entry.pcType || '—'}</td>
                            {/* QS */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{entry.qsName || '—'}</td>
                            {/* 1st Value (coloured) */}
                            {releaseCell(entry.release1Value, firstReceived, releaseWarn)}
                            {/* 1st Date */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: entry.release1Date ? '#555' : '#c77700' }}>{entry.release1Date || (closed ? '—' : <span title="Retention release date not confirmed — set it in Edit / project details.">⚠ TBC</span>)}</td>
                            {/* 2nd Value (coloured) */}
                            {releaseCell(entry.release2Value, secondReceived, releaseWarn)}
                            {/* 2nd Date */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: entry.release2Date ? '#555' : '#c77700' }}>{entry.release2Date || (closed ? '—' : <span title="Retention release date not confirmed — set it in Edit / project details.">⚠ TBC</span>)}</td>
                            {/* VAT */}
                            {vatNeedsManual(entry)
                              ? <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  <span title="This project has mixed VAT treatments across its invoices, so VAT can't be auto-calculated. Enter it manually in Edit." style={{ color: '#dc2626', fontSize: 12.5, fontWeight: 600, cursor: 'help' }}>⚠ enter manually</span>
                                </td>
                              : <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{fa ? fmtC(vatVal) : '—'}</td>}
                            {/* VAT Type */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#555', fontSize: 11.5 }}>{entry.vatRateLabel && entry.vatRateLabel !== '—' ? entry.vatRateLabel : '—'}</td>
                            {/* Total Due */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{fa ? fmtC(totalDue) : '—'}</td>
                            {/* Total Paid */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{hasPaid ? fmt(parseFloat(entry.paid)) : '—'}</td>
                            {/* Total Remaining (Check) */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: !fa ? '#bbb' : closed ? '#16a34a' : '#dc2626' }}>{fa ? fmtC(totalRemaining) : '—'}</td>
                            {/* Comments */}
                            <td style={{ padding: '8px 10px', color: '#555', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.comments || ''}>{entry.comments || '—'}</td>
                            {/* Actions */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                              <button onClick={() => { setEditingId(entry.id); setEditForm({ ...entry }) }}
                                style={{ background: '#f0f2f5', border: '1px solid #e5e5e5', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#333', marginRight: 4 }}>Edit</button>
                              {(() => {
                                const st = retStatusOf(entry)
                                if (st === 'live') return (
                                  <button onClick={() => setRetStatus(entry, 'defects')}
                                    title="Move to Defects Liability (requires Final Account = Invoiced)"
                                    style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#333', marginRight: 4, fontWeight: 600 }}>→ Defects Liability</button>
                                )
                                if (st === 'defects') return (
                                  <>
                                    <button onClick={() => setRetStatus(entry, 'complete')}
                                      title="Mark project Complete"
                                      style={{ background: '#dcfce7', border: '1px solid #16a34a', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#166534', marginRight: 4, fontWeight: 600 }}>✓ Complete</button>
                                    <button onClick={() => setRetStatus(entry, 'live')}
                                      title="Move back to Live Project"
                                      style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#666', marginRight: 4 }}>↩ Live</button>
                                  </>
                                )
                                return (
                                  <button onClick={() => setRetStatus(entry, 'defects')}
                                    title="Re-open — back to Defects Liability"
                                    style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#666', marginRight: 4 }}>↩ Re-open</button>
                                )
                              })()}
                              {entry.manual !== false && (
                                <button onClick={() => deleteEntry(entry.id)}
                                  style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#e63946' }}>Del</button>
                              )}
                            </td>
                          </tr>
                          {isEditing && (
                            <tr key={`edit-${entry.id}`}>
                              <td colSpan={25} style={{ padding: '0 10px 10px' }}>
                                <EntryForm form={editForm} setForm={setEditForm}
                                  onSave={saveEntry} saving={saving} qsOptions={qsOptions} allProjects={allProjects} inputStyle={inputStyle}
                                  onCancel={() => setEditingId(null)} />
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// Top-level so it isn't recreated on every keystroke of the parent (which would
// steal focus from inputs). Project Name is an autocomplete: typing suggests
// matching existing projects; picking one auto-fills and links the entry.
function EntryForm({ form, setForm, onSave, onCancel, saving, qsOptions = [], allProjects = [], inputStyle, existingXeroIds = new Set(), existingKeys = new Set() }) {
  const f = field => e => setForm({ ...form, [field]: e.target.value })
  const fb = field => e => setForm({ ...form, [field]: e.target.checked })
  const [showSuggest, setShowSuggest] = useState(false)
  const suggestRef = useRef(null)

  useEffect(() => {
    if (!showSuggest) return
    const onDown = (e) => { if (suggestRef.current && !suggestRef.current.contains(e.target)) setShowSuggest(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showSuggest])

  const applyProject = (p) => {
    // Auto-fill the details but DO NOT link (no xeroId): a manual entry lives only
    // in the Retention Tracker and must never write back to / appear in Project
    // Financials. It's a standalone snapshot of the values at time of adding.
    setForm({
      ...form,
      ourRef: p.ourRef || '',
      customerName: p.customerName || '',
      projectName: p.projectName || '',
      projectValue: p.projectValue || '',
      finalAccount: p.finalAccount || '',
      retentionPct: p.retentionPct || '',
      completionDate: p.completionDate || '',
      qsName: p.qsName || '',
      comments: p.comments || form.comments || '',
      trackerOnly: true,
    })
    setShowSuggest(false)
  }

  const q = (form.projectName || '').trim().toLowerCase()
  // Only suggest for NEW entries and when the row isn't already linked to a project.
  const canSuggest = !form.id && !form.xeroId
  const matches = canSuggest && q.length >= 1
    ? allProjects.filter(p => {
        // Skip any project already in the tracker (by xeroId, ref or name).
        if (existingXeroIds.has(p.xeroId)) return false
        if (existingKeys.has((p.ourRef || '').trim().toLowerCase())) return false
        if (existingKeys.has((p.projectName || '').trim().toLowerCase())) return false
        return (p.projectName || '').toLowerCase().includes(q) ||
               (p.ourRef || '').toLowerCase().includes(q) ||
               (p.customerName || '').toLowerCase().includes(q)
      }).slice(0, 8)
    : []

  return (
    <div style={{ background: '#f8f9fa', border: '1px solid #e5e5e5', borderRadius: 10, padding: 20, marginBottom: 16 }}>
      {!form.id && (
        <div style={{ fontSize: 10.5, color: '#0f766e', marginBottom: 10 }}>
          Tip: start typing a <strong>Project Name</strong> (or ref/customer) below to pull up an existing project and auto-fill its details — or just type everything in manually.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Our Ref</div>
          <input value={form.ourRef || ''} onChange={f('ourRef')} style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Customer</div>
          <input value={form.customerName || ''} onChange={f('customerName')} style={inputStyle} />
        </div>
        <div style={{ position: 'relative' }} ref={suggestRef}>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Project Name</div>
          <input value={form.projectName || ''} autoComplete="off"
            onChange={e => { setForm({ ...form, projectName: e.target.value }); setShowSuggest(true) }}
            onFocus={() => setShowSuggest(true)}
            style={inputStyle} placeholder="Start typing to search…" />
          {showSuggest && matches.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.12)', maxHeight: 240, overflowY: 'auto' }}>
              <div style={{ fontSize: 10, color: '#999', padding: '6px 10px 2px' }}>Existing projects</div>
              {matches.map(p => (
                <button key={p.xeroId} type="button" onClick={() => applyProject(p)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', background: '#fff', cursor: 'pointer', fontSize: 12.5, color: '#1a1a19' }}>
                  <span style={{ fontWeight: 600 }}>{p.projectName || '(no name)'}</span>
                  <span style={{ color: '#888' }}>{p.ourRef ? `  ·  ${p.ourRef}` : ''}{p.customerName ? `  ·  ${p.customerName}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>PC Type (Main/Sub)</div>
          <input value={form.pcType || ''} onChange={f('pcType')} style={inputStyle} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 12 }}>
        {[['projectValue', 'Project Value £'], ['finalAccount', 'Final Account £'], ['retentionPct', 'Retention %'], ['completionDate', 'Completion Date']].map(([key, label]) => (
          <div key={key}>
            <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>{label}</div>
            <input type={key.includes('Date') ? 'date' : key.includes('Value') || key.includes('Pct') || key.includes('pct') ? 'number' : 'text'}
              value={form[key] || ''} onChange={f(key)} style={inputStyle} />
          </div>
        ))}
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>QS</div>
          <select value={form.qsName || ''} onChange={f('qsName')} style={inputStyle}>
            <option value="">— select QS —</option>
            {qsOptions.map(name => <option key={name} value={name}>{name}</option>)}
            {form.qsName && !qsOptions.includes(form.qsName) && <option value={form.qsName}>{form.qsName}</option>}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Applied for £ <span style={{ color: '#bbb' }}>(manual for now)</span></div>
          <input type="number" value={form.appliedFor || ''} onChange={f('appliedFor')} style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Invoiced Net £ <span style={{ color: '#bbb' }}>(ex-VAT)</span></div>
          <input type="number" value={form.invoicedNet != null ? form.invoicedNet : (form.invoiced || '')} onChange={f('invoicedNet')} style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>VAT Type</div>
          <select value={form.vatRateLabel || ''} onChange={f('vatRateLabel')} style={inputStyle}>
            <option value="">— select —</option>
            {['20%', '5%', '0% reverse charge', '0% zero-rated', 'Exempt', 'No VAT', 'Mixed'].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>
            Manual VAT £ {(form.vatRateLabel || '').toLowerCase() === 'mixed' && <span style={{ color: '#c77700' }}>(required — mixed)</span>}
          </div>
          <input type="number" value={form.vatManual || ''} onChange={f('vatManual')} placeholder={(form.vatRateLabel || '').toLowerCase() === 'mixed' ? 'Enter VAT' : 'auto'} style={inputStyle} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
        <div style={{ background: '#eef2ff', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#4f46e5', marginBottom: 8 }}>1st Retention Release</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Release Value £</div>
              <input type="number" value={form.release1Value || ''} onChange={f('release1Value')} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Release Date</div>
              <input type="date" value={form.release1Date || ''} onChange={f('release1Date')} style={inputStyle} />
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: '#16a34a', fontStyle: 'italic' }}>Auto: turns green once only the 2nd half remains to be paid.</div>
        </div>
        <div style={{ background: '#f0fdf4', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', marginBottom: 8 }}>2nd Retention Release</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Release Value £</div>
              <input type="number" value={form.release2Value || ''} onChange={f('release2Value')} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Release Date</div>
              <input type="date" value={form.release2Date || ''} onChange={f('release2Date')} style={inputStyle} />
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: '#16a34a', fontStyle: 'italic' }}>Auto: turns green once the account is paid in full.</div>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Comments</div>
        <input value={form.comments || ''} onChange={f('comments')} style={inputStyle} placeholder="Any notes..." />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onSave(form)} disabled={saving}
          style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 12 }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={onCancel}
          style={{ background: '#f0f2f5', color: '#555', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 12 }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
