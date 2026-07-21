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
  await saveProject(id, { ...existing, ...req.body })
  await clearCache()
  res.json({ ok: true })
}
