import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import Link from 'next/link'

const fmt = (n) => n == null || n === '' ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)
const fmtC = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n || 0)

const EMPTY_ENTRY = {
  ourRef: '', customerName: '', projectName: '', projectValue: '', finalAccount: '',
  retentionPct: '', completionDate: '', pcType: '',
  qsName: '', qsEmail: '',
  release1Value: '', release1Date: '', release1Received: false,
  release2Value: '', release2Date: '', release2Received: false,
  comments: ''
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
const isClosed = (entry) => {
  if (vatNeedsManual(entry)) return false   // can't confirm closed until VAT entered
  const due = calcTotalDue(entry)
  return due > 0 && Math.abs(calcTotalRemaining(entry)) < 1
}

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
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_ENTRY)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_ENTRY)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('outstanding') // outstanding | all
  const [importing, setImporting] = useState(false)
  const [qsOptions, setQsOptions] = useState([])
  const importRef = useRef(null)
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
      // Show every project that has retention information in its project details
      // (a retention % set), plus any that already have retention outstanding or
      // invoicing under way. This mirrors the project details / EOM data rather
      // than waiting for a project to be invoiced.
      const withRetention = (d2.projects || [])
        .filter(p => (parseFloat(p.retentionPct || 0) > 0) || p.retentionOutstanding > 0 || p.grossInvoiced > 0)
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
          invoicedNet: p.invoicedExVat || 0,
          vat: p.vat || 0,
          vatRateLabel: p.vatRateLabel || '—',
          paid: p.paid || 0,
          appliedFor: '',
          release1Value: (p.grossInvoiced - p.totalInvoiced) / 2 || 0,
          release1Date: '',
          release1Received: false,
          release2Value: (p.grossInvoiced - p.totalInvoiced) / 2 || 0,
          release2Date: '',
          release2Received: false,
          manual: false,
          status: p.status,
        }))
      setXeroEntries(withRetention)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function importInvoices(file) {
    if (!file) return
    setImporting(true)
    try {
      const fileData = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1])
        r.onerror = () => reject(new Error('Could not read file'))
        r.readAsDataURL(file)
      })
      const res = await fetch('/api/import-invoices-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData }),
      })
      const d = await res.json()
      if (!res.ok || !d.ok) { alert(d.error || 'Import failed.'); setImporting(false); if (importRef.current) importRef.current.value = ''; return }
      let msg = `Imported ${d.totalInvoicesProcessed} invoices across ${d.projectsMatched} project${d.projectsMatched === 1 ? '' : 's'}.`
      if (d.projectsUnmatched > 0) msg += `\n\n${d.projectsUnmatched} project name(s) in the file didn't match an app project and were skipped:\n` + (d.summary || []).filter(s => !s.matched).map(s => `• ${s.project}`).join('\n')
      alert(msg)
      await loadAll()   // refresh with the freshly-imported figures
    } catch (e) {
      alert(e?.message || 'Import failed.')
    }
    setImporting(false)
    if (importRef.current) importRef.current.value = ''
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
        finalAccount: e.finalAccount || x.finalAccount,
        projectValue: e.projectValue || x.projectValue,
        retentionPct: e.retentionPct || x.retentionPct,
        completionDate: e.completionDate || x.completionDate,
        qsName: e.qsName || x.qsName,
      }
    }
    return e
  })
  const manualIds = new Set(entries.map(e => e.xeroId).filter(Boolean))
  const allEntries = [
    ...xeroEntries.filter(x => !manualIds.has(x.xeroId) && !entries.find(e => e.id === x.xeroId)),
    ...mergedEntries
  ].filter(e => {
    // Outstanding = retention not yet fully settled (Total Remaining ≠ £0).
    // All = every project that has/had retention.
    if (filter === 'outstanding') return !isClosed(e)
    return true
  }).filter(e => {
    if (!search) return true
    const q = search.toLowerCase()
    return e.ourRef?.toLowerCase().includes(q) || e.customerName?.toLowerCase().includes(q) || e.projectName?.toLowerCase().includes(q)
  })

  const totals = {
    total: allEntries.reduce((s, e) => s + (parseFloat(e.release1Value || 0) + parseFloat(e.release2Value || 0)), 0),
    remaining: allEntries.reduce((s, e) => s + (calcTotalDue(e) ? calcTotalRemaining(e) : 0), 0),
    closed: allEntries.filter(isClosed).length,
  }

  const inputStyle = { padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, width: '100%', boxSizing: 'border-box' }

  function EntryForm({ form, setForm, onSave, onCancel }) {
    const f = field => e => setForm({ ...form, [field]: e.target.value })
    const fb = field => e => setForm({ ...form, [field]: e.target.checked })
    return (
      <div style={{ background: '#f8f9fa', border: '1px solid #e5e5e5', borderRadius: 10, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
          {[['ourRef', 'Our Ref'], ['customerName', 'Customer'], ['projectName', 'Project Name'], ['pcType', 'PC Type (Main/Sub)']].map(([key, label]) => (
            <div key={key}>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>{label}</div>
              <input value={form[key] || ''} onChange={f(key)} style={inputStyle} />
            </div>
          ))}
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
              {/* keep any existing value that isn't in the current list */}
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.release1Received} onChange={fb('release1Received')} />
              Received
            </label>
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.release2Received} onChange={fb('release2Received')} />
              Received
            </label>
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

  return (
    <>
      <Head><title>Rock Roofing — Retention Tracker</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
              <Link href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>← Portal</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/commercial" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Project Financials</Link>
              <span style={{ color: '#444' }}>|</span>
              <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Retention</span>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/variations" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Variations</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/application-calendar" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Application Calendar</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/commercial-scorecard" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Commercial Scorecard</Link>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => window.dispatchEvent(new CustomEvent('open-report-problem'))}
                style={{ background: 'none', border: 'none', color: '#ca8a04', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>⚠ Report app improvement</button>
              <input ref={importRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={e => importInvoices(e.target.files?.[0])} />
              <button onClick={() => importRef.current?.click()} disabled={importing}
                style={{ background: '#fff', color: '#0f766e', border: '1px solid #5eead4', borderRadius: 6, padding: '6px 14px', cursor: importing ? 'default' : 'pointer', fontSize: 13, fontWeight: 600 }}>
                {importing ? 'Importing…' : '⬆ Import invoices from Xero'}
              </button>
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
              onSave={saveEntry}
              onCancel={() => { setShowAddForm(false); setAddForm(EMPTY_ENTRY) }} />
          )}

          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: '#f0f2f5', borderRadius: 8, overflow: 'hidden' }}>
              {[['outstanding', 'Outstanding'], ['all', 'All']].map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)}
                  style={{ padding: '6px 16px', border: 'none', background: filter === key ? '#1a1a2e' : 'transparent', color: filter === key ? '#fff' : '#555', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {label}
                </button>
              ))}
            </div>
            <input placeholder="Search ref, customer, project..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 200, padding: '7px 12px', border: '1px solid #e5e5e5', borderRadius: 8, fontSize: 12 }} />
            <span style={{ fontSize: 12, color: '#888' }}>{allEntries.length} entries</span>
            {/* Colour key */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, color: '#666', width: '100%', marginTop: 4 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#fff3e0', border: '1px solid #ffb74d' }} /> Release due — not received</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#e8f5e9', border: '1px solid #66bb6a' }} /> Release received</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#dcfce7', border: '1px solid #16a34a' }} /> Row green = retention closed (Total Remaining £0)</span>
            </div>
          </div>

          {/* Table */}
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>
            ) : allEntries.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>No retention entries found.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
                      {[
                        ['Ref', 'left', 'Project reference (job number) from project details.'],
                        ['Customer', 'left', 'Customer name from project details.'],
                        ['Project', 'left', 'Project name from project details.'],
                        ['Final Account', 'right', 'Agreed Final Account (AFA) from project details = contract value + instructed variations.'],
                        ['Applied for', 'right', 'Amount applied for. Manual for now; will auto-populate from the Application tab once built.'],
                        ['Invoiced Net', 'right', 'Total invoiced on the project, excluding VAT. From Xero for synced projects, or from the imported Xero CSV.'],
                        ['Account Remaining', 'right', 'Final Account − Invoiced Net. What is still to be invoiced against the final account.'],
                        ['Ret %', 'center', 'Retention percentage from project details.'],
                        ['PC Type', 'left', 'Practical completion type (manual).'],
                        ['QS', 'left', 'Quantity Surveyor from project details (falls back to Estimator).'],
                        ['1st Value', 'right', 'First retention release (half of total retention). Orange = due/not received, green = received.'],
                        ['1st Date', 'left', 'Due date of the first retention release (manual).'],
                        ['2nd Value', 'right', 'Second retention release (half of total retention). Orange = due/not received, green = received.'],
                        ['2nd Date', 'left', 'Due date of the second retention release (manual).'],
                        ['VAT', 'right', 'VAT on the Final Account = Final Account × VAT-type rate. Reverse charge / 0% = £0.'],
                        ['VAT Type', 'left', 'VAT treatment from Xero: reverse charge, 5%, 20%, zero-rated, etc.'],
                        ['Total Due', 'right', 'Final Account + VAT. The full amount due including VAT.'],
                        ['Total Paid', 'right', 'Total received from the customer (including VAT). From Xero / the imported CSV.'],
                        ['Total Remaining (Check)', 'right', 'Total Due − Total Paid. When this reaches £0 everything owed (incl. VAT) has been paid and the retention is closed — the whole row turns green.'],
                        ['Comments', 'left', 'Synced with the Retention comments box in Project Details.'],
                        ['', 'left', ''],
                      ].map(([h, align, tip]) => (
                        <th key={h || 'actions'} title={tip || undefined}
                          style={{ padding: '9px 10px', textAlign: align, fontWeight: 600, color: '#555', whiteSpace: 'nowrap', cursor: tip ? 'help' : 'default' }}>
                          {h}{tip ? <span style={{ color: '#bbb', marginLeft: 3, fontSize: 10 }}>ⓘ</span> : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allEntries.map((entry, i) => {
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
                      // Release cell: orange fill when due & not received; green + "received" when received.
                      const releaseCell = (val, received) => {
                        const has = val != null && val !== '' && !isNaN(parseFloat(val))
                        if (!has) return <td style={{ padding: '8px 10px', textAlign: 'right', color: '#bbb' }}>—</td>
                        return (
                          <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap', background: received ? '#e8f5e9' : '#fff3e0' }}>
                            <div style={{ fontWeight: 600, color: received ? '#166534' : '#b26a00' }}>{fmt(parseFloat(val))}</div>
                            <div style={{ fontSize: 9.5, color: received ? '#16a34a' : '#c77700', fontWeight: 600 }}>{received ? 'received' : 'due'}</div>
                          </td>
                        )
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
                            </td>
                            {/* Customer */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{entry.customerName || '—'}</td>
                            {/* Project */}
                            <td style={{ padding: '8px 10px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.projectName || '—'}</td>
                            {/* Final Account */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(fa || null)}</td>
                            {/* Applied for (manual override) */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{entry.appliedFor != null && entry.appliedFor !== '' ? fmt(parseFloat(entry.appliedFor)) : '—'}</td>
                            {/* Invoiced Net */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{invNet != null ? fmt(invNet) : '—'}</td>
                            {/* Account Remaining */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: accRemaining == null ? '#bbb' : Math.abs(accRemaining) < 1 ? '#16a34a' : '#2563eb' }}>{accRemaining == null ? '—' : fmtC(accRemaining)}</td>
                            {/* Ret % */}
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>{entry.retentionPct ? `${parseFloat(entry.retentionPct).toFixed(0)}%` : '—'}</td>
                            {/* PC Type */}
                            <td style={{ padding: '8px 10px', color: '#555' }}>{entry.pcType || '—'}</td>
                            {/* QS */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{entry.qsName || '—'}</td>
                            {/* 1st Value (coloured) */}
                            {releaseCell(entry.release1Value, entry.release1Received)}
                            {/* 1st Date */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#555' }}>{entry.release1Date || '—'}</td>
                            {/* 2nd Value (coloured) */}
                            {releaseCell(entry.release2Value, entry.release2Received)}
                            {/* 2nd Date */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#555' }}>{entry.release2Date || '—'}</td>
                            {/* VAT */}
                            {vatNeedsManual(entry)
                              ? <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  <span title="This project has mixed VAT treatments across its invoices, so VAT can't be auto-calculated. Enter it manually in Edit." style={{ color: '#dc2626', fontSize: 10.5, cursor: 'help' }}>enter manually</span>
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
                              {entry.manual !== false && (
                                <button onClick={() => deleteEntry(entry.id)}
                                  style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#e63946' }}>Del</button>
                              )}
                            </td>
                          </tr>
                          {isEditing && (
                            <tr key={`edit-${entry.id}`}>
                              <td colSpan={21} style={{ padding: '0 10px 10px' }}>
                                <EntryForm form={editForm} setForm={setEditForm}
                                  onSave={saveEntry}
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
