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
  if (!requireRole(req, res, ['post-contract','management','admin'])) return;
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })
  const KEY = 'retention:entries'

  if (req.method === 'GET') {
    try {
      const data = await redis.get(KEY)
      return res.json({ entries: data || [] })
    } catch { return res.json({ entries: [] }) }
  }

  if (req.method === 'POST') {
    const { entry } = req.body
    if (!entry) return res.status(400).json({ error: 'Missing entry' })
    let entries = []
    try { const d = await redis.get(KEY); if (d) entries = d } catch {}
    if (entry.id) {
      // Update existing
      entries = entries.map(e => e.id === entry.id ? { ...e, ...entry } : e)
    } else {
      // New entry
      entry.id = `ret_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      entry.manual = true
      entries.push(entry)
    }
    await redis.set(KEY, entries)
    return res.json({ entries })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    let entries = []
    try { const d = await redis.get(KEY); if (d) entries = d } catch {}
    entries = entries.filter(e => e.id !== id)
    await redis.set(KEY, entries)
    return res.json({ entries })
  }

  res.status(405).end()
}
