import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens, getAllProjectSettings } from '../../lib/db'
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

// One-time RESET of wages data only. Wipes the untagged wage lump sums and every
// per-project wage source, then re-merges so project cost totals drop the wages.
// Does NOT touch bills or invoices. Admin-only. Requires an explicit confirm flag
// so it can't be triggered by accident.
export default async function handler(req, res) {
  if (!requireRole(req, res, ['admin'])) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!req.body || req.body.confirm !== 'CLEAR WAGES') {
    return res.status(400).json({ error: 'Confirmation required.' })
  }
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  try {
    // Resolve the project list (to find every costs:wages:<id>).
    let projectIds = []
    const cachedList = await redis.get('projects:list').catch(() => null)
    if (Array.isArray(cachedList) && cachedList.length) {
      projectIds = cachedList.map(p => p.id).filter(Boolean)
    } else {
      let tokens = await getTokens()
      if (tokens?.refresh_token) {
        try { const nt = await refreshXeroToken(tokens.refresh_token); tokens = { ...tokens, ...nt }; await saveTokens(tokens) } catch {}
        const cats = await getProjectsFromCategories(tokens.access_token, tokens.tenant_id)
        projectIds = cats.map(cp => cp.trackingOptionId).filter(Boolean)
      }
    }

    // Delete per-project wage sources + re-merge so wages leave the totals.
    let cleared = 0
    for (const id of projectIds) {
      const had = await redis.get(`costs:wages:${id}`).catch(() => null)
      if (had) { await redis.del(`costs:wages:${id}`); cleared++ }
      await mergeCosts(redis, id)   // recompute costs:latest/costs:lines without wages
    }

    // Delete the untagged wage lump sums.
    await redis.del('costs:untagged:wages')
    // Invalidate the dashboard cache so figures refresh.
    await redis.del('dashboard:cache')

    res.json({ ok: true, projectsCleared: cleared, projectsChecked: projectIds.length })
  } catch (e) {
    console.error('clear-wages error:', e)
    res.status(500).json({ error: e.message })
  }
}
