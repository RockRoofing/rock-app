import { getCachedProjects } from '../../../lib/db'

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
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  try {
    // Get all live projects from dashboard cache
    const cached = await redis.get('dashboard:cache')
    const projects = (cached || []).filter(p => p.status === 'INPROGRESS')

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

    // ── GP Margin by month ────────────────────────────────────────────────
    // Average across all live projects — same as scorecard card
    const totalGrossInvoiced = projects.reduce((s, p) => s + (p.grossInvoiced || 0), 0)
    const totalCosts = projects.reduce((s, p) => s + (p.totalCosts || 0), 0)
    const gpMargin = totalGrossInvoiced > 0 ? (totalGrossInvoiced - totalCosts) / totalGrossInvoiced : null
    const gpProfit = totalGrossInvoiced - totalCosts

    // ── Payless Notices ───────────────────────────────────────────────────
    // Detected when: amountPaid < total (underpayment) OR hasCreditNote
    // One per invoice max. Use fullyPaidOnDate month for timing
    const paylessNotices = allInvoiceLines.filter(inv => {
      if (inv.status === 'VOIDED' || inv.status === 'DRAFT') return false
      const underpaid = inv.amountPaid > 0 && inv.amountDue === 0 && inv.amountPaid < inv.total
      const hasCN = inv.hasCreditNote && inv.creditNoteTotal > 0
      return underpaid || hasCN
    })

    // Group payless by month (use fullyPaidOnDate or date if no payment date)
    const paylessByMonth = {}
    for (const inv of paylessNotices) {
      const mk = monthKey(inv.fullyPaidOnDate || inv.date)
      if (!mk) continue
      if (!paylessByMonth[mk]) paylessByMonth[mk] = []
      paylessByMonth[mk].push(inv)
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
      totalGrossInvoiced,
      totalCosts,
      liveProjectCount: projects.length,
      paylessByMonth,
      paylessTotal: paylessNotices.length,
      avgPaymentTime,
      allInvoiceCount: allInvoiceLines.length,
    })

  } catch (e) {
    console.error('Commercial metrics error:', e)
    res.status(500).json({ error: e.message })
  }
}
