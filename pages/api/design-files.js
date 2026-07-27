import { get, set } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { getExternalUsers, externalCanAccessProject } from '../../lib/designUsers'
import { canAccessArea } from '../../lib/roles'

// Document store for the Design portal's simple pages:
//   categories: 'warranties' | 'oms' | 'calculations' | 'tech-sub' | 'leak-test-certs'
// Store key per project+category: design:files:<projectNo>:<category> = [ {file}, ... ]
//
//   GET    ?no=<projectNo>&cat=<category>          -> { files, canUpload }
//   POST   { projectNo, category, file }           -> add (internal only)
//   POST   { projectNo, category, id, action:'revise' } (tech-sub: mark others revised)
//   DELETE { projectNo, category, id }             -> remove (internal only)
//
// External customer users: read-only, and ONLY for projects they're scoped to.

const CATEGORIES = ['warranties', 'oms', 'calculations', 'tech-sub', 'leak-test-certs']
const key = (no, cat) => `design:files:${no}:${cat}`

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}
function sessionUser(req) { return verifySessionToken(readCookie(req, SESSION_COOKIE)) }

// Resolve who's asking + whether they may see / edit this project's design docs.
async function resolveAccess(req, projectNo) {
  const u = sessionUser(req)
  if (!u) return { ok: false, code: 401 }
  if (u.role === 'external') {
    const ext = (await getExternalUsers()).find(x => x.id === u.id && x.active !== false)
    if (!ext || !externalCanAccessProject(ext, projectNo)) return { ok: false, code: 403 }
    return { ok: true, user: u, canUpload: false, external: true }   // customers are view-only
  }
  // Internal: must have Design area access.
  if (!canAccessArea(u.role, 'design')) return { ok: false, code: 403 }
  return { ok: true, user: u, canUpload: true, external: false }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const no = String(req.query.no || '').trim()
    const cat = String(req.query.cat || '').trim()
    if (!no || !CATEGORIES.includes(cat)) return res.status(400).json({ error: 'Missing/invalid project or category' })
    const acc = await resolveAccess(req, no)
    if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access to this project' })
    const files = (await get(key(no, cat))) || []
    return res.json({ files, canUpload: acc.canUpload })
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    const no = String(body.projectNo || '').trim()
    const cat = String(body.category || '').trim()
    if (!no || !CATEGORIES.includes(cat)) return res.status(400).json({ error: 'Missing/invalid project or category' })
    const acc = await resolveAccess(req, no)
    if (!acc.ok) return res.status(acc.code).json({ error: 'No access' })
    if (!acc.canUpload) return res.status(403).json({ error: 'View only - customers cannot upload.' })

    let files = (await get(key(no, cat))) || []

    if (body.action === 'set-current' && body.id) {
      // Tech Sub: mark the chosen one current, all others revised.
      files = files.map(f => ({ ...f, revised: f.id !== body.id }))
      await set(key(no, cat), files)
      return res.json({ ok: true, files })
    }

    const f = body.file || {}
    if (!f.url || !f.name) return res.status(400).json({ error: 'File url and name required' })
    const entry = {
      id: `df_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: f.name,
      url: f.url,
      contentType: f.contentType || '',
      size: f.size || 0,
      uploadedBy: acc.user.name || acc.user.email || 'Rock Roofing',
      uploadedAt: Date.now(),
      revised: false,
      note: f.note || '',
    }
    // Tech Sub: uploading a new one automatically marks all previous as revised.
    if (cat === 'tech-sub') files = files.map(x => ({ ...x, revised: true }))
    files.unshift(entry)
    await set(key(no, cat), files)
    return res.json({ ok: true, files })
  }

  if (req.method === 'DELETE') {
    const body = req.body || {}
    const no = String(body.projectNo || '').trim()
    const cat = String(body.category || '').trim()
    if (!no || !CATEGORIES.includes(cat)) return res.status(400).json({ error: 'Missing/invalid project or category' })
    const acc = await resolveAccess(req, no)
    if (!acc.ok || !acc.canUpload) return res.status(403).json({ error: 'No access' })
    let files = (await get(key(no, cat))) || []
    files = files.filter(f => f.id !== body.id)
    await set(key(no, cat), files)
    return res.json({ ok: true, files })
  }

  res.status(405).end()
}
