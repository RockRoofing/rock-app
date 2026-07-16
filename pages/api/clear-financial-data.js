import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, getProjectsFromCategories } from '../../lib/xero'
import { mergeCosts } from '../../lib/mergeCosts'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

async function projectIds(redis) {
  const cached = await redis.get('projects:list').catch(() => null)
  if (Array.isArray(cached) && cached.length) return cached.map(p => p.id).filter(Boolean)
  let tokens = await getTokens()
  if (tokens?.refresh_token) {
    try { const nt = await refreshXeroToken(tokens.refresh_token); tokens = { ...tokens, ...nt }; await saveTokens(tokens) } catch {}
    const cats = await getProjectsFromCategories(tokens.access_token, tokens.tenant_id)
    return cats.map(cp => cp.trackingOptionId).filter(Boolean)
  }
  return []
}

// Wipe financial data by type. Admin-only, requires typed confirm "CLEAR".
// type: 'bills' | 'wages' | 'sales' | 'overheads' | 'all'
export default async function handler(req, res) {
  if (!requireRole(req, res, ['admin'])) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const { type, confirm } = req.body || {}
  if (confirm !== 'CLEAR') return res.status(400).json({ error: 'Type CLEAR to confirm.' })
  if (!['bills', 'wages', 'sales', 'overheads', 'all'].includes(type)) return res.status(400).json({ error: 'Invalid type.' })

  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  try {
    // Scan ALL keys of each type (not just current projects) so archived/old
    // projects' data is also removed — otherwise old bills survive a "clear".
    async function scanKeys(pattern) {
      const found = []
      let cursor = 0
      do {
        const [next, batch] = await redis.scan(cursor, { match: pattern, count: 500 })
        cursor = typeof next === 'string' ? parseInt(next) : next
        if (Array.isArray(batch)) found.push(...batch)
      } while (cursor !== 0)
      return found
    }

    let cleared = 0

    const clearBills = async () => {
      const keys = await scanKeys('costs:bills:*')
      for (const k of keys) { await redis.del(k); cleared++ }
      await redis.del('costs:untagged:bills')
      // Recompute merged totals for affected projects.
      for (const k of keys) { const id = k.replace('costs:bills:', ''); await mergeCosts(redis, id) }
    }
    const clearWages = async () => {
      const keys = await scanKeys('costs:wages:*')
      for (const k of keys) { await redis.del(k); cleared++ }
      await redis.del('costs:untagged:wages')
      for (const k of keys) { const id = k.replace('costs:wages:', ''); await mergeCosts(redis, id) }
    }
    const clearSales = async () => {
      const lineKeys = await scanKeys('invoiced:lines:*')
      const latestKeys = await scanKeys('invoiced:latest:*')
      for (const k of [...lineKeys, ...latestKeys]) { await redis.del(k); cleared++ }
      await redis.del('invoiced:lines:__UNASSIGNED__')
    }
    const clearOverheads = async () => {
      // Overheads == the ignore-category items, which live in the untagged bills store.
      await redis.del('costs:untagged:bills')
    }

    if (type === 'bills') await clearBills()
    else if (type === 'wages') await clearWages()
    else if (type === 'sales') await clearSales()
    else if (type === 'overheads') await clearOverheads()
    else if (type === 'all') { await clearBills(); await clearWages(); await clearSales() }

    await redis.del('dashboard:cache')
    res.json({ ok: true, type, keysCleared: cleared })
  } catch (e) {
    console.error('clear-financial-data error:', e)
    res.status(500).json({ error: e.message })
  }
}
