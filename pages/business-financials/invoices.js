import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { BizNav, INK, GOLD, gbp, gbpK, monthLbl, fmtDate, Card } from '../../components/BizNav'

const monthKey = (s) => (s || '').slice(0, 7)
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayISO = () => new Date().toISOString().slice(0, 10)

function daysOverdue(dueDate) {
  if (!dueDate) return null
  const due = new Date(dueDate + 'T00:00:00')
  const now = new Date(todayISO() + 'T00:00:00')
  const d = Math.round((now - due) / 86400000)
  return d
}

// Render comment text with @mentions (known member names) bold+blue.
function renderWithMentions(text, members = []) {
  const names = members.map(m => m.name).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!names.length || !text) return text
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('@(' + names.map(esc).join('|') + ')', 'g')
  const out = []; let last = 0, m, key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<span key={key++} style={{ color: '#2563eb', fontWeight: 700 }}>@{m[1]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function InvoicesOwed() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [invoices, setInvoices] = useState([])
  const [meta, setMeta] = useState({})
  const [members, setMembers] = useState([])
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [commentInvoice, setCommentInvoice] = useState(null)

  const today = new Date()
  const [dateBasis, setDateBasis] = useState('expected')   // 'expected' | 'due'
  const [view, setView] = useState('outstanding')   // outstanding | all
  const [sortKey, setSortKey] = useState('dueDate')
  const [sortDir, setSortDir] = useState('asc')
  const [sel, setSel] = useState({})   // { invoiceNumber: true }

  // Supplier (customer) multi-select filter with type-ahead.
  const [custPick, setCustPick] = useState([])
  const [custOpen, setCustOpen] = useState(false)
  const [custSearch, setCustSearch] = useState('')
  const custRef = useRef(null)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      // SAME data source as the commercial Outstanding Invoices page (matches Xero):
      // sales invoice lines from /api/dashboard, manual meta (expected + comments)
      // from /api/outstanding-invoices (shared store invoice:meta).
      const [dashR, metaR, teamR, meR] = await Promise.all([
        fetch('/api/dashboard').then(r => r.json()).catch(() => ({})),
        fetch('/api/outstanding-invoices').then(r => r.json()).catch(() => ({ meta: {} })),
        fetch('/api/team').then(r => r.json()).catch(() => ({ members: [] })),
        fetch('/api/portal-auth?action=me').then(r => r.json()).catch(() => ({ user: null })),
      ])
      setMeta(metaR.meta || {})
      setMembers(teamR.members || [])
      setMe(meR.user || null)
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
            total, paid, due,
            settled: !(due > 0.005),
            projectName: p.name || '',
          })
        }
      }
      setInvoices(rows)
    } catch (e) { console.error(e) }
    setLoading(false)
  }
  useEffect(() => { if (ok) loadAll() }, [ok])

  useEffect(() => {
    function onDoc(e) { if (custRef.current && !custRef.current.contains(e.target)) setCustOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  async function setExpected(invoiceNumber, expectedDate) {
    setMeta(m => ({ ...m, [invoiceNumber]: { ...(m[invoiceNumber] || { comments: [] }), expectedDate } }))
    try {
      await fetch('/api/outstanding-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-expected', invoiceNumber, expectedDate }),
      })
    } catch (e) { console.error(e) }
  }

  // All customer names (respecting the outstanding/all + date filters, but not the
  // Effective date per invoice, per the chosen basis. Expected falls back to due date
  // when no expected date has been set, so nothing disappears.
  const effDate = (i) => {
    if (dateBasis === 'expected') {
      const exp = meta[i.invoiceNumber]?.expectedDate
      return exp || i.dueDate || ''
    }
    return i.dueDate || ''
  }

  // Outstanding/All view only (date-range filter removed).
  const viewFiltered = useMemo(() => invoices.filter(i => {
    if (view === 'outstanding' && i.settled) return false
    return true
  }), [invoices, view])

  const allCustomers = useMemo(() => {
    const s = new Set()
    for (const i of viewFiltered) if (i.customer) s.add(i.customer)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [viewFiltered])
  const custMatches = useMemo(() => {
    const q = custSearch.trim().toLowerCase()
    return q ? allCustomers.filter(s => s.toLowerCase().includes(q)) : allCustomers
  }, [allCustomers, custSearch])
  const custSet = useMemo(() => new Set(custPick), [custPick])

  const filtered = useMemo(() => {
    return viewFiltered.filter(i => {
      if (custSet.size && !custSet.has(i.customer)) return false
      return true
    })
  }, [viewFiltered, custSet])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      let av, bv
      switch (sortKey) {
        case 'customer': av = (a.customer || '').toLowerCase(); bv = (b.customer || '').toLowerCase(); break
        case 'invoiceNumber': av = (a.invoiceNumber || '').toLowerCase(); bv = (b.invoiceNumber || '').toLowerCase(); break
        case 'reference': av = (a.reference || '').toLowerCase(); bv = (b.reference || '').toLowerCase(); break
        case 'date': av = a.date || ''; bv = b.date || ''; break
        case 'paid': av = a.paid || 0; bv = b.paid || 0; break
        case 'due': av = a.due || 0; bv = b.due || 0; break
        case 'basisDate': av = effDate(a); bv = effDate(b); break
        case 'dueDate': default: av = a.dueDate || ''; bv = b.dueDate || ''; break
      }
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, dateBasis, meta])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'due' || key === 'paid' ? 'desc' : 'asc') }
  }
  const arrow = (key) => sortKey === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''

  const total = useMemo(() => filtered.reduce((s, i) => s + (i.due || 0), 0), [filtered])
  const selTotal = useMemo(() => sorted.filter(i => sel[i.invoiceNumber]).reduce((s, i) => s + (i.due || 0), 0), [sorted, sel])
  const selCount = Object.values(sel).filter(Boolean).length

  // LEFT chart: ALL invoices (view only), bucketed by the chosen date basis.
  const byMonthAll = useMemo(() => {
    const m = {}
    for (const i of viewFiltered) { const k = monthKey(effDate(i)) || 'No date'; m[k] = (m[k] || 0) + (i.due || 0) }
    return Object.keys(m).sort().map(k => ({ month: k, amount: Math.round(m[k]) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewFiltered, dateBasis, meta])

  // RIGHT chart: ticked rows if any ticked, else the filtered rows.
  const byMonthSel = useMemo(() => {
    const anyTicked = Object.values(sel).some(Boolean)
    const base = anyTicked ? sorted.filter(i => sel[i.invoiceNumber]) : filtered
    const m = {}
    for (const i of base) { const k = monthKey(effDate(i)) || 'No date'; m[k] = (m[k] || 0) + (i.due || 0) }
    return Object.keys(m).sort().map(k => ({ month: k, amount: Math.round(m[k]) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, filtered, sel, dateBasis, meta])
  const rightIsTicked = Object.values(sel).some(Boolean)
  const thisMonth = today.toISOString().slice(0, 7)

  if (!ok) return null
  return (
    <>
      <Head><title>Invoices Owed - Business Financials</title></Head>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <BizNav />
        <div style={{ padding: '24px 16px', maxWidth: '100%', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <h1 style={{ fontSize: 22, color: INK, margin: 0 }}>Invoices Owed <span style={{ fontSize: 12, color: '#aaa', fontWeight: 400 }}>(sales invoices)</span></h1>
            <div style={{ fontSize: 11, color: '#aaa' }}>Same source as the Outstanding Invoices page</div>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', background: '#fff', border: '1px solid #e6e3dc', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #ddd' }}>
              <button onClick={() => setView('outstanding')} style={{ ...toggle, background: view === 'outstanding' ? GOLD : '#fff', color: view === 'outstanding' ? '#fff' : '#666' }}>Outstanding</button>
              <button onClick={() => setView('all')} style={{ ...toggle, background: view === 'all' ? GOLD : '#fff', color: view === 'all' ? '#fff' : '#666' }}>All</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#888' }}>Date basis:</span>
              <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #ddd' }}>
                <button onClick={() => setDateBasis('expected')} style={{ ...toggle, background: dateBasis === 'expected' ? GOLD : '#fff', color: dateBasis === 'expected' ? '#fff' : '#666' }}>Expected</button>
                <button onClick={() => setDateBasis('due')} style={{ ...toggle, background: dateBasis === 'due' ? GOLD : '#fff', color: dateBasis === 'due' ? '#fff' : '#666' }}>Due</button>
              </div>
            </div>

            {/* Customer multi-select with type-ahead */}
            <div ref={custRef} style={{ position: 'relative', minWidth: 240 }}>
              <div onClick={() => setCustOpen(o => !o)} style={{ ...dateInp, minWidth: 240, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: custPick.length ? INK : '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                  {custPick.length ? custPick.join(', ') : 'All customers'}
                </span>
                <span style={{ color: '#999' }}>{custOpen ? '\u25B2' : '\u25BC'}</span>
              </div>
              {custOpen && (
                <div style={{ position: 'absolute', top: 40, left: 0, zIndex: 30, background: '#fff', border: '1px solid #e2e0da', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,0.14)', width: 320, padding: 8 }}>
                  <input autoFocus value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="Type to search customers..."
                    style={{ width: '100%', padding: '7px 9px', border: '1px solid #e2e0da', borderRadius: 7, fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }} />
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <button onClick={() => setCustPick([])} style={miniBtn}>Clear</button>
                    <button onClick={() => setCustPick(custMatches)} style={miniBtn}>Select shown</button>
                  </div>
                  <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {custMatches.length === 0 && <div style={{ fontSize: 12, color: '#aaa', padding: 8 }}>No customers match.</div>}
                    {custMatches.map(s => (
                      <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={custSet.has(s)} onChange={() => setCustPick(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <span style={{ marginLeft: 'auto', fontSize: 13, color: '#555' }}>Total due: <strong style={{ color: INK }}>{gbp(total)}</strong> ({filtered.length})</span>
            <span style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 12px' }}>Selected: <strong>{gbp(selTotal)}</strong> ({selCount})</span>
          </div>

          {loading ? <div style={{ color: '#999', padding: 40 }}>Loading...</div> : (
            <>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 45%', minWidth: 320 }}>
                  <Card title={`Invoices by month (all, by ${dateBasis} date)`} sub="Everything owed - unaffected by the customer filter or selection">
                    {byMonthAll.length === 0 ? <div style={{ color: '#bbb', padding: 30, textAlign: 'center' }}>No invoices to show.</div> : (
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={byMonthAll} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                          <XAxis dataKey="month" tickFormatter={(m) => m === 'No date' ? 'No date' : monthLbl(m)} tick={{ fontSize: 11 }} />
                          <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={48} />
                          <Tooltip formatter={(v) => gbp(v)} labelFormatter={(m) => m === 'No date' ? 'No due date' : monthLbl(m)} />
                          <ReferenceLine x={thisMonth} stroke="#16a34a" strokeDasharray="4 3" label={{ value: 'now', fontSize: 10, fill: '#16a34a' }} />
                          <Bar dataKey="amount" name="Owed" fill="#16a34a" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </Card>
                </div>
                <div style={{ flex: '1 1 45%', minWidth: 320 }}>
                  <Card title={rightIsTicked ? 'Selected invoices by month (ticked)' : 'Filtered invoices by month'} sub={rightIsTicked ? `Only the rows you have ticked (by ${dateBasis} date)` : `Follows the customer filter (by ${dateBasis} date)`}>
                    {byMonthSel.length === 0 ? <div style={{ color: '#bbb', padding: 30, textAlign: 'center' }}>No invoices match the current filter/selection.</div> : (
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={byMonthSel} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                          <XAxis dataKey="month" tickFormatter={(m) => m === 'No date' ? 'No date' : monthLbl(m)} tick={{ fontSize: 11 }} />
                          <YAxis tickFormatter={gbpK} tick={{ fontSize: 11 }} width={48} />
                          <Tooltip formatter={(v) => gbp(v)} labelFormatter={(m) => m === 'No date' ? 'No due date' : monthLbl(m)} />
                          <ReferenceLine x={thisMonth} stroke="#16a34a" strokeDasharray="4 3" label={{ value: 'now', fontSize: 10, fill: '#16a34a' }} />
                          <Bar dataKey="amount" name="Owed" fill="#2563eb" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </Card>
                </div>
              </div>
              <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e6e3dc', borderRadius: 14, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#faf9f7', borderBottom: '2px solid #eee' }}>
                      <th style={{ ...th, width: 36 }}>
                        <input type="checkbox" checked={selCount > 0 && selCount === sorted.length} onChange={e => setSel(e.target.checked ? Object.fromEntries(sorted.map(i => [i.invoiceNumber, true])) : {})} />
                      </th>
                      <th style={{ ...th, textAlign: 'left', cursor: 'pointer' }} onClick={() => toggleSort('invoiceNumber')}>INV No{arrow('invoiceNumber')}</th>
                      <th style={{ ...th, textAlign: 'left', cursor: 'pointer' }} onClick={() => toggleSort('reference')}>Ref{arrow('reference')}</th>
                      <th style={{ ...th, textAlign: 'left', cursor: 'pointer' }} onClick={() => toggleSort('customer')}>To{arrow('customer')}</th>
                      <th style={{ ...th, textAlign: 'left', cursor: 'pointer' }} onClick={() => toggleSort('date')}>Date{arrow('date')}</th>
                      <th style={{ ...th, textAlign: 'left', cursor: 'pointer' }} onClick={() => toggleSort('dueDate')}>Due date{arrow('dueDate')}</th>
                      <th style={th}>Overdue</th>
                      <th style={{ ...th, textAlign: 'left' }}>Expected</th>
                      <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('paid')}>Paid{arrow('paid')}</th>
                      <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('due')}>Due{arrow('due')}</th>
                      <th style={th}>Comments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((i, idx) => {
                      const od = daysOverdue(effDate(i))
                      const overdue = od != null && od > 0 && i.due > 0.005
                      const m = meta[i.invoiceNumber] || {}
                      const nComments = (m.comments || []).length
                      return (
                        <tr key={(i.invoiceNumber || idx) + '_' + idx} style={{ borderBottom: '1px solid #f2f0ec', background: sel[i.invoiceNumber] ? '#fffbeb' : 'transparent' }}>
                          <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={!!sel[i.invoiceNumber]} onChange={e => setSel(s => ({ ...s, [i.invoiceNumber]: e.target.checked }))} /></td>
                          <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{i.invoiceNumber || '-'}</td>
                          <td style={{ ...td, textAlign: 'left', color: '#666', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={i.reference}>{i.reference || '-'}</td>
                          <td style={{ ...td, textAlign: 'left' }}>{i.customer || '-'}</td>
                          <td style={{ ...td, textAlign: 'left', color: '#555' }}>{fmtDate(i.date)}</td>
                          <td style={{ ...td, textAlign: 'left', color: overdue ? '#dc2626' : '#555', fontWeight: overdue ? 600 : 400 }}>{fmtDate(i.dueDate)}</td>
                          <td style={{ ...td, color: overdue ? '#dc2626' : '#aaa', fontWeight: overdue ? 700 : 400 }}>{overdue ? `${od}d` : (i.settled ? '-' : (od != null && od <= 0 ? `${-od}d left` : '-'))}</td>
                          <td style={{ ...td, textAlign: 'left' }}>
                            <input type="date" value={m.expectedDate || ''} onChange={e => setExpected(i.invoiceNumber, e.target.value)}
                              style={{ padding: '4px 6px', border: '1px solid #e2e0da', borderRadius: 6, fontSize: 12 }} />
                          </td>
                          <td style={{ ...td, color: '#166534' }}>{i.paid ? gbp(i.paid) : '-'}</td>
                          <td style={{ ...td, fontWeight: 700, color: i.due > 0.005 ? INK : '#999' }}>{gbp(i.due)}</td>
                          <td style={td}>
                            <button onClick={() => setCommentInvoice(i)} title="View / add comments"
                              style={{ border: '1px solid #e2e0da', background: nComments ? '#eef6ff' : '#fff', borderRadius: 7, padding: '3px 9px', cursor: 'pointer', fontSize: 12, color: nComments ? '#2563eb' : '#888', fontWeight: nComments ? 700 : 400 }}>
                              {nComments ? `${nComments} \u{1F4AC}` : 'Add'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    {sorted.length === 0 && <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: '#bbb', padding: 24 }}>No invoices match the current filters.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>Sales invoices (Xero ACCREC), same data as the Outstanding Invoices page. Comments are shared between both pages.</div>
            </>
          )}
        </div>
      </div>

      {commentInvoice && (
        <CommentModal
          invoice={commentInvoice}
          meta={meta[commentInvoice.invoiceNumber] || { comments: [] }}
          members={members}
          me={me}
          onClose={() => setCommentInvoice(null)}
          onChanged={(invNo, patch) => setMeta(mm => ({ ...mm, [invNo]: { ...(mm[invNo] || { comments: [] }), ...patch } }))}
        />
      )}
    </>
  )
}

function CommentModal({ invoice, meta, members, me, onClose, onChanged }) {
  const [list, setList] = useState(meta.comments || [])
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const authorName = (me && me.name) || 'Accounts'

  function resolveMentions(t) {
    return members.filter(mem => mem.name && t.toLowerCase().includes('@' + mem.name.toLowerCase())).map(mem => mem.name)
  }
  async function addComment() {
    if (!text.trim()) return
    setSaving(true)
    try {
      const r = await fetch('/api/outstanding-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-comment', invoiceNumber: invoice.invoiceNumber, text, author: authorName, mentions: resolveMentions(text) }),
      })
      const d = await r.json()
      if (d.comment) { const nl = [...list, d.comment]; setList(nl); onChanged(invoice.invoiceNumber, { comments: nl }); setText('') }
    } catch (e) { console.error(e) }
    setSaving(false)
  }
  async function deleteComment(commentId) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this comment?')) return
    try {
      await fetch('/api/outstanding-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-comment', invoiceNumber: invoice.invoiceNumber, commentId }),
      })
      const nl = list.filter(c => c.id !== commentId); setList(nl); onChanged(invoice.invoiceNumber, { comments: nl })
    } catch (e) { console.error(e) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{invoice.invoiceNumber} - {invoice.customer}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{invoice.reference || invoice.projectName}</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>&times;</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: 16 }}>
          {list.length === 0 ? <div style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: 20 }}>No comments yet.</div> : list.map(c => (
            <div key={c.id} style={{ marginBottom: 12, borderBottom: '1px solid #f4f2ee', paddingBottom: 10 }}>
              <div style={{ fontSize: 13, color: '#222', whiteSpace: 'pre-wrap' }}>{renderWithMentions(c.text, members)}</div>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 3, display: 'flex', gap: 8 }}>
                <span>{c.author || 'Unknown'}</span>
                <span>{c.at ? new Date(c.at).toLocaleString('en-GB') : ''}</span>
                <button onClick={() => deleteComment(c.id)} style={{ border: 'none', background: 'none', color: '#c00', cursor: 'pointer', fontSize: 11, padding: 0 }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: 12, borderTop: '1px solid #eee' }}>
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Add a comment... use @Name to mention"
            style={{ width: '100%', minHeight: 60, padding: 9, border: '1px solid #e2e0da', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={addComment} disabled={saving || !text.trim()}
              style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (saving || !text.trim()) ? 0.5 : 1 }}>
              {saving ? 'Saving...' : 'Add comment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const th = { padding: '10px 12px', fontSize: 12, color: '#777', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', textAlign: 'right' }
const dateInp = { padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }
const toggle = { padding: '7px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer' }
const miniBtn = { flex: 1, fontSize: 11, border: '1px solid #e2e0da', background: '#fff', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }
