import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens, getAllProjectSettings } from '../../lib/db'
import { refreshXeroToken, getProjectsFromCategories } from '../../lib/xero'

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

const DEFAULT_LABOUR_CODES = ['320', '321']
const KNOWN_COS_CODES = ['310', '311', '320', '321', '322', '325', '328', '329', '330', '331', '333', '334', '335', '336']
function categoryOf(code, config) {
  const cfg = config[String(code)]
  if (cfg && ['labour', 'materials', 'ignore'].includes(cfg.category)) return cfg.category
  const c = String(code)
  if (DEFAULT_LABOUR_CODES.includes(c)) return 'labour'
  if (KNOWN_COS_CODES.includes(c)) return 'materials'
  return 'ignore'
}

export default async function handler(req, res) {
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

    const knownCodes = new Set(Object.keys(catConfig))

    // ── Resolve the project list (name per trackingOptionId). Prefer the
    //    dashboard cache; if empty, get it from Xero and cache for an hour so we
    //    don't depend on the dashboard having been viewed recently. ──
    let projectList = []   // [{ id, name }]
    if (Array.isArray(dash) && dash.length) {
      projectList = dash.filter(p => p.id && p.id !== '__UNASSIGNED__').map(p => ({ id: p.id, name: p.name || p.jobNo || '' }))
    }
    if (projectList.length === 0) {
      const cachedList = await redis.get('projects:list').catch(() => null)
      if (Array.isArray(cachedList) && cachedList.length) projectList = cachedList
      else {
        try {
          let tokens = await getTokens()
          if (tokens?.refresh_token) {
            try { const nt = await refreshXeroToken(tokens.refresh_token); tokens = { ...tokens, ...nt }; await saveTokens(tokens) } catch {}
            const cats = await getProjectsFromCategories(tokens.access_token, tokens.tenant_id)
            projectList = cats.map(cp => ({ id: cp.trackingOptionId, name: cp.name || cp.jobNo || '' }))
            await redis.set('projects:list', projectList, { ex: 60 * 60 })
          }
        } catch (e) { console.error('project list fetch failed:', e.message) }
      }
    }

    // Read per-project cost + invoice lines DIRECTLY from Redis (always current,
    // independent of the dashboard cache freshness).
    const perProject = await Promise.all(projectList.map(async (p) => {
      const [cLines, iLines] = await Promise.all([
        redis.get(`costs:lines:${p.id}`).then(v => v || []).catch(() => []),
        redis.get(`invoiced:lines:${p.id}`).then(v => v || []).catch(() => []),
      ])
      return { name: p.name, costLines: cLines, invoiceLines: iLines }
    }))

    // Four tab datasets. Each line: project (or null), category, categorised, month.
    const bills = []      // Costs tab: Labour/Materials only
    const wages = []      // Direct Wages tab
    const invoices = []   // Sales Invoices tab
    const ignored = []    // Ignored tab: Ignore-category + untagged overheads

    // 1. Categorised items (per-project, read directly above).
    for (const p of perProject) {
      const project = p.name
      for (const l of (p.costLines || [])) {
        const cat = categoryOf(l.accountCode, catConfig)
        const rec = {
          date: l.date || '', month: monthOf(l.date),
          supplier: l.supplier || '', description: l.description || '', reference: l.reference || '',
          amount: l.amount || 0, accountCode: l.accountCode || '',
          category: cat, categorised: true, project,
          hasCode: knownCodes.has(String(l.accountCode)),
          source: l.accountCode === '320' ? 'wages' : 'bills',
        }
        if (cat === 'ignore') ignored.push(rec)
        else if (rec.source === 'wages') wages.push(rec)
        else bills.push(rec)
      }
      for (const l of (p.invoiceLines || [])) {
        invoices.push({
          date: l.date || '', month: monthOf(l.date),
          invoiceNumber: l.invoiceNumber || '', contact: l.contact || '', reference: l.reference || '',
          total: l.total || 0, amountDue: l.amountDue || 0,
          categorised: true, project,
        })
      }
    }

    // 2. Uncategorised (untagged) items.
    for (const l of (untBills || [])) {
      const cat = categoryOf(l.accountCode, catConfig)
      const rec = {
        date: l.date || '', month: monthOf(l.date),
        supplier: l.supplier || '', description: l.description || '', reference: l.reference || '',
        amount: l.amount || 0, accountCode: l.accountCode || '',
        category: cat, categorised: false, project: null,
        hasCode: knownCodes.has(String(l.accountCode)),
        source: 'bills',
      }
      if (cat === 'ignore') ignored.push(rec)
      else bills.push(rec)
    }
    for (const l of (untWages || [])) {
      wages.push({
        date: l.date || '', month: monthOf(l.date),
        supplier: l.supplier || 'Direct Wages', description: l.description || '', reference: l.reference || '',
        amount: l.amount || 0, accountCode: '320',
        category: 'labour', categorised: false, project: null,
        hasCode: knownCodes.has('320'), source: 'wages',
      })
    }
    for (const l of (unassignedInv || [])) {
      invoices.push({
        date: l.date || '', month: monthOf(l.date),
        invoiceNumber: l.invoiceNumber || '', contact: l.contact || '', reference: l.reference || '',
        total: l.total || 0, amountDue: l.amountDue || 0,
        categorised: false, project: null,
      })
    }

    const appCategorised = {}
    for (const p of perProject) {
      for (const l of (p.costLines || [])) {
        const m = monthOf(l.date); if (!m) continue
        appCategorised[m] = appCategorised[m] || { cost: 0, sales: 0 }
        appCategorised[m].cost += (l.amount || 0)
      }
      for (const l of (p.invoiceLines || [])) {
        const m = monthOf(l.date); if (!m) continue
        appCategorised[m] = appCategorised[m] || { cost: 0, sales: 0 }
        appCategorised[m].sales += (l.total || 0)
      }
    }

    const missingCodes = [...new Set(
      [...bills, ...ignored].map(l => String(l.accountCode)).filter(c => c && !knownCodes.has(c))
    )]

    res.json({
      bills, wages, invoices, ignored,
      appCategorised, benchmark,
      knownCodes: [...knownCodes], missingCodes,
      benchmarkUpdatedAt: benchmark?.updatedAt || null,
      _diag: {
        projectsRead: perProject.length,
        projectListEmpty: projectList.length === 0,
        untaggedWagesRaw: (untWages || []).length,
        untaggedBillsRaw: (untBills || []).length,
        categorisedWageLines: perProject.reduce((s, p) => s + (p.costLines || []).filter(l => String(l.accountCode) === '320').length, 0),
        totalCostLines: perProject.reduce((s, p) => s + (p.costLines || []).length, 0),
        wagesTabCount: wages.length,
      },
    })
  } catch (e) {
    console.error('bookkeeping error:', e)
    res.status(500).json({ error: e.message })
  }
}
