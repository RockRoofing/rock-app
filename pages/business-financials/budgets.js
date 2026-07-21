import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, GOLD, gbp, monthLbl, Card } from '../../components/BizNav'

// Categories we budget against, mapped to the actuals the API returns.
const CATS = [
  ['sales', 'Sales', false],          // higher is better
  ['costOfSales', 'Cost of sales', true],
  ['overheads', 'Overheads', true],
]

export default function Budgets() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [budgets, setBudgets] = useState({})   // { [cat]: monthlyTarget }
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  async function load() {
    setLoading(true)
    try {
      const d = await fetch('/api/business-financials?view=budgets').then(r => r.json())
      setData(d); setBudgets(d.budgets || {})
    } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  async function save() {
    setSaving(true); setSaved(false)
    try {
      await fetch('/api/business-financials?view=budgets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'budgets', budgets }) })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch {}
    setSaving(false)
  }

  if (!ok) return null

  const actuals = data?.actuals || {}
  const months = Object.keys(actuals).sort().slice(-12)

  return (
    <>
      <Head><title>Budgets · Business Financials</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <BizNav />
        <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
          <h1 style={{ fontSize: 22, color: INK, margin: '0 0 6px' }}>Budgets</h1>
          <p style={{ fontSize: 13, color: '#777', margin: '0 0 18px' }}>Set a monthly target for each category. Each month is shaded green when on or under budget (for costs) or on/above target (for sales), and red when off track.</p>

          {loading ? <div style={{ color: '#999', padding: 40 }}>Loading…</div> : (
            <>
              {/* Budget setters */}
              <Card>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  {CATS.map(([key, label]) => (
                    <div key={key}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{label} — monthly budget</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: '#999' }}>£</span>
                        <input type="number" value={budgets[key] ?? ''} onChange={e => setBudgets(b => ({ ...b, [key]: e.target.value === '' ? '' : Number(e.target.value) }))}
                          placeholder="0" style={{ width: 130, padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }} />
                      </div>
                    </div>
                  ))}
                  <button onClick={save} disabled={saving} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save budgets'}</button>
                  {saved && <span style={{ color: '#16a34a', fontSize: 13, fontWeight: 600 }}>Saved ✓</span>}
                </div>
              </Card>

              {/* Budget vs spend table */}
              <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                      <th style={{ ...th, textAlign: 'left' }}>Month</th>
                      {CATS.map(([key, label]) => <th key={key} style={th}>{label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {months.map(mo => (
                      <tr key={mo} style={{ borderBottom: '1px solid #f2f0ec' }}>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{monthLbl(mo)}</td>
                        {CATS.map(([key, , costLike]) => {
                          const actual = actuals[mo]?.[key] || 0
                          const budget = Number(budgets[key] || 0)
                          const onTrack = !budget ? null : (costLike ? actual <= budget : actual >= budget)
                          const bg = onTrack == null ? 'transparent' : onTrack ? '#f0fdf4' : '#fef2f2'
                          const col = onTrack == null ? '#555' : onTrack ? '#166534' : '#b91c1c'
                          return (
                            <td key={key} style={{ ...td, background: bg, color: col, fontWeight: 600 }}>
                              {gbp(actual)}
                              {budget > 0 && <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.8 }}>of {gbp(budget)}</div>}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>Actuals from the P&amp;L benchmark ({data?.benchmarkUpdatedAt ? new Date(data.benchmarkUpdatedAt).toLocaleDateString('en-GB') : 'not synced'}). Budgets are the same target applied to every month.</div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

const th = { padding: '10px 12px', fontSize: 12, color: '#777', fontWeight: 600, textAlign: 'right' }
const td = { padding: '9px 12px', textAlign: 'right' }
