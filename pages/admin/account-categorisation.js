import { useState, useEffect } from 'react'
import AdminShell from '../../components/AdminShell'

const GOLD = '#ca8a04', INK = '#1a1a19'

export default function AccountCategorisationPage() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const d = await fetch('/api/account-categorisation').then(r => r.json())
      setAccounts(d.accounts || [])
    } catch (e) { setErr('Could not load accounts.') }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function setCategory(code, category) {
    setAccounts(prev => prev.map(a => a.code === code ? { ...a, category } : a))
    setDirty(true); setNotice('')
  }

  async function save() {
    setSaving(true); setErr(''); setNotice('')
    try {
      const r = await fetch('/api/account-categorisation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts }),
      })
      const d = await r.json()
      if (!r.ok || !d.ok) { setErr(d.error || 'Could not save.'); setSaving(false); return }
      setNotice('Saved. New cost uploads will use these categories; existing figures refresh on the next upload.')
      setDirty(false)
    } catch (e) { setErr(e?.message || 'Could not save.') }
    setSaving(false)
  }

  const counts = {
    labour: accounts.filter(a => a.category === 'labour').length,
    materials: accounts.filter(a => a.category === 'materials').length,
    ignore: accounts.filter(a => a.category === 'ignore').length,
  }

  const pill = (active, color, bg) => ({
    padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    border: '1px solid ' + (active ? color : '#e0e0e0'),
    background: active ? bg : '#fff', color: active ? color : '#888',
  })

  return (
    <AdminShell active="/admin/account-categorisation" title="Account Categorisation">
      <div style={{ maxWidth: 820 }}>
        <h1 style={{ fontSize: 22, color: INK, margin: '0 0 6px' }}>Account Categorisation</h1>
        <p style={{ color: '#777', fontSize: 14, margin: '0 0 20px' }}>
          Assign each cost-of-sale account to <strong>Labour</strong> or <strong>Materials</strong> (or <strong>Ignore</strong> to exclude it from project costs). This drives the Labour/Materials split used across Project Financials. Accounts appear here automatically once they've been seen in a Cost Transactions upload.
        </p>

        {notice && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#166534' }}>{notice}</div>}
        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#b91c1c' }}>{err}</div>}

        {loading ? <div style={{ color: '#aaa', padding: 20 }}>Loading…</div>
          : accounts.length === 0 ? (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 20, fontSize: 14, color: '#92400e' }}>
              No accounts yet. Run a <strong>Cost Transactions</strong> upload (Project Financials → Upload) first — the cost-of-sale accounts from your Xero export will then appear here to categorise.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, fontSize: 12, color: '#777' }}>
                <span>{accounts.length} accounts</span><span>·</span>
                <span style={{ color: '#2563eb' }}>{counts.labour} labour</span><span>·</span>
                <span style={{ color: '#0f766e' }}>{counts.materials} materials</span><span>·</span>
                <span style={{ color: '#999' }}>{counts.ignore} ignored</span>
              </div>
              <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                      <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 12, color: '#777', fontWeight: 600, width: 90 }}>Code</th>
                      <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 12, color: '#777', fontWeight: 600 }}>Account name</th>
                      <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 12, color: '#777', fontWeight: 600, width: 260 }}>Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a, i) => (
                      <tr key={a.code} style={{ borderBottom: '1px solid #f2f0ec', background: i % 2 ? '#fcfbf9' : '#fff' }}>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: INK }}>{a.code}</td>
                        <td style={{ padding: '10px 14px', fontSize: 13, color: '#333' }}>{a.name || <span style={{ color: '#bbb' }}>—</span>}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <span onClick={() => setCategory(a.code, 'labour')} style={pill(a.category === 'labour', '#2563eb', '#eff6ff')}>Labour</span>
                            <span onClick={() => setCategory(a.code, 'materials')} style={pill(a.category === 'materials', '#0f766e', '#f0fdfa')}>Materials</span>
                            <span onClick={() => setCategory(a.code, 'ignore')} style={pill(a.category === 'ignore', '#999', '#f5f5f5')}>Ignore</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={save} disabled={saving || !dirty}
                  style={{ background: INK, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 22px', fontSize: 14, fontWeight: 600, cursor: saving || !dirty ? 'default' : 'pointer', opacity: saving || !dirty ? 0.5 : 1 }}>
                  {saving ? 'Saving…' : 'Save categories'}
                </button>
                {dirty && <span style={{ fontSize: 12, color: '#b45309' }}>Unsaved changes</span>}
              </div>
              <p style={{ fontSize: 12, color: '#999', marginTop: 12 }}>
                After saving, re-upload a project's Cost Transactions to recalculate its Labour/Materials split with the new categories.
              </p>
            </>
          )}
      </div>
    </AdminShell>
  )
}
