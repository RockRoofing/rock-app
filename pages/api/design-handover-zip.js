import archiver from 'archiver'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { getExternalUsers, externalCanAccessProject } from '../../lib/designUsers'
import { canAccessArea } from '../../lib/roles'
import { get } from '../../lib/db'

// Streams a set of stored files (by URL) into a single ZIP. Used by Handover Docs
// "Download all" / "Download selected". POST { projectNo, urls:[...], zipName }.
function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}

const HKEY = (no) => `design:handover-docs:${no}`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const u = verifySessionToken(readCookie(req, SESSION_COOKIE))
  if (!u) return res.status(401).json({ error: 'Not logged in' })

  const projectNo = String(req.body?.projectNo || '').trim()
  if (!projectNo) return res.status(400).json({ error: 'Missing project' })

  // Access check.
  if (u.role === 'external') {
    const ext = (await getExternalUsers()).find(x => x.id === u.id && x.active !== false)
    if (!ext || !externalCanAccessProject(ext, projectNo)) return res.status(403).json({ error: 'No access' })
  } else if (!canAccessArea(u.role, 'design')) {
    return res.status(403).json({ error: 'No access' })
  }

  // Only allow URLs that actually belong to this project's handover docs (don't let a
  // caller zip arbitrary blob URLs).
  const data = (await get(HKEY(projectNo))) || { sections: [] }
  const allowed = new Map()
  for (const s of (data.sections || [])) for (const f of (s.files || [])) allowed.set(f.url, f.name)

  let requested = Array.isArray(req.body?.urls) ? req.body.urls : []
  const files = requested.map(url => ({ url, name: allowed.get(url) })).filter(f => f.name)
  if (!files.length) return res.status(400).json({ error: 'No valid files selected' })

  const zipName = (String(req.body?.zipName || 'handover-docs').replace(/[^\w.\- ]+/g, '_')) + '.zip'
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`)

  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.on('error', () => { try { res.status(500).end() } catch {} })
  archive.pipe(res)

  const used = new Set()
  for (const f of files) {
    try {
      const upstream = await fetch(f.url)
      if (!upstream.ok) continue
      const buf = Buffer.from(await upstream.arrayBuffer())
      // De-duplicate names within the zip.
      let name = f.name || 'file'
      if (used.has(name)) { const dot = name.lastIndexOf('.'); const base = dot > 0 ? name.slice(0, dot) : name; const ext = dot > 0 ? name.slice(dot) : ''; let n = 2; while (used.has(`${base} (${n})${ext}`)) n++; name = `${base} (${n})${ext}` }
      used.add(name)
      archive.append(buf, { name })
    } catch { /* skip a file that fails to fetch */ }
  }
  await archive.finalize()
}

export const config = { api: { responseLimit: false } }
