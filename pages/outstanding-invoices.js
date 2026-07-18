import { useState, useEffect, useRef, useMemo } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import SyncBar from '../components/SyncBar'

const fmt = (n) => n == null || n === '' ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
const parseDMY = (s) => {
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1])
  const d = new Date(s); return isNaN(d) ? null : d
}
const fmtDate = (s) => { const d = parseDMY(s); return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' }
const daysBetween = (a, b) => Math.floor((a - b) / 86400000)

// Render comment text with @mentions (matching known member names) shown bold+blue.
function renderWithMentions(text, members = []) {
  const names = members.map(m => m.name).filter(Boolean).sort((a, b) => b.length - a.length) // longest first
  if (!names.length || !text) return text
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('@(' + names.map(esc).join('|') + ')', 'g')
  const out = []
  let last = 0, m, key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<span key={key++} style={{ color: '#2563eb', fontWeight: 700 }}>@{m[1]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// The 5 chase stages in timeline order.
const CHASE_STAGES = [
  { key: 'upcoming', label: 'Upcoming', short: 'U' },
  { key: 'overdue1', label: 'Overdue 1', short: '1' },
  { key: 'overdue2', label: 'Overdue 2', short: '2' },
  { key: 'overdue3', label: 'Overdue 3', short: '3' },
  { key: 'withdrawal', label: 'Withdrawal', short: 'W' },
]

// Resolve [merge fields] for a given invoice row into a template string.
// greetingName (optional) is the name for "Hi [Customer First Name]" — it comes
// from the selected To recipient, so it's blank until one is chosen.
function resolveMergeFields(str, row, me, greetingName) {
  if (!str) return ''
  const people = row.people || {}
  const cqs = people.customerQS || null
  const customerFirst = (greetingName || '').trim().split(/\s+/)[0] || ''
  // Signature = the logged-in user sending the email.
  const senderName = (me && (me.name || [me.firstName, me.lastName].filter(Boolean).join(' '))) || ''
  const senderEmail = (me && me.email) || ''
  const senderPhone = (me && me.phone) || ''
  const map = {
    '[Customer First Name]': customerFirst,
    '[Customer Company Name]': people.customerCompany || row.customer || '',
    '[Customer Address]': people.customerAddress || row.customerAddress || '',
    '[Customer QS Name]': cqs?.name || '',
    '[Customer QS Email]': cqs?.email || '',
    '[Invoice Number]': row.invoiceNumber || '',
    '[Invoice Reference]': row.reference || '',
    '[Project Name]': row.projectName || '',
    '[Project Address]': people.projectAddress || row.projectAddress || '',
    '[Sub-Contract Ref]': people.orderRef || row.orderRef || row.subContractRef || '',
    '[Due Date]': fmtDate(row.dueDate),
    "[Today's Date]": new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
    '[Invoice Value]': fmt(row.due),
    '[Invoice Value inc VAT]': fmt(row.due),
    '[Rock Roofing QS Name]': senderName,
    '[Sender Name]': senderName,
    '[Sender Email]': senderEmail,
    '[Sender Phone]': senderPhone,
  }
  let out = str
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v)
  return out
}

// A signature block built from the logged-in sender: name, email, phone, company.
function senderSignature(me) {
  const nm = (me && (me.name || [me.firstName, me.lastName].filter(Boolean).join(' '))) || ''
  const lines = [
    nm,
    (me && me.email) || '',
    (me && me.phone) || '',
    'Rock Roofing',
  ].filter(Boolean)
  return lines.join('\n')
}

// Resolve a template body and expand the sign-off into the full sender signature
// (name / email / phone / Rock Roofing). Templates sign off with
// [Rock Roofing QS Name]; we replace that final token with the signature block.
function buildBody(tplBody, row, me, greetingName) {
  let out = resolveMergeFields(tplBody, row, me, greetingName)
  const sig = senderSignature(me)
  // Replace the resolved sender name on its own sign-off line with the full block.
  const senderName = (me && (me.name || [me.firstName, me.lastName].filter(Boolean).join(' '))) || ''
  if (senderName && out.trimEnd().endsWith(senderName)) {
    out = out.replace(new RegExp(senderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), sig)
  } else {
    // No recognisable sign-off — append the signature.
    out = out.trimEnd() + '\n\n' + sig
  }
  return out
}

// Timeline of 5 dots in the Auto Send cell. Sent stages are filled/green; a stage
// sent doesn't change whether earlier ones show sent (no dropping back).
function ChaseTimeline({ row, chases, onOpen }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {CHASE_STAGES.map((s, i) => {
        const sent = !!chases[s.key]
        const when = sent ? new Date(chases[s.key].at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && <div style={{ width: 10, height: 2, background: '#e5e5e5' }} />}
            <button
              onClick={() => onOpen(s)}
              title={sent ? `${s.label} — sent ${when} (click to resend)` : `${s.label} — click to compose`}
              style={{
                width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', fontSize: 10, fontWeight: 700,
                border: '1px solid ' + (sent ? '#16a34a' : '#d1d5db'),
                background: sent ? '#16a34a' : '#fff',
                color: sent ? '#fff' : '#9ca3af',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}>
              {s.short}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// Compose popup: pre-filled from the stage template with merge fields resolved,
// editable, send via Resend (accounts from-address, QS reply-to). CC controls,
// a "Draft fresh email" mode (not tied to the timeline), and manual timeline
// ticking are all here.
function ChaseComposeModal({ row, stage, templates, members, me, chases, onClose, onSent, onToggleStage }) {
  const [fresh, setFresh] = useState(false)   // fresh custom email, not tied to a stage
  const tpl = (templates || []).find(t => t.key === stage.key) || { subject: '', body: '', ccSiteManager: false, ccRockCM: false }

  // Resolve the Rock CM's email by matching the project's CM name to team members.
  // Rock CM email: prefer the resolved IHM person, fall back to name-matching.
  const cmPerson = row.people?.team?.contractsManager || null
  const cmEmail = (() => {
    if (cmPerson?.email) return cmPerson.email
    const nm = (cmPerson?.name || row.contractsManager || '').trim().toLowerCase()
    if (!nm) return ''
    const hit = (members || []).find(m => (m.name || '').trim().toLowerCase() === nm)
    return hit?.email || ''
  })()
  const cmName = cmPerson?.name || row.contractsManager || ''

  const [to, setTo] = useState('')
  const [subject, setSubject] = useState(fresh ? '' : resolveMergeFields(tpl.subject, row, me))
  const [body, setBody] = useState(fresh ? '' : buildBody(tpl.body, row, me))
  // Seed CCs from the template's auto-CC flags.
  const [ccList, setCcList] = useState(() => {
    const seed = []
    if (tpl.ccRockCM && cmEmail) seed.push(cmEmail)
    // customer site manager: no dedicated field yet — user adds manually.
    return seed
  })
  const [ccInput, setCcInput] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  // Replies go to the logged-in sender.
  const replyTo = (me && me.email) || row.qsEmail || ''

  function switchToFresh(v) {
    setFresh(v)
    if (v) { setSubject(''); setBody('') }
    else { setSubject(resolveMergeFields(tpl.subject, row, me)); setBody(buildBody(tpl.body, row, me)) }
  }
  function addCc() {
    const parts = ccInput.split(/[;,]/).map(s => s.trim()).filter(Boolean)
    if (parts.length) { setCcList(l => [...new Set([...l, ...parts])]); setCcInput('') }
  }
  const removeCc = (e) => setCcList(l => l.filter(x => x !== e))

  // The list of selectable customer contacts (from the IHM), for the To dropdown.
  const contactOptions = (row.people?.customerContacts || []).filter(c => c.email)
  // Pick a single To recipient. Auto-fills the "Hi [name]" greeting from that
  // contact's first name (leaves it blank for an unknown/free-typed email).
  function pickTo(email) {
    setTo(email)
    const hit = contactOptions.find(c => c.email === email)
    const name = hit?.name || ''
    if (!fresh) setBody(buildBody(tpl.body, row, me, name))
  }

  async function send() {
    setErr(''); setSending(true)
    try {
      const recips = to.split(/[;,]/).map(s => s.trim()).filter(Boolean)
      if (!recips.length) { setErr('Add a recipient.'); setSending(false); return }
      if (!subject || !subject.trim()) { setErr('Add a subject.'); setSending(false); return }
      if (!body || !body.trim()) { setErr('The email body is empty.'); setSending(false); return }
      const res = await fetch('/api/chase-email-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recips, cc: ccList, replyTo, subject, text: body }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(d.error || 'Send failed.'); setSending(false); return }
      if (!fresh) {
        // Record on the timeline (never drops back). The API also appends a
        // comment (with the full subject + body) and returns the updated meta.
        let updatedMeta = null
        try {
          const rr = await fetch('/api/outstanding-invoices', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'record-chase', invoiceNumber: row.invoiceNumber, stageKey: stage.key, to: recips, subject, body, author: (me && me.name) || 'Accounts' }),
          })
          const dd = await rr.json().catch(() => ({}))
          if (!rr.ok) { setErr('Email sent, but logging it failed: ' + (dd.error || rr.status)); setSending(false); return }
          updatedMeta = dd.meta || null
        } catch (e) {
          setErr('Email sent, but logging it failed: ' + e.message); setSending(false); return
        }
        onSent(row.invoiceNumber, stage.key, { at: Date.now(), to: recips, subject }, updatedMeta)
      } else {
        // Fresh custom email — not tied to a stage, but still logged (with body).
        let updatedMeta = null
        try {
          const rr = await fetch('/api/outstanding-invoices', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'log-email', invoiceNumber: row.invoiceNumber, to: recips, subject, body, author: (me && me.name) || 'Accounts' }),
          })
          const dd = await rr.json().catch(() => ({}))
          if (!rr.ok) { setErr('Email sent, but logging it failed: ' + (dd.error || rr.status)); setSending(false); return }
          updatedMeta = dd.meta || null
        } catch (e) {
          setErr('Email sent, but logging it failed: ' + e.message); setSending(false); return
        }
        onSent(row.invoiceNumber, null, null, updatedMeta)
      }
    } catch (e) { setErr(e.message); setSending(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 660, boxShadow: '0 10px 40px rgba(0,0,0,0.2)', marginTop: 40 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>{fresh ? 'Fresh email' : stage.label} — {row.invoiceNumber}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{row.customer} · {row.projectName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#999', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          {/* Fresh vs template toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button onClick={() => switchToFresh(false)} style={{ flex: 1, padding: '7px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid ' + (!fresh ? '#0f766e' : '#e5e5e5'), background: !fresh ? '#f0fdfa' : '#fff', color: !fresh ? '#0f766e' : '#666', fontWeight: 600 }}>{stage.label} template</button>
            <button onClick={() => switchToFresh(true)} style={{ flex: 1, padding: '7px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid ' + (fresh ? '#0f766e' : '#e5e5e5'), background: fresh ? '#f0fdfa' : '#fff', color: fresh ? '#0f766e' : '#666', fontWeight: 600 }}>Draft fresh email</button>
          </div>

          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>To (one recipient)</label>
          {contactOptions.length > 0 && (
            <select value={contactOptions.some(c => c.email === to) ? to : ''} onChange={e => pickTo(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', marginBottom: 6, background: '#fff' }}>
              <option value="">— Select a customer contact —</option>
              {contactOptions.map(c => <option key={c.email} value={c.email}>{c.name || c.email}{c.title ? ` (${c.title})` : ''} — {c.email}</option>)}
            </select>
          )}
          <input value={to} onChange={e => pickTo(e.target.value)} placeholder={contactOptions.length ? 'or type an email…' : 'customer@example.com'}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', marginBottom: 10 }} />

          {/* CC controls */}
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>CC</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {ccList.map(e => (
              <span key={e} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#eef2ff', color: '#3730a3', borderRadius: 12, padding: '3px 8px 3px 10px', fontSize: 11 }}>
                {e}<button onClick={() => removeCc(e)} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
              </span>
            ))}
            {ccList.length === 0 && <span style={{ fontSize: 11, color: '#bbb' }}>No CCs</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
            <input value={ccInput} onChange={e => setCcInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCc())}
              placeholder="Add CC email" style={{ flex: 1, padding: '6px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }} />
            <button onClick={addCc} style={{ padding: '6px 12px', background: '#f0f2f5', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#555' }}>Add</button>
          </div>
          {/* quick auto-CC chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {cmEmail && !ccList.includes(cmEmail) && <button onClick={() => setCcList(l => [...l, cmEmail])} style={quickCc}>+ Rock CM{cmName ? ` (${cmName})` : ''}</button>}
            {(row.people?.customerContacts || []).filter(c => c.email && !ccList.includes(c.email)).map(c => (
              <button key={c.email} onClick={() => setCcList(l => [...l, c.email])} style={quickCc}>+ {c.name || c.email}{c.title ? ` (${c.title})` : ''}</button>
            ))}
            {row.customerEmail && !ccList.includes(row.customerEmail) && !(row.people?.customerContacts || []).some(c => c.email === row.customerEmail) && <button onClick={() => setCcList(l => [...l, row.customerEmail])} style={quickCc}>+ Customer contact</button>}
          </div>
          <div style={{ fontSize: 10, color: '#aaa', marginBottom: 12 }}>Sends from the accounts address · replies go to {replyTo || 'the project QS'}.{(tpl.ccSiteManager && !fresh) ? ' This template normally CCs the customer site manager — add their email above.' : ''}</div>

          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Subject</label>
          <input value={subject} onChange={e => setSubject(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', marginBottom: 12 }} />

          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Message</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={stage.key === 'withdrawal' && !fresh ? 18 : 9}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }} />

          {err && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 10 }}>{err}</div>}

          {/* Manual timeline adjustment (useful after a fresh/custom send) */}
          <div style={{ marginTop: 16, padding: '10px 12px', background: '#f8f9fa', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Timeline — tick a stage manually if you chased another way (no email sent):</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {CHASE_STAGES.map(s => {
                const on = !!chases[s.key]
                return (
                  <label key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555', cursor: 'pointer' }}>
                    <input type="checkbox" checked={on} onChange={e => onToggleStage(row.invoiceNumber, s.key, e.target.checked)} />
                    {s.label}
                  </label>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <Link href="/commercial-email-templates" style={{ fontSize: 11, color: '#9ca3af', textDecoration: 'none' }}>Amend template ↗</Link>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ background: '#f0f2f5', border: '1px solid #ddd', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer', color: '#555' }}>Cancel</button>
              <button onClick={send} disabled={sending}
                style={{ background: sending ? '#ccc' : '#0f766e', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: sending ? 'default' : 'pointer' }}>
                {sending ? 'Sending…' : 'Send email'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const quickCc = { padding: '3px 9px', background: '#fff', border: '1px dashed #c7d2fe', borderRadius: 12, fontSize: 11, cursor: 'pointer', color: '#4f46e5' }

export default function OutstandingInvoicesPage() {
  const [invoices, setInvoices] = useState([])
  const [meta, setMeta] = useState({})
  const [members, setMembers] = useState([])
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('overdue')   // overdue | due | dueDate
  const [view, setView] = useState('outstanding')   // outstanding | all
  const [page, setPage] = useState(1)
  const PER_PAGE = 50
  const [commentInvoice, setCommentInvoice] = useState(null)  // invoice object for the pop-out
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [weeklyOpen, setWeeklyOpen] = useState(false)
  const [chaseCompose, setChaseCompose] = useState(null)   // { row, stage }
  const [chaseTemplates, setChaseTemplates] = useState([])

  useEffect(() => { loadAll() }, [])
  useEffect(() => {
    fetch('/api/chase-email-templates').then(r => r.json()).then(d => setChaseTemplates(d.templates || [])).catch(() => {})
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [dashR, metaR, teamR, meR] = await Promise.all([
        fetch('/api/dashboard').then(r => r.json()).catch(() => ({})),
        fetch('/api/outstanding-invoices').then(r => r.json()).catch(() => ({ meta: {} })),
        fetch('/api/team').then(r => r.json()).catch(() => ({ members: [] })),
        fetch('/api/portal-auth?action=me').then(r => r.json()).catch(() => ({ user: null })),
      ])
      setMeta(metaR.meta || {})
      setMembers(teamR.members || [])
      setMe(meR.user || null)

      // Flatten every project's invoice lines. Keep ALL of them (outstanding +
      // paid); the Outstanding/All toggle filters at display time.
      const rows = []
      for (const p of (dashR.projects || [])) {
        for (const inv of (p._invoiceLines || [])) {
          const total = inv.total || 0
          const paid = inv.amountPaid || 0
          const due = inv.amountDue != null ? inv.amountDue : (total - paid)
          rows.push({
            invoiceNumber: inv.invoiceNumber || '',
            reference: inv.reference || '',
            customer: inv.contact || p.customer || '',
            date: inv.date || '',
            dueDate: inv.dueDate || '',
            paid,
            due,
            settled: !(due > 0.005),   // fully paid / nothing left owing
            jobNo: p.jobNo || '',
            projectName: p.name || '',
            qsName: p.qsName || '',
            qsEmail: p.qsEmail || '',
            customerEmail: p.customerEmail || '',
            customerContact: p.customerContact || '',
            contractsManager: p.contractsManager || '',
            people: p.people || null,
            highRisk: !!p.highRisk,
            unassigned: !!p.unassigned,
          })
        }
      }
      setInvoices(rows)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function setExpected(invoiceNumber, expectedDate) {
    // optimistic
    setMeta(m => ({ ...m, [invoiceNumber]: { ...(m[invoiceNumber] || { comments: [] }), expectedDate } }))
    try {
      await fetch('/api/outstanding-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-expected', invoiceNumber, expectedDate }),
      })
    } catch {}
  }

  const today = new Date(); today.setHours(0, 0, 0, 0)

  const rows = useMemo(() => {
    let r = invoices.map(inv => {
      const dd = parseDMY(inv.dueDate)
      // Xero counts the overdue period inclusively (the day after the due date is
      // "1 day overdue"), so add 1 once past the due date to match Xero exactly.
      const gap = dd ? daysBetween(today, dd) : null
      const overdueBy = gap != null && gap >= 0 ? gap + 1 : gap
      const m = meta[inv.invoiceNumber] || {}
      return { ...inv, overdueBy: (overdueBy > 0 && !inv.settled) ? overdueBy : null, expectedDate: m.expectedDate || '', commentCount: (m.comments || []).length }
    })
    // Outstanding (default) hides settled/paid invoices; All shows everything.
    if (view === 'outstanding') r = r.filter(x => !x.settled)
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(x => [x.invoiceNumber, x.reference, x.customer, x.jobNo, x.projectName].some(v => (v || '').toLowerCase().includes(q)))
    }
    r.sort((a, b) => {
      if (sortBy === 'overdue') return (b.overdueBy || -1) - (a.overdueBy || -1)
      if (sortBy === 'due') return (b.due || 0) - (a.due || 0)
      if (sortBy === 'dueDate') return (parseDMY(a.dueDate) || 0) - (parseDMY(b.dueDate) || 0)
      return 0
    })
    return r
  }, [invoices, meta, search, sortBy, view])

  // Reset to page 1 whenever the filters change.
  useEffect(() => { setPage(1) }, [search, sortBy, view])
  const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE))
  const pageRows = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const totals = {
    count: rows.length,
    due: rows.reduce((s, r) => s + (r.due || 0), 0),
    overdueCount: rows.filter(r => r.overdueBy).length,
    overdueDue: rows.filter(r => r.overdueBy).reduce((s, r) => s + (r.due || 0), 0),
    unassignedCount: rows.filter(r => r.unassigned).length,
    unassignedDue: rows.filter(r => r.unassigned).reduce((s, r) => s + (r.due || 0), 0),
  }

  const th = { padding: '9px 10px', textAlign: 'left', fontWeight: 600, color: '#555', whiteSpace: 'nowrap', fontSize: 12 }
  const thR = { ...th, textAlign: 'right' }
  const td = { padding: '8px 10px', fontSize: 12, whiteSpace: 'nowrap' }

  return (
    <>
      <Head><title>Rock Roofing — Outstanding Invoices · v6</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', flex: 1, minWidth: 0 }}>
              <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
              <Link href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>← Portal</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/commercial" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Project Financials</Link>
              <span style={{ color: '#444' }}>|</span>
              <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Outstanding Invoices</span>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/retention" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Retention</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/variations" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Variations</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/application-calendar" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Application Calendar</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/commercial-scorecard" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Commercial Scorecard</Link>
              <Link href="/commercial-email-templates" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Email Templates</Link>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => window.dispatchEvent(new CustomEvent('open-report-problem'))}
                style={{ background: 'none', border: 'none', color: '#ca8a04', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>⚠ Report app improvement</button>
              <SyncBar show={['invoices']} months={12} onDone={() => loadAll()} />
            </div>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: view === 'all' ? 'Invoices (all)' : 'Outstanding invoices', value: totals.count, raw: true },
              { label: view === 'all' ? 'Total due (unpaid)' : 'Total due', value: fmt(totals.due) },
              { label: 'Overdue invoices', value: totals.overdueCount, raw: true, color: totals.overdueCount ? '#dc2626' : '#16a34a' },
              { label: 'Overdue value', value: fmt(totals.overdueDue), color: totals.overdueDue > 0 ? '#dc2626' : '#16a34a' },
            ].map(card => (
              <div key={card.label} style={{ background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{card.label}</div>
                <div style={{ fontSize: card.raw ? 28 : 20, fontWeight: 700, color: card.color || '#1a1a2e' }}>{card.value}</div>
              </div>
            ))}
          </div>

          {/* Key: Unassigned invoices (no project tag in Xero) */}
          {totals.unassignedCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#92400e' }}>
              <span style={{ fontSize: 9, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>UNASSIGNED</span>
              <span><strong>{totals.unassignedCount}</strong> invoice{totals.unassignedCount !== 1 ? 's' : ''} ({fmt(totals.unassignedDue)}) have no project tracking category in Xero, so they aren't attributed to a project. Tag them in Xero and re-upload to move them onto their project.</span>
            </div>
          )}

          {/* Controls */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: '#f0f2f5', borderRadius: 8, overflow: 'hidden' }}>
              {[['outstanding', 'Outstanding'], ['all', 'All']].map(([key, label]) => (
                <button key={key} onClick={() => setView(key)}
                  style={{ padding: '6px 16px', border: 'none', background: view === key ? '#1a1a2e' : 'transparent', color: view === key ? '#fff' : '#555', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {label}
                </button>
              ))}
            </div>
            <input placeholder="Search invoice, ref, customer, project…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 220, padding: '7px 12px', border: '1px solid #e5e5e5', borderRadius: 8, fontSize: 12 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#888' }}>Sort</span>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #e5e5e5', borderRadius: 8, fontSize: 12 }}>
                <option value="overdue">Most overdue</option>
                <option value="due">Largest due</option>
                <option value="dueDate">Due date</option>
              </select>
            </div>
            <span style={{ fontSize: 12, color: '#888' }}>{rows.length} {view === 'all' ? 'total' : 'outstanding'}{rows.length > PER_PAGE ? ` · showing ${(page - 1) * PER_PAGE + 1}–${Math.min(page * PER_PAGE, rows.length)}` : ''}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <button onClick={() => setDownloadOpen(true)}
                style={{ background: '#fff', color: '#0f766e', border: '1px solid #5eead4', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                ⬇ Download Report
              </button>
              <button onClick={() => setWeeklyOpen(true)}
                style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                📧 Weekly Report
              </button>
            </div>
          </div>

          {/* Table */}
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
            {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading…</div>
              : rows.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>{view === 'all' ? 'No invoices found. (Import invoices from Xero on the Retention Tracker.)' : 'No outstanding invoices. Switch to "All" to see paid ones, or import invoices from Xero on the Retention Tracker.'}</div>
              : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
                        <th style={th}>Inv Number</th>
                        <th style={th}>Ref</th>
                        <th style={th}>To</th>
                        <th style={th}>Date</th>
                        <th style={th}>Due Date</th>
                        <th style={th}>Overdue by</th>
                        <th style={th}>Expected date</th>
                        <th style={thR}>Paid</th>
                        <th style={thR}>Due</th>
                        <th style={th}>Comments</th>
                        <th style={th}>Auto send emails</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((r, i) => {
                        const overdue = !!r.overdueBy
                        return (
                          <tr key={`${r.invoiceNumber}-${i}`} style={{ borderBottom: '1px solid #f0f0f0', background: r.settled ? '#f0fdf4' : (i % 2 === 0 ? '#fff' : '#fafafa') }}>
                            <td style={{ ...td, fontWeight: 600, color: '#1a1a2e' }}>
                              {r.invoiceNumber || '—'}
                              {r.settled && <span title="Fully paid" style={{ marginLeft: 6, fontSize: 9, background: '#dcfce7', color: '#16a34a', border: '1px solid #86efac', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>PAID</span>}
                              {r.highRisk && <span title="High risk customer" style={{ marginLeft: 6, fontSize: 9, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>HIGH RISK</span>}
                            </td>
                            <td style={{ ...td, whiteSpace: 'normal', maxWidth: 230 }}>{r.reference || r.projectName || '—'}{r.unassigned && <span title="No Projects tracking tag in Xero — tag it in Xero and re-upload to attribute it to a project" style={{ marginLeft: 6, fontSize: 9, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>UNASSIGNED</span>}</td>
                            <td style={{ ...td, whiteSpace: 'normal', maxWidth: 180 }}>{r.customer || '—'}</td>
                            <td style={td}>{fmtDate(r.date)}</td>
                            <td style={{ ...td, color: overdue ? '#dc2626' : '#555', fontWeight: overdue ? 600 : 400 }}>{fmtDate(r.dueDate)}</td>
                            <td style={{ ...td, color: '#dc2626', fontWeight: 700 }}>{r.overdueBy ? `${r.overdueBy} day${r.overdueBy === 1 ? '' : 's'}` : ''}</td>
                            <td style={td}>
                              <input type="date" value={r.expectedDate || ''} onChange={e => setExpected(r.invoiceNumber, e.target.value)}
                                style={{ fontSize: 11, padding: '3px 5px', border: '1px solid #e5e5e5', borderRadius: 5, fontFamily: 'inherit' }} />
                            </td>
                            <td style={{ ...td, textAlign: 'right', color: '#555' }}>{fmt(r.paid)}</td>
                            <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: r.settled ? '#16a34a' : (overdue ? '#dc2626' : '#1a1a2e') }}>{fmt(r.due)}</td>
                            <td style={td}>
                              <button onClick={() => setCommentInvoice(r)}
                                style={{ background: r.commentCount ? '#eef2ff' : '#f0f2f5', border: '1px solid ' + (r.commentCount ? '#c7d2fe' : '#e5e5e5'), borderRadius: 6, padding: '4px 9px', fontSize: 11, cursor: 'pointer', color: r.commentCount ? '#4f46e5' : '#555', fontWeight: 600 }}>
                                💬 {r.commentCount ? `${r.commentCount}` : 'Add'}
                              </button>
                            </td>
                            <td style={td}>
                              <ChaseTimeline row={r} chases={(meta[r.invoiceNumber] || {}).chases || {}} onOpen={(stage) => setChaseCompose({ row: r, stage })} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            {!loading && rows.length > PER_PAGE && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '14px', borderTop: '1px solid #f0f0f0' }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                  style={{ background: '#f0f2f5', border: '1px solid #e5e5e5', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.5 : 1 }}>← Prev</button>
                <span style={{ fontSize: 12, color: '#555' }}>Page {page} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  style={{ background: '#f0f2f5', border: '1px solid #e5e5e5', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.5 : 1 }}>Next →</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {commentInvoice && (
        <CommentsModal
          invoice={commentInvoice}
          comments={(meta[commentInvoice.invoiceNumber] || {}).comments || []}
          members={members}
          me={me}
          onClose={() => setCommentInvoice(null)}
          onChanged={(invNo, newMeta) => setMeta(m => ({ ...m, [invNo]: { ...(m[invNo] || {}), ...newMeta } }))}
        />
      )}
      {downloadOpen && <DownloadModal onClose={() => setDownloadOpen(false)} />}
      {weeklyOpen && <WeeklyReportModal onClose={() => setWeeklyOpen(false)} />}
      {chaseCompose && (
        <ChaseComposeModal
          row={chaseCompose.row}
          stage={chaseCompose.stage}
          templates={chaseTemplates}
          members={members}
          me={me}
          chases={(meta[chaseCompose.row.invoiceNumber] || {}).chases || {}}
          onToggleStage={async (invNo, stageKey, sent) => {
            // Manual timeline adjustment (tick/untick without sending).
            setMeta(m => {
              const cur = { ...((m[invNo] || {}).chases || {}) }
              if (sent) cur[stageKey] = { at: Date.now(), to: [], subject: '', manual: true }
              else delete cur[stageKey]
              return { ...m, [invNo]: { ...(m[invNo] || {}), chases: cur } }
            })
            try {
              await fetch('/api/outstanding-invoices', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: sent ? 'record-chase' : 'clear-chase', invoiceNumber: invNo, stageKey, manual: true }),
              })
            } catch {}
          }}
          onClose={() => setChaseCompose(null)}
          onSent={(invNo, stageKey, info, updatedMeta) => {
            if (updatedMeta) {
              setMeta(m => ({ ...m, [invNo]: { ...(m[invNo] || {}), ...updatedMeta } }))
            } else if (stageKey) {
              setMeta(m => ({
                ...m,
                [invNo]: { ...(m[invNo] || {}), chases: { ...((m[invNo] || {}).chases || {}), [stageKey]: info } },
              }))
            }
            setChaseCompose(null)
          }}
        />
      )}
    </>
  )
}

// ── Comments pop-out: running chain + add/edit + @mention ──────────────────────
function CommentsModal({ invoice, comments, members, me, onClose, onChanged }) {
  const [list, setList] = useState(comments)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [showMentions, setShowMentions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const taRef = useRef(null)

  const authorName = me ? [me.firstName, me.lastName].filter(Boolean).join(' ') || me.name || me.email : 'You'

  // Resolve @mentions in text -> member ids (matches "@First Last").
  const resolveMentions = (t) => {
    const lower = t.toLowerCase()
    const ids = members.filter(m => m.name && lower.includes('@' + m.name.toLowerCase())).map(m => m.id)
    return [...new Set(ids)]
  }

  const onType = (e) => {
    const v = e.target.value
    setText(v)
    const caret = e.target.selectionStart
    const upto = v.slice(0, caret)
    const m = /@([\w ]{0,30})$/.exec(upto)
    if (m) { setShowMentions(true); setMentionQuery(m[1].toLowerCase()) }
    else setShowMentions(false)
  }
  const insertMention = (member) => {
    const el = taRef.current
    const caret = el ? el.selectionStart : text.length
    const before = text.slice(0, caret).replace(/@([\w ]{0,30})$/, '@' + member.name + ' ')
    const after = text.slice(caret)
    setText(before + after)
    setShowMentions(false)
    // Put the cursor right after the inserted "@Name " so typing continues there.
    const newCaret = before.length
    if (el) setTimeout(() => { el.focus(); el.setSelectionRange(newCaret, newCaret) }, 0)
  }
  const mentionMatches = members.filter(m => m.name && m.name.toLowerCase().includes(mentionQuery)).slice(0, 6)
  const mentionedNames = members.filter(m => m.name && text.toLowerCase().includes('@' + m.name.toLowerCase())).map(m => m.name)

  async function addComment() {
    if (!text.trim()) return
    setSaving(true)
    try {
      const mentions = resolveMentions(text)
      const r = await fetch('/api/outstanding-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-comment', invoiceNumber: invoice.invoiceNumber, text, author: authorName, mentions }),
      })
      const d = await r.json()
      if (d.comment) {
        const newList = [...list, d.comment]
        setList(newList)
        onChanged(invoice.invoiceNumber, { comments: newList })
        setText('')
      }
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')

  async function saveEdit(commentId) {
    const t = editText.trim()
    if (!t) return
    try {
      const r = await fetch('/api/outstanding-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit-comment', invoiceNumber: invoice.invoiceNumber, commentId, text: t }),
      })
      const d = await r.json()
      if (d.meta) { setList(d.meta.comments || []); onChanged(invoice.invoiceNumber, { comments: d.meta.comments || [] }) }
      setEditingId(null); setEditText('')
    } catch (e) { console.error(e) }
  }

  async function deleteComment(commentId) {
    if (!confirm('Delete this comment? This cannot be undone.')) return
    try {
      const r = await fetch('/api/outstanding-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-comment', invoiceNumber: invoice.invoiceNumber, commentId }),
      })
      const d = await r.json()
      if (d.meta) { setList(d.meta.comments || []); onChanged(invoice.invoiceNumber, { comments: d.meta.comments || [] }) }
    } catch (e) { console.error(e) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 560, maxWidth: '100%', maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Comments — {invoice.invoiceNumber}</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{invoice.reference || invoice.projectName} · {invoice.customer}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#999' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {list.length === 0 ? <div style={{ color: '#999', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No comments yet.</div>
            : list.slice().sort((a, b) => a.at - b.at).map(c => (
              <div key={c.id} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #f4f4f4' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1a1a2e' }}>{c.author}{c.source === 'email-bcc' && <span style={{ marginLeft: 6, fontSize: 9, background: '#f0fdf4', color: '#16a34a', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>via email</span>}{c.source === 'chase-email' && <span style={{ marginLeft: 6, fontSize: 9, background: '#eef2ff', color: '#4f46e5', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>chase sent</span>}</span>
                  <span style={{ fontSize: 11, color: '#aaa' }}>{new Date(c.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}{c.editedAt ? ' (edited)' : ''}</span>
                </div>
                {editingId === c.id ? (
                  <div>
                    <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={2}
                      style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e5e5e5', borderRadius: 8, padding: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button onClick={() => saveEdit(c.id)} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 11, cursor: 'pointer' }}>Save</button>
                      <button onClick={() => { setEditingId(null); setEditText('') }} style={{ background: '#f0f2f5', color: '#555', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: '#333', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{renderWithMentions(c.text, members)}</div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 5 }}>
                      <button onClick={() => { setEditingId(c.id); setEditText(c.text) }} style={{ background: 'none', border: 'none', color: '#4f46e5', fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Edit</button>
                      <button onClick={() => deleteComment(c.id)} style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
        </div>

        <div style={{ padding: 16, borderTop: '1px solid #eee', position: 'relative' }}>
          {showMentions && mentionMatches.length > 0 && (
            <div style={{ position: 'absolute', bottom: 'calc(100% - 8px)', left: 16, right: 16, background: '#fff', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 -6px 20px rgba(0,0,0,0.14)', maxHeight: 200, overflowY: 'auto', zIndex: 10 }}>
              <div style={{ fontSize: 10, color: '#999', padding: '6px 10px 2px' }}>Mention someone</div>
              {mentionMatches.map(m => (
                <button key={m.id} type="button" onClick={() => insertMention(m)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: '#fff', cursor: 'pointer', fontSize: 13 }}>{m.name}</button>
              ))}
            </div>
          )}
          <textarea ref={taRef} value={text} onChange={onType} rows={2} placeholder="Add a comment… use @ to mention a colleague"
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e5e5e5', borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit', lineHeight: 1.4, resize: 'vertical' }} />
          {mentionedNames.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#888' }}>Mentioning:</span>
              {mentionedNames.map(n => (
                <span key={n} style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '2px 9px' }}>@{n}</span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={addComment} disabled={saving || !text.trim()}
              style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, cursor: saving || !text.trim() ? 'default' : 'pointer', opacity: saving || !text.trim() ? 0.5 : 1 }}>
              {saving ? 'Adding…' : 'Add comment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Weekly report: manage recipients (portal users + manual) + schedule + send now ──
function WeeklyReportModal({ onClose }) {
  const [recipients, setRecipients] = useState([])   // list of emails (portal + manual)
  const [portalUsers, setPortalUsers] = useState([])
  const [schedule, setSchedule] = useState({ dayOfWeek: 4, hour: 8 })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState('')

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  useEffect(() => { (async () => {
    try {
      const d = await fetch('/api/outstanding-invoices?action=report-settings').then(r => r.json())
      setRecipients(d.recipients || [])
      setPortalUsers(d.portalUsers || [])
      if (d.schedule) setSchedule({ dayOfWeek: d.schedule.dayOfWeek ?? 4, hour: d.schedule.hour ?? 8 })
    } catch {}
    setLoading(false)
  })() }, [])

  async function saveRecipients(list) {
    setSaving(true)
    try {
      await fetch('/api/outstanding-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-recipients', recipients: list }) })
      setRecipients(list)
    } catch {}
    setSaving(false)
  }
  function toggleUser(email) {
    if (recipients.includes(email)) saveRecipients(recipients.filter(x => x !== email))
    else saveRecipients([...recipients, email])
  }
  function addEmail() {
    const e = input.trim()
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setMsg('Enter a valid email address.'); return }
    if (recipients.includes(e)) { setMsg('Already added.'); return }
    setMsg(''); setInput('')
    saveRecipients([...recipients, e])
  }
  function remove(e) { saveRecipients(recipients.filter(x => x !== e)) }

  async function saveSchedule(next) {
    setSchedule(next)
    try {
      await fetch('/api/outstanding-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-schedule', dayOfWeek: next.dayOfWeek, hour: next.hour }) })
    } catch {}
  }

  async function sendNow() {
    setSending(true); setMsg('')
    try {
      const r = await fetch('/api/outstanding-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send-report-now' }) })
      const d = await r.json()
      setMsg(d.ok ? `Sent to ${(d.sentTo || []).length} recipient(s).` : (d.note || d.error || 'Could not send.'))
    } catch (e) { setMsg('Could not send.') }
    setSending(false)
  }

  // Emails that are portal users vs manually-added.
  const portalEmails = new Set(portalUsers.map(u => u.email))
  const manualEmails = recipients.filter(e => !portalEmails.has(e))

  const box = { padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 560, maxWidth: '100%', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Weekly Report</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        <div style={{ padding: 20 }}>
          {loading ? <div style={{ fontSize: 13, color: '#999' }}>Loading…</div> : (
            <>
              {/* Schedule */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', margin: '0 0 8px' }}>WHEN IT'S SENT</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: '#555' }}>Every</span>
                <select value={schedule.dayOfWeek} onChange={e => saveSchedule({ ...schedule, dayOfWeek: parseInt(e.target.value) })} style={box}>
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
                <span style={{ fontSize: 13, color: '#555' }}>at</span>
                <select value={schedule.hour} onChange={e => saveSchedule({ ...schedule, hour: parseInt(e.target.value) })} style={box}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginBottom: 18 }}>UK time. Sends on the hour.</div>

              {/* Portal users */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', margin: '0 0 6px' }}>PORTAL USERS</div>
              <div style={{ maxHeight: 190, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 14 }}>
                {portalUsers.length === 0 && <div style={{ fontSize: 13, color: '#aaa', padding: 10 }}>No portal users found.</div>}
                {portalUsers.map(u => (
                  <label key={u.email} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderBottom: '1px solid #f6f6f6', cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={recipients.includes(u.email)} onChange={() => toggleUser(u.email)} />
                    <span style={{ flex: 1 }}>{u.name}{u.role ? <span style={{ color: '#aaa' }}> — {u.role}</span> : ''}</span>
                    <span style={{ color: '#bbb', fontSize: 11 }}>{u.email}</span>
                  </label>
                ))}
              </div>

              {/* Manual emails */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', margin: '0 0 6px' }}>OTHER EMAIL ADDRESSES</div>
              {manualEmails.length === 0 && <div style={{ fontSize: 13, color: '#aaa', marginBottom: 8 }}>None added.</div>}
              {manualEmails.map(e => (
                <div key={e} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#f8f9fa', borderRadius: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>{e}</span>
                  <button onClick={() => remove(e)} style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 12, cursor: 'pointer' }}>Remove</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEmail()} placeholder="name@company.com"
                  style={{ ...box, flex: 1 }} />
                <button onClick={addEmail} disabled={saving} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Add</button>
              </div>

              {msg && <div style={{ fontSize: 12, color: msg.startsWith('Sent') ? '#16a34a' : '#dc2626', marginTop: 12 }}>{msg}</div>}

              <div style={{ borderTop: '1px solid #eee', marginTop: 18, paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#888' }}>Send this week's report now:</span>
                <button onClick={sendNow} disabled={sending} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.6 : 1 }}>
                  {sending ? 'Sending…' : 'Send now'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Download popout: ask whether to include comments/email correspondence ──────
function DownloadModal({ onClose }) {
  const go = (withComments) => {
    window.location.href = `/api/outstanding-invoices?action=download${withComments ? '&comments=1' : ''}`
    onClose()
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 460, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Download Report</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        <div style={{ padding: 24 }}>
          <p style={{ fontSize: 14, color: '#333', marginTop: 0, marginBottom: 20 }}>Do you want all comments and email correspondence included in the report?</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => go(true)} style={{ flex: 1, background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Yes — include them</button>
            <button onClick={() => go(false)} style={{ flex: 1, background: '#f0f2f5', color: '#333', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>No — summary only</button>
          </div>
        </div>
      </div>
    </div>
  )
}
