import { get, set } from '../../lib/db'
import { requireRole } from '../../lib/portalAuth'
import { defaultChaseTemplates } from '../../lib/chaseEmailTemplates'

const KEY = 'config:chase-email-templates'

// GET  -> { templates: [...], isCustom }   merges saved edits over the defaults
// POST { templates } -> saves (post-contract / management / admin)
export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const saved = await get(KEY)
      const defaults = defaultChaseTemplates()
      if (!saved || !Array.isArray(saved.templates)) {
        return res.json({ templates: defaults, isCustom: false })
      }
      // Merge: keep default order/keys, overlay any saved subject/body/cc.
      const savedByKey = Object.fromEntries(saved.templates.map(t => [t.key, t]))
      const merged = defaults.map(d => ({ ...d, ...(savedByKey[d.key] || {}) }))
      return res.json({ templates: merged, isCustom: true })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  if (req.method === 'POST') {
    if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return
    const { templates } = req.body || {}
    if (!Array.isArray(templates)) return res.status(400).json({ error: 'templates must be an array' })
    // Only persist the editable fields, keyed by the known template keys.
    const defaults = defaultChaseTemplates()
    const validKeys = new Set(defaults.map(d => d.key))
    const clean = templates
      .filter(t => t && validKeys.has(t.key))
      .map(t => ({
        key: t.key,
        subject: String(t.subject || ''),
        body: String(t.body || ''),
        ccSiteManager: !!t.ccSiteManager,
        ccRockCM: !!t.ccRockCM,
      }))
    await set(KEY, { templates: clean, updatedAt: new Date().toISOString() })
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
