import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, fetchChartOfAccounts } from '../../lib/xero'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

// POST /api/sync-chart-of-accounts
// Pulls the full Chart of Accounts (code + name + type/class/status) from Xero and
// stores it so the Account Categorisation list shows every account. New codes that
// aren't yet in the categorisation config appear as "uncategorised" and are flagged
// in the Bookkeeping app until an admin assigns them.
export default async function handler(req, res) {
  if (!requireRole(req, res, ['accounts', 'management', 'admin'])) return
  if (req.method !== 'POST') return res.status(405).end()
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'Not connected to Xero' })
    try {
      const nt = await refreshXeroToken(tokens.refresh_token)
      if (nt?.access_token) { tokens = { ...tokens, ...nt }; await saveTokens(tokens) }
    } catch {}
    const tenantId = tokens.tenant_id
    if (!tenantId) return res.status(400).json({ error: 'No Xero tenant' })

    const chart = await fetchChartOfAccounts(tokens.access_token, tenantId)
    await redis.set('config:chart-of-accounts', chart)
    const now = new Date().toISOString()
    await redis.set('config:chart-of-accounts-synced', now)

    // How many of the synced accounts are not yet categorised (for the response).
    const config = await redis.get('config:account-categorisation').then(v => v || {}).catch(() => ({}))
    const uncategorised = chart.filter(a => !config[a.code] || !['labour', 'materials', 'overheads', 'ignore'].includes(config[a.code].category)).length

    return res.json({ ok: true, count: chart.length, uncategorised, syncedAt: now })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
