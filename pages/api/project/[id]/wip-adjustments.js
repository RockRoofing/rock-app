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
  const { id } = req.query
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  const key = `wip:adjustments:${id}`

  if (req.method === 'GET') {
    try {
      const data = await redis.get(key)
      return res.json({ adjustments: data || [] })
    } catch { return res.json({ adjustments: [] }) }
  }

  if (req.method === 'POST') {
    // Add a new adjustment
    const { month, type, description, amount } = req.body
    if (!month || !type || !amount) return res.status(400).json({ error: 'Missing fields' })
    let adjustments = []
    try {
      const data = await redis.get(key)
      if (data) adjustments = data
    } catch {}
    const newAdj = {
      id: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      month,      // YYYY-MM — applies only to this month
      type,       // 'Cost' or 'Invoice'
      description: description || '',
      amount: parseFloat(amount),
      createdAt: new Date().toISOString(),
    }
    adjustments.push(newAdj)
    await redis.set(key, adjustments)
    return res.json({ adjustment: newAdj, adjustments })
  }

  if (req.method === 'DELETE') {
    const { adjId } = req.body
    let adjustments = []
    try {
      const data = await redis.get(key)
      if (data) adjustments = data
    } catch {}
    adjustments = adjustments.filter(a => a.id !== adjId)
    await redis.set(key, adjustments)
    return res.json({ adjustments })
  }

  res.status(405).end()
}
