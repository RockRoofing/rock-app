import { requireRole } from '../../lib/portalAuth'
import {
  getAllCrmValueChanges, getStoredValueChanges, saveStoredValueChanges, seedFromLegacy,
} from '../../lib/crmValueChanges'

// PARALLEL endpoint. Same output shape as /api/value-changes, but derived from the CRM's
// own deal history instead of the Pipedrive webhook. The original is untouched.
//
//   GET                      -> { changes }
//   POST { action:'seed' }   -> copy the Pipedrive-era records into the CRM store, once
//   POST { dealId, ... }     -> add a record by hand
//   DELETE { id }            -> remove one (hand-made records only)
export default async function handler(req, res) {
  if (!requireRole(req, res, ['pre-contract', 'post-contract', 'management', 'admin'])) return

  if (req.method === 'GET') {
    const changes = await getAllCrmValueChanges()
    return res.status(200).json({ changes })
  }

  if (req.method === 'POST') {
    if (req.body && req.body.action === 'seed') {
      const out = await seedFromLegacy()
      return res.status(200).json(out)
    }

    const { dealId, dealTitle, organizationName, oldValue, newValue, changeDate, estimator, notes } = req.body || {}
    if (!dealId || newValue == null) return res.status(400).json({ error: 'Missing fields' })

    const stored = await getStoredValueChanges()
    const entry = {
      id: `manual-${dealId}-${Date.now()}`,
      type: 'value_change',
      dealId: String(dealId),
      dealTitle: dealTitle || '',
      organizationName: organizationName || '',
      oldValue: oldValue || 0,
      newValue,
      valueChange: newValue - (oldValue || 0),
      changeDate: changeDate || new Date().toISOString().split('T')[0],
      estimator: estimator || '',
      notes: notes || '',
      createdAt: new Date().toISOString(),
      source: 'manual',
    }
    await saveStoredValueChanges([...stored, entry])
    return res.status(200).json({ success: true, entry })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id required' })
    const stored = await getStoredValueChanges()
    // Derived records are computed from the deal, not stored, so there is nothing to
    // delete - change the deal instead. Say so rather than failing silently.
    if (!stored.some((e) => e.id === id)) {
      return res.status(400).json({ error: 'That record comes from the deal history and cannot be deleted here. Edit the deal instead.' })
    }
    await saveStoredValueChanges(stored.filter((e) => e.id !== id))
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
