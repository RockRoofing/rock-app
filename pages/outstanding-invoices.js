import { useState, useEffect, useRef, useMemo } from 'react'
import Head from 'next/head'
import Link from 'next/link'

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

export default function OutstandingInvoicesPage() {
  const [invoices, setInvoices] = useState([])
  const [meta, setMeta] = useState({})
  const [members, setMembers] = useState([])
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('overdue')   // overdue | due | dueDate
  const [commentInvoice, setCommentInvoice] = useState(null)  // invoice object for the pop-out

  useEffect(() => { loadAll() }, [])

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

      // Flatten every project's invoice lines into one outstanding list.
      const rows = []
      for (const p of (dashR.projects || [])) {
        for (const inv of (p._invoiceLines || [])) {
          const due = inv.amountDue != null ? inv.amountDue : ((inv.total || 0) - (inv.amountPaid || 0))
          if (!(due > 0.005)) continue   // only outstanding
          rows.push({
            invoiceNumber: inv.invoiceNumber || '',
            reference: inv.reference || '',
            customer: inv.contact || p.customer || '',
            date: inv.date || '',
            dueDate: inv.dueDate || '',
            paid: inv.amountPaid || 0,
            due,
            jobNo: p.jobNo || '',
            projectName: p.name || '',
            qsName: p.qsName || '',
            qsEmail: p.qsEmail || '',
            highRisk: !!p.highRisk,
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
      const overdueBy = dd ? daysBetween(today, dd) : null
      const m = meta[inv.invoiceNumber] || {}
      return { ...inv, overdueBy: overdueBy > 0 ? overdueBy : null, expectedDate: m.expectedDate || '', commentCount: (m.comments || []).length }
    })
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
  }, [invoices, meta, search, sortBy])

  const totals = {
    count: rows.length,
    due: rows.reduce((s, r) => s + (r.due || 0), 0),
    overdueCount: rows.filter(r => r.overdueBy).length,
    overdueDue: rows.filter(r => r.overdueBy).reduce((s, r) => s + (r.due || 0), 0),
  }

  const th = { padding: '9px 10px', textAlign: 'left', fontWeight: 600, color: '#555', whiteSpace: 'nowrap', fontSize: 12 }
  const thR = { ...th, textAlign: 'right' }
  const td = { padding: '8px 10px', fontSize: 12, whiteSpace: 'nowrap' }

  return (
    <>
      <Head><title>Rock Roofing — Outstanding Invoices</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', position: 'sticky', top: 0, zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
              <Link href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>← Portal</Link>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/commercial" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Project Financials</Link>
              <span style={{ color: '#444' }}>|</span>
              <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6, background: '#2a2a28' }}>Outstanding Invoices</span>
              <span style={{ color: '#444' }}>|</span>
              <Link href="/retention" style={{ color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6 }}>Retention</Link>
            </div>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Outstanding invoices', value: totals.count, raw: true },
              { label: 'Total due', value: fmt(totals.due) },
              { label: 'Overdue invoices', value: totals.overdueCount, raw: true, color: totals.overdueCount ? '#dc2626' : '#16a34a' },
              { label: 'Overdue value', value: fmt(totals.overdueDue), color: totals.overdueDue > 0 ? '#dc2626' : '#16a34a' },
            ].map(card => (
              <div key={card.label} style={{ background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{card.label}</div>
                <div style={{ fontSize: card.raw ? 28 : 20, fontWeight: 700, color: card.color || '#1a1a2e' }}>{card.value}</div>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', flexWrap: 'wrap' }}>
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
            <span style={{ fontSize: 12, color: '#888' }}>{rows.length} shown</span>
          </div>

          {/* Table */}
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
            {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading…</div>
              : rows.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>No outstanding invoices. (Import invoices from Xero on the Retention Tracker, then check back.)</div>
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
                      {rows.map((r, i) => {
                        const overdue = !!r.overdueBy
                        return (
                          <tr key={`${r.invoiceNumber}-${i}`} style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                            <td style={{ ...td, fontWeight: 600, color: '#1a1a2e' }}>
                              {r.invoiceNumber || '—'}
                              {r.highRisk && <span title="High risk customer" style={{ marginLeft: 6, fontSize: 9, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>HIGH RISK</span>}
                            </td>
                            <td style={{ ...td, whiteSpace: 'normal', maxWidth: 230 }}>{r.reference || r.projectName || '—'}</td>
                            <td style={{ ...td, whiteSpace: 'normal', maxWidth: 180 }}>{r.customer || '—'}</td>
                            <td style={td}>{fmtDate(r.date)}</td>
                            <td style={{ ...td, color: overdue ? '#dc2626' : '#555', fontWeight: overdue ? 600 : 400 }}>{fmtDate(r.dueDate)}</td>
                            <td style={{ ...td, color: '#dc2626', fontWeight: 700 }}>{r.overdueBy ? `${r.overdueBy} day${r.overdueBy === 1 ? '' : 's'}` : ''}</td>
                            <td style={td}>
                              <input type="date" value={r.expectedDate || ''} onChange={e => setExpected(r.invoiceNumber, e.target.value)}
                                style={{ fontSize: 11, padding: '3px 5px', border: '1px solid #e5e5e5', borderRadius: 5, fontFamily: 'inherit' }} />
                            </td>
                            <td style={{ ...td, textAlign: 'right', color: '#555' }}>{fmt(r.paid)}</td>
                            <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: overdue ? '#dc2626' : '#1a1a2e' }}>{fmt(r.due)}</td>
                            <td style={td}>
                              <button onClick={() => setCommentInvoice(r)}
                                style={{ background: r.commentCount ? '#eef2ff' : '#f0f2f5', border: '1px solid ' + (r.commentCount ? '#c7d2fe' : '#e5e5e5'), borderRadius: 6, padding: '4px 9px', fontSize: 11, cursor: 'pointer', color: r.commentCount ? '#4f46e5' : '#555', fontWeight: 600 }}>
                                💬 {r.commentCount ? `${r.commentCount}` : 'Add'}
                              </button>
                            </td>
                            <td style={td}>
                              <span title="Chase-email buttons with timeline are coming in a later update — email content to be provided." style={{ fontSize: 11, color: '#bbb', cursor: 'help' }}>— soon —</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
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
    const upto = text.slice(0, caret).replace(/@([\w ]{0,30})$/, '@' + member.name + ' ')
    setText(upto + text.slice(caret))
    setShowMentions(false)
    if (el) setTimeout(() => el.focus(), 0)
  }
  const mentionMatches = members.filter(m => m.name && m.name.toLowerCase().includes(mentionQuery)).slice(0, 6)

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
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1a1a2e' }}>{c.author}{c.source === 'email-bcc' && <span style={{ marginLeft: 6, fontSize: 9, background: '#f0fdf4', color: '#16a34a', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>via email</span>}</span>
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
                    <div style={{ fontSize: 13, color: '#333', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{c.text}</div>
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
            <div style={{ position: 'absolute', bottom: 74, left: 16, right: 16, background: '#fff', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.12)', maxHeight: 180, overflowY: 'auto', zIndex: 5 }}>
              <div style={{ fontSize: 10, color: '#999', padding: '6px 10px 2px' }}>Mention someone</div>
              {mentionMatches.map(m => (
                <button key={m.id} type="button" onClick={() => insertMention(m)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', background: '#fff', cursor: 'pointer', fontSize: 13 }}>{m.name}</button>
              ))}
            </div>
          )}
          <textarea ref={taRef} value={text} onChange={onType} rows={2} placeholder="Add a comment… use @ to mention a colleague"
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e5e5e5', borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
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
