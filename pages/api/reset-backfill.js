import { requireRole } from '../../lib/portalAuth'
import { getClient } from '../../lib/db'
import withTenant from '../../lib/withTenant'

async function handler(req, res) {
  if (!requireRole(req, res, ['admin'])) return;
  const redis = await getClient()
  await redis.del('backfill:labour:progress')
  await redis.del('backfill:labour')
  res.json({ ok: true, message: 'Backfill progress reset' })
}

export default withTenant(handler)
