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
    return res.json({ key, sections: stored?.sections || DEFAULTS[key], isCustom: !!stored })
  }
  if (req.method === 'POST') {
    if (!requireRole(req, res, ['admin'])) return;
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
