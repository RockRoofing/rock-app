import { requireRole } from '../../lib/portalAuth'
import { getTemplate, saveTemplate } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { PRESTART_SECTIONS } from '../../lib/preStartSchema'
import { IHM_SECTIONS } from '../../lib/ihmSchema'

// Editable templates. GET returns the stored template or the code default.
// POST (admin only) saves an edited template. Applies to NEW forms only.
//
// GET  /api/templates?key=prestart|ihm  -> { key, sections, isCustom }
// POST { key, sections }                -> saves (admin only)

const DEFAULTS = { prestart: PRESTART_SECTIONS, ihm: IHM_SECTIONS }

// Once a template has been edited in Admin > Templates, the STORED copy is used and the
// code default is ignored completely. That means a question added in code would never
// appear on any system where the template had ever been customised.
//
// Fields marked `syncFromCode: true` in the schema are therefore merged into a stored
// template on read, if that template does not already have a field with the same id.
// Only flagged fields are merged, so a question deliberately deleted in the editor is not
// resurrected - deleting a flagged one would bring it back, which is why the flag is set
// deliberately per field rather than applied to everything.
function mergeCodeFields(storedSections, defaultSections) {
  if (!Array.isArray(storedSections) || !Array.isArray(defaultSections)) return storedSections
  const haveIds = new Set()
  for (const sec of storedSections) for (const f of (sec.fields || [])) if (f && f.id) haveIds.add(f.id)

  return storedSections.map(sec => {
    const def = defaultSections.find(d => d.id === sec.id)
    if (!def) return sec
    const missing = (def.fields || []).filter(f => f && f.syncFromCode && f.id && !haveIds.has(f.id))
    if (!missing.length) return sec
    return { ...sec, fields: [...(sec.fields || []), ...missing] }
  })
}

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}
function currentUser(req) { return verifySessionToken(readCookie(req, SESSION_COOKIE)) }

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const key = req.query.key
    if (!DEFAULTS[key]) return res.status(400).json({ error: 'Unknown template' })
    const stored = await getTemplate(key)
    const sections = stored?.sections
      ? mergeCodeFields(stored.sections, DEFAULTS[key])
      : DEFAULTS[key]
    return res.json({ key, sections, isCustom: !!stored })
  }
  if (req.method === 'POST') {
    if (!requireRole(req, res, ['management', 'admin'])) return;
    const me = currentUser(req)
    if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
    const { key, sections } = req.body || {}
    if (!DEFAULTS[key]) return res.status(400).json({ error: 'Unknown template' })
    if (!Array.isArray(sections)) return res.status(400).json({ error: 'Invalid template' })
    await saveTemplate(key, { sections, updatedAt: Date.now(), updatedBy: me.name || me.email })
    return res.json({ ok: true })
  }
  res.status(405).end()
}
