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
  const { month } = req.query
  if (!month) return res.status(400).json({ error: 'month required' })

  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  const keys = await redis.keys(`wip:*:${month}`)
  const result = {}

  for (const key of keys) {
    const parts = key.split(':')
    const projectId = parts[1]
    const data = await redis.get(key)
    if (data) result[projectId] = data
  }

  res.json({ month, wip: result })
}
