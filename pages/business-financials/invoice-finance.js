import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BizNav, INK, GOLD, gbp, Card } from '../../components/BizNav'

const pad = (n) => String(n).padStart(2, '0')
const norm = (s) => String(s || '').toLowerCase()
  .replace(/&/g, 'and')
  .replace(/\b(ltd|limited|plc|llp|uk|co|company|the)\b/g, '')
  .replace(/[^a-z0-9]/g, '')
  .trim()
const daysBetween = (a, b) => Math.floor((b - a) / 86400000)

// Parse a Bibby "Limit List" CSV. Header has two preamble rows + blank line, then the
// real header starting with "Buyer Name". We take Buyer Name + Approved Amount, summing
// duplicates. Returns { [debtorName]: approvedAmount }.
function parseBibbyCsv(text) {
  const lines = text.split(/\r?\n/)
  let headerIdx = lines.findIndex(l => /^"?buyer name"?,/i.test(l))
  if (headerIdx < 0) return { limits: {}, error: 'Could not find the "Buyer Name" header row.' }
  const header = splitCsvLine(lines[headerIdx]).map(h => h.trim().toLowerCase())
  const iName = header.findIndex(h => h === 'buyer name')
  const iApproved = header.findIndex(h => h === 'approved amount')
  if (iName < 0 || iApproved < 0) return { limits: {}, error: 'CSV missing Buyer Name or Approved Amount column.' }
  const limits = {}
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cells = splitCsvLine(lines[i])
    const name = (cells[iName] || '').trim()
    if (!name) continue
    const approved = parseFloat((cells[iApproved] || '0').replace(/[",]/g, '')) || 0
    limits[name] = (limits[name] || 0) + approved
  }
  return { limits, error: null }
}
function splitCsvLine(line) {
  const out = []; let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ }
    else if (c === ',' && !inQ) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

export default function InvoiceFinance() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState({ advanceRate: 60, drawn: 0, excludeMaterials: false })
  const [limits, setLimits] = useState({})            // { debtorName: { insuredLimit, materialsOnSite } }
  const [excludedInvoices, setExcludedInvoices] = useState({}) // { invoiceId: true } - final applications etc
  const [saving, setSaving] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const fileRef = useRef(null)

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
      const d = await fetch('/api/business-financials?view=invoice-finance').then(r => r.json())
      setData(d)
      setSettings({ advanceRate: d.settings?.advanceRate ?? 60, drawn: d.settings?.drawn ?? 0, excludeMaterials: !!d.settings?.excludeMaterials })
      setLimits(d.debtorLimits || {})
      const ex = {}
      Object.entries(d.debtorLimits || {}).forEach(() => {})
      setExcludedInvoices((d.settings && d.settings.excludedInvoices) || {})
    } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  // Group receivables by debtor.
  const debtors = useMemo(() => {
    if (!data?.receivables) return []
    const now = new Date()
    const byName = {}
    for (const inv of data.receivables) {
      const name = inv.contact || '(no name)'
      if (!byName[name]) byName[name] = { name, key: norm(name), invoices: [], outstanding: 0 }
      byName[name].invoices.push(inv)
    }
    const rate = (Number(settings.advanceRate) || 0) / 100
    return Object.values(byName).map(d => {
      const lim = limits[d.name] || {}
      const insured = Number(lim.insuredLimit) || 0
      const materialsOnSite = !!lim.materialsOnSite
      // Eligible outstanding = all invoices for this debtor, minus any invoice flagged
      // excluded (e.g. final application). Materials handled by the per-debtor flag.
      let eligibleOutstanding = 0, excludedTotal = 0
      for (const inv of d.invoices) {
        if (excludedInvoices[inv.id]) { excludedTotal += inv.amountDue; continue }
        eligibleOutstanding += inv.amountDue
      }
      const outstanding = d.invoices.reduce((s, i) => s + i.amountDue, 0)
      const rawAdvance = materialsOnSite ? 0 : eligibleOutstanding * rate
      const cappedAdvance = insured > 0 ? Math.min(rawAdvance, insured) : 0
      const hasLimit = insured > 0
      return {
        ...d, insured, materialsOnSite, outstanding, eligibleOutstanding, excludedTotal,
        rawAdvance, advance: cappedAdvance, hasLimit,
        cappedByLimit: hasLimit && rawAdvance > insured,
      }
    }).sort((a, b) => b.advance - a.advance || b.outstanding - a.outstanding)
  }, [data, limits, settings.advanceRate, excludedInvoices])

  const totals = useMemo(() => {
    const totalOutstanding = debtors.reduce((s, d) => s + d.outstanding, 0)
    const totalAdvance = debtors.reduce((s, d) => s + d.advance, 0)
    const drawn = Number(settings.drawn) || 0
    const availability = totalAdvance - drawn
    const noLimit = debtors.filter(d => !d.hasLimit && d.outstanding > 0)
    return { totalOutstanding, totalAdvance, drawn, availability, noLimitCount: noLimit.length, noLimitValue: noLimit.reduce((s, d) => s + d.outstanding, 0) }
  }, [debtors, settings.drawn])

  async function saveAll() {
    setSaving(true)
    try {
      await fetch('/api/business-financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'invoice-finance', action: 'save-settings', settings: { ...settings, excludedInvoices } }) })
      await fetch('/api/business-financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'invoice-finance', action: 'save-limits', debtorLimits: limits }) })
    } catch {}
    setSaving(false)
  }

  function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const { limits: parsed, error } = parseBibbyCsv(String(reader.result))
      if (error) { setImportMsg('Import failed: ' + error); return }
      // Match parsed Bibby buyer names to Xero debtor names by normalised key.
      const xeroNames = (data?.receivables || []).map(i => i.contact).filter(Boolean)
      const xeroByKey = {}
      for (const n of xeroNames) xeroByKey[norm(n)] = n
      let matched = 0, unmatched = 0
      const next = { ...limits }
      const unmatchedNames = []
      for (const [bibbyName, amount] of Object.entries(parsed)) {
        const xn = xeroByKey[norm(bibbyName)]
        if (xn) { next[xn] = { ...(next[xn] || {}), insuredLimit: amount }; matched++ }
        else { next[bibbyName] = { ...(next[bibbyName] || {}), insuredLimit: amount }; unmatched++; unmatchedNames.push(bibbyName) }
      }
      setLimits(next)
      setImportMsg(`Imported ${Object.keys(parsed).length} limits. ${matched} matched a Xero debtor, ${unmatched} did not (stored under the Bibby name)${unmatchedNames.length ? ': ' + unmatchedNames.slice(0, 6).join(', ') + (unmatchedNames.length > 6 ? '...' : '') : ''}. Review, then Save.`)
    }
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  function setLimit(name, field, value) {
    setLimits(prev => ({ ...prev, [name]: { ...(prev[name] || {}), [field]: value } }))
  }

  if (!ok) return null

  return (
    <>
      <Head><title>Invoice Finance - Rock Roofing</title></Head>
      <BizNav />
      <div style={{ maxWidth: '100%', padding: '24px 32px 80px' }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, color: INK, fontSize: 26 }}>Invoice Finance (Bibby) availability</h1>
          <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4 }}>Estimates cash available from the facility: {settings.advanceRate}% of each debtor&apos;s outstanding invoices, capped at their insured (approved) limit. Debtors with no limit are excluded. Final applications can be excluded per invoice.</div>
        </div>

        {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : !data ? <div style={{ color: '#b91c1c', padding: 40 }}>Could not load.</div> : (
          <>
            {/* Top figures */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <Box label="Outstanding sales ledger" value={gbp(totals.totalOutstanding)} />
              <Box label={`Eligible advance @ ${settings.advanceRate}%`} value={gbp(totals.totalAdvance)} color="#0f766e" sub="capped at insured limits" />
              <Box label="Currently drawn" value={gbp(totals.drawn)} color="#b45309" />
              <Box label="Availability now" value={gbp(totals.availability)} color={totals.availability < 0 ? '#dc2626' : '#0f766e'} strong sub="advance minus drawn" />
            </div>

            {totals.noLimitCount > 0 && (
              <div style={{ fontSize: 12.5, color: '#b45309', marginBottom: 14, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>
                {totals.noLimitCount} debtor(s) with outstanding invoices have no insured limit set ({gbp(totals.noLimitValue)} of ledger not advanced). Set their limit below or import the Bibby list.
              </div>
            )}

            {/* Controls */}
            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', marginBottom: 18, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div><div style={lbl}>Advance rate %</div><input type="number" value={settings.advanceRate} onChange={e => setSettings(s => ({ ...s, advanceRate: e.target.value }))} style={{ ...inp, width: 90 }} /></div>
              <div><div style={lbl}>Currently drawn (from Bibby)</div><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: '#999' }}>&pound;</span><input type="number" value={settings.drawn} onChange={e => setSettings(s => ({ ...s, drawn: e.target.value }))} style={{ ...inp, width: 140 }} /></div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="file" accept=".csv" ref={fileRef} onChange={onFile} style={{ display: 'none' }} id="bibbyfile" />
                <label htmlFor="bibbyfile" style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, cursor: 'pointer', color: '#333' }}>Import Bibby limit list (CSV)</label>
              </div>
              <button onClick={saveAll} disabled={saving} style={{ background: INK, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving...' : 'Save'}</button>
              {importMsg && <div style={{ fontSize: 11.5, color: '#555', flexBasis: '100%' }}>{importMsg}</div>}
            </div>

            {/* Debtor table */}
            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 900 }}>
                <thead>
                  <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                    <th style={{ ...th, textAlign: 'left' }}>Debtor</th>
                    <th style={th}>Outstanding</th>
                    <th style={th}>Insured limit</th>
                    <th style={th}>Materials only</th>
                    <th style={th}>Raw advance</th>
                    <th style={th}>Eligible advance</th>
                    <th style={{ ...th, textAlign: 'left' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {debtors.map((d) => (
                    <tr key={d.name} style={{ borderBottom: '1px solid #f2f0ec', background: !d.hasLimit && d.outstanding > 0 ? '#fffdf5' : 'transparent' }}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{d.name}<div style={{ fontSize: 10.5, color: '#aaa', fontWeight: 400 }}>{d.invoices.length} invoice{d.invoices.length !== 1 ? 's' : ''}</div></td>
                      <td style={td}>{gbp(d.outstanding)}</td>
                      <td style={{ ...td, padding: '4px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
                          <span style={{ color: '#bbb', fontSize: 12 }}>&pound;</span>
                          <input type="number" value={(limits[d.name]?.insuredLimit) ?? ''} placeholder="0"
                            onChange={e => setLimit(d.name, 'insuredLimit', e.target.value)}
                            style={{ width: 100, padding: '5px 6px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12.5, textAlign: 'right' }} />
                        </div>
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <input type="checkbox" checked={!!limits[d.name]?.materialsOnSite} onChange={e => setLimit(d.name, 'materialsOnSite', e.target.checked)} />
                      </td>
                      <td style={{ ...td, color: '#999' }}>{gbp(d.rawAdvance)}</td>
                      <td style={{ ...td, fontWeight: 700, color: d.advance > 0 ? '#0f766e' : '#ccc' }}>{gbp(d.advance)}</td>
                      <td style={{ ...td, textAlign: 'left', fontSize: 11.5 }}>
                        {!d.hasLimit ? <span style={{ color: '#b45309' }}>No insured limit</span>
                          : d.materialsOnSite ? <span style={{ color: '#999' }}>Materials only - not advanced</span>
                          : d.cappedByLimit ? <span style={{ color: '#2563eb' }}>Capped at insured limit</span>
                          : <span style={{ color: '#16a34a' }}>Full advance</span>}
                      </td>
                    </tr>
                  ))}
                  {debtors.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#aaa' }}>No outstanding receivables. Sync Invoices Owed first.</td></tr>}
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
              v1 simplifications: disallowed / overdue amounts are handled manually (set a lower insured limit or tick materials-only). Bibby does not advance the final application on a project - exclude those by lowering the debtor&apos;s outstanding via the finance side, or tell me and I&apos;ll add per-invoice exclusion. Insured limit = Bibby &quot;Approved Amount&quot;. Availability = eligible advance minus what you&apos;ve currently drawn.
            </div>
          </>
        )}
      </div>
    </>
  )
}

function Box({ label, value, sub, color, strong }) {
  return (
    <div style={{ background: strong ? '#f7faf9' : '#fff', border: strong ? '1.5px solid #0f766e' : '1px solid #e6e3dc', borderRadius: 12, padding: '13px 18px', minWidth: 190 }}>
      <div style={{ fontSize: 12, color: '#888' }}>{label}</div>
      <div style={{ fontSize: strong ? 24 : 21, fontWeight: 800, color: color || INK, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9a958c', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
const lbl = { fontSize: 11, color: '#888', marginBottom: 3 }
const inp = { padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }
const th = { padding: '10px 12px', fontSize: 11, color: '#9a958c', fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap' }
