import { get, set, getOpsProjects } from '../../lib/db'

// RAMS sign-off matrix: which operative has signed onto which project's RAMS.
// Store: ops:rams-matrix = { [projectKey]: { [opId]: true } }
//   projectKey = the RR project number (e.g. "J13").
//
// GET  /api/rams-matrix -> { projects:[{key,name}], signoffs }
// POST /api/rams-matrix { action:'toggle', projectKey, opId, signed:bool }

const KEY = 'ops:rams-matrix'

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const [ops, signoffs] = await Promise.all([
        getOpsProjects(),
        get(KEY).then(v => v || {}),
      ])
      const projects = (ops || [])
        .filter(p => (p.status || 'active') === 'active')
        .map(p => ({ key: p.projectNo, name: p.data?.projectName ? `${p.projectNo}. ${p.data.projectName}` : p.projectNo }))
        .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
      return res.json({ projects, signoffs })
    }

    if (req.method === 'POST') {
      const { action, projectKey, opId, signed } = req.body || {}
      if (action === 'toggle') {
        if (!projectKey || !opId) return res.status(400).json({ error: 'Missing projectKey/opId' })
        const m = (await get(KEY)) || {}
        m[projectKey] = m[projectKey] || {}
        if (signed) m[projectKey][opId] = true
        else { delete m[projectKey][opId]; if (!Object.keys(m[projectKey]).length) delete m[projectKey] }
        await set(KEY, m)
        return res.json({ ok: true })
      }
      return res.status(400).json({ error: 'Unknown action' })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('rams-matrix error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
