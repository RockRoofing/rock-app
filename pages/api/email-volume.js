import { requireRole } from '../../lib/portalAuth'
import { getEmailVolume } from '../../lib/crmEmailVolume'
import withTenant from '../../lib/withTenant'

// GET -> { volume: { "edita@rockroofing.co.uk": { "2026-08": 143 } } }
async function handler(req, res) {
  if (!requireRole(req, res, ['pre-contract', 'management', 'admin'])) return
  const volume = await getEmailVolume()
  return res.status(200).json({ volume })
}

export default withTenant(handler)
