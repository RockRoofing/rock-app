import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

// THE PAGE THE EMAIL LINK OPENS.
//
// No portal login. The token in the address is the authentication and it scopes what
// loads, so somebody added to the table by hand can answer their queries and cannot
// see anybody else's.
const INK = '#1a1a2e'
const GREEN = '#1c704f'
const money = (n) => `\u00A3${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const when = (ms) => { try { return new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

export default function InQueryReview() {
  const router = useRouter()
  const { token } = router.query
  const [me, setMe] = useState(null)
  const [items, setItems] = useState([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({})     // key -> comment being typed
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!token) return
    setLoading(true)
    fetch(`/api/inquery-review?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else { setMe(d.me); setItems(d.items || []) } })
      .catch(e => setErr(e.message || 'Could not load'))
      .finally(() => setLoading(false))
  }, [token])

  async function save(key, patch) {
    setBusy(key); setErr('')
    try {
      const d = await fetch('/api/inquery-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, key, ...patch }),
      }).then(r => r.json())
      if (d.error) { setErr(d.error); return }
      // Patch the one row rather than reloading - a reload would lose whatever is
      // half typed in the other boxes.
      setItems(list => list.map(it => it.key === key ? { ...it, status: d.item.status, comments: d.item.comments } : it))
      setDraft(s => ({ ...s, [key]: '' }))
    } catch (e) { setErr(e.message || 'Could not save') }
    finally { setBusy('') }
  }

  const outstanding = items.filter(i => i.status !== 'approved').length

  return (
    <div style={{ minHeight: '100vh', background: '#f7f7f5', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <Head><title>Costs in query</title></Head>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 18px 60px' }}>
        <h1 style={{ fontSize: 22, color: INK, margin: '0 0 4px' }}>Costs in query</h1>
        {me && <p style={{ fontSize: 13.5, color: '#777', margin: '0 0 18px' }}>
          {me.name} &middot; {outstanding === 0 ? 'nothing outstanding' : `${outstanding} still to answer`}
        </p>}

        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 14 }}>{err}</div>}
        {loading && <div style={{ fontSize: 14, color: '#888' }}>Loading...</div>}
        {!loading && !err && items.length === 0 && (
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, fontSize: 14, color: '#666' }}>
            Nothing is assigned to you at the moment.
          </div>
        )}

        {items.map(it => {
          const approved = it.status === 'approved'
          return (
            <div key={it.key} style={{ background: '#fff', border: `1px solid ${approved ? '#bbf7d0' : '#eee'}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{it.supplier || 'Unknown supplier'}</div>
                  <div style={{ fontSize: 12.5, color: '#888', marginTop: 2 }}>
                    {[it.date, it.reference].filter(Boolean).join('  \u00B7  ')}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>{money(it.amount)}</div>
                  <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '2px 9px', display: 'inline-block', marginTop: 4,
                    background: approved ? '#dcfce7' : '#fef3c7', color: approved ? '#15803d' : '#b45309' }}>
                    {approved ? 'Approved' : 'In query'}
                  </span>
                </div>
              </div>

              {it.lines.length > 0 && (
                <div style={{ marginTop: 10, borderTop: '1px solid #f2f2f2', paddingTop: 8 }}>
                  {it.lines.map((l, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, color: '#555', padding: '2px 0' }}>
                      <span>{l.description || l.accountCode || 'Line'}</span>
                      <span style={{ whiteSpace: 'nowrap' }}>{money(l.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {it.comments.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {it.comments.map((c, i) => (
                    <div key={i} style={{ borderLeft: '3px solid #e5e7eb', background: '#fafafa', borderRadius: 6, padding: '7px 10px', marginTop: 6 }}>
                      <div style={{ fontSize: 11.5, color: '#888' }}>{c.by} &middot; {when(c.at)}</div>
                      <div style={{ fontSize: 13, color: '#333', whiteSpace: 'pre-wrap', fontStyle: c.system ? 'italic' : 'normal' }}>{c.body}</div>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                value={draft[it.key] || ''}
                onChange={e => setDraft(s => ({ ...s, [it.key]: e.target.value }))}
                rows={2}
                placeholder={approved ? 'Add a note...' : 'What is this cost, or what is wrong with it?'}
                style={{ width: '100%', boxSizing: 'border-box', marginTop: 10, padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 6, resize: 'vertical', fontFamily: 'inherit' }} />

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
                <button onClick={() => save(it.key, { comment: draft[it.key] || '' })}
                  disabled={busy === it.key || !(draft[it.key] || '').trim()}
                  style={{ padding: '8px 14px', fontSize: 13, borderRadius: 7, border: '1px solid #ddd', background: '#fff', color: INK, cursor: (draft[it.key] || '').trim() ? 'pointer' : 'default', opacity: (draft[it.key] || '').trim() ? 1 : 0.5 }}>
                  Add comment
                </button>
                {approved ? (
                  <button onClick={() => save(it.key, { status: 'query', comment: draft[it.key] || '' })} disabled={busy === it.key}
                    style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 7, border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', cursor: 'pointer' }}>
                    Put back in query
                  </button>
                ) : (
                  <button onClick={() => save(it.key, { status: 'approved', comment: draft[it.key] || '' })} disabled={busy === it.key}
                    style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, borderRadius: 7, border: 'none', background: GREEN, color: '#fff', cursor: 'pointer' }}>
                    {busy === it.key ? 'Saving...' : 'Approve'}
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {!loading && items.length > 0 && (
          <p style={{ fontSize: 12, color: '#999', marginTop: 18 }}>
            Approving tells the bookkeeper the cost is right. They then move it onto the job it belongs to,
            at which point it leaves this list.
          </p>
        )}
      </div>
    </div>
  )
}
