import { get, set } from '../../../../lib/db'
import { requireRole } from '../../../../lib/portalAuth'
import { getMentionableUsersForRoles, notifyMentions } from '../../../../lib/crmMentions'

// COMMENTS ON COST LINES.
//
// A cost lands on a project because somebody coded it that way in Xero, and the person
// who can tell it is on the wrong job is usually not the person who coded it. This is
// the place to say so, against the specific invoice, and to tag whoever needs to act.
//
// Stored per project under one key, as a map of line key -> comments. One key rather
// than one per line because a project's Costs tab reads them all at once, and Redis
// round trips are the expensive part.
const keyFor = (projectId) => `ops:cost-comments:${projectId}`

// Who can be tagged: the commercial and management side. A cost mis-coding is theirs
// to fix, and pre-contract has no access to the Costs tab in the first place.
const MENTION_ROLES = ['post-contract', 'management', 'admin']

const clean = (s, max) => String(s == null ? '' : s).slice(0, max)

export default async function handler(req, res) {
  // Costs are commercial. Same access as the rest of the Costs tab.
  const session = requireRole(req, res, ['post-contract', 'management', 'admin'])
  if (!session) return

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'Missing project id' })

  let store = {}
  try { store = (await get(keyFor(id))) || {} } catch { store = {} }
  if (!store || typeof store !== 'object' || Array.isArray(store)) store = {}

  if (req.method === 'GET') {
    let users = []
    try { users = await getMentionableUsersForRoles(MENTION_ROLES) } catch { users = [] }
    // Names only to the client. The addresses stay server-side - the browser never
    // needs them and a tagging dropdown is not a reason to publish a staff email list.
    return res.json({
      comments: store,
      users: users.map((u) => ({ name: u.name, first: u.first, username: u.username })),
      me: session.name || session.email || '',
    })
  }

  if (req.method === 'POST') {
    const lineKey = clean(req.body?.lineKey, 400)
    const body = clean(req.body?.body, 4000).trim()
    if (!lineKey) return res.status(400).json({ error: 'Missing lineKey' })
    if (!body) return res.status(400).json({ error: 'Comment is empty' })

    // The author is the SESSION, never the client. A comment saying who flagged a
    // mis-coded cost is only worth anything if it cannot be typed by someone else.
    const author = session.name || session.email || 'Unknown'
    const comment = {
      id: `cc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      body,
      author,
      authorId: session.id || null,
      at: Date.now(),
      // Kept so a comment still reads sensibly if the invoice later drops out of the
      // date filter, or the line is recoded and the row disappears entirely.
      label: clean(req.body?.label, 200),
      amount: Number(req.body?.amount) || 0,
    }
    const list = Array.isArray(store[lineKey]) ? store[lineKey] : []
    list.push(comment)
    store[lineKey] = list
    await set(keyFor(id), store)

    let notified = { sent: 0, names: [] }
    try {
      const users = await getMentionableUsersForRoles(MENTION_ROLES)
      const baseUrl = process.env.PORTAL_BASE_URL || 'https://app.rockroofing.co.uk'
      notified = await notifyMentions({
        body,
        author,
        users,
        what: 'a comment on a cost',
        context: comment.label ? `${comment.label} - project ${id}` : `project ${id}`,
        link: `${baseUrl}/project/${encodeURIComponent(id)}?tab=costs`,
        cta: 'Open the costs',
      })
    } catch (e) {
      // A failed notification must not lose the comment - it is already saved. Report
      // it instead of swallowing it, so "I tagged them and nothing happened" is
      // answerable.
      notified = { ok: false, sent: 0, error: e.message || 'notify failed', names: [] }
    }

    return res.json({ ok: true, comments: store, comment, notified })
  }

  if (req.method === 'DELETE') {
    const lineKey = clean(req.body?.lineKey, 400)
    const commentId = clean(req.body?.commentId, 100)
    const list = Array.isArray(store[lineKey]) ? store[lineKey] : []
    const target = list.find((c) => c && c.id === commentId)
    if (!target) return res.status(404).json({ error: 'Comment not found' })
    // Your own, or an admin clearing up.
    const isAuthor = (target.authorId && target.authorId === session.id)
      || (target.author && target.author === (session.name || session.email))
    if (!isAuthor && session.role !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own comments.' })
    }
    const next = list.filter((c) => c && c.id !== commentId)
    if (next.length) store[lineKey] = next
    else delete store[lineKey]
    await set(keyFor(id), store)
    return res.json({ ok: true, comments: store })
  }

  res.setHeader('Allow', 'GET, POST, DELETE')
  return res.status(405).json({ error: 'Method not allowed' })
}
