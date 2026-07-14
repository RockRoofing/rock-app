import { get, set, getOpsProjects, getProjectFiles, getRamsSignatures, getRamsApprovals } from '../../lib/db'

// RAMS sign-off matrix (portal). Derived from REAL data:
//   - Current RAMS docs per project (ops:files:<no>, category 'rams')
//   - Per-document signatures (ops:rams-signatures:<no>)
//   - Per-document approval chain (ops:rams-approvals:<no>)
//
// A project's RAMS status rolls up its CURRENT RAMS documents:
//   stage      = the earliest (least-advanced) stage across its current docs
//   signerKeys = lowercased names of people who have signed ALL current docs
//
// Cell state (computed client-side from this payload):
//   'yes' (green)  = this operative has signed all current RAMS
//   'ps'  (orange) = project has current RAMS whose chain has reached operatives
//                    but this operative hasn't signed
//   ''             = no current RAMS, or chain hasn't reached operatives yet
//
// GET /api/rams-matrix -> { projects:[{ key, name, stage, hasRams, signerKeys:[] }], signoffs }
// POST keeps a manual toggle store (ops:rams-matrix) for backwards-compat.

const KEY = 'ops:rams-matrix'

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const ops = await getOpsProjects()
      const active = (ops || []).filter(p => (p.status || 'active') === 'active')
      const manual = (await get(KEY)) || {}

      const STAGE_RANK = { cm: 0, director: 1, 'site-manager': 2, operatives: 3, complete: 4 }
      const projects = []
      for (const p of active) {
        const no = p.projectNo
        const files = await getProjectFiles(no)
        const ramsFiles = (files || []).filter(f => f.category === 'rams')
        const name = p.data?.projectName ? `${no}. ${p.data.projectName}` : no

        if (!ramsFiles.length) {
          projects.push({ key: no, name, hasRams: false, stage: null, signerKeys: [] })
          continue
        }

        const [sigs, appr] = await Promise.all([getRamsSignatures(no), getRamsApprovals(no)])

        // Rolled-up stage = least-advanced across current docs (strictest view).
        let minRank = 4
        for (const f of ramsFiles) {
          const st = (appr[f.id] && appr[f.id].stage) || 'cm'
          minRank = Math.min(minRank, STAGE_RANK[st] != null ? STAGE_RANK[st] : 0)
        }
        const stage = Object.keys(STAGE_RANK).find(k => STAGE_RANK[k] === minRank) || 'cm'

        // Who (operatives) has signed ALL current RAMS docs -> match by lowercased
        // name. EXCLUDE the CM/Director auto-signatures (they approve + auto-sign,
        // but they are not "operatives" for the matrix/pipeline).
        const perOpSignedCount = {}
        for (const f of ramsFiles) {
          const bucket = sigs[f.id] || {}
          for (const opId of Object.keys(bucket)) {
            if (opId.startsWith('cm:') || opId.startsWith('director:')) continue
            const rec = bucket[opId]
            if (rec.role === 'Contracts Manager' || rec.role === 'Director') continue
            const nmeKey = (rec.name || '').trim().toLowerCase()
            if (!nmeKey) continue
            perOpSignedCount[nmeKey] = (perOpSignedCount[nmeKey] || 0) + 1
          }
        }
        const signerKeys = Object.keys(perOpSignedCount).filter(k => perOpSignedCount[k] >= ramsFiles.length)

        projects.push({ key: no, name, hasRams: true, stage, signerKeys })
      }

      projects.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
      return res.json({ projects, signoffs: manual })
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
