import { saveProject, getProject } from '../../../../lib/db'

async function clearCache() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return
    const redis = new Redis({ url, token })
    await redis.del('dashboard:cache')
  } catch {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { id } = req.query
  // Merge with existing settings so a partial update (e.g. just wipMarginOverride
  // from the WIP page) doesn't wipe the rest. Full-object callers are unaffected.
  const existing = (await getProject(id)) || {}

  // OWNED ELSEWHERE - never written from here.
  //
  // This endpoint takes whatever the caller sends and merges it. The Project Details form
  // posts its entire settings object back, and that object is the WHOLE project record -
  // including contractedRates and applications, which it never edits and may be holding a
  // stale copy of.
  //
  // The effect: lock the contracted rates, then save project details from a page loaded
  // before the lock, and the lock silently reverted. Applications then refused to create
  // one, correctly reporting rates that were not locked - while the rates page still
  // showed them locked from its own state.
  //
  // Applications are on the list for the same reason: a stale copy posted back here would
  // undo a certificate.
  const OWNED_ELSEWHERE = ['contractedRates', 'applications']
  const incoming = { ...req.body }
  for (const k of OWNED_ELSEWHERE) delete incoming[k]

  await saveProject(id, { ...existing, ...incoming })
  await clearCache()
  res.json({ ok: true })
}
