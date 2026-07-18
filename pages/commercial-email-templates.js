import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { CHASE_MERGE_FIELDS } from '../lib/chaseEmailTemplates'

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    try {
      const d = await fetch('/api/chase-email-templates').then(r => r.json())
      setTemplates(d.templates || [])
    } catch { setMsg('Could not load templates.') }
    setLoading(false)
  }

  function update(key, field, value) {
    setTemplates(ts => ts.map(t => t.key === key ? { ...t, [field]: value } : t))
  }

  async function save() {
    setSaving(true); setMsg('')
    try {
      const res = await fetch('/api/chase-email-templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates })
      })
      if (res.ok) setMsg('Saved.')
      else { const d = await res.json(); setMsg(d.error || 'Save failed.') }
    } catch { setMsg('Save failed.') }
    setSaving(false)
  }

  return (
    <>
      <Head><title>Rock Roofing — Chase Email Templates</title></Head>
      <div style={{ minHeight: '100vh', background: '#f5f5f4' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 56, flexWrap: 'wrap' }}>
            <Link href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>← Portal</Link>
            <Link href="/outstanding-invoices" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px' }}>Outstanding Invoices</Link>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Chase Email Templates</span>
          </div>
        </div>

        <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
          <h1 style={{ fontSize: 20, color: '#1a1a2e', marginBottom: 4 }}>Chase Email Templates</h1>
          <p style={{ fontSize: 13, color: '#666', marginTop: 0 }}>
            These are the standard invoice-chase emails sent from the Outstanding Invoices page. Edit the subject and body below; changes apply to future emails only.
          </p>

          <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 12, color: '#3730a3' }}>
            <strong>Merge fields</strong> (typed exactly, replaced when the email is drafted):<br />
            <span style={{ fontFamily: 'monospace', fontSize: 11, lineHeight: 1.8 }}>{CHASE_MERGE_FIELDS.join('  ')}</span>
          </div>

          {loading ? <p style={{ color: '#888' }}>Loading…</p> : templates.map(t => (
            <div key={t.key} style={{ background: '#fff', borderRadius: 10, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', marginBottom: 12 }}>{t.label}</div>

              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Subject</label>
              <input value={t.subject || ''} onChange={e => update(t.key, 'subject', e.target.value)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', marginBottom: 12 }} />

              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Body</label>
              <textarea value={t.body || ''} onChange={e => update(t.key, 'body', e.target.value)} rows={t.key === 'withdrawal' ? 20 : 8}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }} />

              <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: '#555' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!t.ccSiteManager} onChange={e => update(t.key, 'ccSiteManager', e.target.checked)} />
                  Auto-CC customer site manager
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!t.ccRockCM} onChange={e => update(t.key, 'ccRockCM', e.target.checked)} />
                  Auto-CC Rock Roofing CM
                </label>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', bottom: 0, background: '#f5f5f4', padding: '12px 0' }}>
            <button onClick={save} disabled={saving || loading}
              style={{ background: saving ? '#ccc' : '#0f766e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save templates'}
            </button>
            {msg && <span style={{ fontSize: 13, color: msg === 'Saved.' ? '#16a34a' : '#dc2626' }}>{msg}</span>}
          </div>
        </div>
      </div>
    </>
  )
}
