import { requireRole } from '../../lib/portalAuth'
import { getClient } from '../../lib/db'
import withTenant from '../../lib/withTenant'

async function handler(req, res) {
  if (!requireRole(req, res, ['admin'])) return;
  const redis = await getClient()
  await redis.del('dashboard:cache')
  res.json({ ok: true, message: 'Dashboard cache cleared' })
}

export default withTenant(handler)
