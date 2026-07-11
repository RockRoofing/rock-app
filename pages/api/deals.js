import { requireRole } from '../../lib/portalAuth'
import { getCachedDeals, getLastSync } from '../../lib/db'

export default async function handler(req, res) {
  if (!requireRole(req, res, ['pre-contract','post-contract','management','admin'])) return;
  const deals = await getCachedDeals() || []
  const lastSync = await getLastSync()

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

  return res.status(200).json({ deals: lightweight, lastSync })
}
