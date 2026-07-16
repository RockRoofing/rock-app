import { requireRole } from '../../lib/portalAuth'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

const monthOf = (dateStr) => (dateStr && /^\d{4}-\d{2}/.test(dateStr)) ? dateStr.slice(0, 7) : ''

export default async function handler(req, res) {
  // Accounts, Management, Admin.
  if (!requireRole(req, res, ['accounts', 'management', 'admin'])) return
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  try {
    const [untBills, untWages, unassignedInv, catConfig, benchmark, dash] = await Promise.all([
      redis.get('costs:untagged:bills').then(v => v || []).catch(() => []),
      redis.get('costs:untagged:wages').then(v => v || []).catch(() => []),
      redis.get('invoiced:lines:__UNASSIGNED__').then(v => v || []).catch(() => []),
      redis.get('config:account-categorisation').then(v => v || {}).catch(() => ({})),
      redis.get('xero:pl-benchmark').then(v => v || null).catch(() => null),
      redis.get('dashboard:cache').then(v => v || []).catch(() => []),
    ])

    // Tag each untagged bill/wage line with its month + a categorised flag.
    const knownCodes = new Set(Object.keys(catConfig))
    const tagLine = (l, source) => ({
      ...l, source,
      month: monthOf(l.date),
      hasCode: knownCodes.has(String(l.accountCode)),   // is this account in the app's categorisation?
    })
    const bills = (untBills || []).map(l => tagLine(l, 'bills'))
    const wages = (untWages || []).map(l => tagLine(l, 'wages'))
    const invoices = (unassignedInv || []).map(l => ({
      ...l, source: 'invoices', month: monthOf(l.date),
    }))

    // App-side categorised totals per month + per account (from dashboard cache).
    // costs:lines carry accountCode; invoiced lines carry total/amountDue.
    const appCategorised = {}   // month -> { cost, sales }
    for (const p of (dash || [])) {
      for (const l of (p._costLines || [])) {
        const m = monthOf(l.date); if (!m) continue
        appCategorised[m] = appCategorised[m] || { cost: 0, sales: 0 }
        appCategorised[m].cost += (l.amount || 0)
      }
      for (const l of (p._invoiceLines || [])) {
        const m = monthOf(l.date); if (!m) continue
        appCategorised[m] = appCategorised[m] || { cost: 0, sales: 0 }
        appCategorised[m].sales += (l.total || 0)
      }
    }

    // Distinct account codes seen in the untagged data but NOT in the app config.
    const missingCodes = [...new Set(
      [...bills, ...wages].map(l => String(l.accountCode)).filter(c => c && !knownCodes.has(c))
    )]

    res.json({
      bills, wages, invoices,
      appCategorised,
      benchmark,                    // { month: { accounts:{code:total}, costOfSaleTotal, salesTotal }, ... } | null
      knownCodes: [...knownCodes],
      missingCodes,
      benchmarkUpdatedAt: benchmark?.updatedAt || null,
    })
  } catch (e) {
    console.error('bookkeeping error:', e)
    res.status(500).json({ error: e.message })
  }
}
