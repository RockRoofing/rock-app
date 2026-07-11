import { requireRole } from '../../lib/portalAuth'
import { getCachedDeals } from '../../lib/db'

// Returns all Pipedrive deals currently sitting in the Negotiating stage.
// Source: the cached, normalised deals kept up to date by the Pipedrive
// sync/webhook (same data the Sales dashboard uses) — no extra API calls.
//
// GET /api/negotiating -> { deals: [...], count, totalValue }
export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract','management','admin'])) return;
  try {
    const all = (await getCachedDeals()) || []
    const deals = all
      .filter(d => d.stageName === 'Negotiating' && d.status === 'open')
      .map(d => ({
        id: d.id,
        title: d.title,
        value: d.value || 0,
        currency: d.currency || 'GBP',
        organizationName: d.organizationName || '',
        systemPriced: d.systemPriced || '',
        roofingWorksOnSite: d.roofingWorksOnSite || null,
        expectedCloseDate: d.expectedCloseDate || null,
        ownerName: d.ownerName || '',
        salesPerson: d.salesPerson || '',
        estimator: d.estimator || '',
        region: d.region || '',
        projectType: d.projectType || '',
        siteLocation: d.siteLocation || '',
        sizeM2: d.sizeM2 || null,
        creditScore: d.creditScore || null,
        creditLimit: d.creditLimit || null,
        insuredCreditLimit: d.insuredCreditLimit || null,
        scopeOfWorks: d.scopeOfWorks || '',
      }))
      // Soonest on-site date first; nulls last.
      .sort((a, b) => {
        if (!a.roofingWorksOnSite) return 1
        if (!b.roofingWorksOnSite) return -1
        return new Date(a.roofingWorksOnSite) - new Date(b.roofingWorksOnSite)
      })

    const totalValue = deals.reduce((s, d) => s + (d.value || 0), 0)
    return res.json({ deals, count: deals.length, totalValue })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
