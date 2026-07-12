import { requireRole } from '../../lib/portalAuth'
import { get, set } from '../../lib/db'

const DEFAULT_TARGETS = {
  commercial: {
    gpMargin: 0.20,
    paylessNotices: 0,
    avgPaymentDays: 30,
    retentionInvoiced: 1,
  },
  estimator: {
    strikeRateOverall: 0.25,
    strikeRateMCSecured: 0.30,
    valuePricedExisting: 300000,
    totalValuePriced: 667000,
    totalValueSecured: 133000,
    dealsSecuredOver200k: 1,
    gpMargin: 0.25,
  },
  sales: {
    gleniganReceived: 6,
    gleniganPriced: 3,
    gleniganScored5: 3,
    websiteReceived: 7,
    websitePriced: 4,
    strikeRateValue: 0.25,
    valuePricedExisting: 800000,
    totalValuePriced: 2000000,
    projectsPricedOver200k: 9,
    totalValueSecured: 400000,
    projectsSecuredOver200k: 3,
  },
  contractsManager: {
    gpMargin: 0.20,
    psnPct: 1,
    hsIncidences: 0,
    wiRockFault: 0,
    procPct: 1,
    issuesOnTimePct: 0.9,
  },
  operationsManager: {
    sosPct: 1,
    diaryPct: 1,
    wahPct: 1,
    toolbox: 1,
    tasksPct: 0.9,
    risksPct: 0.9,
  }
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['pre-contract','post-contract','management','admin'])) return;
  if (req.method === 'GET') {
    const stored = await get('scorecard:targets')
    return res.status(200).json({ targets: stored || DEFAULT_TARGETS })
  }
  if (req.method === 'POST') {
    await set('scorecard:targets', req.body.targets)
    return res.status(200).json({ success: true })
  }
  res.status(405).end()
}
