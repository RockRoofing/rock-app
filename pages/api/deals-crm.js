import { requireRole } from '../../lib/portalAuth'
import { get } from '../../lib/db'
import { crmDealsToFlat } from '../../lib/crmDashboardAdapter'
import { getMilestones } from '../../lib/crmMilestones'

// PARALLEL / COMPARISON endpoint. Same output shape as /api/deals, but sourced
// from the CRM (crm:deals) via the adapter instead of the Pipedrive sync cache.
// Used by the /sales-crm comparison page. The original /api/deals is untouched.
export default async function handler(req, res) {
  if (!requireRole(req, res, ['pre-contract','post-contract','management','admin'])) return;
  const crmDeals = await get('crm:deals') || []
  // Received dates and project scores. Not fields on the deal - see lib/crmMilestones.
  const milestones = await getMilestones(crmDeals)
  const deals = crmDealsToFlat(crmDeals, milestones)

  const lightweight = deals.map(d => ({
    id: d.id,
    title: d.title,
    value: d.value,
    status: d.status,
    createdDate: d.createdDate,
    closeTime: d.closeTime,
    wonTime: d.wonTime,
    lostTime: d.lostTime,
    organizationName: d.organizationName,
    salesPerson: d.salesPerson,
    ownerName: d.ownerName,
    estimator: d.estimator,
    projectStage: d.projectStage,
    customerType: d.customerType,
    leadSource: d.leadSource,
    systemPriced: d.systemPriced,
    projectType: d.projectType,
    region: d.region,
    lostReason: d.lostReason,
    stageName: d.stageName,
    over200k: d.over200k,
    wonCount: d.wonCount || 0,
    firstContactDate: d.firstContactDate || null,
    everIn1stContact: d.everIn1stContact || false,
    receivedDate: d.receivedDate || null,
    everInReceived: d.everInReceived || false,
    roofingWorksOnSite: d.roofingWorksOnSite || null,
    label: d.label || null,
  }))

  // lastSync is deliberately null. It used to return pipedrive:last_sync, which was the
  // last Pipedrive pull - meaningless on a page that reads the CRM, and the only remaining
  // Pipedrive read on this endpoint. The CRM is edited live; there is no sync to report.
  return res.status(200).json({ deals: lightweight, lastSync: null })
}
