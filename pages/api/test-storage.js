import { requireRole } from '../../lib/portalAuth'
import { get } from '../../lib/db'

// Admin probe: reports what is actually in the CRM's stores.
// It used to probe the Pipedrive keys as well; those are gone.
export default async function handler(req, res) {
  if (!requireRole(req, res, ['admin'])) return;

  const describe = (v) => {
    if (v == null) return 'empty'
    if (Array.isArray(v)) return `found (${v.length} items)`
    if (typeof v === 'object') return `found (${Object.keys(v).length} keys)`
    return 'found'
  }

  try {
    const keys = [
      'crm:deals',
      'crm:value-changes',
      'crm:deal-milestones',
      'crm:emails:unallocated',
      'crm:emails:threads',
      'crm:emails:never',
      'crm:emails:sync-state',
      'scorecard:targets',
      // Kept so the one-off seeds can still find the historical archive.
      'value_changes:all',
    ]
    const out = {}
    for (const k of keys) out[k] = describe(await get(k))
    return res.status(200).json(out)
  } catch (e) {
    return res.status(200).json({ error: e.message })
  }
}
