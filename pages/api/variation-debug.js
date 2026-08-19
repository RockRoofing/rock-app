import { requireRole } from '../../lib/portalAuth'
import { getProject, get } from '../../lib/db'

// GET /api/variation-debug?projectId=...        what is stored for one project
// GET /api/variation-debug                      a count for every project
//
// Reports exactly what the server holds. WRITES NOTHING.
//
// Added because "the variations are not showing" has two completely different causes -
// the records are gone, or they are there and something is not reading them - and those
// need opposite responses. Guessing between them wastes a deploy either way.
export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return

  const { projectId, jobNo } = req.query

  // TWO RECORDS PER PROJECT is the thing to check. Settings are stored under the tracking
  // option id OR the job number, and a variation written against one is invisible to a
  // reader that finds the other first.
  if (jobNo) {
    const byJob = (await getProject(jobNo)) || {}
    return res.json({
      ok: true, lookedUpBy: 'jobNo', key: jobNo,
      count: Array.isArray(byJob.variations) ? byJob.variations.length : 0,
      variations: (byJob.variations || []).map(v => ({
        varNumber: v.varNumber, description: (v.description || '').slice(0, 60),
        instructed: v.instructed || 'no', builtInBuilder: !!v.builder,
      })),
    })
  }

  if (projectId) {
    const project = (await getProject(projectId)) || {}
    // The two places variations have lived. If one has rows and the other does not, the
    // records are fine and the reader is wrong.
    const onProject = Array.isArray(project.variations) ? project.variations : null
    const onSettings = Array.isArray(project.settings?.variations) ? project.settings.variations : null

    const summarise = (list) => (list || []).map(v => ({
      varNumber: v.varNumber || '(none)',
      description: (v.description || '').slice(0, 60),
      instructed: v.instructed || 'no',
      total: (parseFloat(v.materials) || 0) + (parseFloat(v.labour) || 0) + (parseFloat(v.profit) || 0),
      builtInBuilder: !!v.builder,
      sent: v.builder?.firstSentAt ? new Date(v.builder.firstSentAt).toISOString() : null,
    }))

    return res.json({
      ok: true,
      projectId: String(projectId),
      projectKeys: Object.keys(project),
      counts: {
        onProject: onProject ? onProject.length : 'not present',
        onSettings: onSettings ? onSettings.length : 'not present',
      },
      onProject: summarise(onProject),
      onSettings: summarise(onSettings),
      note: 'If one list has rows and the other does not, nothing has been lost - the reader was looking in the wrong place.',
    })
  }

  // EVERY KEY IN STORAGE THAT HOLDS A VARIATION, whatever it is keyed by.
  //
  // I have now twice been wrong about WHERE these live, so this stops theorising and
  // lists every project:* record that contains variations, with its raw key. If V01 and
  // V02 exist anywhere, this finds them.
  if (req.query.all === '1') {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !tok) return res.status(500).json({ error: 'Storage not configured' })
    const redis = new Redis({ url, token: tok })
    const keys = await redis.keys('project:*')
    const found = []
    for (const k of keys) {
      const v = await redis.get(k)
      const list = Array.isArray(v?.variations) ? v.variations : []
      if (!list.length) continue
      found.push({
        redisKey: k,
        count: list.length,
        numbers: list.map(x => x.varNumber || '(none)'),
        descriptions: list.map(x => (x.description || '').slice(0, 40)),
      })
    }
    return res.json({ ok: true, keysScanned: keys.length, recordsWithVariations: found.length, found })
  }

  // Every project, so a wipe can be spotted at a glance rather than checked one by one.
  const { getAllProjectSettings } = await import('../../lib/db')
  const all = await getAllProjectSettings()
  let cache = []
  try { cache = (await get('dashboard:cache')) || [] } catch {}

  const rows = []
  for (const [id, p] of Object.entries(all || {})) {
    const onProject = Array.isArray(p?.variations) ? p.variations.length : 0
    const onSettings = Array.isArray(p?.settings?.variations) ? p.settings.variations.length : 0
    if (!onProject && !onSettings) continue
    const row = Array.isArray(cache) ? cache.find(c => String(c.xeroId) === String(id)) : null
    rows.push({ projectId: id, jobNo: row?.jobNo || '', name: row?.name || '', onProject, onSettings })
  }
  rows.sort((a, b) => String(a.jobNo).localeCompare(String(b.jobNo), undefined, { numeric: true }))
  return res.json({ ok: true, projectsWithVariations: rows.length, rows })
}
