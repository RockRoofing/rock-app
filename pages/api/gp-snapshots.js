import { requireRole } from '../../lib/portalAuth'
import { getGpSnapshots } from '../../lib/crmGpSnapshots'

export default async function handler(req, res) {
  if (!requireRole(req, res, ['pre-contract', 'management', 'admin'])) return
  return res.status(200).json({ snapshots: await getGpSnapshots() })
}
