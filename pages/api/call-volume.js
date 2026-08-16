import { requireRole } from '../../lib/portalAuth'
import { getCallVolume } from '../../lib/crm8x8'

export default async function handler(req, res) {
  if (!requireRole(req, res, ['pre-contract', 'management', 'admin'])) return
  return res.status(200).json({ volume: await getCallVolume() })
}
