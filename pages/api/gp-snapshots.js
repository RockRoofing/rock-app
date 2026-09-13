import { requireRole } from '../../lib/portalAuth'
import { getGpSnapshots } from '../../lib/crmGpSnapshots'
import withTenant from '../../lib/withTenant'

async function handler(req, res) {
  if (!requireRole(req, res, ['pre-contract', 'management', 'admin'])) return
  return res.status(200).json({ snapshots: await getGpSnapshots() })
}

export default withTenant(handler)
