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
  const [settings, setSettings] = useState({ advanceRate: 60, drawn: 0, retentionPct: 10, facilityCap: 500000 })
  const [limits, setLimits] = useState({})            // { debtorName: { insuredLimit, materials } }
  const [excludedInvoices, setExcludedInvoices] = useState({}) // { invoiceId: true } - variations w/o instruction, final apps
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
      setSettings({ advanceRate: d.settings?.advanceRate ?? 60, drawn: d.settings?.drawn ?? 0, retentionPct: d.settings?.retentionPct ?? 10, facilityCap: d.settings?.facilityCap ?? 500000 })
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
    const retPct = (Number(settings.retentionPct) || 0) / 100
    return Object.values(byName).map(d => {
      const lim = limits[d.name] || {}
      const insured = Number(lim.insuredLimit) || 0
      const materials = Number(lim.materials) || 0   // materials-on-site value (GBP), not funded
      // Outstanding for this debtor (excluding any invoices flagged out - e.g.
      // variations without written instruction, final applications).
      let outstanding = 0, excludedTotal = 0
      for (const inv of d.invoices) {
        if (excludedInvoices[inv.id]) { excludedTotal += inv.amountDue; continue }
        outstanding += inv.amountDue
      }
      const grossOutstanding = d.invoices.reduce((s, i) => s + i.amountDue, 0)
      // Retention holdback: the last X% of the contract isn't funded. Approximated as
      // X% of the eligible outstanding.
      const retention = Math.max(0, outstanding * retPct)
      // Fundable base = outstanding, minus materials on site, minus retention holdback.
      const fundableBase = Math.max(0, outstanding - materials - retention)
      const rawAdvance = fundableBase * rate
      // Only fund where there's an insured limit, capped at that limit.
      const hasLimit = insured > 0
      const advance = hasLimit ? Math.min(rawAdvance, insured) : 0
      return {
        ...d, insured, materials, outstanding: grossOutstanding, eligibleOutstanding: outstanding,
        retention, fundableBase, excludedTotal, rawAdvance, advance, hasLimit,
        cappedByLimit: hasLimit && rawAdvance > insured,
      }
    }).sort((a, b) => b.advance - a.advance || b.outstanding - a.outstanding)
  }, [data, limits, settings.advanceRate, settings.retentionPct, excludedInvoices])

  const totals = useMemo(() => {
    const totalOutstanding = debtors.reduce((s, d) => s + d.outstanding, 0)
    const grossAdvance = debtors.reduce((s, d) => s + d.advance, 0)
    // Facility cap: total funded is capped at the maximum facility value.
    const cap = Number(settings.facilityCap) || 0
    const totalAdvance = cap > 0 ? Math.min(grossAdvance, cap) : grossAdvance
    const cappedByFacility = cap > 0 && grossAdvance > cap
    const drawn = Number(settings.drawn) || 0
    const availability = totalAdvance - drawn
    const noLimit = debtors.filter(d => !d.hasLimit && d.outstanding > 0)
    return { totalOutstanding, grossAdvance, totalAdvance, cap, cappedByFacility, drawn, availability, noLimitCount: noLimit.length, noLimitValue: noLimit.reduce((s, d) => s + d.outstanding, 0) }
  }, [debtors, settings.drawn, settings.facilityCap])

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
          <div style={{ color: '#8a857c', fontSize: 13, marginTop: 4 }}>Estimates cash available from the Bibby facility. Per debtor: fundable = outstanding &minus; materials on site &minus; {settings.retentionPct}% retention held back; advance = {settings.advanceRate}% of fundable, capped at the insured (approved) limit. Debtors with no insured limit are excluded. Variations without written instruction / final applications can be excluded per invoice. Total funding is capped at the facility maximum ({gbp(Number(settings.facilityCap) || 0)}).</div>
        </div>

        {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : !data ? <div style={{ color: '#b91c1c', padding: 40 }}>Could not load.</div> : (
          <>
            {/* Top figures */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <Box label="Outstanding sales ledger" value={gbp(totals.totalOutstanding)} />
              <Box label={`Advance @ ${settings.advanceRate}%`} value={gbp(totals.grossAdvance)} color="#0f766e" sub="after materials, retention & insured limits" />
              <Box label="Facility cap" value={gbp(totals.cap)} sub={totals.cappedByFacility ? 'reached - funding capped' : 'headroom available'} color={totals.cappedByFacility ? '#dc2626' : '#888'} />
              <Box label="Currently drawn" value={gbp(totals.drawn)} color="#b45309" />
              <Box label="Availability now" value={gbp(totals.availability)} color={totals.availability < 0 ? '#dc2626' : '#0f766e'} strong sub="funded (capped) minus drawn" />
            </div>

            {totals.noLimitCount > 0 && (
              <div style={{ fontSize: 12.5, color: '#b45309', marginBottom: 14, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>
                {totals.noLimitCount} debtor(s) with outstanding invoices have no insured limit set ({gbp(totals.noLimitValue)} of ledger not advanced). Set their limit below or import the Bibby list.
              </div>
            )}

            {/* Controls */}
            <div style={{ background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', marginBottom: 18, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div><div style={lbl}>Advance rate %</div><input type="number" value={settings.advanceRate} onChange={e => setSettings(s => ({ ...s, advanceRate: e.target.value }))} style={{ ...inp, width: 90 }} /></div>
              <div><div style={lbl}>Retention held back %</div><input type="number" value={settings.retentionPct} onChange={e => setSettings(s => ({ ...s, retentionPct: e.target.value }))} style={{ ...inp, width: 90 }} title="Last X% of the contract not funded" /></div>
              <div><div style={lbl}>Facility cap (max funded)</div><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: '#999' }}>&pound;</span><input type="number" value={settings.facilityCap} onChange={e => setSettings(s => ({ ...s, facilityCap: e.target.value }))} style={{ ...inp, width: 130 }} title="Maximum total funded facility, e.g. 60% of 500k = 300k" /></div></div>
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
                    <th style={th}>Materials on site (&pound;)</th>
                    <th style={th}>Retention held</th>
                    <th style={th}>Fundable</th>
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
                          <span style={{ color: '#bbb', fontSize: 12 }}>&pound;</span>
                          <input type="number" value={(limits[d.name]?.materials) ?? ''} placeholder="0"
                            onChange={e => setLimit(d.name, 'materials', e.target.value)}
                            style={{ width: 90, padding: '5px 6px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12.5, textAlign: 'right' }} />
                        </div>
                      </td>
                      <td style={{ ...td, color: '#999' }}>{gbp(d.retention)}</td>
                      <td style={{ ...td, color: '#555' }}>{gbp(d.fundableBase)}</td>
                      <td style={{ ...td, color: '#999' }}>{gbp(d.rawAdvance)}</td>
                      <td style={{ ...td, fontWeight: 700, color: d.advance > 0 ? '#0f766e' : '#ccc' }}>{gbp(d.advance)}</td>
                      <td style={{ ...td, textAlign: 'left', fontSize: 11.5 }}>
                        {!d.hasLimit ? <span style={{ color: '#b45309' }}>No insured limit</span>
                          : d.fundableBase <= 0 ? <span style={{ color: '#999' }}>Nothing fundable</span>
                          : d.cappedByLimit ? <span style={{ color: '#2563eb' }}>Capped at insured limit</span>
                          : <span style={{ color: '#16a34a' }}>Full advance</span>}
                      </td>
                    </tr>
                  ))}
                  {debtors.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#aaa' }}>No outstanding sales invoices. Sync Invoices Owed first.</td></tr>}
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
              Rules applied: materials on site (enter the &pound; value per debtor) and the last {settings.retentionPct}% of the contract are not funded; only debtors with an insured limit are funded, capped at that limit; total funding is capped at the facility maximum. Variations are only fundable with written instruction - exclude any not yet instructed. Insured limit = Bibby &quot;Approved Amount&quot; (import via CSV or type). Availability = funded (after the cap) minus what you&apos;ve currently drawn.
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
