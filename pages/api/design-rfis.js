import { get, set } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { getExternalUsers, externalCanAccessProject } from '../../lib/designUsers'
import { getPortalUsers } from '../../lib/db'
import { canAccessArea } from '../../lib/roles'
import { sendRfiCommentNotice, sendRfiIssuedNotice, APP_URL } from '../../lib/designEmail'
import { recordPending, getReadMap, markRfiRead, unreadFromMap, projectRecipients, projectDisplayName, outstandingDigestHtml, sendMail } from '../../lib/designRfiNotify'

// RFIs (Requests for Information) per project.
// Store: design:rfis:<projectNo> = [ { rfi } ]  (newest first by number)
//   rfi = { id, number, description, requiredDate, responsibleUserId, status,
//           attachments:[{name,url,contentType,size}], comments:[{id,authorId,authorName,
//           external, html, at}], createdAt, issuedAt }
//
// GET  ?no=<projectNo>                 -> { rfis, canEdit, people, meId }
// GET  ?no=<projectNo>&people=1        -> { people }
// POST { projectNo, action, ... }
//   action 'create' { rfi }            (internal)
//   action 'update' { rfi }            (internal)
//   action 'delete' { id }             (internal)
//   action 'comment' { id, html }      (internal OR external on their project)
//   action 'status'  { id, status }    (internal)

const rkey = (no) => `design:rfis:${no}`
const nkey = (no) => `design:rfis-next:${no}`   // auto-increment counter

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

// Mentionable people on a project: internal Design users + external users scoped here.
async function peopleFor(projectNo) {
  const [portal, ext] = await Promise.all([getPortalUsers(), getExternalUsers()])
  const out = []
  for (const p of (portal || [])) {
    if (p.active === false) continue
    if (!canAccessArea(p.role, 'design')) continue
    out.push({ id: p.id, name: p.name || [p.firstName, p.lastName].filter(Boolean).join(' '), external: false, company: 'Rock Roofing' })
  }
  for (const e of (ext || [])) {
    if (e.active === false) continue
    if (!externalCanAccessProject(e, projectNo)) continue
    out.push({ id: e.id, name: e.name, external: true, company: e.company || 'Customer' })
  }
  return out
}

// Same as peopleFor but keeps emails - server-side only, never returned to the client.
async function peopleWithEmail(projectNo) {
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

async function projectName(projectNo) {
  try {
    const d = await fetch(`${APP_URL}/api/planning`).then(r => r.json())
    const p = (d.projects || []).find(x => String(x.projectNo || x.jobNo || '') === String(projectNo))
    return p ? (p.name || '') : ''
  } catch { return '' }
}

// Which people are @mentioned in a comment's HTML? Mentions render as the person's name
// inside a styled span (see the RFI comment box), so match on name.
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

const rfiLinkFor = (projectNo, rfiId) => `${APP_URL}/design/${encodeURIComponent(projectNo)}/rfis?open=${encodeURIComponent(rfiId)}`

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const no = String(req.query.no || '').trim()
    if (!no) return res.status(400).json({ error: 'Missing project' })
    const acc = await resolveAccess(req, no)
    if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })
    const people = await peopleFor(no)
    if (req.query.people) return res.json({ people })
    const rfis = (await get(rkey(no))) || []
    const readMap = await getReadMap(no, acc.user.id)
    const unread = unreadFromMap(rfis, readMap)
    return res.json({ rfis, canEdit: acc.canEdit, people, meId: acc.user.id, meName: acc.user.name, external: acc.external, unread })
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    const no = String(body.projectNo || '').trim()
    if (!no) return res.status(400).json({ error: 'Missing project' })
    const acc = await resolveAccess(req, no)
    if (!acc.ok) return res.status(acc.code).json({ error: 'No access' })

    let rfis = (await get(rkey(no))) || []

    // Mark a single RFI as read for the current user (called when they open it).
    if (body.action === 'mark-read') {
      const rfi = rfis.find(r => r.id === body.id)
      if (rfi) await markRfiRead(no, acc.user.id, rfi)
      return res.json({ ok: true })
    }

    // Comment - allowed for internal AND external (on their project).
    if (body.action === 'comment') {
      if (!acc.canComment) return res.status(403).json({ error: 'Not allowed' })
      const idx = rfis.findIndex(r => r.id === body.id)
      if (idx < 0) return res.status(404).json({ error: 'RFI not found' })
      const html = String(body.html || '').trim()
      if (!html) return res.status(400).json({ error: 'Empty comment' })
      const comment = { id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, authorId: acc.user.id, authorName: acc.user.name || 'User', external: acc.external, html, at: Date.now() }
      rfis[idx].comments = [...(rfis[idx].comments || []), comment]
      await set(rkey(no), rfis)
      // The comment's author has obviously seen this RFI.
      try { await markRfiRead(no, acc.user.id, rfis[idx]) } catch {}
      // Comments are batched into ONE end-of-day email per project (design-rfi-daily cron).
      try { await recordPending(no, 'comment') } catch {}
      // @mentions are the exception: anyone @mentioned gets an IMMEDIATE email every time.
      let notify = { mentioned: 0, sent: 0 }
      try {
        const people = await peopleWithEmail(no)
        const ids = mentionedIds(html, people).filter(id => id !== acc.user.id)
        if (ids.length) {
          const pname = await projectName(no)
          const link = rfiLinkFor(no, rfis[idx].id)
          for (const id of ids) {
            const p = people.find(x => x.id === id)
            if (!p || !p.email) continue
            notify.mentioned++
            const r = await sendRfiCommentNotice({ to: p.email, recipientName: p.name, projectNo: no, projectName: pname, rfiNumber: rfis[idx].number, authorName: comment.authorName, commentHtml: html, rfiLink: link, mentioned: true })
            if (r.sent) notify.sent++
          }
        }
      } catch (e) { /* mention notification failure must not fail the comment */ }
      return res.json({ ok: true, rfi: rfis[idx], notify })
    }

    // Save markup/annotations for one attachment. Allowed for internal AND external
    // (customers can mark up their own project's RFI attachments).
    if (body.action === 'attachment-markup') {
      if (!acc.canComment) return res.status(403).json({ error: 'Not allowed' })
      const idx = rfis.findIndex(x => x.id === body.id)
      if (idx < 0) return res.status(404).json({ error: 'RFI not found' })
      const atts = rfis[idx].attachments || []
      const ai = atts.findIndex(a => a.url === body.attachmentUrl)
      if (ai < 0) return res.status(404).json({ error: 'Attachment not found' })
      atts[ai] = { ...atts[ai], markup: body.markup }
      rfis[idx].attachments = atts
      await set(rkey(no), rfis)
      return res.json({ ok: true, rfi: rfis[idx] })
    }

    // Add attachments to an RFI - allowed for EVERYONE with access (incl. customers).
    if (body.action === 'add-attachments') {
      if (!acc.canComment) return res.status(403).json({ error: 'Not allowed' })
      const idx = rfis.findIndex(x => x.id === body.id)
      if (idx < 0) return res.status(404).json({ error: 'RFI not found' })
      const incoming = Array.isArray(body.attachments) ? body.attachments : []
      const clean = incoming.filter(a => a && a.url).map(a => ({ name: a.name || 'attachment', url: a.url, contentType: a.contentType || '', size: a.size || 0, addedBy: acc.user.name || 'User', addedByExternal: !!acc.external, addedAt: Date.now() }))
      if (!clean.length) return res.status(400).json({ error: 'No attachments' })
      rfis[idx].attachments = [...(rfis[idx].attachments || []), ...clean]
      await set(rkey(no), rfis)
      return res.json({ ok: true, rfi: rfis[idx] })
    }

    // Everything else is internal-only.
    if (!acc.canEdit) return res.status(403).json({ error: 'View/comment only' })

    // Manually push the outstanding-RFI list to everyone assigned to the project.
    if (body.action === 'send-reminders') {
      const outstanding = rfis.filter(r => r.status !== 'resolved')
      if (!outstanding.length) return res.json({ ok: true, sent: 0, message: 'No outstanding RFIs to remind about.' })
      const recipients = (await projectRecipients(no)).filter(r => r.email)
      if (!recipients.length) return res.json({ ok: true, sent: 0, message: 'No recipients with an email on this project.' })
      const pname = await projectName(no)
      const withNames = await peopleWithEmail(no)
      const nameById = {}
      for (const p of withNames) nameById[p.id] = p.name
      const pn = (id) => nameById[id] || ''
      let sent = 0
      for (const r of recipients) {
        const html = outstandingDigestHtml({ name: r.name, projectName: pname, projectNo: no, rfis: outstanding, personName: pn })
        const out = await sendMail(r.email, `Outstanding RFIs for ${pname || no}`, html)
        if (out.sent) sent++
      }
      return res.json({ ok: true, sent, recipients: recipients.length, outstanding: outstanding.length })
    }

    if (body.action === 'create') {
      const r = body.rfi || {}
      const next = ((await get(nkey(no))) || 0) + 1
      await set(nkey(no), next)
      const rfi = {
        id: `rfi_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        number: `RFI-${String(next).padStart(3, '0')}`,
        description: r.description || '',
        requiredDate: r.requiredDate || '',
        responsibleUserId: r.responsibleUserId || '',
        status: 'open',
        attachments: Array.isArray(r.attachments) ? r.attachments : [],
        comments: [],
        createdAt: Date.now(),
        issuedAt: Date.now(),   // auto issue date on send
      }
      rfis = [rfi, ...rfis]
      await set(rkey(no), rfis)
      // The person who raised it has obviously seen it.
      try { await markRfiRead(no, acc.user.id, rfi) } catch {}
      // Email EVERYONE with access to the project immediately (one email per new RFI),
      // making clear which Rock Roofing person raised it.
      try {
        const people = await peopleWithEmail(no)
        const pname = await projectName(no)
        const link = rfiLinkFor(no, rfi.id)
        for (const person of people) {
          if (!person.email || person.id === acc.user.id) continue
          await sendRfiIssuedNotice({ to: person.email, recipientName: person.name, raisedByName: acc.user.name, projectNo: no, projectName: pname, rfiNumber: rfi.number, description: rfi.description, requiredDate: rfi.requiredDate, rfiLink: link })
        }
      } catch (e) { /* notification failure must not fail the create */ }
      return res.json({ ok: true, rfis })
    }

    if (body.action === 'update') {
      const r = body.rfi || {}
      const idx = rfis.findIndex(x => x.id === r.id)
      if (idx < 0) return res.status(404).json({ error: 'RFI not found' })
      const { id, number, comments, createdAt, issuedAt, ...editable } = r
      rfis[idx] = { ...rfis[idx], ...editable }
      await set(rkey(no), rfis)
      return res.json({ ok: true, rfis })
    }

    if (body.action === 'status') {
      const idx = rfis.findIndex(x => x.id === body.id)
      if (idx < 0) return res.status(404).json({ error: 'RFI not found' })
      rfis[idx].status = body.status === 'resolved' ? 'resolved' : 'open'
      await set(rkey(no), rfis)
      return res.json({ ok: true, rfis })
    }

    if (body.action === 'delete') {
      rfis = rfis.filter(x => x.id !== body.id)
      await set(rkey(no), rfis)
      return res.json({ ok: true, rfis })
    }

    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(405).end()
}
