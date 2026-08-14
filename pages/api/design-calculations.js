import { get, set } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { getExternalUsers, externalCanAccessProject } from '../../lib/designUsers'
import { getPortalUsers } from '../../lib/db'
import { canAccessArea } from '../../lib/roles'
import { sendRfiCommentNotice, APP_URL } from '../../lib/designEmail'
import { calcRecordPendingComment, calcRecordPendingDoc, calcGetReadMap, calcMarkRead, calcUnread, projectDisplayName } from '../../lib/designRfiNotify'
import { hashFileAtUrl, recordApprovalEvent, generateAndStoreCertificate } from '../../lib/approvalAudit'
import { buildStampedCopy } from '../../lib/stampPdf'

// Calculations for a project. Each drawing is a REVISION in a "family". Revisions are
// lettered Rev A, B, C ...; only the newest is current, older ones are superseded (kept,
// greyed behind the current one). Status flow: In Review -> Approved (customer approves).
// Rock Roofing can additionally mark a calculation "Construction Issue".
// Store: design:calculations:<no> = [ { id, familyId, revision, title, name, url,
//   contentType, size, thumbUrl, uploadedBy, uploadedAt, superseded, markup, comments:[],
//   status:'in-review'|'approved', constructionIssue:bool, approverId, approvedAt,
//   approvedBy, approvalRecord } ]

const RKEY = (no) => `design:calculations:${no}`

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
    out.push({ id: p.id, name: p.name || [p.firstName, p.lastName].filter(Boolean).join(' '), email: p.email || '', external: false, company: 'Rock Roofing' })
  }
  for (const e of (ext || [])) {
    if (e.active === false) continue
    if (!externalCanAccessProject(e, projectNo)) continue
    out.push({ id: e.id, name: e.name, email: e.email || '', external: true, company: e.company || 'Customer' })
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

const revLetter = (n) => { let s = ''; n = n + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }
const isImg = (f) => (f.contentType || '').startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(f.name || '')
const calcLink = (no, id) => `${APP_URL}/design/${encodeURIComponent(no)}/calculations?open=${encodeURIComponent(id)}`
const rid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
const esc0 = (s) => String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Write the immutable audit entry + generate the approval certificate for one drawing.
// Returns { certificateUrl, fileHash, eventId }.
async function recordAndCertify(no, projectName, doc, approver) {
  const fileHash = await hashFileAtUrl(doc.url)
  const evt = await recordApprovalEvent(no, {
    kind: 'calculation', event: 'approved', projectNo: no, projectName,
    itemTitle: doc.title, revision: doc.revision, docId: doc.id, familyId: doc.familyId,
    fileName: doc.name, fileUrl: doc.url, fileHash,
    approver: { name: approver.name || '', email: approver.email || '', phone: approver.phone || '', company: approver.company || '', role: approver.role || 'Customer', userId: approver.userId },
    atText: doc.approvalRecord?.atText || '',
  })
  const certificateUrl = await generateAndStoreCertificate({
    kind: 'calculation', projectNo: no, projectName, item: doc.title, revision: doc.revision,
    fileName: doc.name, fileHash, approver: { name: approver.name, company: approver.company, role: approver.role || 'Customer', email: approver.email, phone: approver.phone, userId: approver.userId },
    atText: doc.approvalRecord?.atText || '', ts: evt.ts, eventId: evt.id,
  })
  return { certificateUrl, fileHash, eventId: evt.id }
}

async function notifyApprover(no, doc) {
  try {
    if (!doc.approverId) return
    const people = await peopleFor(no)
    const approver = people.find(p => p.id === doc.approverId)
    if (!approver || !approver.email) return
    const pname = await projectDisplayName(no)
    await sendRfiCommentNotice({ to: approver.email, recipientName: approver.name, projectNo: no, projectName: pname, rfiNumber: `${doc.title} (Rev ${doc.revision})`, authorName: doc.uploadedBy, commentHtml: `A calculation has been uploaded and needs your review. Please <strong>review, comment or approve</strong> it.`, rfiLink: calcLink(no, doc.id), mentioned: false, cta: 'Review Calculations' })
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
    const docs = (await get(RKEY(no))) || []
    const readMap = await calcGetReadMap(no, acc.user.id)
    const unread = calcUnread(docs, readMap)
    return res.json({ docs, canEdit: acc.canEdit, people, meId: acc.user.id, external: acc.external, unread })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = req.body || {}
  const no = String(body.projectNo || '').trim()
  if (!no) return res.status(400).json({ error: 'Missing project' })
  const acc = await resolveAccess(req, no)
  if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })

  let docs = (await get(RKEY(no))) || []
  const idx = (id) => docs.findIndex(d => d.id === id)

  if (body.action === 'mark-read') {
    const d = docs.find(x => x.id === body.id)
    if (d) await calcMarkRead(no, acc.user.id, d)
    return res.json({ ok: true })
  }

  // Comment - internal AND external. @mentions immediate; batched end-of-day otherwise.
  if (body.action === 'comment') {
    if (!acc.canComment) return res.status(403).json({ error: 'Not allowed' })
    const i = idx(body.id)
    if (i < 0) return res.status(404).json({ error: 'Calculation not found' })
    const html = String(body.html || '').trim()
    if (!html) return res.status(400).json({ error: 'Empty comment' })
    const comment = { id: rid('c'), authorId: acc.user.id, authorName: acc.user.name || 'User', external: acc.external, html, at: Date.now() }
    docs[i].comments = [...(docs[i].comments || []), comment]
    await set(RKEY(no), docs)
    try { await calcMarkRead(no, acc.user.id, docs[i]) } catch {}
    try { await calcRecordPendingComment(no) } catch {}
    let notify = { mentioned: 0, sent: 0 }
    try {
      const people = await peopleFor(no)
      const ids = mentionedIds(html, people).filter(id => id !== acc.user.id)
      if (ids.length) {
        const pname = await projectDisplayName(no)
        const link = calcLink(no, docs[i].id)
        for (const id of ids) {
          const p = people.find(x => x.id === id)
          if (!p || !p.email) continue
          notify.mentioned++
          const r = await sendRfiCommentNotice({ to: p.email, recipientName: p.name, projectNo: no, projectName: pname, rfiNumber: `${docs[i].title || 'Calculation'} (Rev ${docs[i].revision})`, authorName: comment.authorName, commentHtml: html, rfiLink: link, mentioned: true, cta: 'Review Calculations' })
          if (r.sent) notify.sent++
        }
      }
    } catch (e) { /* ignore */ }
    return res.json({ ok: true, doc: docs[i], notify })
  }

  // Markup - internal AND external.
  if (body.action === 'markup') {
    if (!acc.canComment) return res.status(403).json({ error: 'Not allowed' })
    const i = idx(body.id)
    if (i < 0) return res.status(404).json({ error: 'Calculation not found' })
    docs[i].markup = body.markup
    await set(RKEY(no), docs)
    return res.json({ ok: true, doc: docs[i] })
  }

  // Approve - ONLY the assigned customer approver, not superseded.
  if (body.action === 'approve') {
    const i = idx(body.id)
    if (i < 0) return res.status(404).json({ error: 'Calculation not found' })
    if (!acc.external) return res.status(403).json({ error: 'Only the customer can approve a calculation.' })
    if (docs[i].approverId && docs[i].approverId !== acc.user.id) return res.status(403).json({ error: 'Only the assigned approver can approve this calculation.' })
    if (docs[i].superseded) return res.status(400).json({ error: 'This revision has been superseded.' })
    if (docs[i].status === 'approved') return res.json({ ok: true, doc: docs[i] })
    const ext = (await getExternalUsers()).find(x => x.id === acc.user.id) || {}
    const now = Date.now()
    docs[i].status = 'approved'
    docs[i].approvedAt = now
    docs[i].approvedBy = ext.name || acc.user.name || 'Customer'
    docs[i].approvalRecord = { name: ext.name || '', email: ext.email || '', phone: ext.phone || '', company: ext.company || '', role: ext.role || 'Customer', userId: acc.user.id, at: now, atText: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'long' }).format(new Date(now)) }
    // Immutable audit entry + timestamped certificate (evidence for disputes).
    try {
      const pname0 = await projectDisplayName(no)
      const { certificateUrl, fileHash, eventId } = await recordAndCertify(no, pname0, docs[i], { ...ext, userId: acc.user.id })
      docs[i].approvalRecord.certificateUrl = certificateUrl
      docs[i].approvalRecord.fileHash = fileHash
      docs[i].approvalRecord.auditId = eventId
    } catch (e) { /* audit failure must not block the approval */ }
    // Bake a stamped copy (APPROVED, plus CONSTRUCTION ISSUE if already set).
    try { docs[i].stampedUrl = await buildStampedCopy(docs[i], { projectNo: no }) } catch (e) { /* stamping must not block */ }
    await set(RKEY(no), docs)
    try {
      const people = await peopleFor(no)
      const pname = await projectDisplayName(no)
      const link = calcLink(no, docs[i].id)
      for (const p of people) { if (p.external || !p.email) continue; await sendRfiCommentNotice({ to: p.email, recipientName: p.name, projectNo: no, projectName: pname, rfiNumber: `${docs[i].title} (Rev ${docs[i].revision})`, authorName: docs[i].approvedBy, commentHtml: `<strong>Approved.</strong> This calculation has been approved by ${docs[i].approvedBy}${ext.company ? ` (${ext.company})` : ''}.`, rfiLink: link, mentioned: false, cta: 'Review Calculations' }) }
    } catch (e) { /* ignore */ }
    return res.json({ ok: true, doc: docs[i] })
  }

  // Approve MANY at once (customer only). Approves each selected drawing the caller is the
  // assigned approver for; silently skips superseded / already-approved / not-theirs.
  if (body.action === 'approve-many') {
    if (!acc.external) return res.status(403).json({ error: 'Only the customer can approve calculations.' })
    const ids = Array.isArray(body.ids) ? body.ids : []
    const ext = (await getExternalUsers()).find(x => x.id === acc.user.id) || {}
    const now = Date.now()
    const approvedNow = []
    for (const id of ids) {
      const i = idx(id)
      if (i < 0) continue
      const d = docs[i]
      if (d.superseded || d.status === 'approved') continue
      if (d.approverId && d.approverId !== acc.user.id) continue   // not their drawing to approve
      d.status = 'approved'; d.approvedAt = now; d.approvedBy = ext.name || acc.user.name || 'Customer'
      d.approvalRecord = { name: ext.name || '', email: ext.email || '', phone: ext.phone || '', company: ext.company || '', role: ext.role || 'Customer', userId: acc.user.id, at: now, atText: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'long' }).format(new Date(now)) }
      approvedNow.push(d)
    }
    if (approvedNow.length) {
      // Immutable audit entry + certificate for each approved drawing.
      try {
        const pname0 = await projectDisplayName(no)
        for (const d of approvedNow) {
          const { certificateUrl, fileHash, eventId } = await recordAndCertify(no, pname0, d, { ...ext, userId: acc.user.id })
          d.approvalRecord.certificateUrl = certificateUrl
          d.approvalRecord.fileHash = fileHash
          d.approvalRecord.auditId = eventId
        }
      } catch (e) { /* audit failure must not block approvals */ }
      for (const d of approvedNow) {
        try { d.stampedUrl = await buildStampedCopy(d, { projectNo: no }) } catch (e) { /* stamping must not block */ }
      }
      await set(RKEY(no), docs)
      try {
        const people = await peopleFor(no)
        const pname = await projectDisplayName(no)
        const link = `${APP_URL}/design/${encodeURIComponent(no)}/calculations`
        const names = approvedNow.map(d => `${d.title} (Rev ${d.revision})`).join(', ')
        for (const p of people) { if (p.external || !p.email) continue; await sendRfiCommentNotice({ to: p.email, recipientName: p.name, projectNo: no, projectName: pname, rfiNumber: `${approvedNow.length} calculation${approvedNow.length === 1 ? '' : 's'}`, authorName: ext.name || acc.user.name || 'Customer', commentHtml: `<strong>Approved.</strong> ${esc0(names)} approved by ${ext.name || 'the customer'}${ext.company ? ` (${ext.company})` : ''}.`, rfiLink: link, mentioned: false, cta: 'Review Calculations' }) }
      } catch (e) { /* ignore */ }
    }
    return res.json({ ok: true, approved: approvedNow.length, docs })
  }

  // Everything below is internal-only (Rock Roofing).
  if (!acc.canEdit) return res.status(403).json({ error: 'View/comment only' })

  // Add a brand-new drawing (own family, Rev A). Requires a customer approver.
  if (body.action === 'add') {
    const f = body.file || {}
    if (!f.url) return res.status(400).json({ error: 'No file' })
    const doc = {
      id: rid('calc'), familyId: rid('fam'), revision: 'A',
      title: (body.title || f.name || 'Calculation').trim(),
      name: f.name || 'Calculation', url: f.url, contentType: f.contentType || '', size: f.size || 0,
      thumbUrl: isImg(f) ? f.url : '',
      uploadedBy: acc.user.name || 'User', uploadedAt: Date.now(),
      superseded: false, markup: null, comments: [],
      status: 'in-review', constructionIssue: false,
      approverId: body.approverId || '', approvedAt: 0, approvedBy: '', approvalRecord: null,
    }
    docs = [doc, ...docs]
    await set(RKEY(no), docs)
    await notifyApprover(no, doc)
    try { await calcRecordPendingDoc(no) } catch {}
    return res.json({ ok: true, docs })
  }

  // Add a new revision of an existing drawing. Marks the family superseded, adds next letter.
  if (body.action === 'add-revision') {
    const f = body.file || {}
    if (!f.url) return res.status(400).json({ error: 'No file' })
    const base = docs.find(d => d.id === body.id)
    if (!base) return res.status(404).json({ error: 'Calculation not found' })
    const fam = base.familyId
    const famDocs = docs.filter(d => d.familyId === fam)
    const nextRev = revLetter(famDocs.length)
    docs = docs.map(d => d.familyId === fam ? { ...d, superseded: true } : d)
    const doc = {
      id: rid('calc'), familyId: fam, revision: nextRev,
      title: base.title,
      name: f.name || base.title, url: f.url, contentType: f.contentType || '', size: f.size || 0,
      thumbUrl: isImg(f) ? f.url : '',
      uploadedBy: acc.user.name || 'User', uploadedAt: Date.now(),
      superseded: false, markup: null, comments: [],
      status: 'in-review', constructionIssue: false,
      approverId: body.approverId || base.approverId || '', approvedAt: 0, approvedBy: '', approvalRecord: null,
    }
    docs = [doc, ...docs]
    await set(RKEY(no), docs)
    await notifyApprover(no, doc)
    try { await calcRecordPendingDoc(no) } catch {}
    return res.json({ ok: true, docs })
  }

  // Toggle Construction Issue (internal only). Records when it was marked, and rebuilds
  // the stamped copy so the stamp appears / disappears everywhere.
  if (body.action === 'construction-issue') {
    const i = idx(body.id)
    if (i < 0) return res.status(404).json({ error: 'Calculation not found' })
    const on = body.value !== false
    docs[i].constructionIssue = on
    docs[i].constructionIssueAt = on ? Date.now() : 0
    try { docs[i].stampedUrl = await buildStampedCopy(docs[i], { projectNo: no }) } catch (e) { /* stamping must not block */ }
    await set(RKEY(no), docs)
    return res.json({ ok: true, doc: docs[i] })
  }

  // Mark / unmark Construction Issue on MANY calculations at once (internal only). Skips
  // superseded revisions and anything already in the requested state. Rebuilds the
  // stamped copy for each one that actually changed.
  if (body.action === 'construction-issue-many') {
    const ids = Array.isArray(body.ids) ? body.ids : []
    const on = body.value !== false
    const now = Date.now()
    const changed = []
    for (const id of ids) {
      const i = idx(id)
      if (i < 0) continue
      if (docs[i].superseded) continue
      if (!!docs[i].constructionIssue === on) continue
      docs[i].constructionIssue = on
      docs[i].constructionIssueAt = on ? now : 0
      changed.push(docs[i])
    }
    for (const d of changed) {
      try { d.stampedUrl = await buildStampedCopy(d, { projectNo: no }) } catch (e) { /* stamping must not block */ }
    }
    if (changed.length) await set(RKEY(no), docs)
    return res.json({ ok: true, changed: changed.length, docs })
  }

  if (body.action === 'delete') {
    docs = docs.filter(d => d.id !== body.id)
    await set(RKEY(no), docs)
    return res.json({ ok: true, docs })
  }

  // Notify project users that drawings are uploaded. approverIds get an "approve" ask; the
  // rest just get a heads-up. Optionally set those approvers on the current drawings.
  if (body.action === 'notify-uploaded') {
    const approverIds = Array.isArray(body.approverIds) ? body.approverIds : []
    const people = await peopleFor(no)
    const pname = await projectDisplayName(no)
    const link = `${APP_URL}/design/${encodeURIComponent(no)}/calculations`
    let sent = 0
    for (const p of people) {
      if (!p.email) continue
      const isApprover = approverIds.includes(p.id)
      const msg = isApprover
        ? `Rock Roofing have uploaded calculations for project <strong>${pname || no}</strong> for your <strong>review and approval</strong>. Please review, comment and approve them.`
        : `Rock Roofing have uploaded calculations for project <strong>${pname || no}</strong> for your information and review.`
      const r = await sendRfiCommentNotice({ to: p.email, recipientName: p.name, projectNo: no, projectName: pname, rfiNumber: 'Calculations', authorName: acc.user.name || 'Rock Roofing', commentHtml: msg, rfiLink: link, mentioned: false, cta: 'Review Calculations' })
      if (r.sent) sent++
    }
    // Assign chosen approvers to all current (non-superseded) drawings that don't have one.
    if (approverIds.length === 1) {
      docs = docs.map(d => (!d.superseded && !d.approverId) ? { ...d, approverId: approverIds[0] } : d)
      await set(RKEY(no), docs)
    }
    return res.json({ ok: true, sent, docs })
  }

  return res.status(400).json({ error: 'Unknown action' })
}
