import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const blank = () => ({
  name: '', enabled: true, func: 'commercial', cadence: 'weekly', trigger: 'reminder',
  dueDay: 4, dueDom: 15, offsetDays: 0,
  recipientUserIds: [], recipientEmails: [], subject: '', body: '',
})

export default function NotificationsBuilder() {
  const [list, setList] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // notification being edited
  const [msg, setMsg] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [testTo, setTestTo] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    try { const d = await fetch('/api/notifications').then(r => r.json()); setList(d.notifications || []); setUsers(d.users || []) } catch {}
    setLoading(false)
  }

  function edit(n) { setEditing(JSON.parse(JSON.stringify(n))); setEmailInput(''); setTestTo(''); setMsg('') }
  function newOne() { edit(blank()) }

  async function save() {
    if (!editing.name.trim()) { setMsg('Give the notification a name.'); return }
    const r = await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', notification: editing }) })
    const d = await r.json()
    if (r.ok) { setList(d.notifications); setEditing(null); setMsg('') } else setMsg(d.error || 'Save failed')
  }
  async function del(id) {
    if (!confirm('Delete this notification?')) return
    const r = await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    const d = await r.json(); if (r.ok) { setList(d.notifications); setEditing(null) }
  }
  async function toggleEnabled(n) {
    const upd = { ...n, enabled: !n.enabled }
    const r = await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', notification: upd }) })
    const d = await r.json(); if (r.ok) setList(d.notifications)
  }
  async function sendTest() {
    if (!editing.id) { setMsg('Save the notification first, then send a test.'); return }
    setMsg('Sending test…')
    const r = await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', id: editing.id, testTo: testTo || undefined }) })
    const d = await r.json()
    setMsg(d.ok ? `Test sent${testTo ? ' to ' + testTo : ' to the notification recipients'}.` : `Test failed: ${d.reason || d.error || 'unknown'}`)
  }

  const set = (patch) => setEditing(e => ({ ...e, ...patch }))
  const toggleUser = (id) => setEditing(e => ({ ...e, recipientUserIds: e.recipientUserIds.includes(id) ? e.recipientUserIds.filter(x => x !== id) : [...e.recipientUserIds, id] }))
  const addEmail = () => { const v = emailInput.trim(); if (!/\S+@\S+/.test(v)) return; if (!editing.recipientEmails.includes(v)) set({ recipientEmails: [...editing.recipientEmails, v] }); setEmailInput('') }
  const removeEmail = (e) => set({ recipientEmails: editing.recipientEmails.filter(x => x !== e) })

  const scheduleText = (n) => {
    const off = n.offsetDays ? ` + ${n.offsetDays} day${n.offsetDays === 1 ? '' : 's'}` : ''
    const when = n.cadence === 'weekly' ? `${DOW[n.dueDay ?? 4]}${off}` : `${ordinal(n.dueDom || 15)} of the month${off}`
    const cond = n.trigger === 'incomplete' ? ' — only if tasks not complete' : ''
    return `${cap(n.func)} · ${cap(n.cadence)} · ${when}${cond}`
  }

  return (
    <>
      <Head><title>Notification Builder — Admin</title></Head>
      <div style={{ minHeight: '100vh', background: '#f5f6f8', fontFamily: 'system-ui,-apple-system,sans-serif' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <Link href="/admin" style={{ color: '#aaa', fontSize: 13, textDecoration: 'none' }}>&larr; Admin</Link>
          <span style={{ color: '#444' }}>|</span>
          <span style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>Email Notifications</span>
        </div>

        <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 24px', display: 'grid', gridTemplateColumns: editing ? '1fr 1.3fr' : '1fr', gap: 20 }}>
          {/* List */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Notifications</h2>
              <button onClick={newOne} style={primary}>+ New notification</button>
            </div>
            {loading ? <div style={{ color: '#999' }}>Loading…</div> : list.length === 0 ? (
              <div style={{ color: '#999', background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center' }}>No notifications yet. Create one to get started.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {list.map(n => (
                  <div key={n.id} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 10, padding: '12px 14px', opacity: n.enabled ? 1 : 0.55 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e' }}>{n.name}</div>
                        <div style={{ fontSize: 12, color: '#8a857c', marginTop: 2 }}>{scheduleText(n)}</div>
                        <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 4 }}>{(n.recipientUserIds?.length || 0) + (n.recipientEmails?.length || 0)} recipient(s)</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button onClick={() => toggleEnabled(n)} title={n.enabled ? 'On' : 'Off'} style={{ ...pill, background: n.enabled ? '#dcfce7' : '#f1f1f1', color: n.enabled ? '#16a34a' : '#999' }}>{n.enabled ? 'On' : 'Off'}</button>
                        <button onClick={() => edit(n)} style={linkBtn}>Edit</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Editor */}
          {editing && (
            <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 18, alignSelf: 'start' }}>
              <h3 style={{ margin: '0 0 14px', fontSize: 16 }}>{editing.id ? 'Edit notification' : 'New notification'}</h3>

              <Field label="Name"><input value={editing.name} onChange={e => set({ name: e.target.value })} style={inp} placeholder="e.g. Weekly Commercial reminder" /></Field>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Function">
                  <select value={editing.func} onChange={e => set({ func: e.target.value })} style={inp}>
                    <option value="commercial">Commercial</option>
                    <option value="bookkeeping">Bookkeeping</option>
                  </select>
                </Field>
                <Field label="Cadence">
                  <select value={editing.cadence} onChange={e => set({ cadence: e.target.value, dueDay: e.target.value === 'weekly' ? (editing.func === 'bookkeeping' ? 5 : 4) : editing.dueDay })} style={inp}>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </Field>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {editing.cadence === 'weekly' ? (
                  <Field label="Due day">
                    <select value={editing.dueDay ?? 4} onChange={e => set({ dueDay: parseInt(e.target.value, 10) })} style={inp}>
                      {DOW.map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </Field>
                ) : (
                  <Field label="Due day of month">
                    <input type="number" min="1" max="28" value={editing.dueDom ?? 15} onChange={e => set({ dueDom: parseInt(e.target.value, 10) || 15 })} style={inp} />
                  </Field>
                )}
                <Field label="Send offset (days after due)">
                  <input type="number" min="0" max="14" value={editing.offsetDays} onChange={e => set({ offsetDays: Math.max(0, parseInt(e.target.value, 10) || 0) })} style={inp} />
                </Field>
              </div>

              <Field label="When to send">
                <select value={editing.trigger} onChange={e => set({ trigger: e.target.value })} style={inp}>
                  <option value="reminder">Always (a plain reminder on the due day)</option>
                  <option value="incomplete">Only if the tasks are NOT all marked Yes</option>
                </select>
              </Field>
              <div style={{ fontSize: 11.5, color: '#8a857c', margin: '-6px 0 12px' }}>
                {editing.trigger === 'incomplete'
                  ? 'This email is sent only when the relevant task grid is not fully complete for that period. Use "send offset" for follow-ups (e.g. 1 = the day after, 2 = two days after).'
                  : 'This email is sent on the due day regardless of whether the tasks are done.'}
              </div>

              {/* Recipients */}
              <div style={{ fontWeight: 600, fontSize: 13, margin: '6px 0 6px' }}>Recipients — portal users</div>
              <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid #eee', borderRadius: 8, padding: 8, marginBottom: 10 }}>
                {users.map(u => (
                  <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 2px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editing.recipientUserIds.includes(u.id)} onChange={() => toggleUser(u.id)} />
                    {u.name} <span style={{ color: '#aaa', fontSize: 11.5 }}>{u.email}</span>
                  </label>
                ))}
                {users.length === 0 && <div style={{ color: '#aaa', fontSize: 12.5 }}>No portal users with emails.</div>}
              </div>

              <div style={{ fontWeight: 600, fontSize: 13, margin: '2px 0 6px' }}>Recipients — other email addresses</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input value={emailInput} onChange={e => setEmailInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmail() } }} placeholder="name@example.com" style={{ ...inp, flex: 1 }} />
                <button onClick={addEmail} style={ghost}>Add</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {editing.recipientEmails.map(e => (
                  <span key={e} style={{ background: '#f1f5f9', borderRadius: 20, padding: '3px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{e}
                    <button onClick={() => removeEmail(e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 13 }}>&times;</button></span>
                ))}
              </div>

              {/* Content */}
              <Field label="Email subject"><input value={editing.subject} onChange={e => set({ subject: e.target.value })} style={inp} placeholder="e.g. Weekly Commercial Tasks reminder" /></Field>
              {/* REPLY-TO. Without one, a reply goes to the sending subdomain, which is
                  not a mailbox - so somebody answers "yes, done that" and it disappears
                  with no bounce and no sign anything went wrong. */}
              <Field label="Replies go to">
                <input type="email" value={editing.replyTo || ''} onChange={e => set({ replyTo: e.target.value })}
                  style={inp} placeholder="e.g. dori@rockroofing.co.uk — leave blank and replies go nowhere" />
              </Field>
              <Field label="Email body"><textarea value={editing.body} onChange={e => set({ body: e.target.value })} rows={5} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} placeholder="The message that will be emailed…" /></Field>

              {msg && <div style={{ fontSize: 12.5, color: msg.includes('fail') || msg.includes('Give') ? '#dc2626' : '#0f766e', margin: '4px 0 10px' }}>{msg}</div>}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                <button onClick={save} style={primary}>Save</button>
                <button onClick={() => setEditing(null)} style={ghost}>Cancel</button>
                {editing.id && <button onClick={() => del(editing.id)} style={{ ...ghost, color: '#dc2626', borderColor: '#f3c0c0' }}>Delete</button>}
                <div style={{ flex: 1 }} />
                <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="test to (optional)" style={{ ...inp, width: 180 }} />
                <button onClick={sendTest} style={ghost}>Send test</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function Field({ label, children }) { return <div style={{ marginBottom: 12 }}><div style={{ fontSize: 12, color: '#666', fontWeight: 600, marginBottom: 4 }}>{label}</div>{children}</div> }
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }
const inp = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13.5 }
const primary = { background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const ghost = { background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }
const linkBtn = { background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 13, fontWeight: 600 }
const pill = { border: 'none', borderRadius: 20, padding: '3px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }
