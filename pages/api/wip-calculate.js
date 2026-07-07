import { getTokens, saveTokens, getAllProjectSettings } from '../../lib/db'
import { refreshXeroToken, getProjectsFromCategories, fetchBillsByCategory, fetchLabourJournalsByCategory } from '../../lib/xero'

export const config = {
  maxDuration: 300
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { month } = req.body
  if (!month) return res.status(400).json({ error: 'month required' })

  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'No tokens' })
    const newTokens = await refreshXeroToken(tokens.refresh_token)
    tokens = { ...tokens, ...newTokens }
    await saveTokens(tokens)

    const tenantId = tokens.tenant_id
    const categoryProjects = await getProjectsFromCategories(tokens.access_token, tenantId)
    const allSettings = await getAllProjectSettings()

    const [year, monthNum] = month.split('-').map(Number)
    const wipEndDate = new Date(year, monthNum, 0)

    const results = {}

    for (const cp of categoryProjects) {
      const projectId = cp.trackingOptionId
      const settings = allSettings[projectId] || allSettings[cp.jobNo] || {}

      const valuationDay = parseInt(settings.valuationDay || 0)
      if (!valuationDay) continue

      const vDate = new Date(year, monthNum - 1, valuationDay)

      const farPast = new Date(2020, 0, 1)
      let costsToValuationDate = 0
      try {
        const { total: billsTotal } = await fetchBillsByCategory(
          tokens.access_token, tenantId, projectId, farPast, vDate
        )
        costsToValuationDate += billsTotal
      } catch (e) {
        console.error(`Bills to valuation failed for ${cp.jobNo}:`, e.message)
      }
      try {
        const { total: labourTotal } = await fetchLabourJournalsByCategory(
          tokens.access_token, tenantId, projectId, farPast, vDate
        )
        costsToValuationDate += labourTotal
      } catch (e) {
        console.error(`Labour journals to valuation failed for ${cp.jobNo}:`, e.message)
      }

      await new Promise(r => setTimeout(r, 200))

      const invoiceCache = null
      const totalInvoiced = invoiceCache?.totalInvoiced || 0
      const retPct = parseFloat(settings.retentionPct || 0)
      const retentionOutstanding = retPct > 0 ? totalInvoiced * retPct / (1 - retPct) : 0
      const grossInvoiced = totalInvoiced + retentionOutstanding

      const marginAtValuationDate = grossInvoiced > 0
        ? (grossInvoiced - costsToValuationDate) / grossInvoiced
        : null

      const effectiveMargin = settings.wipMarginOverride
        ? parseFloat(settings.wipMarginOverride) / 100
        : marginAtValuationDate

      let costsAfterDate = 0
      try {
        const { total: billsTotal } = await fetchBillsByCategory(
          tokens.access_token, tenantId, projectId, vDate, wipEndDate
        )
        costsAfterDate += billsTotal
      } catch (e) {
        console.error(`Post-val bills failed for ${cp.jobNo}:`, e.message)
      }
      try {
        const { total: labourTotal } = await fetchLabourJournalsByCategory(
          tokens.access_token, tenantId, projectId, vDate, wipEndDate
        )
        costsAfterDate += labourTotal
      } catch (e) {
        console.error(`Post-val labour journals failed for ${cp.jobNo}:`, e.message)
      }

      await new Promise(r => setTimeout(r, 200))

      const wip = effectiveMargin != null && effectiveMargin < 1 && costsAfterDate > 0
        ? costsAfterDate / (1 - effectiveMargin)
        : 0

      results[projectId] = {
        wip,
        costsAfterDate,
        costsToValuationDate,
        effectiveMargin,
        marginAtValuationDate,
        totalInvoiced,
        grossInvoiced,
        vDate: vDate.toISOString(),
        wipEndDate: wipEndDate.toISOString()
      }
    }

    res.json({ ok: true, month, results })

  } catch (e) {
    console.error('WIP calculate error:', e)
    res.status(500).json({ error: e.message })
  }
}
