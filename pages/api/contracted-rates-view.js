import { getProject } from '../../lib/db'
import { computeRateTotals } from '../../lib/contractRatesParser'

// Read-only view of a project's contracted rates, for the Site App (CM view).
// GET only, no writes. The Site App gates project access on its own side
// (useMyProjects / canAccessProject); this endpoint never mutates anything, so
// it is safe to expose without a portal role. All editing goes through the
// role-guarded /api/contracted-rates endpoint.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const { projectId } = req.query
  if (!projectId) return res.status(400).json({ error: 'projectId required' })
  try {
    const project = (await getProject(projectId)) || {}
    const cr = project.contractedRates || null
    // Variations for the operative Schedule of Works — NON-FINANCIAL fields only
    // (no materials/labour/profit/value). VO number, description, item, qty, unit
    // and instructed status.
    const variations = (project.variations || []).map(v => ({
      varNumber: v.varNumber || '',
      description: v.description || v.descriptionFull || '',
      item: v.item || v.itemNo || '',
      qty: v.qty != null ? v.qty : '',
      unit: v.unit || '',
      instructed: !!v.instructed,
    }))
    if (!cr) return res.json({ contractedRates: null, variations })
    return res.json({
      contractedRates: {
        items: cr.items || [],
        locked: !!cr.locked,
        fileName: cr.fileName || '',
        savedAt: cr.savedAt || cr.uploadedAt || null,
        totals: computeRateTotals(cr.items || []),
      },
      variations,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
