import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'

export default function StaffPage() {
  const [cms, setCms] = useState([])
  const [estimators, setEstimators] = useState([])
  const [newCm, setNewCm] = useState('')
  const [newEstimator, setNewEstimator] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/staff')
      const data = await res.json()
      setCms(data.cms || [])
      setEstimators(data.estimators || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function save(updatedCms, updatedEstimators) {
    setSaving(true)
    setSaved(false)
    try {
      await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cms: updatedCms, estimators: updatedEstimators })
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  function addCm() {
    const name = newCm.trim()
    if (!name || cms.includes(name)) return
    const updated = [...cms, name].sort()
    setCms(updated)
    setNewCm('')
    save(updated, estimators)
  }

  function removeCm(name) {
    const updated = cms.filter(c => c !== name)
    setCms(updated)
    save(updated, estimators)
  }

  function addEstimator() {
    const name = newEstimator.trim()
    if (!name || estimators.includes(name)) return
    const updated = [...estimators, name].sort()
    setEstimators(updated)
    setNewEstimator('')
    save(cms, updated)
  }

  function removeEstimator(name) {
    const updated = estimators.filter(e => e !== name)
    setEstimators(updated)
    save(cms, updated)
  }

  const inputStyle = { flex: 1, padding: '8px 12px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, outline: 'none' }
  const addBtnStyle = { background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }

  return (
    <>
      <Head><title>Rock Roofing — Staff</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <div style={{ background: '#1a1a2e', padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Link href="/commercial" style={{ color: '#888', fontSize: 13 }}>← Budget Tracker</Link>
              <span style={{ color: '#444' }}>|</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
                <span style={{ color: '#fff', fontWeight: 600, fontSize: 16 }}>Staff Management</span>
              </div>
            </div>
            {saved && <span style={{ color: '#16a34a', fontSize: 13, background: '#f0fdf4', padding: '4px 12px', borderRadius: 6 }}>✓ Saved</span>}
          </div>
        </div>

        <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 24px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 40 }}>Loading...</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

              <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ marginBottom: 20 }}>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>Contracts Managers</h2>
                  <p style={{ fontSize: 12, color: '#888', margin: '4px 0 0' }}>{cms.length} people</p>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                  <input value={newCm} onChange={e => setNewCm(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCm()} placeholder="Full name" style={inputStyle} />
                  <button onClick={addCm} style={addBtnStyle} disabled={!newCm.trim()}>Add</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {cms.length === 0 ? (
                    <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No contracts managers added yet</div>
                  ) : cms.map(name => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#f8f9fa', borderRadius: 8, border: '1px solid #eee' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 28, height: 28, background: '#1a1a2e', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                          {name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
                      </div>
                      <button onClick={() => removeCm(name)} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 16, padding: '2px 6px', borderRadius: 4, lineHeight: 1 }} title="Remove">×</button>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ marginBottom: 20 }}>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>Estimators</h2>
                  <p style={{ fontSize: 12, color: '#888', margin: '4px 0 0' }}>{estimators.length} people</p>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                  <input value={newEstimator} onChange={e => setNewEstimator(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEstimator()} placeholder="Full name" style={inputStyle} />
                  <button onClick={addEstimator} style={addBtnStyle} disabled={!newEstimator.trim()}>Add</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {estimators.length === 0 ? (
                    <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No estimators added yet</div>
                  ) : estimators.map(name => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#f8f9fa', borderRadius: 8, border: '1px solid #eee' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 28, height: 28, background: '#e63946', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                          {name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
                      </div>
                      <button onClick={() => removeEstimator(name)} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 16, padding: '2px 6px', borderRadius: 4, lineHeight: 1 }} title="Remove">×</button>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}
          <div style={{ marginTop: 24, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#92400e' }}>
            <strong>Note:</strong> These lists populate the dropdowns when editing project settings. Removing a person here won't change any existing project assignments — it only removes them from future selections.
          </div>
        </div>
      </div>
    </>
  )
}
