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

const CONFIG_KEY = 'config:account-categorisation'   // { [code]: { name, category: 'labour'|'materials'|'ignore' } }
const SEEN_KEY = 'costs:seen-accounts'                // { [code]: name }  (populated by cost uploads)

// Sensible defaults so the split works before anything is configured. Anything
// not listed defaults to 'materials' (matches the old importer behaviour).
export const DEFAULT_LABOUR_CODES = ['320', '321']

// The standard cost-of-sale accounts, so the page is useful before any re-upload.
const BASE_ACCOUNTS = {
  '310': 'Cost of Goods Sold',
  '311': 'Material',
  '320': 'Direct Wages',
  '321': 'CIS Labour Expense',
  '322': 'CIS Materials Purchased',
  '325': 'Direct Expenses',
  '328': 'Sub Contractors',
  '329': 'Hotels',
  '330': 'Fuel, Parking & Tolls',
  '331': 'Food and Drinks',
  '333': 'Plant and Equipment Hire',
  '334': 'Sub-Contract Bona Fide',
  '335': 'Vehicle fines',
  '336': 'Design Services',
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['admin'])) return
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  if (req.method === 'GET') {
    const [config, seen] = await Promise.all([
      redis.get(CONFIG_KEY).then(v => v || {}).catch(() => ({})),
      redis.get(SEEN_KEY).then(v => v || {}).catch(() => ({})),
    ])
    // Merge: base cost-of-sale accounts + every seen account + any configured one.
    const codes = new Set([...Object.keys(BASE_ACCOUNTS), ...Object.keys(seen), ...Object.keys(config)])
    const accounts = [...codes].map(code => {
      const cfg = config[code] || {}
      const category = cfg.category || (DEFAULT_LABOUR_CODES.includes(code) ? 'labour' : 'materials')
      return { code, name: cfg.name || seen[code] || BASE_ACCOUNTS[code] || '', category }
    }).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    return res.json({ accounts })
  }

  if (req.method === 'POST') {
    const { accounts } = req.body || {}
    if (!Array.isArray(accounts)) return res.status(400).json({ error: 'accounts array required' })
    const config = {}
    for (const a of accounts) {
      if (!a || !a.code) continue
      const category = ['labour', 'materials', 'ignore'].includes(a.category) ? a.category : 'materials'
      config[String(a.code)] = { name: a.name || '', category }
    }
    await redis.set(CONFIG_KEY, config)
    await redis.del('dashboard:cache')   // costs re-derive on next read
    return res.json({ ok: true, saved: Object.keys(config).length })
  }

  res.status(405).end()
}
