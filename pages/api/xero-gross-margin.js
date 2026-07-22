import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, fetchProfitAndLoss, fetchAccountCodeMap } from '../../lib/xero'
import { normCategory, defaultCategoryFor } from './account-categorisation'

// Live Gross Margin straight from Xero's Profit & Loss, as a TRAILING 12-MONTH
// rolling figure (the last 12 fully completed months).
//
// The split is driven ENTIRELY by the Account Categorisation tab
// (config:account-categorisation) - NOT by Xero's own P&L section grouping. Every
// P&L account code is bucketed by its saved category (labour | materials | sales |
// overheads | uncategorised), falling back to the same per-code default the
// categorisation page uses. Then:
//
//   Total Sales     = sum of codes categorised 'sales'
//   Total Costs     = sum of codes categorised 'labour' + 'materials'
//   (overheads and uncategorised are EXCLUDED)
//   Gross Profit    = Total Sales - Total Costs
//   Gross Margin    = Gross Profit / Total Sales
//
// Credit notes need no special handling: Xero's P&L is accrual-based and already
// nets sales credit notes (ACCRECCREDIT) into the revenue codes and supplier credit
// notes (ACCPAYCREDIT) into the cost codes. Fetching /CreditNotes on top would
// DOUBLE COUNT, so we deliberately do not.
//
// Live-fetched on each load (no persistence): ~6 Xero calls, one per month.

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Resolve a code's category exactly as the Account Categorisation page does:
// a saved category wins (migrating legacy 'ignore' -> 'overheads'); otherwise the
// per-code default. Balance-sheet codes (e.g. 612 Retention) never reach here
// because fetchProfitAndLoss only returns P&L codes.
function categoryOf(code, config) {
  const cfg = config[String(code)] || {}
  return normCategory(cfg.category) || defaultCategoryFor(code)
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return

  try {
    const redis = await getRedis()
    const catConfig = redis
      ? (await redis.get('config:account-categorisation').then(v => v || {}).catch(() => ({})))
      : {}

    let tokens = await getTokens()
    if (!tokens?.refresh_token) return res.status(400).json({ error: 'Xero not connected.' })
    try {
      const nt = await refreshXeroToken(tokens.refresh_token)
      if (nt?.access_token) { tokens = { ...tokens, ...nt }; await saveTokens(tokens) }
    } catch (e) {
      return res.status(400).json({ error: 'Could not refresh Xero token - reconnect Xero.' })
    }

    const tenantId = tokens.tenant_id
    // Chart-of-Accounts map so P&L lines carry account CODES (byCode). Without this
    // we cannot categorise, so it is required for the categorisation-based split.
    const nameToCode = await fetchAccountCodeMap(tokens.access_token, tenantId).catch(() => ({}))

    const now = new Date()
    const months = []
    // We want 6 TRAILING-12-MONTH rolling points for the trend. The earliest point
    // needs the 12 months before it, so we fetch 17 completed months in total
    // (17 = 12 + 6 - 1). Each month is fetched ONCE; the rolling windows are then
    // computed in memory - no duplicate fetches.
    const TREND_POINTS = 6
    const WINDOW = 12
    const MONTHS_TO_FETCH = WINDOW + TREND_POINTS - 1   // 17
    for (let k = MONTHS_TO_FETCH; k >= 1; k--) {
      const d = new Date(now.getFullYear(), now.getMonth() - k, 1)
      const y = d.getFullYear()
      const m = d.getMonth()                       // 0-11
      const from = `${y}-${String(m + 1).padStart(2, '0')}-01`
      const last = new Date(y, m + 1, 0)
      const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
      const key = from.slice(0, 7)                 // YYYY-MM
      const label = `${MONTH_ABBR[m]} ${String(y).slice(2)}`
      try {
        const pl = await fetchProfitAndLoss(tokens.access_token, tenantId, from, to, nameToCode)
        const byCode = pl.byCode || {}

        // Bucket every P&L code by its Account Categorisation category.
        let sales = 0, labour = 0, materials = 0, overheads = 0, uncategorised = 0
        const codeRows = []
        for (const code of Object.keys(byCode)) {
          const amt = byCode[code] || 0
          const cat = categoryOf(code, catConfig)
          if (cat === 'sales') sales += amt
          else if (cat === 'labour') labour += amt
          else if (cat === 'materials') materials += amt
          else if (cat === 'overheads') overheads += amt
          else uncategorised += amt
          codeRows.push({ code, amount: amt, category: cat, plSection: pl.codeSection?.[code] || null })
        }
        codeRows.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }))
        // P&L revenue lines are typically positive; cost lines positive as expenses.
        // Use magnitudes so the margin formula is sign-safe regardless of how the
        // report presents each section.
        const totalSales = Math.abs(sales)
        const totalLabour = Math.abs(labour)
        const totalMaterials = Math.abs(materials)
        const totalCosts = totalLabour + totalMaterials      // overheads excluded
        const grossProfit = totalSales - totalCosts
        const grossMargin = totalSales > 0 ? grossProfit / totalSales : null

        months.push({
          month: key, label,
          sales: totalSales,
          labour: totalLabour,
          materials: totalMaterials,
          directCosts: totalCosts,
          overheads: Math.abs(overheads),
          uncategorised: Math.abs(uncategorised),
          grossProfit,
          grossMargin,                              // fraction 0-1 (null if no sales)
          // Diagnostics (per month): raw signed section totals from Xero's P&L, and
          // the per-code breakdown showing exactly which category each code fell in.
          xeroIncomeTotal: pl.incomeTotal,
          xeroCostOfSalesTotal: pl.costOfSalesTotal,
          xeroOverheadsTotal: pl.overheadsTotal,
          codeRows,
        })
        await sleep(250)                            // be gentle on the Xero rate limit
      } catch (e) {
        console.error('Gross-margin P&L pull failed for', key, e.message)
        months.push({ month: key, label, sales: 0, labour: 0, materials: 0, directCosts: 0, overheads: 0, uncategorised: 0, grossProfit: 0, grossMargin: null, error: true })
      }
    }

    // months[] now holds up to 17 completed months, oldest -> newest.
    const okAll = months.filter(mo => !mo.error)

    // Helper: sum a slice of months into a trailing-window aggregate.
    const aggregate = (slice) => {
      const sales = slice.reduce((s, mo) => s + (mo.sales || 0), 0)
      const labour = slice.reduce((s, mo) => s + (mo.labour || 0), 0)
      const materials = slice.reduce((s, mo) => s + (mo.materials || 0), 0)
      const costs = labour + materials
      const grossProfit = sales - costs
      return {
        sales, labour, materials, directCosts: costs, grossProfit,
        grossMargin: sales > 0 ? grossProfit / sales : null,
        monthsIncluded: slice.length,
        rangeLabel: slice.length ? `${slice[0].label} - ${slice[slice.length - 1].label}` : null,
      }
    }

    // -- Headline: trailing 12 months ending the most recent completed month --
    const last12 = months.slice(-WINDOW)
    const trailing12 = aggregate(last12.filter(mo => !mo.error))

    // -- Trend: 6 points, each a TRAILING-12-MONTH margin ending that month --
    // Point i ends at months[end], covering months[end-11 .. end]. Only build a
    // point when a full 12-month window is available so every point is comparable.
    const rollingTrend = []
    for (let end = months.length - 1; end >= WINDOW - 1 && rollingTrend.length < TREND_POINTS; end--) {
      const windowSlice = months.slice(end - WINDOW + 1, end + 1)
      const agg = aggregate(windowSlice.filter(mo => !mo.error))
      rollingTrend.push({
        month: months[end].label,                    // the month the window ENDS on
        endMonth: months[end].month,
        grossMargin: agg.grossMargin,
        sales: agg.sales,
        directCosts: agg.directCosts,
        grossProfit: agg.grossProfit,
        rangeLabel: agg.rangeLabel,
      })
    }
    rollingTrend.reverse()   // oldest -> newest for the chart

    // Latest single completed month (kept for the per-code diagnostic only).
    const latest = okAll.length ? okAll[okAll.length - 1] : null

    res.json({
      months,                                       // oldest -> newest (up to 17)
      trailing12,                                    // rolling-annual headline
      rollingTrend,                                  // 6 trailing-12 points for the trend
      latest,                                        // most recent single month (diagnostic)
      latestGrossMargin: latest ? latest.grossMargin : null,
      basis: 'account-categorisation',
      window: 'trailing-12-months',
      fetchedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('xero-gross-margin error:', e)
    res.status(500).json({ error: e.message })
  }
}
