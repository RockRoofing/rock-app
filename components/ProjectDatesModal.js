import { useState, useEffect } from 'react'
import Link from 'next/link'

// The exact "set dates" box used by the Application Calendar: an amber missing-dates
// notice, the fixed recurring day-of-month fields, an "Add monthly dates manually"
// per-month override table, plus Save dates / View project. Self-contained — it
// loads the project's settings, saves them, and calls onSaved() so the caller can
// refresh. Used on both the Application Calendar and the Applications page so they
// stay identical and both write through to project settings.
export default function ProjectDatesModal({ project, onClose, onSaved }) {
  const [dayFields, setDayFields] = useState({ applicationDay: '', valuationDay: '', paymentDay: '' })
  const [monthOverrides, setMonthOverrides] = useState({})
  const [showManualMonths, setShowManualMonths] = useState(false)
  const [modalLoading, setModalLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const missingAny = !dayFields.applicationDay || !dayFields.valuationDay || !dayFields.paymentDay

  useEffect(() => { (async () => {
    setModalLoading(true)
    try {
      const data = await fetch(`/api/project/${project.xeroId}`).then(r => r.json())
      const s = data.settings || {}
      setDayFields({
        applicationDay: s.applicationDay || '',
        valuationDay: s.valuationDay || '',
        paymentDay: s.paymentDay || '',
      })
      setMonthOverrides(s.dateOverrides || {})
    } catch { setDayFields({ applicationDay: '', valuationDay: '', paymentDay: '' }); setMonthOverrides({}) }
    setModalLoading(false)
  })() }, [project.xeroId])

  async function saveDates() {
    setSaving(true)
    try {
      const data = await fetch(`/api/project/${project.xeroId}`).then(r => r.json())
      const settings = data.settings || {}
      const updatedSettings = {
        ...settings,
        applicationDay: dayFields.applicationDay || undefined,
        valuationDay: dayFields.valuationDay || undefined,
        paymentDay: dayFields.paymentDay || undefined,
        dateOverrides: monthOverrides,
      }
      await fetch(`/api/project/${project.xeroId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings),
      })
      if (onSaved) onSaved(updatedSettings)
    } catch { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: '100%', maxWidth: 620, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: '#1a1a2e' }}>{[project.jobNo, project.name].filter(Boolean).join(' — ')}</h3>
          <button onClick={onClose} style={{ fontSize: 20, border: 'none', background: 'none', cursor: 'pointer', color: '#888' }}>×</button>
        </div>

        <div>
          {missingAny && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
              ⚠ Missing one or more dates — set the fixed monthly days below, or add specific monthly dates manually.
            </div>
          )}

          {/* 1) Fixed recurring day-of-month */}
          <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>Fixed monthly dates</div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>The day of each month these dates normally fall on. Used for every month unless overridden manually below.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Application day', key: 'applicationDay', color: '#1e40af', bg: '#dbeafe' },
              { label: 'Valuation day', key: 'valuationDay', color: '#065f46', bg: '#d1fae5' },
              { label: 'Payment day', key: 'paymentDay', color: '#92400e', bg: '#fef3c7' },
            ].map(item => (
              <div key={item.key} style={{ background: item.bg, borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: item.color, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' }}>{item.label}</div>
                <input type="number" min="1" max="31" placeholder="e.g. 25"
                  value={dayFields[item.key] || ''}
                  onChange={e => setDayFields(d => ({ ...d, [item.key]: e.target.value }))}
                  style={{ width: '100%', minWidth: 0, fontSize: 12, padding: '5px 6px', border: `1px solid ${item.color}44`, borderRadius: 6, background: '#fff', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              </div>
            ))}
          </div>

          {/* 2) Manual per-month override table (same as Project Details) */}
          <button onClick={() => setShowManualMonths(s => !s)}
            style={{ background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#6366f1', marginBottom: showManualMonths ? 12 : 0 }}>
            {showManualMonths ? '▲ Hide manual monthly dates' : '＋ Add monthly dates manually'}
          </button>
          {showManualMonths && (
            <div style={{ marginBottom: 16, border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden', maxHeight: 320, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f8f9fa', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e5e5', fontWeight: 600, color: '#555' }}>Month</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e5e5', fontWeight: 600, color: '#555' }}>Application</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e5e5', fontWeight: 600, color: '#555' }}>Valuation</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e5e5', fontWeight: 600, color: '#555' }}>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 14 }, (_, i) => {
                    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 2 + i)
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                    const label = d.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
                    const row = monthOverrides[key] || {}
                    const [ky, km] = key.split('-').map(n => parseInt(n, 10))
                    const monthMin = `${key}-01`
                    const monthMax = `${key}-${String(new Date(ky, km, 0).getDate()).padStart(2, '0')}`
                    return (
                      <tr key={key} style={{ borderBottom: '0.5px solid #f0f0f0' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 500, color: '#1a1a2e', whiteSpace: 'nowrap' }}>{label}</td>
                        {['applicationDate', 'valuationDate', 'paymentDate'].map(field => (
                          <td key={field} style={{ padding: '4px 8px' }}>
                            <input type="date" value={row[field] || ''} min={monthMin} max={monthMax}
                              onChange={e => {
                                const next = { ...monthOverrides, [key]: { ...row, [field]: e.target.value || undefined } }
                                if (!next[key].applicationDate && !next[key].valuationDate && !next[key].paymentDate) delete next[key]
                                setMonthOverrides(next)
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

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={saveDates} disabled={saving || modalLoading}
              style={{ flex: 1, background: (saving || modalLoading) ? '#ccc' : '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px', fontSize: 13, fontWeight: 500, cursor: (saving || modalLoading) ? 'not-allowed' : 'pointer' }}>
              {modalLoading ? 'Loading…' : saving ? 'Saving...' : 'Save dates'}
            </button>
            <Link href={`/project/${project.xeroId}`}
              style={{ padding: '9px 16px', background: '#f0f2f5', color: '#1a1a2e', borderRadius: 8, fontSize: 13, textDecoration: 'none', fontWeight: 500 }}>
              View project ↗
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
