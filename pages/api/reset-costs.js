import { requireRole } from '../../lib/portalAuth'
import { getClient } from '../../lib/db'
import withTenant from '../../lib/withTenant'

async function handler(req, res) {
  if (!requireRole(req, res, ['admin'])) return;
  if (req.method !== 'POST') return res.status(405).end()
  const redis = await getClient()
  await redis.del('costs:labour')
  await redis.del('costs:materials')
  await redis.del('uploaded:invoices')
  await redis.del('dashboard:cache')
  res.json({ ok: true, message: 'All cost data reset' })
}

export default withTenant(handler)
