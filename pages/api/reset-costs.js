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
  if (req.method !== 'POST') return res.status(405).end()
  const redis = await getRedis()
  if (redis) {
    await redis.del('costs:labour')
    await redis.del('costs:materials')
    await redis.del('uploaded:invoices')
    await redis.del('dashboard:cache')
  }
  res.json({ ok: true, message: 'All cost data reset' })
}
