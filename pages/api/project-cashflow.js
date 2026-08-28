import { requireRole } from '../../lib/portalAuth'
import { getProject } from '../../lib/db'
import { buildContractWorksFromRates, computeApplicationSummary, buildAppVariations, varKey } from '../../lib/applications'
import { projectVariations, varNumberOf } from '../../lib/variationInstruct'

const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }

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

  // Variation percentages already certified on that application, keyed the same way the
  // applications screen keys them (varNumber|description) so they match the tracker.
  //
  // buildAppVariations() gives the frozen list on a sent application and rebuilds a
  // draft's from variationData, which is exactly the distinction we want.
  const appVars = buildAppVariations(latest, projectVariations(project))
  const varPct = {}
  for (const v of appVars) {
    if (!v || !v.key) continue
    varPct[v.key] = v.pctComplete == null ? 0 : num(v.pctComplete)
  }

  // MATERIALS ON SITE ALREADY CLAIMED. This is money IN - stock bought and certified to
  // the customer with a mark-up - and is NOT the same thing as the forecast's materials
  // lines, which are supplier payments going out. Returned so the forecast can SHOW what
  // has been claimed, not so it can spend it again.
  const mats = (Array.isArray(latest.materials) ? latest.materials : []).filter(m => m && m.kind !== 'group')
  const materialsClaimed = mats.reduce((s, m) => {
    const base = m.total != null ? num(m.total) : (num(m.qty) * num(m.rate))
    const line = base * (1 + num(m.markupPct) / 100)
    return s + line * ((m.pctComplete == null ? 100 : num(m.pctComplete)) / 100)
  }, 0)

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
    varPct,
    materialsClaimed,
    materialsClaimedLines: mats.length,
  }
}

// The variation tracker for this project, valued and flagged, so the forecast can carry
// instructed variations as revenue and offer the uninstructed ones.
//
// instructed is a STRING ('yes'/'no'), not a boolean - `!!v.instructed` and
// `v.instructed === false` both get it wrong, which is why it is normalised here once
// rather than tested at each use.
function variationSeed(project) {
  return projectVariations(project).map(v => ({
    key: varKey(v),
    varNumber: varNumberOf(v) || '',
    description: v.descriptionFull || v.description || '',
    materials: num(v.materials),
    labour: num(v.labour),
    profit: num(v.profit),
    value: num(v.materials) + num(v.labour) + num(v.profit),
    instructed: (v.instructed === 'yes' || v.instructed === true) ? 'yes' : 'no',
  })).filter(v => v.value !== 0 || v.varNumber)
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

      // REAL APPLICATIONS, keyed by xeroId, so the chart can show actuals where they
      // exist instead of a forecast that has already been overtaken. Keyed by xeroId
      // rather than projectKey because the forecast keys are job numbers ("L:J240") and
      // the applications live on the Xero-keyed project record - the client already holds
      // the jobNo -> xeroId map and joins them.
      const actuals = {}
      try {
        let cursor = 0
        const pkeys = []
        do {
          const [next, batch] = await redis.scan(cursor, { match: 'project:*', count: 200 })
          cursor = Number(next)
          for (const k of (batch || [])) pkeys.push(k)
        } while (cursor)
        for (const k of pkeys) {
          const rec = await redis.get(k).catch(() => null)
          const apps = Array.isArray(rec && rec.applications) ? rec.applications : []
          if (!apps.length) continue
          const sorted = apps.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0))
          const trackerVars = projectVariations(rec)
          const out = []
          let prev = null
          for (const a of sorted) {
            // Same prevGross rule as pages/api/applications.js - the typed
            // prevCertGross if there is one, otherwise the previous application's
            // computed gross. Getting this wrong makes every certificate cumulative.
            const prevGross = !prev ? 0
              : (a.prevCertGross != null ? num(a.prevCertGross) : computeApplicationSummary(prev, 0).grossCurrent)
            let thisCert = 0
            try {
              const app = { ...a, variations: buildAppVariations(a, trackerVars) }
              thisCert = num(computeApplicationSummary(app, prevGross).thisCert.total)
            } catch {}
            out.push({
              seq: a.seq || 0,
              appNumber: a.appNumber || null,
              status: a.status || '',
              // The period the application VALUES, for matching a forecast to it.
              endDate: a.valDate || a.appDate || (a.monthKey ? `${a.monthKey}-28` : ''),
              // When the money is actually due. Off the application itself, which beats
              // any forecast payment term - it is the contractual date.
              dueDate: a.finalDate || a.paymentDate || '',
              thisCert,
            })
            prev = a
          }
          const keep = out.filter(a => a.endDate)
          if (keep.length) actuals[k.replace('project:', '')] = keep
        }
      } catch {}

      return res.json({ all: out, actuals })
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
      variations: variationSeed(project),
      // ACTUAL spend to date, the same cache Project Financials reads
      // (costs:latest:<xeroId>, written by the wip-sync cron from Xero bills plus the
      // labour journals). Negotiated projects are not in Xero, so there is nothing to
      // read and this comes back null rather than a misleading zero.
      actuals: xeroId ? await (async () => {
        const c = (await redis.get(`costs:latest:${xeroId}`).catch(() => null)) || null
        if (!c) return null
        return { labourSpend: num(c.labourSpend), materialsSpend: num(c.materialsSpend), calculatedAt: c.calculatedAt || null }
      })() : null,
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
