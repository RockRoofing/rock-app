import { getTokens, saveTokens, getAllProjectSettings, getEffectiveValuationDate, getWipEndDate } from '../../../lib/db'
import { refreshXeroToken, getProjectsFromCategories, fetchBillsByCategory, fetchLabourJournalsByCategory, getInvoicesByCategory } from '../../../lib/xero'

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
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis connection' })

  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'No tokens' })
    const newTokens = await refreshXeroToken(tokens.refresh_token)
    tokens = { ...tokens, ...newTokens }
    await saveTokens(tokens)

    const tenantId = tokens.tenant_id
    const categoryProjects = await getProjectsFromCategories(tokens.access_token, tenantId)
    const allSettings = await getAllProjectSettings()
    const wipEndDate = getWipEndDate()

    const now = new Date()
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const results = []
    let processed = 0
    let skipped = 0

    for (const cp of categoryProjects) {
      if (cp.status === 'ARCHIVED') { skipped++; continue }

      const projectId = cp.trackingOptionId
      const catId = cp.trackingCategoryId
      const settings = allSettings[projectId] || allSettings[cp.jobNo] || {}
      const vDate = getEffectiveValuationDate(settings)

      // ── Sync all-time cost totals ─────────────────────────────────────
      try {
        const farPast = new Date(2020, 0, 1)
        const { labourTotal, materialsTotal, total } = await fetchBillsByCategory(
          tokens.access_token, tenantId, projectId, farPast, null, catId
        )
        const labourJournals = await fetchLabourJournalsByCategory(
          tokens.access_token, tenantId, projectId, farPast, null
        )
        await redis.set(`costs:latest:${projectId}`, {
          labourSpend: labourTotal + labourJournals.total,
          materialsSpend: materialsTotal,
          totalCosts: total + labourJournals.total,
          calculatedAt: now.toISOString()
        })
      } catch (e) {
        console.error(`Cost sync failed for ${cp.jobNo}:`, e.message)
      }

      // ── Sync invoice totals + detail for commercial metrics ─────────
      try {
        const invoices = await getInvoicesByCategory(tokens.access_token, tenantId, projectId, catId)
        const totalInvoiced = invoices.reduce((s, inv) => s + (inv.Total || 0), 0)
        // Ex-VAT invoiced (matches the Final Account basis), VAT, and paid totals.
        const invoicedExVat = invoices.reduce((s, inv) => s + (inv.SubTotal || 0), 0)
        const vatTotal = invoices.reduce((s, inv) => s + (inv.TotalTax || 0), 0)
        const paidTotal = invoices.reduce((s, inv) => s + (inv.AmountPaid || 0), 0)
        const dueTotal = invoices.reduce((s, inv) => s + (inv.AmountDue || 0), 0)
        await redis.set(`invoiced:latest:${projectId}`, {
          totalInvoiced,          // inc VAT (unchanged, for existing consumers)
          invoicedExVat,          // ex VAT — reconciles with Final Account
          vatTotal,               // VAT charged
          paidTotal,              // total received (inc VAT)
          dueTotal,               // total still outstanding (inc VAT)
          invoiceCount: invoices.length,
          calculatedAt: now.toISOString()
        })
        // Cache invoice details for payless notice and payment time calculations
        const invoiceDetails = invoices.map(inv => ({
          invoiceId: inv.InvoiceID,
          invoiceNumber: inv.InvoiceNumber,
          date: inv.DateString || inv.Date,
          dueDate: inv.DueDateString || inv.DueDate,
          total: inv.Total || 0,
          subTotal: inv.SubTotal || 0,
          totalTax: inv.TotalTax || 0,
          amountPaid: inv.AmountPaid || 0,
          amountDue: inv.AmountDue || 0,
          fullyPaidOnDate: inv.FullyPaidOnDate || null,
          status: inv.Status,
          hasCreditNote: (inv.CreditNotes || []).length > 0,
          creditNoteTotal: (inv.CreditNotes || []).reduce((s, cn) => s + (cn.Total || 0), 0),
          jobNo: cp.jobNo,
          projectId,
        }))
        await redis.set(`invoiced:lines:${projectId}`, invoiceDetails)
      } catch (e) {
        console.error(`Invoice sync failed for ${cp.jobNo}:`, e.message)
      }

      await new Promise(r => setTimeout(r, 200))

      if (!vDate) { skipped++; continue }

      // ── WIP calculation ───────────────────────────────────────────────
      const farPast = new Date(2020, 0, 1)
      let costsToValuationDate = 0
      try {
        const { total: b } = await fetchBillsByCategory(tokens.access_token, tenantId, projectId, farPast, vDate, catId)
        costsToValuationDate += b
      } catch (e) { console.error(`Bills to val failed ${cp.jobNo}:`, e.message) }
      try {
        const { total: l } = await fetchLabourJournalsByCategory(tokens.access_token, tenantId, projectId, farPast, vDate)
        costsToValuationDate += l
      } catch (e) { console.error(`Labour to val failed ${cp.jobNo}:`, e.message) }

      await new Promise(r => setTimeout(r, 200))

      const invoiceCacheEntry = await redis.get(`invoiced:latest:${projectId}`)
      const totalInvoiced = invoiceCacheEntry?.totalInvoiced || 0
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
        const { total: b } = await fetchBillsByCategory(tokens.access_token, tenantId, projectId, vDate, wipEndDate, catId)
        costsAfterDate += b
      } catch (e) { console.error(`Post-val bills failed ${cp.jobNo}:`, e.message) }
      try {
        const { total: l } = await fetchLabourJournalsByCategory(tokens.access_token, tenantId, projectId, vDate, wipEndDate)
        costsAfterDate += l
      } catch (e) { console.error(`Post-val labour failed ${cp.jobNo}:`, e.message) }

      await new Promise(r => setTimeout(r, 200))

      const wip = effectiveMargin != null && effectiveMargin < 1 && costsAfterDate > 0
        ? costsAfterDate / (1 - effectiveMargin)
        : 0

      const wipEntry = {
        wip,
        costsAfterDate,
        costsToValuationDate,
        effectiveMargin,
        marginAtValuationDate,
        totalInvoiced,
        grossInvoiced,
        vDate: vDate.toISOString(),
        wipEndDate: wipEndDate.toISOString(),
        calculatedAt: now.toISOString()
      }

      await redis.set(`wip:latest:${projectId}`, wipEntry)
      await redis.set(`wip:${projectId}:${monthKey}`, wipEntry)

      results.push({ jobNo: cp.jobNo, wip, costsAfterDate, costsToValuationDate, marginAtValuationDate })
      processed++
    }

    await redis.del('dashboard:cache')

    res.json({
      ok: true,
      wipSync: { processed, skipped, monthKey, results }
    })

  } catch (e) {
    console.error('Cron sync error:', e)
    res.status(500).json({ error: e.message })
  }
}
