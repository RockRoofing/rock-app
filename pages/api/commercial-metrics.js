import { requireRole } from '../../lib/portalAuth'
import { getCachedProjects } from '../../lib/db'
import { computeProjectWip } from '../../lib/wipCalc'

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

    // For "Average Time to Get Paid" we must look at ALL projects, not just
    // in-progress ones: invoices are usually fully paid AFTER a job has moved to
    // defects/closed, so restricting to in-progress hides most paid invoices.
    const allProjects = (cached || []).filter(p => !hiddenSet.has(String(p.xeroId)))
    const paymentInvoiceLines = []
    for (const p of allProjects) {
      try {
        const lines = await redis.get(`invoiced:lines:${p.xeroId}`)
        if (lines) {
          for (const inv of lines) {
            paymentInvoiceLines.push({ ...inv, projectName: p.name, jobNo: p.jobNo })
          }
        }
      } catch {}
    }

    // -- GP Margin (EOM basis, last full month, INCLUDING WIP) --
    // Match the EOM report's "inc WIP" header bar exactly: for each in-progress
    // project, at the LAST COMPLETED month's valuation date,
    //   Invoiced (inc WIP) = invoiced to val date + WIP
    //   Profit   (inc WIP) = profit to date + profit portion of WIP
    //   GP Margin          = sum profit(inc WIP) / sum invoiced(inc WIP)
    // WIP comes from the shared computeProjectWip (lib/wipCalc.js) so all pages
    // agree. Projects with no valuation date this month are excluded on BOTH sides.
    const nowD = new Date()
    const lastFull = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1)
    const eomYear = lastFull.getFullYear()
    const eomMonth = lastFull.getMonth() + 1              // 1-12
    const eomMonthKey = `${eomYear}-${String(eomMonth).padStart(2, '0')}`
    const monthEndStr = new Date(Date.UTC(eomYear, eomMonth, 0)).toISOString().split('T')[0]
    const invVal = (i) => (i.sales200 != null ? i.sales200 : (i.subTotal != null ? i.subTotal : 0))

    let eomGross = 0, eomCosts = 0        // to-val-date totals (ex WIP)
    let eomWip = 0, eomWipProfit = 0      // WIP totals
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
      if (!vStr) { gpBreakdown.push({ jobNo: p.jobNo, projectName: p.name, valDate: null, invoiced: 0, costs: 0, wip: 0, invoicedIncWip: 0, margin: null, included: false, note: 'no valuation date this month' }); continue }
      const cLines = (await redis.get(`costs:lines:${p.xeroId}`).catch(() => null)) || p._costLines || []
      const iLines = (await redis.get(`invoiced:lines:${p.xeroId}`).catch(() => null)) || p._invoiceLines || []
      const costsToDate = cLines.filter(l => l.date && l.date <= vStr).reduce((s, l) => s + (l.amount || 0), 0)
      const grossInvoicedToDate = iLines.filter(l => l.date && l.date <= vStr).reduce((s, l) => s + invVal(l), 0)
      const profitToDate = grossInvoicedToDate - costsToDate

      // WIP for this month via the shared calc (same source as the EOM bar).
      const monthAdj = Array.isArray(p.wipAdjustments)
        ? p.wipAdjustments.filter(a => a.month === eomMonthKey)
        : []
      const _wip = computeProjectWip({
        costLines: cLines, invoiceLines: iLines, valStr: vStr, monthEndStr,
        adjustments: monthAdj, marginOverride: p.wipMarginOverride,
      })
      const wip = _wip.wipValue
      const wipProfit = _wip.wipProfit

      eomGross += grossInvoicedToDate
      eomCosts += costsToDate
      eomWip += wip
      eomWipProfit += wipProfit

      const invoicedIncWip = grossInvoicedToDate + wip
      const profitIncWip = profitToDate + wipProfit
      gpBreakdown.push({
        jobNo: p.jobNo, projectName: p.name, valDate: vStr,
        invoiced: grossInvoicedToDate, costs: costsToDate, wip,
        invoicedIncWip,
        margin: invoicedIncWip > 0 ? profitIncWip / invoicedIncWip : null,
        included: true,
      })
    }
    gpBreakdown.sort((a, b) => String(a.jobNo || '').localeCompare(String(b.jobNo || ''), undefined, { numeric: true }))
    // Totals INCLUDING WIP - these match the EOM report's "inc WIP" header bar.
    const totalGrossInvoiced = eomGross + eomWip           // Invoiced (inc WIP)
    const totalCosts = eomCosts                            // costs to val date (ex WIP)
    const gpProfit = (eomGross - eomCosts) + eomWipProfit  // Profit (inc WIP)
    const gpMargin = totalGrossInvoiced > 0 ? gpProfit / totalGrossInvoiced : null

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

    // -- Average Days Beyond Terms (paid vs due date) --
    // For each fully-paid SALES invoice: daysOverdue = fullyPaidOnDate - dueDate.
    // Negative = paid early, positive = paid late. The metric is the AVERAGE of
    // these per month (grouped by the month the invoice was paid). e.g. 10 invoices
    // each paid 5 days after their due date -> average +5.
    // Needs BOTH fullyPaidOnDate (when it was actually paid) and dueDate (the terms).
    // fullyPaidOnDate is captured from Xero by sync-invoices.js and wip-sync.
    // Paid = status 'PAID' OR nothing outstanding (amountDue == 0, amountPaid > 0).
    // Credit notes excluded.
    const isPaid = (inv) =>
      inv.status === 'PAID' ||
      ((Number(inv.amountDue) || 0) === 0 && (Number(inv.amountPaid) || 0) > 0)
    const paidInvoices = paymentInvoiceLines.filter(inv =>
      inv.fullyPaidOnDate && inv.dueDate && !inv.creditNote && isPaid(inv)
    )

    const paymentTimeByMonth = {}
    for (const inv of paidInvoices) {
      const mk = monthKey(inv.fullyPaidOnDate)
      if (!mk) continue
      const dueDate = parseXeroDate(inv.dueDate)
      const paidDate = parseXeroDate(inv.fullyPaidOnDate)
      if (!dueDate || !paidDate || isNaN(dueDate) || isNaN(paidDate)) continue
      // Positive = paid AFTER the due date (late); negative = paid early.
      const days = Math.round((paidDate - dueDate) / (1000 * 60 * 60 * 24))
      if (days < -365 || days > 365) continue // sanity window (keeps early payments)
      if (!paymentTimeByMonth[mk]) paymentTimeByMonth[mk] = []
      paymentTimeByMonth[mk].push({ days, inv })
    }

    const avgPaymentTime = {}
    for (const [mk, entries] of Object.entries(paymentTimeByMonth)) {
      avgPaymentTime[mk] = {
        avgDays: Math.round(entries.reduce((s, e) => s + e.days, 0) / entries.length),
        count: entries.length,
        invoices: entries.map(e => ({ ...e.inv, daysBeyondTerms: e.days })),
      }
    }

    // Single authoritative overall average across ALL qualifying invoices (every
    // month pooled), so the headline can't disagree with the drill. Rounded.
    const allEntries = Object.values(paymentTimeByMonth).flat()
    const overallAvgDaysBeyondTerms = allEntries.length
      ? Math.round(allEntries.reduce((s, e) => s + e.days, 0) / allEntries.length)
      : null

    // Diagnostics: if the card is empty, these show WHERE the invoices fall out.
    const paymentDiag = {
      apiVersion: 'metrics-v3',
      totalInvoiceLines: paymentInvoiceLines.length,
      withFullyPaidOnDate: paymentInvoiceLines.filter(i => i.fullyPaidOnDate).length,
      withDueDate: paymentInvoiceLines.filter(i => i.dueDate).length,
      withStatusPaid: paymentInvoiceLines.filter(i => i.status === 'PAID').length,
      withZeroDue: paymentInvoiceLines.filter(i => (Number(i.amountDue) || 0) === 0 && (Number(i.amountPaid) || 0) > 0).length,
      passedIsPaid: paymentInvoiceLines.filter(isPaid).length,
      qualifiedPaidInvoices: paidInvoices.length,
      monthsWithData: Object.keys(avgPaymentTime).length,
      overallAvgDaysBeyondTerms,
    }

    res.json({
      gpMargin,
      gpProfit,
      gpMarginMonth: eomMonthKey,
      gpBreakdown,
      totalGrossInvoiced,
      totalCosts,
      totalWip: eomWip,
      totalWipProfit: eomWipProfit,
      totalInvoicedExWip: eomGross,
      liveProjectCount: projects.length,
      paylessByMonth,
      paylessCountByMonth,
      paylessManual,
      paylessTotal: creditNoteDetails.length,
      paylessAdjustedTotal: Object.values(paylessCountByMonth).reduce((s, m) => s + m.adjusted, 0),
      avgPaymentTime,
      paymentDiag,
      allInvoiceCount: allInvoiceLines.length,
    })

  } catch (e) {
    console.error('Commercial metrics error:', e)
    res.status(500).json({ error: e.message })
  }
}
