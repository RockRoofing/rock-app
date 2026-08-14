import { get, set } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { getExternalUsers, externalCanAccessProject } from '../../lib/designUsers'
import { getPortalUsers } from '../../lib/db'
import { canAccessArea } from '../../lib/roles'
import { buildStampedCopy } from '../../lib/stampPdf'

// Drawings per project + set ('rock' | 'contract').
// Store: design:drawings:<set>:<projectNo> = [ {drawing} ]
//   drawing = { id, name, url, contentType, size, thumbUrl,
//               status, comments:[...], markup:[...],   // markup = annotation objects
//               meta:{architect,reference,project,revision,status,date},  // contract only
//               uploadedBy, uploadedAt }
// status (rock): 'in-review' (default) | 'approved' | 'construction-issue'
//
// GET  ?no=&set=                          -> { drawings, canEdit, people, meId }
// POST { projectNo, set, action, ... }
//   'create'  { drawing }                 internal
//   'status'  { id, status }              internal (rock)
//   'delete'  { id }                      internal
//   'markup'  { id, markup }              internal (own drawings) - customers CAN also mark up per spec
//   'comment' { id, html }                internal + external
//   'meta'    { id, meta }                internal (contract)

const SETS = ['rock', 'contract']
const dkey = (set, no) => `design:drawings:${set}:${no}`

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
    return { ok: true, user: { ...u, name: ext.name }, canEdit: false, canComment: true, canMarkup: true, external: true }
  }
  if (!canAccessArea(u.role, 'design')) return { ok: false, code: 403 }
  return { ok: true, user: u, canEdit: true, canComment: true, canMarkup: true, external: false }
}

async function peopleFor(projectNo) {
  const [portal, ext] = await Promise.all([getPortalUsers(), getExternalUsers()])
  const out = []
  for (const p of (portal || [])) {
    if (p.active === false || !canAccessArea(p.role, 'design')) continue
    out.push({ id: p.id, name: p.name || [p.firstName, p.lastName].filter(Boolean).join(' '), external: false, company: 'Rock Roofing' })
  }
  for (const e of (ext || [])) {
    if (e.active === false || !externalCanAccessProject(e, projectNo)) continue
    out.push({ id: e.id, name: e.name, external: true, company: e.company || 'Customer' })
  }
  return out
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const no = String(req.query.no || '').trim()
    const set = String(req.query.set || 'rock').trim()
    if (!no || !SETS.includes(set)) return res.status(400).json({ error: 'Missing/invalid project or set' })
    const acc = await resolveAccess(req, no)
    if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })
    const drawings = (await get(dkey(set, no))) || []
    const people = await peopleFor(no)
    return res.json({ drawings, canEdit: acc.canEdit, canMarkup: acc.canMarkup, people, meId: acc.user.id, meName: acc.user.name, external: acc.external })
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    const no = String(body.projectNo || '').trim()
    const set = String(body.set || 'rock').trim()
    if (!no || !SETS.includes(set)) return res.status(400).json({ error: 'Missing/invalid project or set' })
    const acc = await resolveAccess(req, no)
    if (!acc.ok) return res.status(acc.code).json({ error: 'No access' })
    let drawings = (await get(dkey(set, no))) || []
    const idxOf = (id) => drawings.findIndex(d => d.id === id)

    // Comment + markup - allowed for internal AND external.
    if (body.action === 'comment') {
      const i = idxOf(body.id); if (i < 0) return res.status(404).json({ error: 'Not found' })
      const html = String(body.html || '').trim(); if (!html) return res.status(400).json({ error: 'Empty' })
      const comment = { id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, authorId: acc.user.id, authorName: acc.user.name || 'User', external: acc.external, html, at: Date.now() }
      drawings[i].comments = [...(drawings[i].comments || []), comment]
      await set(dkey(set, no), drawings)
      return res.json({ ok: true, drawing: drawings[i] })
    }
    if (body.action === 'markup') {
      if (!acc.canMarkup) return res.status(403).json({ error: 'Not allowed' })
      const i = idxOf(body.id); if (i < 0) return res.status(404).json({ error: 'Not found' })
      // markup is either a flat array (image drawings) or a {page: shapes[]} map (PDFs).
      const mk = body.markup
      drawings[i].markup = (Array.isArray(mk) || (mk && typeof mk === 'object')) ? mk : []
      await set(dkey(set, no), drawings)
      return res.json({ ok: true, drawing: drawings[i] })
    }

    // Internal-only from here.
    if (!acc.canEdit) return res.status(403).json({ error: 'View/comment only' })

    if (body.action === 'create') {
      const d = body.drawing || {}
      if (!d.url || !d.name) return res.status(400).json({ error: 'File required' })
      const drawing = {
        id: `dw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: d.name, url: d.url, contentType: d.contentType || '', size: d.size || 0, thumbUrl: d.thumbUrl || '',
        status: set === 'rock' ? 'in-review' : '',
        comments: [], markup: [],
        meta: d.meta || {},
        uploadedBy: acc.user.name || 'Rock Roofing', uploadedAt: Date.now(),
      }
      drawings = [drawing, ...drawings]
      await set(dkey(set, no), drawings)
      return res.json({ ok: true, drawings })
    }
    if (body.action === 'status') {
      const i = idxOf(body.id); if (i < 0) return res.status(404).json({ error: 'Not found' })
      const allowed = ['in-review', 'approved', 'construction-issue']
      if (allowed.includes(body.status)) {
        drawings[i].status = body.status
        // Timestamp the status so the stamp can carry a UK date/time. Status here is
        // one-of-three, so only ever one stamp on this tab.
        const now = Date.now()
        drawings[i].approvedAt = body.status === 'approved' ? now : 0
        drawings[i].constructionIssueAt = body.status === 'construction-issue' ? now : 0
        try { drawings[i].stampedUrl = await buildStampedCopy(drawings[i], { projectNo: no }) } catch (e) { /* stamping must not block */ }
      }
      await set(dkey(set, no), drawings)
      return res.json({ ok: true, drawings })
    }
    if (body.action === 'meta') {
      const i = idxOf(body.id); if (i < 0) return res.status(404).json({ error: 'Not found' })
      drawings[i].meta = { ...(drawings[i].meta || {}), ...(body.meta || {}) }
      await set(dkey(set, no), drawings)
      return res.json({ ok: true, drawings })
    }
    if (body.action === 'delete') {
      drawings = drawings.filter(d => d.id !== body.id)
      await set(dkey(set, no), drawings)
      return res.json({ ok: true, drawings })
    }
    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(405).end()
}
