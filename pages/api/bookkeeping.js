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

    // Four tab datasets. Each line: project (or null), category, categorised, month.
    const bills = []      // Costs tab: Labour/Materials only
    const wages = []      // Direct Wages tab
    const invoices = []   // Sales Invoices tab
    const ignored = []    // Ignored tab: Ignore-category + untagged overheads

    // 1. Categorised items (from per-project dashboard cache).
    for (const p of (dash || [])) {
      if (p.id === '__UNASSIGNED__') continue
      const project = p.name || p.jobNo || ''
      for (const l of (p._costLines || [])) {
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
      for (const l of (p._invoiceLines || [])) {
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

    const missingCodes = [...new Set(
      [...bills, ...ignored].map(l => String(l.accountCode)).filter(c => c && !knownCodes.has(c))
    )]

    res.json({
      bills, wages, invoices, ignored,
      appCategorised, benchmark,
      knownCodes: [...knownCodes], missingCodes,
      benchmarkUpdatedAt: benchmark?.updatedAt || null,
    })
  } catch (e) {
    console.error('bookkeeping error:', e)
    res.status(500).json({ error: e.message })
  }
}
