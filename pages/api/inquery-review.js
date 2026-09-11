import { get, set } from '../../lib/db'
import { INQUERY_KEY, verifyReviewToken } from '../../lib/inquery'

// THE REVIEWER'S SIDE.
//
// DELIBERATELY NOT BEHIND requireRole. Somebody added to the table by hand has no
// portal account, so the token IS the authentication: it is signed, it names one
// email address, and it expires.
//
// It also SCOPES what comes back. A token only ever returns the invoices assigned to
// that address - not the whole In Query list - so a forwarded link cannot show
// somebody else's queries.
//
//   GET  ?token=..                              -> { me, items }
//   POST { token, key, status?, comment? }      -> update one invoice
export default async function handler(req, res) {
  const token = String(req.query.token || req.body?.token || '')
  const t = verifyReviewToken(token)
  if (!t) return res.status(401).json({ error: 'That link is not valid, or it has expired. Ask for a new one.' })

  let state = {}
  try { state = (await get(INQUERY_KEY)) || {} } catch { state = {} }
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = {}

  const mine = (key) => {
    const rec = state[key]
    return !!(rec && rec.assignee && String(rec.assignee.email || '').toLowerCase() === t.email)
  }

  if (req.method === 'GET') {
    const items = Object.entries(state)
      .filter(([k]) => mine(k))
      .map(([k, rec]) => {
        // date|supplier|reference, the key the bookkeeper's table builds.
        const [date, supplier, reference] = String(k).split('|')
        return {
          key: k, date, supplier, reference,
          status: rec.status === 'approved' ? 'approved' : 'query',
          comments: Array.isArray(rec.comments) ? rec.comments : [],
          // Snapshotted when the list was sent, so the reviewer sees the lines and
          // the amount even though this endpoint never reads Xero.
          lines: Array.isArray(rec.lines) ? rec.lines : [],
          amount: Number(rec.amount) || 0,
        }
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.supplier).localeCompare(String(b.supplier)))
    const name = (Object.values(state).find(r => r && r.assignee && String(r.assignee.email || '').toLowerCase() === t.email)?.assignee?.name) || t.email
    return res.json({ me: { name, email: t.email }, items })
  }

  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }) }

  const key = String(req.body?.key || '')
  if (!key || !mine(key)) return res.status(403).json({ error: 'That item is not assigned to you.' })

  const rec = state[key]
  const comments = Array.isArray(rec.comments) ? rec.comments : []
  const who = rec.assignee?.name || t.email
  let changed = false

  const comment = String(req.body?.comment || '').trim().slice(0, 2000)
  if (comment) { comments.push({ by: who, body: comment, at: Date.now() }); changed = true }

  if (req.body?.status === 'approved' || req.body?.status === 'query') {
    const status = req.body.status
    // A note of the decision itself, so the thread reads as a history rather than
    // a status that silently flipped at some point.
    if (status !== (rec.status || 'query')) {
      comments.push({ by: who, body: status === 'approved' ? 'Marked approved.' : 'Put back in query.', at: Date.now(), system: true })
    }
    state[key] = { ...rec, status, comments, updatedAt: Date.now(), approvedAt: status === 'approved' ? Date.now() : 0, approvedBy: status === 'approved' ? who : '' }
    changed = true
  } else if (changed) {
    state[key] = { ...rec, comments, updatedAt: Date.now() }
  }

  if (!changed) return res.status(400).json({ error: 'Nothing to save' })
  await set(INQUERY_KEY, state)
  return res.json({ ok: true, item: { key, status: state[key].status || 'query', comments: state[key].comments || [] } })
}
