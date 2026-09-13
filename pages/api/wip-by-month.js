import { requireRole } from '../../lib/portalAuth'
import { getClient } from '../../lib/db'
import withTenant from '../../lib/withTenant'

async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract','management','admin'])) return;
  const { month } = req.query
  if (!month) return res.status(400).json({ error: 'month required' })

  const redis = await getClient()

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

export default withTenant(handler)
