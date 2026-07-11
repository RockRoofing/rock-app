import { requireRole } from '../../lib/portalAuth'
async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['admin'])) return;
  const redis = await getRedis()
  if (redis) {
    await redis.del('backfill:labour:progress')
    await redis.del('backfill:labour')
  }
  res.json({ ok: true, message: 'Backfill progress reset' })
}
