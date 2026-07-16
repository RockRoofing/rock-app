import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, getProjectsFromCategories } from '../../lib/xero'
import { mergeCosts } from '../../lib/mergeCosts'
import { costLineKey, mergeDedupe } from '../../lib/costDedupe'

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

function parseCSVLine(line) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = '' } else cur += c }
  }
  out.push(cur); return out
}
const num = (x) => { const n = parseFloat(String(x || '').replace(/,/g, '')); return isNaN(n) ? 0 : n }
const parseDate = (s) => {
  if (!s) return null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s).trim())
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return s
}

const DEFAULT_LABOUR_CODES = ['320', '321']
function categoryFor(code, name, config) {
  const cfg = config[String(code)] || config[String(name)]
  if (cfg && ['labour', 'materials', 'ignore'].includes(cfg.category)) return cfg.category
  return DEFAULT_LABOUR_CODES.includes(String(code)) ? 'labour' : 'materials'
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { fileData } = req.body
    if (!fileData) return res.status(400).json({ error: 'No file provided' })

    const csv = Buffer.from(fileData, 'base64').toString('utf8')
    const lines = csv.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return res.status(400).json({ error: 'Empty file' })

    const headers = parseCSVLine(lines[0]).map(h => h.trim())
    const H = (name) => headers.indexOf(name)
    const col = {
      contact: H('ContactName'), invNo: H('InvoiceNumber'), date: H('InvoiceDate'),
      desc: H('Description'), lineAmount: H('LineAmount'), accountCode: H('AccountCode'),
      tracking: H('TrackingOption1'), type: H('Type'),
    }
    if (col.lineAmount === -1 || col.accountCode === -1 || col.tracking === -1) {
      return res.status(400).json({ error: 'This does not look like a Xero Bills export (missing LineAmount / AccountCode / TrackingOption1 columns).' })
    }

    const redis = await getRedis()
    if (!redis) return res.status(500).json({ error: 'No Redis connection' })

    // Account categorisation config (admin-managed) + seen-accounts recording.
    const catConfig = (await redis.get('config:account-categorisation').catch(() => null)) || {}
    const seenAccounts = (await redis.get('costs:seen-accounts').catch(() => null)) || {}

    // Group cost lines by project (TrackingOption1). Untagged lines are captured
    // separately for the Bookkeeping reconciliation page (not silently dropped).
    const byProject = new Map()   // tracking -> { labour, materials, total, lines:[] }
    const untagged = []           // bill lines with NO tracking category
    let allCosCount = 0           // count of all cost-of-sale lines seen
    for (let i = 1; i < lines.length; i++) {
      const c = parseCSVLine(lines[i])
      const tracking = (c[col.tracking] || '').trim()
      const code = (c[col.accountCode] || '').trim()
      if (!code) continue
      const amount = num(c[col.lineAmount])
      if (amount === 0) continue

      if (!seenAccounts[code]) seenAccounts[code] = ''
      const category = categoryFor(code, '', catConfig)
      const description = c[col.desc] || ''
      const lineRec = {
        date: parseDate(c[col.date]),
        supplier: (c[col.contact] || '').trim() || description.split(' - ')[0] || '',
        description,
        reference: (c[col.invNo] || '').trim(),
        amount,
        accountCode: code,
        accountName: '',
        source: 'bills',
      }

      if (!tracking) {
        // No project tag — record for reconciliation, keep out of project costs.
        untagged.push({ ...lineRec, category })
        continue
      }
      if (category === 'ignore') continue

      if (!byProject.has(tracking)) byProject.set(tracking, { labour: 0, materials: 0, total: 0, lines: [] })
      const g = byProject.get(tracking)
      const isLabour = category === 'labour'
      g.total += amount
      if (isLabour) g.labour += amount; else g.materials += amount
      g.lines.push({ ...lineRec, accountName: '', type: isLabour ? 'Labour' : 'Materials' })
    }

    // Store untagged bills (merged/deduped) for the Bookkeeping page.
    if (untagged.length) {
      const existingUn = (await redis.get('costs:untagged:bills').catch(() => null)) || []
      const { merged } = mergeDedupe(existingUn, untagged, costLineKey)
      await redis.set('costs:untagged:bills', merged)
    }

    if (byProject.size === 0 && untagged.length === 0) {
      return res.status(400).json({ error: 'No bill lines found. Make sure the export includes the Projects tracking category.' })
    }

    // Resolve tracking names -> trackingOptionId (the cost cache key).
    const trackingByName = new Map()
    try {
      let tokens = await getTokens()
      if (tokens?.refresh_token) {
        try { const rt = await refreshXeroToken(tokens.refresh_token); if (rt?.access_token) { tokens = { ...tokens, ...rt }; await saveTokens(tokens) } } catch {}
        const cats = await getProjectsFromCategories(tokens.access_token, tokens.tenant_id)
        for (const cp of cats) trackingByName.set((cp.name || '').trim().toLowerCase(), cp.trackingOptionId)
      }
    } catch (e) { console.error('project resolve failed:', e) }

    let matched = 0, unmatched = 0
    let totalAdded = 0
    const summary = []
    for (const [tracking, g] of byProject.entries()) {
      const projectId = trackingByName.get(tracking.toLowerCase())
      if (!projectId) { unmatched++; summary.push({ project: tracking, matched: false, total: g.total }); continue }
      matched++
      // MERGE with any existing bill lines (so partial exports accumulate — Xero
      // caps exports at 500 lines, so 3 years takes several uploads).
      const existing = (await redis.get(`costs:bills:${projectId}`).catch(() => null))?.lines || []
      const { merged, added } = mergeDedupe(existing, g.lines, costLineKey)
      totalAdded += added
      const labour = merged.filter(l => LABOUR_ACCOUNT_CODES.includes(l.accountCode)).reduce((s, l) => s + (l.amount || 0), 0)
      const materials = merged.filter(l => !LABOUR_ACCOUNT_CODES.includes(l.accountCode)).reduce((s, l) => s + (l.amount || 0), 0)
      await redis.set(`costs:bills:${projectId}`, {
        labourSpend: labour, materialsSpend: materials, totalCosts: labour + materials, lines: merged,
        calculatedAt: new Date().toISOString(), source: 'bills_bulk',
      })
      await mergeCosts(redis, projectId)
      summary.push({ project: tracking, matched: true, labour, materials, total: labour + materials, lines: merged.length, added })
    }

    try { await redis.set('costs:seen-accounts', seenAccounts) } catch {}
    await redis.del('dashboard:cache')

    return res.json({
      ok: true,
      projectsMatched: matched,
      projectsUnmatched: unmatched,
      totalLinesProcessed: [...byProject.values()].reduce((s, g) => s + g.lines.length, 0),
      newLinesAdded: totalAdded,
      totalCosts: summary.filter(s => s.matched).reduce((s, x) => s + (x.total || 0), 0),
      summary: summary.sort((a, b) => (b.total || 0) - (a.total || 0)),
    })
  } catch (e) {
    console.error('import-bills-bulk error:', e)
    return res.status(500).json({ error: e.message || 'Import failed' })
  }
}
