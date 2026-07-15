import { useState, useEffect } from 'react'
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
  const [filter, setFilter] = useState('all') // all, pending, overdue, released
  const [search, setSearch] = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      // Load manual entries
      const r1 = await fetch('/api/retention')
      const d1 = await r1.json()
      setEntries(d1.entries || [])

      // Load Xero projects with retention
      const r2 = await fetch('/api/dashboard')
      const d2 = await r2.json()
      const withRetention = (d2.projects || [])
        .filter(p => p.retentionOutstanding > 0 || p.grossInvoiced > 0)
        .map(p => ({
          id: p.xeroId,
          xeroId: p.xeroId,
          ourRef: p.jobNo || '',
          customerName: p.customer || '',
          projectName: p.name || '',
          projectValue: p.contractValue || 0,
          finalAccount: p.afa || 0,
          retentionPct: (p.retentionPct || 0) * 100,
          completionDate: '',
          pcType: '',
          qsName: p.estimator || '',
          qsEmail: '',
          invoiced: p.totalInvoiced || 0,
          vat: p.vat || 0,
          vatRateLabel: p.vatRateLabel || '—',
          paid: p.paid || 0,
          release1Value: (p.grossInvoiced - p.totalInvoiced) / 2 || 0,
          release1Date: '',
          release1Received: false,
          release2Value: (p.grossInvoiced - p.totalInvoiced) / 2 || 0,
          release2Date: '',
          release2Received: false,
          comments: p.comment || '',
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
        invoiced: x.invoiced, vat: x.vat, vatRateLabel: x.vatRateLabel, paid: x.paid,
        finalAccount: e.finalAccount || x.finalAccount,
        projectValue: e.projectValue || x.projectValue,
        retentionPct: e.retentionPct || x.retentionPct,
      }
    }
    return e
  })
  const manualIds = new Set(entries.map(e => e.xeroId).filter(Boolean))
  const allEntries = [
    ...xeroEntries.filter(x => !manualIds.has(x.xeroId) && !entries.find(e => e.id === x.xeroId)),
    ...mergedEntries
  ].filter(e => {
    const balance = calcBalance(e)
    if (filter === 'overdue') {
      const now = new Date().toISOString().split('T')[0]
      return (e.release1Date && !e.release1Received && e.release1Date < now) ||
             (e.release2Date && !e.release2Received && e.release2Date < now)
    }
    if (filter === 'pending') return !e.release1Received || !e.release2Received
    if (filter === 'released') return e.release1Received && e.release2Received
    return true
  }).filter(e => {
    if (!search) return true
    const q = search.toLowerCase()
    return e.ourRef?.toLowerCase().includes(q) || e.customerName?.toLowerCase().includes(q) || e.projectName?.toLowerCase().includes(q)
  })

  const totals = {
    total: allEntries.reduce((s, e) => s + (parseFloat(e.release1Value || 0) + parseFloat(e.release2Value || 0)), 0),
    outstanding: allEntries.reduce((s, e) => s + calcBalance(e), 0),
    overdue: allEntries.filter(e => {
      const now = new Date().toISOString().split('T')[0]
      return (e.release1Date && !e.release1Received && e.release1Date < now) ||
             (e.release2Date && !e.release2Received && e.release2Date < now)
    }).reduce((s, e) => s + calcBalance(e), 0)
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
          {[['projectValue', 'Project Value £'], ['finalAccount', 'Final Account £'], ['retentionPct', 'Retention %'], ['completionDate', 'Completion Date'], ['qsName', 'QS Name']].map(([key, label]) => (
            <div key={key}>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>{label}</div>
              <input type={key.includes('Date') ? 'date' : key.includes('Value') || key.includes('Pct') || key.includes('pct') ? 'number' : 'text'}
                value={form[key] || ''} onChange={f(key)} style={inputStyle} />
            </div>
          ))}
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
              { label: 'Outstanding', value: fmtC(totals.outstanding), color: '#2563eb' },
              { label: 'Overdue', value: fmtC(totals.overdue), color: totals.overdue > 0 ? '#e63946' : '#888' },
              { label: 'Projects tracked', value: allEntries.length, raw: true },
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
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', background: '#f0f2f5', borderRadius: 8, overflow: 'hidden' }}>
              {[['all', 'All'], ['pending', 'Pending'], ['overdue', 'Overdue'], ['released', 'Released']].map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)}
                  style={{ padding: '6px 12px', border: 'none', background: filter === key ? '#1a1a2e' : 'transparent', color: filter === key ? '#fff' : '#555', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {label}
                </button>
              ))}
            </div>
            <input placeholder="Search ref, customer, project..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, padding: '7px 12px', border: '1px solid #e5e5e5', borderRadius: 8, fontSize: 12 }} />
            <span style={{ fontSize: 12, color: '#888' }}>{allEntries.length} entries</span>
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
                      {['Ref', 'Customer', 'Project', 'Final Account', 'Invoiced', 'VAT', 'VAT Type', 'Paid', 'Final Bal', 'Ret %', 'PC Type', 'QS', 'Status',
                        '1st Value', '1st Date', '1st Rcvd',
                        '2nd Value', '2nd Date', '2nd Rcvd',
                        'Balance', 'Comments', ''].map(h => (
                        <th key={h} style={{ padding: '9px 10px', textAlign: ['1st Value', '2nd Value', 'Final Account', 'Balance', 'Invoiced', 'VAT', 'Paid', 'Final Bal'].includes(h) ? 'right' : 'left', fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allEntries.map((entry, i) => {
                      const balance = calcBalance(entry)
                      const badge = statusBadge(entry)
                      const isEditing = editingId === entry.id
                      const now = new Date().toISOString().split('T')[0]
                      const r1Overdue = entry.release1Date && !entry.release1Received && entry.release1Date < now
                      const r2Overdue = entry.release2Date && !entry.release2Received && entry.release2Date < now
                      return (
                        <>
                          <tr key={entry.id} style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                            <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1a1a2e', whiteSpace: 'nowrap' }}>
                              {entry.manual === false && entry.xeroId
                                ? <Link href={`/project/${entry.xeroId}`} style={{ color: '#2563eb' }}>{entry.ourRef}</Link>
                                : entry.ourRef || '—'}
                              {!entry.manual && <span style={{ marginLeft: 4, fontSize: 9, background: '#eef2ff', color: '#4f46e5', borderRadius: 4, padding: '1px 4px' }}>Xero</span>}
                            </td>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{entry.customerName || '—'}</td>
                            <td style={{ padding: '8px 10px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.projectName || '—'}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(parseFloat(entry.finalAccount) || parseFloat(entry.projectValue) || null)}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{entry.invoiced != null && entry.invoiced !== '' ? fmt(parseFloat(entry.invoiced)) : '—'}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{entry.vat != null && entry.vat !== '' ? fmt(parseFloat(entry.vat)) : '—'}</td>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#555', fontSize: 11.5 }}>{entry.vatRateLabel && entry.vatRateLabel !== '—' ? entry.vatRateLabel : '—'}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{entry.paid != null && entry.paid !== '' ? fmt(parseFloat(entry.paid)) : '—'}</td>
                            {(() => { const fb = calcFinalBalance(entry); const has = (entry.finalAccount || entry.projectValue) && (entry.paid != null && entry.paid !== '')
                              return <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: !has ? '#bbb' : Math.abs(fb) < 1 ? '#16a34a' : '#2563eb' }}>{has ? fmtC(fb) : '—'}</td> })()}
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>{entry.retentionPct ? `${parseFloat(entry.retentionPct).toFixed(0)}%` : '—'}</td>
                            <td style={{ padding: '8px 10px', color: '#555' }}>{entry.pcType || '—'}</td>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{entry.qsName || '—'}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, background: badge.bg, color: badge.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{badge.label}</span>
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(parseFloat(entry.release1Value) || null)}</td>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: r1Overdue ? '#e63946' : '#555', fontWeight: r1Overdue ? 600 : 400 }}>
                              {entry.release1Date || '—'}
                              {r1Overdue && <span style={{ marginLeft: 4, fontSize: 9, background: '#fef2f2', color: '#e63946', borderRadius: 4, padding: '1px 4px' }}>OVERDUE</span>}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                              {entry.manual !== false ? (
                                <input type="checkbox" checked={!!entry.release1Received}
                                  onChange={async e => {
                                    const updated = { ...entry, release1Received: e.target.checked }
                                    await saveEntry(updated)
                                  }} style={{ cursor: 'pointer' }} />
                              ) : (
                                <span style={{ color: entry.release1Received ? '#16a34a' : '#ddd', fontSize: 14 }}>{entry.release1Received ? '✓' : '○'}</span>
                              )}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(parseFloat(entry.release2Value) || null)}</td>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: r2Overdue ? '#e63946' : '#555', fontWeight: r2Overdue ? 600 : 400 }}>
                              {entry.release2Date || '—'}
                              {r2Overdue && <span style={{ marginLeft: 4, fontSize: 9, background: '#fef2f2', color: '#e63946', borderRadius: 4, padding: '1px 4px' }}>OVERDUE</span>}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                              {entry.manual !== false ? (
                                <input type="checkbox" checked={!!entry.release2Received}
                                  onChange={async e => {
                                    const updated = { ...entry, release2Received: e.target.checked }
                                    await saveEntry(updated)
                                  }} style={{ cursor: 'pointer' }} />
                              ) : (
                                <span style={{ color: entry.release2Received ? '#16a34a' : '#ddd', fontSize: 14 }}>{entry.release2Received ? '✓' : '○'}</span>
                              )}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: balance > 0 ? '#2563eb' : '#16a34a', whiteSpace: 'nowrap' }}>{fmtC(balance)}</td>
                            <td style={{ padding: '8px 10px', color: '#555', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.comments || '—'}</td>
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
                              <td colSpan={22} style={{ padding: '0 10px 10px' }}>
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
