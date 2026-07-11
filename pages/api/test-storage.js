import { requireRole } from '../../lib/portalAuth'
import { get } from '../../lib/db'

export default async function handler(req, res) {
  if (!requireRole(req, res, ['admin'])) return;
  try {
    // Try both key formats
    const withUnderscore = await get('value_changes_all')
    const withColon = await get('value_changes:all')
    const pipedrive = await get('pipedrive_deals')
    const pipedriveColon = await get('pipedrive:deals')
    
    return res.status(200).json({
      value_changes_all: withUnderscore ? `found (${Array.isArray(withUnderscore) ? withUnderscore.length : 'not array'} items)` : 'empty',
      'value_changes:all': withColon ? `found (${Array.isArray(withColon) ? withColon.length : 'not array'} items)` : 'empty',
      pipedrive_deals: pipedrive ? `found (${Array.isArray(pipedrive) ? pipedrive.length : 'not array'} items)` : 'empty',
      'pipedrive:deals': pipedriveColon ? `found (${Array.isArray(pipedriveColon) ? pipedriveColon.length : 'not array'} items)` : 'empty',
    })
  } catch(e) {
    return res.status(200).json({ error: e.message })
  }
}
