import { getTokens, saveTokens, getProject, getEffectiveValuationDate } from '../../../lib/db'
import { refreshXeroToken, getProjectsFromCategories } from '../../../lib/xero'

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
  const { id } = req.query

  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'Not connected to Xero' })

    try {
      const newTokens = await refreshXeroToken(tokens.refresh_token)
      tokens = { ...tokens, ...newTokens }
      await saveTokens(tokens)
    } catch (e) {
      console.error('Token refresh failed:', e.message)
    }

    const tenantId = tokens.tenant_id
    if (!tenantId) return res.status(500).json({ error: 'No tenant ID' })

    const redis = await getRedis()

    // Get project identity — try dashboard cache first, then Xero API
    let cp = null

    if (redis) {
      try {
        const cached = await redis.get('dashboard:cache')
        if (cached && Array.isArray(cached)) {
          const found = cached.find(p => p.xeroId === id || p.trackingOptionId === id)
          if (found) {
            cp = {
              trackingOptionId: id,
              name: found.name,
              jobNo: found.jobNo,
              status: found.status === 'CLOSED' ? 'ARCHIVED' : 'ACTIVE',
              trackingCategoryId: found.trackingCategoryId
            }
          }
        }
      } catch (e) {
        console.error('Cache lookup failed:', e.message)
      }
    }

    // Fallback: fetch tracking categories from Xero
    if (!cp) {
      try {
        const categoryProjects = await getProjectsFromCategories(tokens.access_token, tenantId)
        const found = categoryProjects.find(p => p.trackingOptionId === id)
        if (found) cp = found
      } catch (e) {
        console.error('Xero category lookup failed:', e.message)
      }
    }

    if (!cp) return res.status(404).json({ error: 'Project not found' })

    const settings = await getProject(id) || {}
    const vDate = getEffectiveValuationDate(settings)

    // Read costs from Redis cache
    let labourSpend = 0
    let materialsSpend = 0
    let costLines = []

    if (redis) {
      try {
        const costCache = await redis.get(`costs:latest:${id}`)
        if (costCache) {
          labourSpend = costCache.labourSpend || 0
          materialsSpend = costCache.materialsSpend || 0
        }
        const lines = await redis.get(`costs:lines:${id}`)
        if (lines) costLines = lines
      } catch {}
    }

    // Post-valuation costs
    let costsAfterDate = 0
    let postValCostLines = []

    if (vDate) {
      const vDateStr = vDate.toISOString().split('T')[0]
      postValCostLines = costLines.filter(l => l.date && l.date > vDateStr)
      costsAfterDate = postValCostLines.reduce((s, l) => s + (l.amount || 0), 0)
    }

    // Read invoices from Redis cache
    let invoices = []
    let totalInvoiced = 0

    if (redis) {
      try {
        const invoiceCache = await redis.get(`invoiced:latest:${id}`)
        if (invoiceCache) totalInvoiced = invoiceCache.totalInvoiced || 0
        const invoiceLines = await redis.get(`invoiced:lines:${id}`)
        if (invoiceLines) invoices = invoiceLines
      } catch {}
    }

    // Calculations
    const contractValue = parseFloat(settings.contractValue || 0)
    const instructedVars = (settings.variations || [])
      .filter(v => v.instructed)
      .reduce((s, v) => s + (parseFloat(v.materials || 0) + parseFloat(v.labour || 0) + parseFloat(v.profit || 0)), 0)
    const afa = contractValue + instructedVars

    const retPct = parseFloat(settings.retentionPct || 0)
    const totalRetention = retPct > 0 ? totalInvoiced * retPct / (1 - retPct) : 0
    const now = new Date()
    const pc1 = settings.pcDate ? new Date(settings.pcDate) : null
    const pc2 = settings.defectsDate ? new Date(settings.defectsDate) : null
    const retentionReleased = (pc1 && pc1 <= now ? totalRetention / 2 : 0) + (pc2 && pc2 <= now ? totalRetention / 2 : 0)
    const retentionOutstanding = totalRetention - retentionReleased
    const grossInvoiced = totalInvoiced + retentionOutstanding

    const currentMargin = grossInvoiced > 0 ? (grossInvoiced - (labourSpend + materialsSpend)) / grossInvoiced : null
    const effectiveMargin = settings.wipMarginOverride
      ? parseFloat(settings.wipMarginOverride) / 100
      : currentMargin
    const remainingToClaim = afa - totalInvoiced

    const wip = effectiveMargin != null && effectiveMargin < 1 && costsAfterDate > 0
      ? costsAfterDate / (1 - effectiveMargin)
      : 0

    res.json({
      costLines,
      invoiceLines: invoices,
      project: {
        xeroId: id,
        trackingOptionId: id,
        jobNo: cp.jobNo,
        name: cp.name,
        status: cp.status === 'ARCHIVED' ? 'CLOSED' : 'INPROGRESS',
        customer: settings.customerName || '',
        costs: postValCostLines,
        invoices,
        calculated: {
          totalCosts: labourSpend + materialsSpend,
          labourSpend,
          materialsSpend,
          costsAfterDate,
          totalInvoiced,
          afa,
          currentMargin,
          effectiveMargin,
          remainingToClaim,
          retentionOutstanding,
          grossInvoiced,
          wip,
          wipMarginOverride: settings.wipMarginOverride || null
        }
      },
      settings
    })
  } catch (e) {
    console.error('Project API error:', e)
    res.status(500).json({ error: e.message })
  }
}
