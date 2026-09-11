import { useState, useMemo, useEffect, Fragment } from 'react'

// THE IN QUERY TABLE.
//
// Its own component rather than another branch inside the generic bookkeeping table.
// It groups by invoice, sorts on any column, carries an assignee, a status and a
// comment thread, and sends the list out - none of which the other tabs do, and all
// of which would have turned that table into a thicket of `tab === 'inquery' &&`.
const money = (n) => `\u00A3${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const when = (ms) => { try { return new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

const th = { padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid #eee', whiteSpace: 'nowrap', userSelect: 'none' }
const td = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid #f4f4f2', verticalAlign: 'top' }

// date|supplier|reference. Must match invoiceKeyOf in lib/inquery.js - the server
// keys its records the same way, and a mismatch would silently orphan every record.
const keyOf = (r) => [r.date || '', r.supplier || r.contact || '', r.reference || r.invoiceNumber || ''].join('|')

export default function InQueryTable({ rows, statusFilter, onStatusFilterChange }) {
  const [state, setState] = useState({})
  const [users, setUsers] = useState([])
  const [sortCol, setSortCol] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [expanded, setExpanded] = useState(null)
  const [userFilter, setUserFilter] = useState('')
  const [manualFor, setManualFor] = useState(null)     // key being assigned by hand
  const [manual, setManual] = useState({ name: '', email: '' })
  const [commentFor, setCommentFor] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [sendResult, setSendResult] = useState(null)

  useEffect(() => {
    fetch('/api/bookkeeping-inquery').then(r => r.json())
      .then(d => { if (!d.error) { setState(d.state || {}); setUsers(d.users || []) } })
      .catch(() => {})
  }, [])

  async function post(body) {
    setBusy(true); setMsg('')
    try {
      const d = await fetch('/api/bookkeeping-inquery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
      if (d.error) { setMsg(d.error); return null }
      if (d.state) setState(d.state)
      return d
    } catch (e) { setMsg(e.message || 'Failed'); return null }
    finally { setBusy(false) }
  }

  // ONE ROW PER INVOICE. The lines are kept on the group so they can be opened, and
  // so the email and the review page can show what makes up the amount.
  const groups = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      const k = keyOf(r)
      if (!m.has(k)) m.set(k, { key: k, date: r.date || '', supplier: r.supplier || r.contact || '', reference: r.reference || r.invoiceNumber || '', amount: 0, lines: [], project: r.project || '' })
      const g = m.get(k)
      g.amount += Number(r.amount != null ? r.amount : r.total) || 0
      g.lines.push({ description: r.description || '', accountCode: r.accountCode || '', amount: Number(r.amount != null ? r.amount : r.total) || 0, category: r.category || '' })
    }
    return [...m.values()].map(g => {
      const rec = state[g.key] || {}
      return {
        ...g,
        description: g.lines.length === 1 ? g.lines[0].description : `${g.lines.length} lines`,
        assignee: rec.assignee || null,
        status: rec.status === 'approved' ? 'approved' : 'query',
        comments: Array.isArray(rec.comments) ? rec.comments : [],
      }
    })
  }, [rows, state])

  // Every name on screen, portal or typed, so the filter offers what is actually
  // there rather than the whole staff list.
  const assigneeOptions = useMemo(() => {
    const seen = new Map()
    for (const g of groups) if (g.assignee?.name) seen.set(g.assignee.email || g.assignee.name, g.assignee.name)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [groups])

  // Counts across everything on the tab, BEFORE the status filter - they exist to
  // tell you what is in the other views, so they cannot be filtered by the view.
  const counts = useMemo(() => ({
    query: groups.filter(g => g.status !== 'approved').length,
    approved: groups.filter(g => g.status === 'approved').length,
    all: groups.length,
  }), [groups])

  const filtered = useMemo(() => {
    let out = groups
    if (statusFilter) out = out.filter(g => g.status === statusFilter)
    if (userFilter) out = out.filter(g => (g.assignee?.email || g.assignee?.name || '') === userFilter)
    const dir = sortDir === 'asc' ? 1 : -1
    const val = (g) => {
      switch (sortCol) {
        case 'supplier': return String(g.supplier).toLowerCase()
        case 'reference': return String(g.reference).toLowerCase()
        case 'description': return String(g.description).toLowerCase()
        case 'amount': return g.amount
        case 'user': return String(g.assignee?.name || '').toLowerCase()
        case 'status': return g.status
        case 'comments': return g.comments.length
        default: return String(g.date)
      }
    }
    return [...out].sort((a, b) => {
      const x = val(a), y = val(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
  }, [groups, statusFilter, userFilter, sortCol, sortDir])

  const total = filtered.reduce((s, g) => s + g.amount, 0)
  const sortBy = (col) => { if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir(col === 'amount' ? 'desc' : 'asc') } }
  // In a JSX expression, not as bare text - \u2195 written as text renders the six
  // characters, not the arrow.
  const arrow = (col) => sortCol === col
    ? <span style={{ fontSize: 9, marginLeft: 3 }}>{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
    : <span style={{ fontSize: 9, marginLeft: 3, color: '#ccc' }}>{'\u2195'}</span>

  async function sendList() {
    const items = filtered
      .filter(g => g.status !== 'approved' && g.assignee?.email)
      .map(g => ({ key: g.key, date: g.date, supplier: g.supplier, reference: g.reference, description: g.description, amount: g.amount, lines: g.lines }))
    if (!items.length) { setMsg('Nothing to send - assign somebody with an email address first.'); return }
    const d = await post({ action: 'send', items })
    if (d) setSendResult(d)
  }

  const COLS = [['date', 'Date'], ['supplier', 'Supplier'], ['reference', 'Reference'], ['description', 'Description'],
    ['amount', 'Amount'], ['user', 'User responsible'], ['status', 'Status'], ['comments', 'Comments']]

  return (
    <div>
      <div style={{ margin: '0 0 12px', padding: '9px 12px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', fontSize: 12.5, color: '#7c2d12' }}>
        Costs parked against the <strong>In Query</strong> tracking option in Xero - in the books, but not yet on a
        project. Assign each one to whoever can answer it, send them the list, and they approve it or say what is
        wrong. Approving does not move it: you then re-tag it to the job in Xero, at which point it leaves this tab.
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        {/* A segmented control with COUNTS, not a dropdown.
            Approving something makes it leave the default view, and a collapsed
            dropdown gives no clue where it went - it reads as though the row was
            deleted. "Approved (3)" sitting next to it says plainly that it is still
            there and where to find it. */}
        <div style={{ display: 'inline-flex', border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden' }}>
          {[['query', 'In Query', counts.query], ['approved', 'Approved', counts.approved], ['', 'All', counts.all]].map(([v, label, n]) => (
            <button key={v || 'all'} onClick={() => onStatusFilterChange(v)}
              style={{
                padding: '7px 13px', fontSize: 12.5, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontWeight: statusFilter === v ? 700 : 500,
                background: statusFilter === v ? '#1a1a2e' : '#fff',
                color: statusFilter === v ? '#fff' : '#555',
              }}>
              {label} ({n})
            </button>
          ))}
        </div>
        <select value={userFilter} onChange={e => setUserFilter(e.target.value)}
          style={{ padding: '7px 10px', fontSize: 13, border: '1px solid #e5e5e5', borderRadius: 7, fontFamily: 'inherit', minWidth: 190 }}>
          <option value="">Everyone</option>
          {assigneeOptions.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          {groups.some(g => !g.assignee) && <option value="__none__" disabled>- unassigned items exist -</option>}
        </select>
        <span style={{ fontSize: 12.5, color: '#666' }}>
          {filtered.length} invoice{filtered.length === 1 ? '' : 's'} &middot; <strong>{money(total)}</strong>
        </span>
        <button onClick={sendList} disabled={busy}
          style={{ marginLeft: 'auto', background: '#1c704f', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Sending...' : 'Send list'}
        </button>
      </div>

      {statusFilter === 'query' && counts.approved > 0 && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', borderRadius: 8, padding: '7px 11px', fontSize: 12.5, marginBottom: 10 }}>
          {counts.approved} approved {counts.approved === 1 ? 'invoice is' : 'invoices are'} hidden by this view - they are not gone.
          {' '}<button onClick={() => onStatusFilterChange('approved')} style={{ background: 'none', border: 'none', padding: 0, color: '#15803d', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>Show them</button>
          {' '}They leave this tab for good once you re-tag them to a project in Xero.
        </div>
      )}
      {msg && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, marginBottom: 10 }}>{msg}</div>}
      {sendResult && (
        <div style={{ background: '#f7fdf9', border: '1px solid #bbf7d0', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 10 }}>
          {/* One line per recipient. "Sent" on its own cannot tell you which of five
              people did not get it. */}
          {(sendResult.results || []).map((r, i) => (
            <div key={i} style={{ color: r.ok ? '#15803d' : '#b91c1c' }}>
              {r.ok ? `sent - ${r.name} (${r.count} item${r.count === 1 ? '' : 's'})` : `FAILED - ${r.name} - ${r.detail || r.status || ''}`}
            </div>
          ))}
          <div style={{ color: '#888', fontSize: 11, marginTop: 3 }}>from {sendResult.from}</div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 26 }} />
              {COLS.map(([c, label]) => (
                <th key={c} onClick={() => sortBy(c)} style={{ ...th, cursor: 'pointer', textAlign: c === 'amount' ? 'right' : 'left' }}>
                  {label}{arrow(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} style={{ ...td, color: '#aaa', textAlign: 'center', padding: 30 }}>
                {groups.length === 0 ? 'Nothing tagged In Query in Xero for these filters.' : 'No items match these filters.'}
              </td></tr>
            ) : filtered.map((g, i) => (
              // Fragment with the KEY on it. A bare <> in a list has no key, so React
              // reconciles by position and an expanded row follows the wrong invoice
              // the moment the sort changes.
              <Fragment key={g.key}>
                <tr style={{ background: i % 2 ? '#fcfbf9' : '#fff' }}>
                  <td style={{ ...td, cursor: g.lines.length > 1 ? 'pointer' : 'default', color: '#aaa' }}
                    onClick={() => g.lines.length > 1 && setExpanded(expanded === g.key ? null : g.key)}>
                    {g.lines.length > 1 ? (expanded === g.key ? '\u25BE' : '\u25B8') : ''}
                  </td>
                  <td style={td}>{g.date || '\u2014'}</td>
                  <td style={td}>{g.supplier || '\u2014'}</td>
                  <td style={td}>{g.reference || '\u2014'}</td>
                  <td style={{ ...td, maxWidth: 260, whiteSpace: 'normal' }}>{g.description || '\u2014'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{money(g.amount)}</td>
                  <td style={td}>
                    <select
                      value={g.assignee ? (g.assignee.userId || `manual:${g.assignee.email}`) : ''}
                      onChange={e => {
                        const v = e.target.value
                        if (v === '__manual__') { setManualFor(g.key); setManual({ name: '', email: '' }); return }
                        if (!v) { post({ action: 'assign', key: g.key, assignee: null }); return }
                        const u = users.find(x => x.id === v)
                        if (u) post({ action: 'assign', key: g.key, assignee: { name: u.name, email: u.email, userId: u.id } })
                      }}
                      style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #e5e5e5', borderRadius: 6, fontFamily: 'inherit', maxWidth: 170 }}>
                      <option value="">Unassigned</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      {g.assignee && !g.assignee.userId && <option value={`manual:${g.assignee.email}`}>{g.assignee.name}</option>}
                      <option value="__manual__">Someone else...</option>
                    </select>
                    {g.assignee && <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{g.assignee.email}</div>}
                  </td>
                  <td style={td}>
                    {/* Changed here, not only inside the comments window. Approving a
                        run of invoices is the common job and it should not need a
                        modal opened and closed for each one. */}
                    <select
                      value={g.status}
                      onChange={e => post({ action: 'status', key: g.key, status: e.target.value })}
                      title="Change the status"
                      style={{
                        fontSize: 10.5, fontWeight: 700, borderRadius: 20, padding: '3px 8px', cursor: 'pointer',
                        fontFamily: 'inherit', appearance: 'none', textAlign: 'center',
                        background: g.status === 'approved' ? '#dcfce7' : '#fef3c7',
                        color: g.status === 'approved' ? '#15803d' : '#b45309',
                        border: `1px solid ${g.status === 'approved' ? '#bbf7d0' : '#fde68a'}`,
                      }}>
                      <option value="query">In Query</option>
                      <option value="approved">Approved</option>
                    </select>
                  </td>
                  <td style={td}>
                    <button onClick={() => { setCommentFor(g.key); setDraft('') }}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: g.comments.length ? '#3730a3' : '#9aa5b1', fontSize: 12, fontWeight: g.comments.length ? 700 : 400 }}>
                      {g.comments.length ? `${g.comments.length} comment${g.comments.length === 1 ? '' : 's'}` : 'Add'}
                    </button>
                    {g.comments.length > 0 && (
                      <div style={{ fontSize: 10.5, color: '#888', marginTop: 2, maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {g.comments[g.comments.length - 1].body}
                      </div>
                    )}
                  </td>
                </tr>
                {expanded === g.key && g.lines.map((l, li) => (
                  <tr key={`${g.key}-${li}`} style={{ background: '#eef2ff' }}>
                    <td />
                    <td style={{ ...td, color: '#888', fontSize: 12 }} colSpan={3}>{l.description || '\u2014'}</td>
                    <td style={{ ...td, fontSize: 11, color: '#888' }}>{l.accountCode}</td>
                    <td style={{ ...td, textAlign: 'right', fontSize: 12, color: '#555' }}>{money(l.amount)}</td>
                    <td colSpan={3} />
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {manualFor && (
        <Modal title="Assign to someone else" onClose={() => setManualFor(null)}>
          <p style={{ fontSize: 13, color: '#777', marginTop: 0 }}>
            An email address is required - the list is sent to them, and the link they get is tied to it.
          </p>
          <input value={manual.name} onChange={e => setManual(s => ({ ...s, name: e.target.value }))} placeholder="Name"
            style={inp} />
          <input value={manual.email} onChange={e => setManual(s => ({ ...s, email: e.target.value }))} placeholder="Email address" type="email"
            style={{ ...inp, marginTop: 8 }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button onClick={() => setManualFor(null)} style={ghost}>Cancel</button>
            <button
              onClick={async () => {
                if (!manual.name.trim() || !manual.email.trim()) { setMsg('Both a name and an email address are needed.'); return }
                const d = await post({ action: 'assign', key: manualFor, assignee: { name: manual.name.trim(), email: manual.email.trim() } })
                if (d) setManualFor(null)
              }}
              style={primary}>Assign</button>
          </div>
        </Modal>
      )}

      {commentFor && (() => {
        const g = groups.find(x => x.key === commentFor)
        if (!g) return null
        return (
          <Modal title={`${g.supplier || 'Invoice'} - ${money(g.amount)}`} onClose={() => setCommentFor(null)}>
            {g.comments.length === 0 && <p style={{ fontSize: 13, color: '#888', marginTop: 0 }}>No comments yet.</p>}
            {g.comments.map((c, i) => (
              <div key={i} style={{ borderLeft: '3px solid #e5e7eb', background: '#fafafa', borderRadius: 6, padding: '7px 10px', marginBottom: 7 }}>
                <div style={{ fontSize: 11.5, color: '#888' }}>{c.by} &middot; {when(c.at)}</div>
                <div style={{ fontSize: 13, color: '#333', whiteSpace: 'pre-wrap', fontStyle: c.system ? 'italic' : 'normal' }}>{c.body}</div>
              </div>
            ))}
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} placeholder="Add a comment..."
              style={{ ...inp, resize: 'vertical', marginTop: 8 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                onClick={() => post({ action: 'status', key: g.key, status: g.status === 'approved' ? 'query' : 'approved' })}
                style={{ ...ghost, color: g.status === 'approved' ? '#b45309' : '#15803d' }}>
                {g.status === 'approved' ? 'Put back in query' : 'Mark approved'}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setCommentFor(null)} style={ghost}>Close</button>
                <button onClick={async () => { if (!draft.trim()) return; const d = await post({ action: 'comment', key: g.key, body: draft }); if (d) setDraft('') }}
                  disabled={!draft.trim()} style={{ ...primary, opacity: draft.trim() ? 1 : 0.5 }}>Add comment</button>
              </div>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}

const inp = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 14, border: '1px solid #ddd', borderRadius: 8, fontFamily: 'inherit' }
const ghost = { padding: '8px 14px', fontSize: 13, borderRadius: 7, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }
const primary = { padding: '8px 16px', fontSize: 13, fontWeight: 700, borderRadius: 7, border: 'none', background: '#1c704f', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }

// x and Escape only, never a backdrop click - a half-typed comment should not vanish
// because somebody clicked past the edge of the box.
function Modal({ title, children, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 10, width: '100%', maxWidth: 560, maxHeight: '85vh', overflow: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: '#1a1a2e' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#888', lineHeight: 1 }}>&times;</button>
        </div>
        {children}
      </div>
    </div>
  )
}
