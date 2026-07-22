import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, fetchProfitAndLoss, fetchAccountCodeMap } from '../../lib/xero'
import { normCategory, defaultCategoryFor } from './account-categorisation'

// Live Gross Margin straight from Xero's Profit & Loss, for the last 6 COMPLETED
// months (rolling).
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
    // k = 6..1 => the last 6 FULLY COMPLETED calendar months (excludes the current,
    // in-progress month). On any day in September this yields Mar..Aug.
    for (let k = 6; k >= 1; k--) {
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

    // Latest = most recent completed month that actually returned a margin.
    const withMargin = months.filter(mo => mo.grossMargin != null)
    const latest = withMargin.length ? withMargin[withMargin.length - 1] : null

    res.json({
      months,                                       // oldest -> newest
      latest,                                        // { month, label, grossMargin, ... } | null
      latestGrossMargin: latest ? latest.grossMargin : null,
      basis: 'account-categorisation',
      fetchedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('xero-gross-margin error:', e)
    res.status(500).json({ error: e.message })
  }
}
