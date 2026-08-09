import { get, set } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { getExternalUsers, externalCanAccessProject } from '../../lib/designUsers'
import { canAccessArea } from '../../lib/roles'

// Handover Docs for a project: named sections, each holding uploaded documents.
// Store: design:handover-docs:<no> = { sections: [ { id, name, files: [ { id, name, url,
//                                     contentType, size, uploadedBy, uploadedAt } ] } ] }
const HKEY = (no) => `design:handover-docs:${no}`

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}

async function resolveAccess(req, projectNo) {
  const u = verifySessionToken(readCookie(req, SESSION_COOKIE))
  if (!u) return { ok: false, code: 401 }
  // Handover Docs is internal-only - customers (external users) have no access at all.
  if (u.role === 'external') return { ok: false, code: 403 }
  if (!canAccessArea(u.role, 'design')) return { ok: false, code: 403 }
  return { ok: true, user: u, canEdit: true }
}

const rid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const no = String(req.query.no || '').trim()
    if (!no) return res.status(400).json({ error: 'Missing project' })
    const acc = await resolveAccess(req, no)
    if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })
    const data = (await get(HKEY(no))) || { sections: [] }
    return res.json({ ...data, canEdit: acc.canEdit })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = req.body || {}
  const no = String(body.projectNo || '').trim()
  if (!no) return res.status(400).json({ error: 'Missing project' })
  const acc = await resolveAccess(req, no)
  if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })
  if (!acc.canEdit) return res.status(403).json({ error: 'View only' })

  const data = (await get(HKEY(no))) || { sections: [] }
  const section = (id) => data.sections.find(s => s.id === id)

  try {
    if (body.action === 'add-section') {
      const name = String(body.name || '').trim()
      if (!name) return res.status(400).json({ error: 'Section name required' })
      data.sections.push({ id: rid('sec'), name, files: [] })
      await set(HKEY(no), data)
      return res.json({ ok: true, ...data })
    }

    if (body.action === 'rename-section') {
      const s = section(body.id)
      if (!s) return res.status(404).json({ error: 'Section not found' })
      s.name = String(body.name || '').trim() || s.name
      await set(HKEY(no), data)
      return res.json({ ok: true, ...data })
    }

    if (body.action === 'delete-section') {
      data.sections = data.sections.filter(s => s.id !== body.id)
      await set(HKEY(no), data)
      return res.json({ ok: true, ...data })
    }

    if (body.action === 'add-file') {
      const s = section(body.sectionId)
      if (!s) return res.status(404).json({ error: 'Section not found' })
      const f = body.file || {}
      if (!f.url) return res.status(400).json({ error: 'No file' })
      s.files = s.files || []
      s.files.push({ id: rid('doc'), name: f.name || 'Document', url: f.url, contentType: f.contentType || '', size: f.size || 0, uploadedBy: acc.user.name || 'User', uploadedAt: Date.now() })
      await set(HKEY(no), data)
      return res.json({ ok: true, ...data })
    }

    if (body.action === 'delete-file') {
      const s = section(body.sectionId)
      if (!s) return res.status(404).json({ error: 'Section not found' })
      s.files = (s.files || []).filter(x => x.id !== body.fileId)
      await set(HKEY(no), data)
      return res.json({ ok: true, ...data })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
