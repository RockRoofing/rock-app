import { getTokens, saveTokens } from '../../../lib/db'
import { refreshXeroToken, fetchAllCostBills, extractJobNoFromDescription, LABOUR_ACCOUNTS, COST_OF_SALE_ACCOUNTS } from '../../../lib/xero'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'No tokens stored' })
    const newTokens = await refreshXeroToken(tokens.refresh_token)
    tokens = { ...tokens, ...newTokens }
    await saveTokens(tokens)

    const tenantId = tokens.tenant_id
    const redis = await getRedis()

    // Get last sync date
    const lastSyncDate = redis ? await redis.get('sync:lastDate') : null
    const fromDate = lastSyncDate || (() => {
      const d = new Date()
      d.setDate(d.getDate() - 30)
      return d.toISOString().split('T')[0]
    })()

    // Always fetch all unpaid bills fresh
    const unpaidBills = await fetchAllCostBills(tokens.access_token, tenantId, 'AUTHORISED')
    // Only fetch paid bills since last sync
    const paidBills = await fetchAllCostBills(tokens.access_token, tenantId, 'PAID', fromDate)
    const allBills = [...paidBills, ...unpaidBills]

    // Load already processed invoice numbers (from uploads AND previous syncs)
    const processedInvoices = (redis ? await redis.get('uploaded:invoices') : null) || {}

    const labourByJob = {}
    const materialsByJob = {}
    const newInvoiceNumbers = {}
    let skipped = 0

    for (const inv of allBills) {
      const invoiceNo = inv.InvoiceNumber
      if (invoiceNo && processedInvoices[invoiceNo]) {
        skipped++
        continue
      }
      if (invoiceNo) newInvoiceNumbers[invoiceNo] = true

      for (const line of inv.LineItems || []) {
        if (!COST_OF_SALE_ACCOUNTS.includes(line.AccountCode)) continue
        const jobNo = extractJobNoFromDescription(line.Description)
        if (!jobNo) continue
        const amount = line.LineAmount || 0
        if (LABOUR_ACCOUNTS.includes(line.AccountCode)) {
          labourByJob[jobNo] = (labourByJob[jobNo] || 0) + amount
        } else {
          materialsByJob[jobNo] = (materialsByJob[jobNo] || 0) + amount
        }
      }
    }

    if (redis) {
      const existingLabour = await redis.get('costs:labour') || {}
      const existingMaterials = await redis.get('costs:materials') || {}

      const mergedLabour = { ...existingLabour }
      const mergedMaterials = { ...existingMaterials }

      for (const [job, amount] of Object.entries(labourByJob)) {
        mergedLabour[job] = (mergedLabour[job] || 0) + amount
      }
      for (const [job, amount] of Object.entries(materialsByJob)) {
        mergedMaterials[job] = (mergedMaterials[job] || 0) + amount
      }

      await redis.set('costs:labour', mergedLabour)
      await redis.set('costs:materials', mergedMaterials)
      await redis.set('uploaded:invoices', { ...processedInvoices, ...newInvoiceNumbers })
      await redis.set('sync:lastDate', new Date().toISOString().split('T')[0])
      await redis.del('dashboard:cache')
    }

    res.json({
      ok: true,
      billsProcessed: allBills.length,
      skippedDuplicates: skipped,
      jobsWithLabour: Object.keys(labourByJob).length,
      jobsWithMaterials: Object.keys(materialsByJob).length,
      fromDate
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
