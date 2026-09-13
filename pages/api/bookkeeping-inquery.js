import { get, set, getPortalUsers } from '../../lib/db'
import { requireRole } from '../../lib/portalAuth'
import { INQUERY_KEY, createReviewToken } from '../../lib/inquery'
import withTenant from '../../lib/withTenant'

// IN QUERY - the bookkeeper's side.
//
//   GET                                   -> { state, users }
//   POST { action:'assign',  key, assignee }
//   POST { action:'comment', key, body }
//   POST { action:'status',  key, status }        query | approved
//   POST { action:'send',    items }              email each assignee their list
//
// The reviewer's side is /api/inquery-review, which is token-authenticated because
// a manually added person has no portal account.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const money = (n) => `\u00A3${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function handler(req, res) {
  const session = requireRole(req, res, ['post-contract', 'management', 'admin'])
  if (!session) return

  let state = {}
  try { state = (await get(INQUERY_KEY)) || {} } catch { state = {} }
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = {}

  if (req.method === 'GET') {
    let users = []
    try {
      users = (await getPortalUsers() || [])
        .filter(u => u && u.active !== false && u.email)
        .map(u => ({ id: u.id, name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' '), email: u.email }))
        .filter(u => u.name)
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch { users = [] }
    return res.json({ state, users })
  }

  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }) }

  const action = String(req.body?.action || '')
  const by = session.name || session.email || 'Unknown'

  if (action === 'assign') {
    const key = String(req.body?.key || '')
    if (!key) return res.status(400).json({ error: 'Missing key' })
    const a = req.body?.assignee || null
    if (a && !a.email) return res.status(400).json({ error: 'That person needs an email address - the list is sent to them.' })
    const rec = state[key] || { status: 'query', comments: [] }
    state[key] = { ...rec, assignee: a ? { name: String(a.name || '').trim(), email: String(a.email || '').trim().toLowerCase(), userId: a.userId || null } : null, updatedAt: Date.now() }
    await set(INQUERY_KEY, state)
    return res.json({ ok: true, state })
  }

  if (action === 'comment') {
    const key = String(req.body?.key || '')
    const body = String(req.body?.body || '').trim().slice(0, 2000)
    if (!key || !body) return res.status(400).json({ error: 'Nothing to add' })
    const rec = state[key] || { status: 'query', comments: [] }
    const comments = Array.isArray(rec.comments) ? rec.comments : []
    comments.push({ by, body, at: Date.now() })
    state[key] = { ...rec, comments, updatedAt: Date.now() }
    await set(INQUERY_KEY, state)
    return res.json({ ok: true, state })
  }

  if (action === 'status') {
    const key = String(req.body?.key || '')
    const status = req.body?.status === 'approved' ? 'approved' : 'query'
    if (!key) return res.status(400).json({ error: 'Missing key' })
    const rec = state[key] || { comments: [] }
    state[key] = {
      ...rec, status, updatedAt: Date.now(),
      approvedAt: status === 'approved' ? Date.now() : 0,
      approvedBy: status === 'approved' ? by : '',
    }
    await set(INQUERY_KEY, state)
    return res.json({ ok: true, state })
  }

  if (action === 'send') {
    // The table sends what is ON SCREEN, so the email matches the list the
    // bookkeeper is looking at rather than everything ever tagged In Query.
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (!items.length) return res.status(400).json({ error: 'Nothing to send' })

    // Group by the person, so somebody with nine queries gets one email with nine
    // lines rather than nine emails.
    const byPerson = new Map()
    for (const it of items) {
      const rec = state[it.key] || {}
      const a = rec.assignee
      if (!a || !a.email) continue
      if ((rec.status || 'query') === 'approved') continue   // nothing left to ask
      const k = a.email.toLowerCase()
      if (!byPerson.has(k)) byPerson.set(k, { name: a.name || a.email, email: k, rows: [] })
      byPerson.get(k).rows.push(it)
    }
    if (!byPerson.size) {
      return res.status(400).json({ error: 'None of those have somebody assigned with an email address.' })
    }

    // SNAPSHOT WHAT WAS SENT ONTO THE RECORD.
    //
    // The reviewer's page is token-authenticated and never reads Xero - it must not,
    // because the person holding the link is often outside the business. So the lines
    // and the amount are stored here, at the moment the list goes out, and the review
    // page shows exactly what the email showed.
    for (const person of byPerson.values()) {
      for (const it of person.rows) {
        const rec = state[it.key] || { status: 'query', comments: [] }
        state[it.key] = {
          ...rec,
          amount: Number(it.amount) || 0,
          lines: Array.isArray(it.lines) ? it.lines.slice(0, 40) : [],
          description: it.description || '',
          sentAt: Date.now(),
        }
      }
    }
    await set(INQUERY_KEY, state)

    const key = process.env.RESEND_API_KEY
    const from = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
    const baseUrl = process.env.PORTAL_BASE_URL || `https://${req.headers.host}`
    const results = []

    for (const person of byPerson.values()) {
      const token = createReviewToken({ email: person.email })
      const link = `${baseUrl}/inquery-review?token=${encodeURIComponent(token)}`
      const total = person.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
      const rowsHtml = person.rows.map(r => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px">${esc(r.date || '')}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px">${esc(r.supplier || '')}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px">${esc(r.reference || '')}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px">${esc(r.description || '')}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;text-align:right;white-space:nowrap">${money(r.amount)}</td>
        </tr>`).join('')

      const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:720px;color:#1a1a19">
        <p style="font-size:15px">Hello ${esc(person.name)},</p>
        <p style="font-size:14px">These costs are sitting <strong>in query</strong> - they are in Xero but not yet
        against a job. Please confirm each one, or say what is wrong with it.</p>
        <table style="width:100%;border-collapse:collapse;margin:14px 0">
          <thead><tr>
            <th style="text-align:left;font-size:11px;color:#888;padding:4px 8px">Date</th>
            <th style="text-align:left;font-size:11px;color:#888;padding:4px 8px">Supplier</th>
            <th style="text-align:left;font-size:11px;color:#888;padding:4px 8px">Reference</th>
            <th style="text-align:left;font-size:11px;color:#888;padding:4px 8px">Description</th>
            <th style="text-align:right;font-size:11px;color:#888;padding:4px 8px">Amount</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot><tr><td colspan="4" style="padding:6px 8px;font-size:13px;font-weight:700">Total</td>
            <td style="padding:6px 8px;font-size:13px;font-weight:700;text-align:right">${money(total)}</td></tr></tfoot>
        </table>
        <p><a href="${link}" style="background:#1c704f;color:#fff;padding:10px 18px;border-radius:6px;
             text-decoration:none;font-size:14px;font-weight:600">Review these costs</a></p>
        <p style="font-size:12px;color:#888">The link is yours - it opens your queries only, and works without a
        portal login.</p>
      </div>`

      if (!key) { results.push({ name: person.name, to: person.email, ok: false, detail: 'RESEND_API_KEY is not set' }); continue }
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [person.email], subject: `${person.rows.length} cost${person.rows.length === 1 ? '' : 's'} in query - please review`, html }),
        })
        if (r.ok) results.push({ name: person.name, to: person.email, ok: true, count: person.rows.length })
        else {
          let detail = ''
          try { detail = (await r.text()).slice(0, 300) } catch { /* ignore */ }
          results.push({ name: person.name, to: person.email, ok: false, status: r.status, detail })
        }
      } catch (e) {
        results.push({ name: person.name, to: person.email, ok: false, detail: e.message || 'network error' })
      }
    }

    return res.json({ ok: true, sent: results.filter(r => r.ok).length, results, from })
  }

  return res.status(400).json({ error: 'Unknown action' })
}

export default withTenant(handler)
