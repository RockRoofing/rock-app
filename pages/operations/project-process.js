import { useState, useEffect, useRef, useCallback } from 'react'
import OperationsShell, { PageHeading } from '../../components/OperationsShell'
import { INK, GOLD, Loading, primaryBtn, ghostBtn } from '../../components/opsUI'

const API = '/api/project-process'

export default function ProjectProcessPage() {
  const [board, setBoard] = useState(null)
  const [users, setUsers] = useState([])
  const [addable, setAddable] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)       // { projectNo, cardId }
  const [adding, setAdding] = useState(false)
  const [pick, setPick] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await fetch(API).then(r => r.json())
      setBoard(d.board || { columns: [] }); setUsers(d.users || []); setAddable(d.addable || [])
    } catch {}
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // Deep-link from email: ?project=..&card=..
  useEffect(() => {
    if (!board) return
    const q = new URLSearchParams(window.location.search)
    const p = q.get('project'), c = q.get('card')
    if (p && c && board.columns.some(col => col.projectNo === p)) setOpen({ projectNo: p, cardId: c })
  }, [board])

  async function post(payload) {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    return r.json().catch(() => ({}))
  }
  async function addProject() {
    if (!pick) return
    await post({ action: 'add-project', projectNo: pick })
    setPick(''); setAdding(false); load()
  }
  async function removeProject(projectNo) {
    if (!confirm('Remove this project from the board? Its checklists and notes will be lost.')) return
    await post({ action: 'remove-project', projectNo }); load()
  }

  if (loading || !board) return (
    <OperationsShell active="process" section="process" title="Project Process" wide><PageHeading title="Project Process" /><Loading /></OperationsShell>
  )

  const openCol = open && board.columns.find(c => c.projectNo === open.projectNo)
  const openCard = openCol && openCol.cards.find(c => c.id === open.cardId)

  return (
    <OperationsShell active="process" section="process" title="Project Process" wide>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 2px', fontSize: 22, color: INK }}>Project Process</h1>
          <div style={{ fontSize: 13, color: '#8a857c' }}>Each project has a card per role with a checklist to complete. New projects are added automatically; use Add project to pull in an existing one.</div>
        </div>
        <button onClick={() => setAdding(a => !a)} style={primaryBtn}>{adding ? 'Cancel' : '+ Add project'}</button>
      </div>

      {adding && (
        <div style={{ background: '#fff', border: '1px solid #ece9f5', borderRadius: 12, padding: 14, marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#666' }}>Add an existing project:</span>
          <select value={pick} onChange={e => setPick(e.target.value)} style={{ ...selStyle, minWidth: 320 }}>
            <option value="">Select a project...</option>
            {addable.map(p => <option key={p.projectNo} value={p.projectNo}>{p.projectNo} - {p.name}</option>)}
          </select>
          <button onClick={addProject} disabled={!pick} style={{ ...primaryBtn, opacity: pick ? 1 : 0.5 }}>Add</button>
          {addable.length === 0 && <span style={{ fontSize: 12, color: '#aaa' }}>All current projects are already on the board.</span>}
        </div>
      )}

      {board.columns.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 40, textAlign: 'center', color: '#aaa' }}>
          No projects on the board yet. New projects will appear here automatically, or add an existing one above.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start' }}>
          {board.columns.map(coln => (
            <div key={coln.projectNo} style={{ minWidth: 300, maxWidth: 300, flex: '0 0 300px' }}>
              <div style={{ background: '#faf9f7', border: '1px solid #ece9e3', borderRadius: 12, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: INK }}>{coln.name}</div>
                    <div style={{ fontSize: 11, color: '#a09a90' }}>{coln.projectNo}{coln.customer ? ` - ${coln.customer}` : ''}</div>
                  </div>
                  <button onClick={() => removeProject(coln.projectNo)} title="Remove project from board" style={{ background: 'none', border: 'none', color: '#c9c4bc', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>&times;</button>
                </div>
                {coln.cards.map(card => {
                  const done = card.items.filter(i => i.done).length
                  const total = card.items.length
                  const pct = total ? Math.round((done / total) * 100) : 0
                  const overdue = card.dueDate && !isAllDone(card) && card.dueDate < todayISO()
                  return (
                    <button key={card.id} onClick={() => setOpen({ projectNo: coln.projectNo, cardId: card.id })}
                      style={{ display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #ececec', borderRadius: 10, padding: 10, marginBottom: 8, cursor: 'pointer' }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: INK, marginBottom: 6 }}>{card.role}</div>
                      <div style={{ height: 6, background: '#f0eee9', borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#16a34a' : GOLD }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8a857c' }}>
                        <span>{done}/{total} done</span>
                        <span style={{ display: 'flex', gap: 8 }}>
                          {card.assigneeName && <span title="Assigned to">{card.assigneeName.split(' ')[0]}</span>}
                          {card.dueDate && <span style={{ color: overdue ? '#dc2626' : '#8a857c', fontWeight: overdue ? 700 : 400 }}>{fmtDMY(card.dueDate)}</span>}
                          {(card.chat || []).length > 0 && <span title="Chat messages">{(card.chat || []).length} chat</span>}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {openCard && (
        <CardModal
          projectNo={open.projectNo} projectName={openCol.name} card={openCard} users={users}
          onClose={() => setOpen(null)} post={post} reload={load}
        />
      )}
    </OperationsShell>
  )
}

function isAllDone(card) { return card.items.length > 0 && card.items.every(i => i.done) }
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function fmtDMY(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${String(y).slice(2)}` }

// ── Card detail modal ──────────────────────────────────────────────────────
function CardModal({ projectNo, projectName, card, users, onClose, post, reload }) {
  const [items, setItems] = useState(card.items)
  const [notes, setNotes] = useState(card.notes || '')
  const [due, setDue] = useState(card.dueDate || '')
  const [assignee, setAssignee] = useState(card.assignee || '')
  const [newItem, setNewItem] = useState('')
  const [editId, setEditId] = useState(null)
  const [editText, setEditText] = useState('')
  const [chat, setChat] = useState(card.chat || [])
  const dragId = useRef(null)
  const notesTimer = useRef(null)

  useEffect(() => { setItems(card.items); setNotes(card.notes || ''); setDue(card.dueDate || ''); setAssignee(card.assignee || ''); setChat(card.chat || []) }, [card.id])

  const base = { projectNo, cardId: card.id }

  async function toggle(itemId) {
    setItems(its => its.map(i => i.id === itemId ? { ...i, done: !i.done } : i))
    await post({ action: 'toggle-item', ...base, itemId })
  }
  async function addItem() {
    const text = newItem.trim(); if (!text) return
    setNewItem('')
    await post({ action: 'add-item', ...base, text })
    reload()
    const d = await fetch(API).then(r => r.json()).catch(() => null)
    if (d) { const col = d.board.columns.find(c => c.projectNo === projectNo); const cc = col && col.cards.find(c => c.id === card.id); if (cc) setItems(cc.items) }
  }
  async function saveEdit() {
    if (editId == null) return
    const text = editText.trim()
    setItems(its => its.map(i => i.id === editId ? { ...i, text } : i))
    await post({ action: 'edit-item', ...base, itemId: editId, text })
    setEditId(null); setEditText('')
  }
  async function delItem(itemId) {
    setItems(its => its.filter(i => i.id !== itemId))
    await post({ action: 'delete-item', ...base, itemId })
  }
  function onDrop(targetId) {
    if (!dragId.current || dragId.current === targetId) return
    const cur = [...items]
    const from = cur.findIndex(i => i.id === dragId.current)
    const to = cur.findIndex(i => i.id === targetId)
    if (from < 0 || to < 0) return
    const [moved] = cur.splice(from, 1); cur.splice(to, 0, moved)
    setItems(cur); dragId.current = null
    post({ action: 'reorder-items', ...base, order: cur.map(i => i.id) })
  }
  function saveNotes(v) {
    setNotes(v)
    clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => post({ action: 'set-card-meta', ...base, notes: v }), 700)
  }
  async function saveDue(v) { setDue(v); await post({ action: 'set-card-meta', ...base, dueDate: v }); reload() }
  async function saveAssignee(v) { setAssignee(v); await post({ action: 'set-card-meta', ...base, assignee: v }); reload() }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 2vw', overflowY: 'auto' }} onMouseDown={onClose}>
      <div onMouseDown={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(980px, 96vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #eee' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>{projectName} - {card.role}</div>
            <div style={{ fontSize: 12, color: '#a09a90' }}>{projectNo}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#999', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
        </div>

        <div style={{ display: 'flex', gap: 0, maxHeight: '80vh' }}>
          {/* Left: details */}
          <div style={{ flex: '1 1 60%', padding: 18, overflowY: 'auto', borderRight: '1px solid #f0f0f0' }}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ flex: '1 1 200px' }}>
                <Lbl>Required completion date</Lbl>
                <input type="date" value={due} onChange={e => saveDue(e.target.value)} style={selStyle} />
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <Lbl>Assigned to</Lbl>
                <select value={assignee} onChange={e => saveAssignee(e.target.value)} style={selStyle}>
                  <option value="">Unassigned</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>

            <Lbl>Checklist ({items.filter(i => i.done).length} of {items.length} done)</Lbl>
            <div>
              {items.map(it => (
                <div key={it.id} draggable onDragStart={() => { dragId.current = it.id }} onDragOver={e => e.preventDefault()} onDrop={() => onDrop(it.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderBottom: '1px solid #f5f5f5' }}>
                  <span title="Drag to reorder" style={{ cursor: 'grab', color: '#ccc', fontSize: 14 }}>&#8942;&#8942;</span>
                  <input type="checkbox" checked={it.done} onChange={() => toggle(it.id)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                  {editId === it.id ? (
                    <input autoFocus value={editText} onChange={e => setEditText(e.target.value)} onBlur={saveEdit} onKeyDown={e => e.key === 'Enter' && saveEdit()} style={{ ...selStyle, flex: 1 }} />
                  ) : (
                    <span onDoubleClick={() => { setEditId(it.id); setEditText(it.text) }} title="Double-click to edit"
                      style={{ flex: 1, fontSize: 13.5, color: it.done ? '#aaa' : '#333', textDecoration: it.done ? 'line-through' : 'none', cursor: 'text' }}>{it.text}</span>
                  )}
                  <button onClick={() => { setEditId(it.id); setEditText(it.text) }} style={iconBtn} title="Edit">&#9998;</button>
                  <button onClick={() => delItem(it.id)} style={{ ...iconBtn, color: '#dc2626' }} title="Delete">&times;</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} placeholder="Add an activity..." style={{ ...selStyle, flex: 1 }} />
              <button onClick={addItem} style={ghostBtn}>Add</button>
            </div>

            <Lbl>Notes</Lbl>
            <textarea value={notes} onChange={e => saveNotes(e.target.value)} rows={4} placeholder="Notes for this role..." style={{ ...selStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          {/* Right: task chat */}
          <div style={{ flex: '1 1 40%', minWidth: 300, display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
            <div style={{ padding: '14px 16px 8px', fontWeight: 700, fontSize: 14, color: INK }}>Task chat</div>
            <ChatPanel chat={chat} users={users} projectNo={projectNo} cardId={card.id} post={post}
              onPosted={(m) => setChat(c => [...c, m])} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Task chat with @mention autocomplete ───────────────────────────────────
function ChatPanel({ chat, users, projectNo, cardId, post, onPosted }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [suggest, setSuggest] = useState(null)   // { query, from } or null
  const [note, setNote] = useState('')
  const taRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [chat.length])

  function onChange(e) {
    const v = e.target.value
    setText(v)
    const caret = e.target.selectionStart
    const upto = v.slice(0, caret)
    const m = /@([\w'-]*)$/.exec(upto)
    if (m) setSuggest({ query: m[1].toLowerCase(), from: caret - m[1].length - 1 })
    else setSuggest(null)
  }
  function pick(u) {
    // Replace the @query being typed with @Name (keeping it as one token).
    const before = text.slice(0, suggest.from)
    const caret = taRef.current ? taRef.current.selectionStart : text.length
    const after = text.slice(caret)
    const token = `@${u.name}`
    const next = `${before}${token} ${after}`
    setText(next); setSuggest(null)
    setTimeout(() => { if (taRef.current) { taRef.current.focus(); const pos = (before + token + ' ').length; taRef.current.setSelectionRange(pos, pos) } }, 0)
  }
  function resolveMentions(msg) {
    // Find which portal users are @mentioned by name in the message.
    const ids = []
    for (const u of users) {
      const re = new RegExp('@' + u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'i')
      if (re.test(msg)) ids.push(u.id)
    }
    return [...new Set(ids)]
  }
  async function send() {
    const msg = text.trim(); if (!msg || sending) return
    setSending(true); setNote('')
    const mentions = resolveMentions(msg)
    const r = await post({ action: 'post-chat', projectNo, cardId, text: msg, mentions })
    setSending(false)
    if (r && r.ok) {
      setText(''); setSuggest(null)
      if (r.message) onPosted(r.message)
      const n = (r.notified || []).filter(x => x.ok).length
      if (mentions.length) setNote(n ? `Notified ${n} tagged user${n === 1 ? '' : 's'} by email.` : 'Tagged, but email could not be sent.')
    } else setNote((r && r.error) || 'Could not send.')
  }

  const matches = suggest ? users.filter(u => u.name.toLowerCase().includes(suggest.query)).slice(0, 6) : []

  return (
    <>
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 16px', minHeight: 200 }}>
        {chat.length === 0 && <div style={{ color: '#bbb', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>No messages yet. Use @name to tag a portal user - they get an email with a link to this card.</div>}
        {chat.map(m => (
          <div key={m.id} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, color: '#999', marginBottom: 2 }}><strong style={{ color: '#555' }}>{m.authorName}</strong> · {new Date(m.ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
            <div style={{ fontSize: 13.5, color: '#333', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{renderMentions(m.text, users)}</div>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid #eee', padding: 12, position: 'relative' }}>
        {suggest && matches.length > 0 && (
          <div style={{ position: 'absolute', bottom: '100%', left: 12, right: 12, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 -4px 16px rgba(0,0,0,0.1)', overflow: 'hidden', marginBottom: 4 }}>
            {matches.map(u => (
              <button key={u.id} onMouseDown={e => { e.preventDefault(); pick(u) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
                <strong>{u.name}</strong> <span style={{ color: '#aaa' }}>{u.email}</span>
              </button>
            ))}
          </div>
        )}
        <textarea ref={taRef} value={text} onChange={onChange} placeholder="Type a message. Use @ to tag someone..." rows={2}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !suggest) { e.preventDefault(); send() } }}
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0e0e0', borderRadius: 8, padding: '8px 10px', fontSize: 13.5, resize: 'vertical', fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <span style={{ fontSize: 11.5, color: note.startsWith('Notified') ? '#16a34a' : '#c0392b' }}>{note}</span>
          <button onClick={send} disabled={sending || !text.trim()} style={{ ...primaryBtn, opacity: (sending || !text.trim()) ? 0.5 : 1 }}>{sending ? 'Sending...' : 'Send'}</button>
        </div>
      </div>
    </>
  )
}

// Render @Name mentions in blue+bold within a message.
function renderMentions(text, users) {
  if (!text) return null
  // Build a regex of all known names, longest first to avoid partial overlaps.
  const names = users.map(u => u.name).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!names.length) return text
  const esc = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp('@(' + esc.join('|') + ')(?![\\w])', 'gi')
  const out = []
  let last = 0, m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<span key={m.index} style={{ color: '#2563eb', fontWeight: 700 }}>{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const selStyle = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13.5, background: '#fff' }
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', fontSize: 14, padding: '0 4px' }
const Lbl = ({ children }) => <div style={{ fontSize: 12, color: '#888', margin: '14px 0 5px', fontWeight: 600 }}>{children}</div>
