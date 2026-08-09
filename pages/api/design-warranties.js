import { get, set } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { getExternalUsers, externalCanAccessProject } from '../../lib/designUsers'
import { canAccessArea } from '../../lib/roles'

// Warranties for a project: a flat list of uploaded documents (no sections).
// Store: design:warranties:<no> = { files: [ { id, name, url, contentType, size,
//                                   uploadedBy, uploadedAt } ] }
const WKEY = (no) => `design:warranties:${no}`

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}

async function resolveAccess(req, projectNo) {
  const u = verifySessionToken(readCookie(req, SESSION_COOKIE))
  if (!u) return { ok: false, code: 401 }
  if (u.role === 'external') {
    const ext = (await getExternalUsers()).find(x => x.id === u.id && x.active !== false)
    if (!ext || !externalCanAccessProject(ext, projectNo)) return { ok: false, code: 403 }
    return { ok: true, user: { ...u, name: ext.name }, canEdit: false }   // customers: view + download only
  }
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
    const data = (await get(WKEY(no))) || { files: [] }
    return res.json({ files: data.files || [], canEdit: acc.canEdit })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = req.body || {}
  const no = String(body.projectNo || '').trim()
  if (!no) return res.status(400).json({ error: 'Missing project' })
  const acc = await resolveAccess(req, no)
  if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })
  if (!acc.canEdit) return res.status(403).json({ error: 'View only' })

  const data = (await get(WKEY(no))) || { files: [] }

  try {
    if (body.action === 'add-file') {
      const f = body.file || {}
      if (!f.url) return res.status(400).json({ error: 'No file' })
      data.files = data.files || []
      data.files.push({ id: rid('doc'), name: f.name || 'Warranty', url: f.url, contentType: f.contentType || '', size: f.size || 0, uploadedBy: acc.user.name || 'User', uploadedAt: Date.now() })
      await set(WKEY(no), data)
      return res.json({ ok: true, files: data.files })
    }
    if (body.action === 'delete-file') {
      data.files = (data.files || []).filter(x => x.id !== body.fileId)
      await set(WKEY(no), data)
      return res.json({ ok: true, files: data.files })
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
