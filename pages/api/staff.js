import { getStaff, saveStaff } from '../../lib/db'

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
  if (req.method === 'GET') {
    const staff = await getStaff()
    return res.json(staff)
  }

  if (req.method === 'POST') {
    const { members } = req.body
    if (!Array.isArray(members)) {
      return res.status(400).json({ error: 'members must be an array' })
    }
    await saveStaff({ members })
    await clearCache()
    return res.json({ ok: true })
  }

  res.status(405).end()
}
