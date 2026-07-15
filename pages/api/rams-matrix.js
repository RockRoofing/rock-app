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
        let ramsFiles = (files || []).filter(f => f.category === 'rams')
        const name = p.data?.projectName ? `${no}. ${p.data.projectName}` : no

        if (!ramsFiles.length) {
          projects.push({ key: no, name, hasRams: false, stage: null, signerKeys: [] })
          continue
        }

        // Operatives only ever see (and sign) the CURRENT revision, and the Site
        // App pipeline reflects only that file. The matrix MUST do the same —
        // otherwise an older revision still at an earlier stage drags the rolled-up
        // stage backwards (e.g. showing CM as current when the live RAMS is already
        // with the Site Manager). Use only the newest RAMS file.
        ramsFiles.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0))
        const currentFile = ramsFiles[0]
        ramsFiles = [currentFile]

        const [sigs, appr] = await Promise.all([getRamsSignatures(no), getRamsApprovals(no)])

        // Stage = the current revision's approval stage (defaults to 'cm').
        const stage = (appr[currentFile.id] && appr[currentFile.id].stage) || 'cm'

        // Who (operatives) has signed the CURRENT RAMS -> match by lowercased name.
        // EXCLUDE the CM/Director auto-signatures (they approve + auto-sign, but are
        // not "operatives" for the matrix/pipeline).
        const signerKeys = []
        const bucket = sigs[currentFile.id] || {}
        for (const opId of Object.keys(bucket)) {
          if (opId.startsWith('cm:') || opId.startsWith('director:')) continue
          const rec = bucket[opId]
          if (rec.role === 'Contracts Manager' || rec.role === 'Director') continue
          const nmeKey = (rec.name || '').trim().toLowerCase()
          if (nmeKey && !signerKeys.includes(nmeKey)) signerKeys.push(nmeKey)
        }

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
