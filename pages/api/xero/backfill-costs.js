import { getTokens, saveTokens } from '../../../lib/db'
import { refreshXeroToken, getProjectsFromCategories } from '../../../lib/xero'

export const config = {
  maxDuration: 300
}

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

const LABOUR_ACCOUNTS = ['321']
const COST_OF_SALE_ACCOUNTS = ['321', '322', '310', '311', '331', '330', '329', '333', '334', '335', '336']
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export default async function handler(req, res) {
  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'No tokens' })
    const newTokens = await refreshXeroToken(tokens.refresh_token)
    tokens = { ...tokens, ...newTokens }
    await saveTokens(tokens)

    const redis = await getRedis()
    if (!redis) return res.status(500).json({ error: 'No Redis' })

    const tenantId = tokens.tenant_id
    const categoryProjects = await getProjectsFromCategories(tokens.access_token, tenantId)
    const j228 = categoryProjects.find(p => p.jobNo === 'J228')
    if (!j228) return res.status(404).json({ error: 'J228 not found' })

    const trackingOptionId = j228.trackingOptionId
    const fromDate = '2022-01-01' // 3 years back
    const now = new Date()

    let totalScanned = 0
    let j228BillIds = []
    let labourTotal = 0
    let materialsTotal = 0
    const costLines = []
    let page = 1

    // Step 1: Collect all bill IDs from last 3 years
    while (true) {
      const r = await fetch(
        `https://api.xero.com/api.xro/2.0/Invoices?Type=ACCPAY&page=${page}&pageSize=100&DateFrom=${fromDate}`,
        {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            'Xero-Tenant-Id': tenantId,
            Accept: 'application/json'
          }
        }
      )
      if (!r.ok) break
      const data = await r.json()
      const invoices = data.Invoices || []
      if (invoices.length === 0) break
      for (const inv of invoices) j228BillIds.push(inv.InvoiceID)
      totalScanned += invoices.length
      if (invoices.length < 100) break
      page++
      await sleep(300)
    }

    // Step 2: Fetch each individually to check tracking
    let j228Count = 0
    for (const invoiceId of j228BillIds) {
      await sleep(80)
      const r = await fetch(
        `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}`,
        {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            'Xero-Tenant-Id': tenantId,
            Accept: 'application/json'
          }
        }
      )
      if (!r.ok) continue
      const data = await r.json()
      const inv = (data.Invoices || [])[0]
      if (!inv) continue

      const matchedLines = (inv.LineItems || []).filter(line =>
        (line.Tracking || []).some(t => t.TrackingOptionID === trackingOptionId)
      )
      if (matchedLines.length === 0) continue
      j228Count++

      for (const line of matchedLines) {
        if (!COST_OF_SALE_ACCOUNTS.includes(line.AccountCode)) continue
        const amount = line.LineAmount || 0
        const isLabour = LABOUR_ACCOUNTS.includes(line.AccountCode)
        if (isLabour) labourTotal += amount
        else materialsTotal += amount
        costLines.push({
          date: inv.DateString,
          supplier: inv.Contact?.Name || '',
          description: line.Description || '',
          amount,
          accountCode: line.AccountCode,
          type: isLabour ? 'Labour' : 'Materials'
        })
      }
    }

    // Step 3: Save to Redis
    const costData = {
      labourSpend: labourTotal,
      materialsSpend: materialsTotal,
      totalCosts: labourTotal + materialsTotal,
      lastSyncDate: now.toISOString(),
      calculatedAt: now.toISOString()
    }
    await redis.set(`costs:latest:${trackingOptionId}`, costData)
    await redis.set(`costs:lines:${trackingOptionId}`, costLines)
    await redis.set('backfill:lastSync', now.toISOString())
    await redis.del('dashboard:cache')

    res.json({
      ok: true,
      totalScanned,
      j228Bills: j228Count,
      labourTotal,
      materialsTotal,
      totalCosts: labourTotal + materialsTotal,
      timeTaken: `${((Date.now() - now.getTime()) / 1000).toFixed(1)}s`
    })
  } catch (e) {
    console.error('Backfill error:', e)
    res.status(500).json({ error: e.message })
  }
}
