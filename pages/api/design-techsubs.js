import { get, set } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { getExternalUsers, externalCanAccessProject } from '../../lib/designUsers'
import { getPortalUsers } from '../../lib/db'
import { canAccessArea } from '../../lib/roles'
import { sendRfiCommentNotice, APP_URL } from '../../lib/designEmail'
import { tsKey, tsRecordPendingComment, tsGetReadMap, tsMarkRead, tsUnread, projectDisplayName } from '../../lib/designRfiNotify'

// Tech Sub documents for a project. Each doc is a REVISION belonging to a "family" (one
// tech sub). Revisions within a family are lettered REV A, REV B, ... Only the newest in a
// family is current; older ones are marked superseded but keep their revision letter.
// Store: design:techsubs:<no> = [ { id, familyId, revision, name, url, contentType, size,
//                                   uploadedBy, uploadedAt, superseded, markup, comments:[] } ]

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}
function sessionUser(req) { return verifySessionToken(readCookie(req, SESSION_COOKIE)) }

async function resolveAccess(req, projectNo) {
  const u = sessionUser(req)
  if (!u) return { ok: false, code: 401 }
  if (u.role === 'external') {
    const ext = (await getExternalUsers()).find(x => x.id === u.id && x.active !== false)
    if (!ext || !externalCanAccessProject(ext, projectNo)) return { ok: false, code: 403 }
    return { ok: true, user: { ...u, name: ext.name }, canEdit: false, canComment: true, external: true }
  }
  if (!canAccessArea(u.role, 'design')) return { ok: false, code: 403 }
  return { ok: true, user: u, canEdit: true, canComment: true, external: false }
}

async function peopleFor(projectNo) {
  const [portal, ext] = await Promise.all([getPortalUsers(), getExternalUsers()])
  const out = []
  for (const p of (portal || [])) {
    if (p.active === false) continue
    if (!canAccessArea(p.role, 'design')) continue
    out.push({ id: p.id, name: p.name || [p.firstName, p.lastName].filter(Boolean).join(' '), email: p.email || '', external: false })
  }
  for (const e of (ext || [])) {
    if (e.active === false) continue
    if (!externalCanAccessProject(e, projectNo)) continue
    out.push({ id: e.id, name: e.name, email: e.email || '', external: true })
  }
  return out
}

function mentionedIds(html, people) {
  const text = String(html || '')
  const ids = []
  for (const p of people) {
    if (!p.name) continue
    const re = new RegExp('@' + p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'i')
    if (re.test(text)) ids.push(p.id)
  }
  return [...new Set(ids)]
}

const revLetter = (n) => {
  // 0 -> A, 1 -> B, ... 25 -> Z, 26 -> AA ...
  let s = ''; n = n + 1
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}
const tsLink = (no, id) => `${APP_URL}/design/${encodeURIComponent(no)}/tech-sub?open=${encodeURIComponent(id)}`
const rid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

// Email the assigned customer approver that a Tech Sub needs their review/approval.
async function notifyApprover(no, doc) {
  try {
    if (!doc.approverId) return
    const people = await peopleFor(no)
    const approver = people.find(p => p.id === doc.approverId)
    if (!approver || !approver.email) return
    const pname = await projectDisplayName(no)
    await sendRfiCommentNotice({
      to: approver.email, recipientName: approver.name, projectNo: no, projectName: pname,
      rfiNumber: `${doc.title} (Rev ${doc.revision})`, authorName: doc.uploadedBy,
      commentHtml: `A Tech Sub has been uploaded and needs your review. Please <strong>review, comment or approve</strong> it.`,
      rfiLink: tsLink(no, doc.id), mentioned: false, cta: 'Review the Tech Sub',
    })
  } catch (e) { /* ignore */ }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const no = String(req.query.no || '').trim()
    if (!no) return res.status(400).json({ error: 'Missing project' })
    const acc = await resolveAccess(req, no)
    if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })
    const people = await peopleFor(no)
    if (req.query.people) return res.json({ people })
    const docs = (await get(tsKey(no))) || []
    const readMap = await tsGetReadMap(no, acc.user.id)
    const unread = tsUnread(docs, readMap)
    return res.json({ docs, canEdit: acc.canEdit, people, meId: acc.user.id, external: acc.external, unread })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = req.body || {}
  const no = String(body.projectNo || '').trim()
  if (!no) return res.status(400).json({ error: 'Missing project' })
  const acc = await resolveAccess(req, no)
  if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })

  let docs = (await get(tsKey(no))) || []
  const idx = (id) => docs.findIndex(d => d.id === id)

  // Mark a doc read for the current user.
  if (body.action === 'mark-read') {
    const d = docs.find(x => x.id === body.id)
    if (d) await tsMarkRead(no, acc.user.id, d)
    return res.json({ ok: true })
  }

  // Comment - allowed for internal AND external. Batched into end-of-day email; @mentions
  // notified immediately.
  if (body.action === 'comment') {
    if (!acc.canComment) return res.status(403).json({ error: 'Not allowed' })
    const i = idx(body.id)
    if (i < 0) return res.status(404).json({ error: 'Tech Sub not found' })
    const html = String(body.html || '').trim()
    if (!html) return res.status(400).json({ error: 'Empty comment' })
    const comment = { id: rid('c'), authorId: acc.user.id, authorName: acc.user.name || 'User', external: acc.external, html, at: Date.now() }
    docs[i].comments = [...(docs[i].comments || []), comment]
    await set(tsKey(no), docs)
    try { await tsMarkRead(no, acc.user.id, docs[i]) } catch {}
    try { await tsRecordPendingComment(no) } catch {}
    let notify = { mentioned: 0, sent: 0 }
    try {
      const people = await peopleFor(no)
      const ids = mentionedIds(html, people).filter(id => id !== acc.user.id)
      if (ids.length) {
        const pname = await projectDisplayName(no)
        const link = tsLink(no, docs[i].id)
        for (const id of ids) {
          const p = people.find(x => x.id === id)
          if (!p || !p.email) continue
          notify.mentioned++
          const r = await sendRfiCommentNotice({ to: p.email, recipientName: p.name, projectNo: no, projectName: pname, rfiNumber: `${docs[i].title || 'Tech Sub'} (Rev ${docs[i].revision})`, authorName: comment.authorName, commentHtml: html, rfiLink: link, mentioned: true, cta: 'Review the Tech Sub' })
          if (r.sent) notify.sent++
        }
      }
    } catch (e) { /* ignore */ }
    return res.json({ ok: true, doc: docs[i], notify })
  }

  // Markup save - allowed for internal AND external.
  if (body.action === 'markup') {
    if (!acc.canComment) return res.status(403).json({ error: 'Not allowed' })
    const i = idx(body.id)
    if (i < 0) return res.status(404).json({ error: 'Tech Sub not found' })
    docs[i].markup = body.markup
    await set(tsKey(no), docs)
    return res.json({ ok: true, doc: docs[i] })
  }

  // Approve a tech sub. ONLY the assigned customer approver may approve - never Rock
  // Roofing staff, and not once the revision has been superseded.
  if (body.action === 'approve') {
    const i = idx(body.id)
    if (i < 0) return res.status(404).json({ error: 'Tech Sub not found' })
    if (!acc.external) return res.status(403).json({ error: 'Only the customer can approve a Tech Sub.' })
    if (docs[i].approverId && docs[i].approverId !== acc.user.id) return res.status(403).json({ error: 'Only the assigned approver can approve this Tech Sub.' })
    if (docs[i].superseded) return res.status(400).json({ error: 'This revision has been superseded and can no longer be approved.' })
    if (docs[i].approvalStatus === 'approved') return res.json({ ok: true, doc: docs[i] })

    // Full digital record of the approval.
    const ext = (await getExternalUsers()).find(x => x.id === acc.user.id) || {}
    const now = Date.now()
    docs[i].approvalStatus = 'approved'
    docs[i].approvedAt = now
    docs[i].approvedBy = ext.name || acc.user.name || 'Customer'
    docs[i].approvalRecord = {
      name: ext.name || acc.user.name || '',
      email: ext.email || '',
      phone: ext.phone || '',
      company: ext.company || '',
      role: ext.role || 'Customer',
      userId: acc.user.id,
      at: now,
      atText: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'long' }).format(new Date(now)),
    }
    await set(tsKey(no), docs)
    // Let the internal team know it was approved.
    try {
      const people = await peopleFor(no)
      const pname = await projectDisplayName(no)
      const link = tsLink(no, docs[i].id)
      for (const p of people) {
        if (p.external || !p.email) continue
        await sendRfiCommentNotice({ to: p.email, recipientName: p.name, projectNo: no, projectName: pname, rfiNumber: `${docs[i].title} (Rev ${docs[i].revision})`, authorName: docs[i].approvedBy, commentHtml: `<strong>Approved.</strong> This Tech Sub has been approved by ${docs[i].approvedBy}${ext.company ? ` (${ext.company})` : ''}.`, rfiLink: link, mentioned: false, cta: 'Review the Tech Sub' })
      }
    } catch (e) { /* ignore */ }
    return res.json({ ok: true, doc: docs[i] })
  }

  // Everything below is internal-only.
  if (!acc.canEdit) return res.status(403).json({ error: 'View/comment only' })

  // Add a brand-new tech sub (its own family, starting at Rev A). Requires an approver
  // (a customer user who must review/approve it).
  if (body.action === 'add') {
    const f = body.file || {}
    if (!f.url) return res.status(400).json({ error: 'No file' })
    const doc = {
      id: rid('ts'), familyId: rid('fam'), revision: 'A',
      title: (body.title || f.name || 'Tech Sub').trim(),
      name: f.name || 'Tech Sub', url: f.url, contentType: f.contentType || '', size: f.size || 0,
      uploadedBy: acc.user.name || 'User', uploadedAt: Date.now(),
      superseded: false, markup: null, comments: [],
      approverId: body.approverId || '', approvalStatus: 'pending', approvedAt: 0, approvedBy: '',
    }
    docs = [doc, ...docs]
    await set(tsKey(no), docs)
    await notifyApprover(no, doc)
    return res.json({ ok: true, docs })
  }

  // Add a NEW REVISION of an existing tech sub family. The current newest in that family
  // becomes superseded (keeping its letter); the new one gets the next letter.
  if (body.action === 'add-revision') {
    const f = body.file || {}
    if (!f.url) return res.status(400).json({ error: 'No file' })
    const base = docs.find(d => d.id === body.id)
    if (!base) return res.status(404).json({ error: 'Tech Sub not found' })
    const fam = base.familyId
    const famDocs = docs.filter(d => d.familyId === fam)
    // Next revision letter = count of existing revisions in the family.
    const nextRev = revLetter(famDocs.length)
    // Mark all existing revisions in the family as superseded (they keep their letters).
    docs = docs.map(d => d.familyId === fam ? { ...d, superseded: true } : d)
    const doc = {
      id: rid('ts'), familyId: fam, revision: nextRev,
      title: base.title,
      name: f.name || base.title, url: f.url, contentType: f.contentType || '', size: f.size || 0,
      uploadedBy: acc.user.name || 'User', uploadedAt: Date.now(),
      superseded: false, markup: null, comments: [],
      approverId: body.approverId || base.approverId || '', approvalStatus: 'pending', approvedAt: 0, approvedBy: '',
    }
    docs = [doc, ...docs]
    await set(tsKey(no), docs)
    await notifyApprover(no, doc)
    return res.json({ ok: true, docs })
  }

  if (body.action === 'delete') {
    docs = docs.filter(d => d.id !== body.id)
    await set(tsKey(no), docs)
    return res.json({ ok: true, docs })
  }

  return res.status(400).json({ error: 'Unknown action' })
}
