import { requireRole } from '../../lib/portalAuth'
import { getCachedProjects } from '../../lib/db'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

function parseXeroDate(d) {
  if (!d) return null
  // Xero dates come as /Date(1234567890000+0000)/
  const match = String(d).match(/\d+/)
  if (match) return new Date(parseInt(match[0]))
  return new Date(d)
}

function monthKey(date) {
  const d = parseXeroDate(date)
  if (!d || isNaN(d)) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract','management','admin'])) return;
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  // Save a manual per-month payless (credit-note) count adjustment.
  if (req.method === 'POST') {
    try {
      const { month, adjusted } = req.body || {}
      if (!month) return res.status(400).json({ error: 'month required' })
      const cur = (await redis.get('config:payless-adjustments').catch(() => null)) || {}
      if (adjusted === null || adjusted === '' || adjusted === undefined) delete cur[month]
      else cur[month] = Number(adjusted)
      await redis.set('config:payless-adjustments', cur)
      return res.json({ ok: true, paylessManual: cur })
    } catch (e) { return res.status(500).json({ error: e.message }) }
  }

  try {
    // Get all live projects from dashboard cache, excluding the shared hidden list.
    const cached = await redis.get('dashboard:cache')
    const hiddenIds = (await redis.get('config:hidden-projects').catch(() => null)) || []
    const hiddenSet = new Set(hiddenIds.map(String))
    const projects = (cached || []).filter(p => p.status === 'INPROGRESS' && !hiddenSet.has(String(p.xeroId)))

    // Collect all invoice lines across all projects
    const allInvoiceLines = []
    for (const p of projects) {
      try {
        const lines = await redis.get(`invoiced:lines:${p.xeroId}`)
        if (lines) {
          for (const inv of lines) {
            allInvoiceLines.push({ ...inv, projectName: p.name, jobNo: p.jobNo })
          }
        }
      } catch {}
    }

    // ── GP Margin (EOM basis, last full month) ────────────────────────────
    // Match the EOM report: margin at the LAST COMPLETED month's valuation date,
    // over in-progress projects only. costsToDate / grossInvoiced are summed up to
    // each project's valuation date for that month — NOT all-time.
    const nowD = new Date()
    const lastFull = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1)
    const eomYear = lastFull.getFullYear()
    const eomMonth = lastFull.getMonth() + 1              // 1-12
    const eomMonthKey = `${eomYear}-${String(eomMonth).padStart(2, '0')}`
    const invVal = (i) => (i.sales200 != null ? i.sales200 : (i.subTotal != null ? i.subTotal : 0))

    let eomGross = 0, eomCosts = 0
    const gpBreakdown = []
    for (const p of projects) {
      // Valuation date for the last full month: per-month override wins, else the
      // fixed valuation day applied to that month.
      let vStr = null
      const ov = p.dateOverrides?.[eomMonthKey]?.valuationDate
      if (ov) vStr = ov
      else if (p.valuationDay) {
        const dim = new Date(eomYear, eomMonth, 0).getDate()
        const day = Math.min(parseInt(p.valuationDay), dim)
        vStr = new Date(Date.UTC(eomYear, eomMonth - 1, day)).toISOString().split('T')[0]
      }
      if (!vStr) { gpBreakdown.push({ jobNo: p.jobNo, projectName: p.name, valDate: null, invoiced: 0, costs: 0, margin: null, included: false, note: 'no valuation date this month' }); continue }
      const cLines = (await redis.get(`costs:lines:${p.xeroId}`).catch(() => null)) || p._costLines || []
      const iLines = (await redis.get(`invoiced:lines:${p.xeroId}`).catch(() => null)) || p._invoiceLines || []
      const costsToDate = cLines.filter(l => l.date && l.date <= vStr).reduce((s, l) => s + (l.amount || 0), 0)
      const grossInvoicedToDate = iLines.filter(l => l.date && l.date <= vStr).reduce((s, l) => s + invVal(l), 0)
      eomGross += grossInvoicedToDate
      eomCosts += costsToDate
      gpBreakdown.push({
        jobNo: p.jobNo, projectName: p.name, valDate: vStr,
        invoiced: grossInvoicedToDate, costs: costsToDate,
        margin: grossInvoicedToDate > 0 ? (grossInvoicedToDate - costsToDate) / grossInvoicedToDate : null,
        included: true,
      })
    }
    gpBreakdown.sort((a, b) => String(a.jobNo || '').localeCompare(String(b.jobNo || ''), undefined, { numeric: true }))
    const totalGrossInvoiced = eomGross
    const totalCosts = eomCosts
    const gpMargin = totalGrossInvoiced > 0 ? (totalGrossInvoiced - totalCosts) / totalGrossInvoiced : null
    const gpProfit = totalGrossInvoiced - totalCosts

    // ── Payless Notices = Credit Notes ────────────────────────────────────
    // Every credit note applied against a project counts as one payless notice.
    // Counted by the month the credit note is dated. Each month's count can be
    // manually overridden (e.g. 7 raw, adjusted to 4 because 3 were minor).
    const creditNoteDetails = allInvoiceLines
      .filter(l => l.creditNote)
      .map(l => ({
        projectName: l.projectName || '',
        jobNo: l.jobNo || '',
        creditNoteNumber: l.invoiceNumber || '',
        appliedToInvoice: l.appliedToInvoice || l.reference || '',
        date: l.date || '',
        amount: Math.abs(l.sales200 != null ? l.sales200 : (l.subTotal || l.total || 0)),
        contact: l.contact || '',
      }))

    // Group credit notes by month.
    const paylessByMonth = {}
    for (const cn of creditNoteDetails) {
      const mk = monthKey(cn.date)
      if (!mk) continue
      if (!paylessByMonth[mk]) paylessByMonth[mk] = []
      paylessByMonth[mk].push(cn)
    }

    // Manual per-month adjustments: { 'YYYY-MM': adjustedCount }. When set, the
    // adjusted number is used for the metric; the raw credit notes still show in the
    // drill-down.
    const paylessManual = (await redis.get('config:payless-adjustments').catch(() => null)) || {}
    const paylessCountByMonth = {}
    for (const mk of Object.keys(paylessByMonth)) {
      const raw = paylessByMonth[mk].length
      const adj = paylessManual[mk]
      paylessCountByMonth[mk] = { raw, adjusted: (adj != null && adj !== '') ? Number(adj) : raw, isAdjusted: adj != null && adj !== '' }
    }

    // ── Average Time to Get Paid ──────────────────────────────────────────
    // Days between invoice date and fullyPaidOnDate, for paid invoices
    const paidInvoices = allInvoiceLines.filter(inv =>
      inv.fullyPaidOnDate && inv.date && inv.status === 'PAID'
    )

    const paymentTimeByMonth = {}
    for (const inv of paidInvoices) {
      const mk = monthKey(inv.fullyPaidOnDate)
      if (!mk) continue
      const invDate = parseXeroDate(inv.date)
      const paidDate = parseXeroDate(inv.fullyPaidOnDate)
      if (!invDate || !paidDate) continue
      const days = Math.round((paidDate - invDate) / (1000 * 60 * 60 * 24))
      if (days < 0 || days > 365) continue // sanity check
      if (!paymentTimeByMonth[mk]) paymentTimeByMonth[mk] = []
      paymentTimeByMonth[mk].push({ days, inv })
    }

    const avgPaymentTime = {}
    for (const [mk, entries] of Object.entries(paymentTimeByMonth)) {
      avgPaymentTime[mk] = {
        avgDays: Math.round(entries.reduce((s, e) => s + e.days, 0) / entries.length),
        count: entries.length,
        invoices: entries.map(e => e.inv),
      }
    }

    res.json({
      gpMargin,
      gpProfit,
      gpMarginMonth: eomMonthKey,
      gpBreakdown,
      totalGrossInvoiced,
      totalCosts,
      liveProjectCount: projects.length,
      paylessByMonth,
      paylessCountByMonth,
      paylessManual,
      paylessTotal: creditNoteDetails.length,
      paylessAdjustedTotal: Object.values(paylessCountByMonth).reduce((s, m) => s + m.adjusted, 0),
      avgPaymentTime,
      allInvoiceCount: allInvoiceLines.length,
    })

  } catch (e) {
    console.error('Commercial metrics error:', e)
    res.status(500).json({ error: e.message })
  }
}
