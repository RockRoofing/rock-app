import { getAllProjectSettings } from '../../lib/db'
import { getProjectsFromCategories } from '../../lib/xero'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken } from '../../lib/xero'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

// Calculate valuation date for a given month key (YYYY-MM) and valuation day
function getValuationDateForMonth(monthKey, valuationDay) {
  if (!valuationDay || !monthKey) return null
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, parseInt(valuationDay)))
}

export default async function handler(req, res) {
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  // Try cache first unless sync=true
  if (req.query.sync !== 'true') {
    try {
      const cached = await redis.get('dashboard:cache')
      if (cached) return res.json({ projects: cached })
    } catch {}
  }

  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'Not connected to Xero' })
    try {
      const newTokens = await refreshXeroToken(tokens.refresh_token)
      tokens = { ...tokens, ...newTokens }
      await saveTokens(tokens)
    } catch {}

    const categoryProjects = await getProjectsFromCategories(tokens.access_token, tokens.tenant_id)
    const allSettings = await getAllProjectSettings()

    const projects = await Promise.all(categoryProjects.map(async (cp) => {
      const id = cp.trackingOptionId
      const settings = allSettings[id] || allSettings[cp.jobNo] || {}

      // ── Read all-time cost totals from Redis ──────────────────────────────
      let labourSpend = 0, materialsSpend = 0, totalCosts = 0
      let costLines = []
      try {
        const costCache = await redis.get(`costs:latest:${id}`)
        if (costCache) {
          labourSpend = costCache.labourSpend || 0
          materialsSpend = costCache.materialsSpend || 0
          totalCosts = costCache.totalCosts || (labourSpend + materialsSpend)
        }
        const lines = await redis.get(`costs:lines:${id}`)
        if (lines) costLines = lines
      } catch {}

      // ── Read invoice lines from Redis ─────────────────────────────────────
      let totalInvoiced = 0, invoiceLines = []
      let invoicedExVat = 0, vatTotal = 0, paidTotal = 0, vatRateLabel = '—'
      try {
        const invCache = await redis.get(`invoiced:latest:${id}`)
        if (invCache) {
          totalInvoiced = invCache.totalInvoiced || 0
          invoicedExVat = invCache.invoicedExVat || 0
          vatTotal = invCache.vatTotal || 0
          paidTotal = invCache.paidTotal || 0
          vatRateLabel = invCache.vatRateLabel || '—'
        }
        const lines = await redis.get(`invoiced:lines:${id}`)
        if (lines) invoiceLines = lines
      } catch {}

      // Resilient fallback: if the aggregate cache predates the VAT/paid fields,
      // derive them from the per-invoice lines (which carry total/subTotal/
      // totalTax/amountPaid). This means values appear even before a full re-sync.
      if (invoiceLines.length) {
        if (!paidTotal) paidTotal = invoiceLines.reduce((s, l) => s + (l.amountPaid || 0), 0)
        if (!vatTotal) vatTotal = invoiceLines.reduce((s, l) => s + (l.totalTax || 0), 0)
        if (!invoicedExVat) invoicedExVat = invoiceLines.reduce((s, l) => s + (l.subTotal || 0), 0)
        if (!totalInvoiced) totalInvoiced = invoiceLines.reduce((s, l) => s + (l.total || 0), 0)
        if (vatRateLabel === '—') {
          const labels = [...new Set(invoiceLines.map(l => l.vatLabel).filter(x => x && x !== '—'))]
          if (labels.length === 1) vatRateLabel = labels[0]
          else if (labels.length > 1) vatRateLabel = 'Mixed'
          else {
            const net = invoicedExVat, tax = vatTotal
            if (net > 0 && tax > 0) vatRateLabel = `${Math.round((tax / net) * 100)}%`
            else if (net > 0 && tax === 0) vatRateLabel = '0%'
          }
        }
      }

      // Last invoice date
      const lastInvoiceDate = invoiceLines.length > 0
        ? invoiceLines.reduce((latest, inv) => inv.date > latest ? inv.date : latest, invoiceLines[0].date)
        : null

      // Payment status
      const allPaid = invoiceLines.length > 0 && invoiceLines.every(inv => (inv.amountDue || 0) === 0)
      const amountOutstanding = invoiceLines.reduce((s, inv) => s + (inv.amountDue || 0), 0)

      // ── Contract / AFA ────────────────────────────────────────────────────
      const contractValue = parseFloat(settings.contractValue || 0)
      const instructedVars = (settings.variations || [])
        .filter(v => v.instructed)
        .reduce((s, v) => s + (parseFloat(v.materials || 0) + parseFloat(v.labour || 0) + parseFloat(v.profit || 0)), 0)
      const afa = contractValue + instructedVars

      // ── Retention (all-time) ──────────────────────────────────────────────
      const retPct = parseFloat(settings.retentionPct || 0)
      const totalRetention = retPct > 0 ? totalInvoiced * retPct / (1 - retPct) : 0
      const now = new Date()
      const pc1 = settings.pcDate ? new Date(settings.pcDate) : null
      const pc2 = settings.defectsDate ? new Date(settings.defectsDate) : null
      const retentionReleased = (pc1 && pc1 <= now ? totalRetention / 2 : 0) + (pc2 && pc2 <= now ? totalRetention / 2 : 0)
      const retentionOutstanding = totalRetention - retentionReleased
      const grossInvoiced = totalInvoiced + retentionOutstanding
      const currentMargin = grossInvoiced > 0 ? (grossInvoiced - totalCosts) / grossInvoiced : null
      const remainingToClaim = afa - totalInvoiced

      // ── Budgets (inc. instructed variations) ─────────────────────────────
      const labourBudget = parseFloat(settings.labourBudget || 0) +
        (settings.variations || []).filter(v => v.instructed).reduce((s, v) => s + parseFloat(v.labour || 0), 0)
      const materialsBudget = parseFloat(settings.materialsBudget || 0) +
        (settings.variations || []).filter(v => v.instructed).reduce((s, v) => s + parseFloat(v.materials || 0), 0)
      const totalBudget = labourBudget + materialsBudget

      // ── WIP ───────────────────────────────────────────────────────────────
      let wip = 0, wipMarginOverride = settings.wipMarginOverride || null
      try {
        const wipCache = await redis.get(`wip:latest:${id}`)
        if (wipCache) wip = wipCache.wip || 0
      } catch {}

      // ── Comment ───────────────────────────────────────────────────────────
      let comment = ''
      try {
        const c = await redis.get(`comment:${id}`)
        if (c) comment = c
      } catch {}

      // ── Project stage ─────────────────────────────────────────────────────
      let stage = 'INPROGRESS'
      if (afa > 0 && totalInvoiced >= afa * 0.999 && allPaid) {
        stage = 'CLOSED'
      } else if (afa > 0 && remainingToClaim <= retentionOutstanding + 1) {
        stage = 'DEFECTS'
      }

      return {
        xeroId: id,
        trackingOptionId: id,
        trackingCategoryId: cp.trackingCategoryId,
        jobNo: cp.jobNo,
        name: cp.name,
        status: stage,
        customer: settings.customerName || '',
        contractsManager: settings.contractsManager || '',
        estimator: settings.estimator || '',
        qsName: settings.qsName || '',
        qsEmail: settings.qsEmail || '',
        highRisk: settings.highRiskCustomer === true,
        pcDate: settings.pcDate || '',
        defectsDate: settings.defectsDate || '',
        completionDate: settings.completionDate || settings.pcDate || '',
        retentionComments: settings.retentionComments || '',
        variations: settings.variations || [],
        applicationDay: settings.applicationDay || null,
        paymentDay: settings.paymentDay || null,
        dateOverrides: settings.dateOverrides || {},
        valuationDay: settings.valuationDay || null,
        contractValue,
        afa,
        // All-time figures
        totalInvoiced,
        invoicedExVat,
        vat: vatTotal,
        paid: paidTotal,
        vatRateLabel,
        remainingToClaim,
        totalCosts,
        labourSpend,
        materialsSpend,
        totalBudget,
        labourBudget,
        materialsBudget,
        retentionOutstanding,
        grossInvoiced,
        currentMargin,
        wip,
        wipMarginOverride,
        allPaid,
        amountOutstanding,
        lastInvoiceDate,
        retentionPct: parseFloat(settings.retentionPct || 0),
        comment,
        // Raw lines for EOM calculations on the frontend
        _costLines: costLines,
        _invoiceLines: invoiceLines,
      }
    }))

    // Append a pseudo-project holding invoices that had no Projects tag in Xero,
    // so they surface (e.g. in Outstanding Invoices) rather than disappearing.
    try {
      const unLines = await redis.get('invoiced:lines:__UNASSIGNED__')
      if (Array.isArray(unLines) && unLines.length) {
        const totalInvoiced = unLines.reduce((s, l) => s + (l.total || 0), 0)
        const paidTotal = unLines.reduce((s, l) => s + (l.amountPaid || 0), 0)
        const dueTotal = unLines.reduce((s, l) => s + (l.amountDue || 0), 0)
        projects.push({
          id: '__UNASSIGNED__',
          jobNo: '',
          name: 'Unassigned (no project tag in Xero)',
          projectName: 'Unassigned (no project tag in Xero)',
          unassigned: true,
          totalInvoiced,
          allPaid: paidTotal,
          amountOutstanding: dueTotal,
          _costLines: [],
          _invoiceLines: unLines,
        })
      }
    } catch {}

    await redis.set('dashboard:cache', projects, { ex: 60 * 60 * 4 })
    res.json({ projects })

  } catch (e) {
    console.error('Dashboard error:', e)
    res.status(500).json({ error: e.message })
  }
}
