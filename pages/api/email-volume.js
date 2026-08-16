import { requireRole } from '../../lib/portalAuth'
import { getEmailVolume } from '../../lib/crmEmailVolume'

// GET -> { volume: { "edita@rockroofing.co.uk": { "2026-08": 143 } } }
export default async function handler(req, res) {
  if (!requireRole(req, res, ['pre-contract', 'management', 'admin'])) return
  const volume = await getEmailVolume()
  return res.status(200).json({ volume })
}
