import { requireRole } from '../../lib/portalAuth'
import { getProject } from '../../lib/db'
import { buildContractWorksFromRates, computeApplicationSummary } from '../../lib/applications'

// Hypothetical (forecast) applications for the Commercial Cash Flow page.
// These are NEVER written to a project's real applications - they live in their own
// Redis key so they can't affect the live commercial workflow.
//   cashflow:hyp-apps:<projectKey>  ->  [ { id, from, to, contractWorks, variations,
//                                          materials, mcdPct, retentionPct, matDeliver } ]
// projectKey is the planning key: "L:<projectNo>" (live/draft) or "N:<dealId>" (negotiated).

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

const HKEY = (key) => `cashflow:hyp-apps:${key}`

// Resolve a project's contracted rates from the right store:
//  - Negotiated ("N:<dealId>")  -> crates:negotiated:<dealId>
//  - Live/draft ("L:<projectNo>") -> the project record is keyed by Xero id, which the
//    cash-flow key does NOT carry. So live/draft rates are looked up by the caller
//    passing the project's xeroId (when it exists in Xero). Without a xeroId we can't
//    reach the live rates, so we return none and the UI explains the project must be
//    added to Xero to build from its contracted rates.
async function loadRates(redis, projectKey, xeroId, project) {
  if (projectKey && projectKey.startsWith('N:')) {
    const dealId = projectKey.slice(2)
    const neg = (await redis.get(`crates:negotiated:${dealId}`).catch(() => null)) || {}
    return neg.contractedRates || null
  }
  if (xeroId) return (project || {}).contractedRates || null
  return null
}

// The most recent REAL application on the project - the thing a new forecast should
// start from, because it is the last agreed picture of how complete the job is.
//
// "Most recent" is by seq, which is the order applications were raised. Drafts count:
// a draft is still the latest view of percentage complete, and a forecast is a
// forecast. Status is returned so the modal can say which one it used.
//
// Only the fields the seed actually needs come back. The full contractWorks tree on a
// real application can be large and none of the rest of it is wanted here.
function latestApplicationSeed(project) {
  const apps = Array.isArray(project && project.applications) ? project.applications : []
  if (!apps.length) return null
  const latest = apps.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0)).pop()
  if (!latest) return null
  return {
    seq: latest.seq || 0,
    appNumber: latest.appNumber || null,
    status: latest.status || '',
    monthKey: latest.monthKey || '',
    monthLabel: latest.monthLabel || '',
    appDate: latest.appDate || '',
    valDate: latest.valDate || '',
    // Where this application's period ENDS, for comparing against a forecast's `to`.
    // Real applications carry no from/to - they are dated by valuation - so fall back
    // through the dates we do have. monthKey is 'YYYY-MM', hence the -28.
    endDate: latest.valDate || latest.appDate || (latest.monthKey ? `${latest.monthKey}-28` : ''),
    mcdPct: latest.mcdPct != null ? latest.mcdPct : null,
    retentionPct: latest.retentionPct != null ? latest.retentionPct : null,
    contractWorks: (Array.isArray(latest.contractWorks) ? latest.contractWorks : [])
      .filter(r => r && r.kind === 'item')
      .map(r => ({ id: r.id, code: r.code, pctComplete: r.pctComplete || 0 })),
  }
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  if (req.method === 'GET') {
    const { projectKey, xeroId, all } = req.query
    // all=1 -> return every project's saved forecasts (for colouring the gantt).
    if (all) {
      const keys = []
      try {
        let cursor = 0
        do {
          const [next, batch] = await redis.scan(cursor, { match: 'cashflow:hyp-apps:*', count: 200 })
          cursor = Number(next)
          for (const k of (batch || [])) keys.push(k)
        } while (cursor)
      } catch {}
      const out = {}
      for (const k of keys) {
        const pk = k.replace('cashflow:hyp-apps:', '')
        try { out[pk] = (await redis.get(k)) || [] } catch { out[pk] = [] }
      }
      return res.json({ all: out })
    }
    if (!projectKey) return res.status(400).json({ error: 'projectKey required' })
    // One read of the project record, used for both the rates and the applications.
    // Negotiated projects ("N:<dealId>") are not in Xero and have no real
    // applications - contracted rates are all there is, which is the fallback.
    const project = xeroId ? ((await getProject(xeroId)) || {}) : {}
    const [rates, hyp] = await Promise.all([
      loadRates(redis, projectKey, xeroId, project),
      redis.get(HKEY(projectKey)).then(v => v || []).catch(() => ([])),
    ])
    return res.json({
      contractedRates: rates || null,
      hasRates: !!(rates && Array.isArray(rates.items) && rates.items.length),
      seedContractWorks: rates && Array.isArray(rates.items) ? buildContractWorksFromRates(rates.items) : [],
      hypApps: Array.isArray(hyp) ? hyp : [],
      latestApplication: latestApplicationSeed(project),
    })
  }

  if (req.method === 'POST') {
    const { action, projectKey } = req.body || {}
    if (!projectKey) return res.status(400).json({ error: 'projectKey required' })

    if (action === 'save-hyp') {
      const { hypApps } = req.body
      if (!Array.isArray(hypApps)) return res.status(400).json({ error: 'hypApps array required' })
      await redis.set(HKEY(projectKey), hypApps)
      return res.json({ ok: true, hypApps })
    }

    if (action === 'delete-hyp') {
      const { id } = req.body
      const list = (await redis.get(HKEY(projectKey)).catch(() => ([]))) || []
      const next = list.filter(a => a.id !== id)
      await redis.set(HKEY(projectKey), next)
      return res.json({ ok: true, hypApps: next })
    }

    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(405).json({ error: 'Method not allowed' })
}

// Re-export for potential server use (kept internal otherwise).
export { computeApplicationSummary }
