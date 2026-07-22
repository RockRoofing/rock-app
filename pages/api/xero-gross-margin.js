import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, fetchProfitAndLoss, fetchAccountCodeMap } from '../../lib/xero'

// Live Gross Margin straight from Xero's Profit & Loss, for the last 6 COMPLETED
// months (rolling). Gross Margin = (Sales - Direct Costs) / Sales, with overheads
// EXCLUDED. Credit notes need no special handling: Xero's P&L is accrual-based and
// already nets sales credit notes (ACCRECCREDIT) into the Income total and supplier
// credit notes (ACCPAYCREDIT) into the Cost of Sales total, so using the P&L section
// totals accounts for them automatically. Fetching /CreditNotes on top would DOUBLE
// count, so we deliberately do not.
//
// Live-fetched on each load (no persistence): ~6 Xero calls, one per month.

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return

  try {
    let tokens = await getTokens()
    if (!tokens?.refresh_token) return res.status(400).json({ error: 'Xero not connected.' })
    try {
      const nt = await refreshXeroToken(tokens.refresh_token)
      if (nt?.access_token) { tokens = { ...tokens, ...nt }; await saveTokens(tokens) }
    } catch (e) {
      return res.status(400).json({ error: 'Could not refresh Xero token - reconnect Xero.' })
    }

    const tenantId = tokens.tenant_id
    // One Chart-of-Accounts fetch so P&L lines carry account codes (not needed for
    // the section totals, but keeps the helper behaviour consistent).
    const nameToCode = await fetchAccountCodeMap(tokens.access_token, tenantId).catch(() => ({}))

    const now = new Date()
    const months = []
    // k = 1..6 => the last 6 FULLY COMPLETED calendar months (excludes the current,
    // in-progress month). On any day in September this yields Mar..Aug.
    for (let k = 6; k >= 1; k--) {
      const d = new Date(now.getFullYear(), now.getMonth() - k, 1)
      const y = d.getFullYear()
      const m = d.getMonth()                       // 0-11
      const from = `${y}-${String(m + 1).padStart(2, '0')}-01`
      const last = new Date(y, m + 1, 0)
      const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
      const key = from.slice(0, 7)                 // YYYY-MM
      try {
        const pl = await fetchProfitAndLoss(tokens.access_token, tenantId, from, to, nameToCode)
        const sales = Math.abs(pl.incomeTotal || 0)
        const directCosts = Math.abs(pl.costOfSalesTotal || 0)   // overheads excluded by design
        const grossProfit = sales - directCosts
        const grossMargin = sales > 0 ? grossProfit / sales : null
        months.push({
          month: key,
          label: `${MONTH_ABBR[m]} ${String(y).slice(2)}`,
          sales,
          directCosts,
          grossProfit,
          grossMargin,                              // fraction 0-1 (null if no sales)
        })
        await sleep(250)                            // be gentle on the Xero rate limit
      } catch (e) {
        console.error('Gross-margin P&L pull failed for', key, e.message)
        months.push({ month: key, label: `${MONTH_ABBR[m]} ${String(y).slice(2)}`, sales: 0, directCosts: 0, grossProfit: 0, grossMargin: null, error: true })
      }
    }

    // Latest = most recent completed month that actually returned a margin.
    const withMargin = months.filter(mo => mo.grossMargin != null)
    const latest = withMargin.length ? withMargin[withMargin.length - 1] : null

    res.json({
      months,                                       // oldest -> newest
      latest,                                        // { month, label, grossMargin, ... } | null
      latestGrossMargin: latest ? latest.grossMargin : null,
      fetchedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('xero-gross-margin error:', e)
    res.status(500).json({ error: e.message })
  }
}
