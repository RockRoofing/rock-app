import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, getProjectsFromCategories } from '../../lib/xero'
import { mergeCosts } from '../../lib/mergeCosts'

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
const num = (x) => { const n = parseFloat(String(x || '').replace(/[£,]/g, '')); return isNaN(n) ? 0 : n }
const parseDate = (s) => {
  if (!s) return null
  const t = String(s).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return t
}

// Find a header column by trying several likely names (case-insensitive).
function findCol(headers, names) {
  const lower = headers.map(h => h.toLowerCase().trim())
  for (const n of names) { const i = lower.indexOf(n.toLowerCase()); if (i !== -1) return i }
  // fuzzy contains
  for (let i = 0; i < lower.length; i++) for (const n of names) if (lower[i].includes(n.toLowerCase())) return i
  return -1
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { fileData } = req.body
    if (!fileData) return res.status(400).json({ error: 'No file provided' })

    const csv = Buffer.from(fileData, 'base64').toString('utf8')
    const allLines = csv.split(/\r?\n/)
    // Find the header row (the line containing Date + an amount + a tracking column).
    let headerIdx = allLines.findIndex(l => /date/i.test(l) && /(gross|amount|debit|net)/i.test(l))
    if (headerIdx === -1) headerIdx = 0
    const headers = parseCSVLine(allLines[headerIdx]).map(h => h.trim())

    const col = {
      date: findCol(headers, ['Date']),
      desc: findCol(headers, ['Description', 'Details', 'Narration']),
      ref: findCol(headers, ['Reference', 'Source']),
      amount: findCol(headers, ['Gross', 'Amount', 'Net', 'Debit']),
      credit: findCol(headers, ['Credit']),
      tracking: findCol(headers, ['TrackingOption1', 'Tracking', 'Project', 'Projects']),
    }
    if (col.tracking === -1 || col.amount === -1) {
      return res.status(400).json({ error: 'Could not find a project/tracking column and an amount column in this export. Please export Account Transactions for account 320 with the Projects tracking category shown as a column, then re-upload. (If unsure, send James the file so the columns can be mapped.)' })
    }

    const redis = await getRedis()
    if (!redis) return res.status(500).json({ error: 'No Redis connection' })
    const seenAccounts = (await redis.get('costs:seen-accounts').catch(() => null)) || {}
    if (!seenAccounts['320']) seenAccounts['320'] = 'Direct Wages'

    const byProject = new Map()
    for (let i = headerIdx + 1; i < allLines.length; i++) {
      const raw = allLines[i]
      if (!raw || !raw.trim()) continue
      const c = parseCSVLine(raw)
      const tracking = (c[col.tracking] || '').trim()
      if (!tracking) continue
      let amount = num(c[col.amount])
      if (col.credit !== -1) amount = num(c[col.amount]) - num(c[col.credit])
      if (amount === 0) continue

      if (!byProject.has(tracking)) byProject.set(tracking, { labour: 0, lines: [] })
      const g = byProject.get(tracking)
      g.labour += amount
      g.lines.push({
        date: parseDate(c[col.date]),
        supplier: 'Direct Wages',
        description: col.desc !== -1 ? (c[col.desc] || '') : 'Direct Wages',
        reference: col.ref !== -1 ? (c[col.ref] || '') : '',
        amount,
        accountCode: '320',
        accountName: 'Direct Wages',
        type: 'Labour',
        source: 'wages',
      })
    }

    if (byProject.size === 0) {
      return res.status(400).json({ error: 'No project-tagged wage lines found. Make sure the export shows the Projects tracking category against each line.' })
    }

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
    const summary = []
    for (const [tracking, g] of byProject.entries()) {
      const projectId = trackingByName.get(tracking.toLowerCase())
      if (!projectId) { unmatched++; summary.push({ project: tracking, matched: false, total: g.labour }); continue }
      matched++
      await redis.set(`costs:wages:${projectId}`, {
        labourSpend: g.labour, materialsSpend: 0, totalCosts: g.labour, lines: g.lines,
        calculatedAt: new Date().toISOString(), source: 'wages_bulk',
      })
      await mergeCosts(redis, projectId)
      summary.push({ project: tracking, matched: true, labour: g.labour, total: g.labour, lines: g.lines.length })
    }

    try { await redis.set('costs:seen-accounts', seenAccounts) } catch {}
    await redis.del('dashboard:cache')

    return res.json({
      ok: true,
      projectsMatched: matched,
      projectsUnmatched: unmatched,
      totalLinesProcessed: [...byProject.values()].reduce((s, g) => s + g.lines.length, 0),
      totalCosts: [...byProject.values()].reduce((s, g) => s + g.labour, 0),
      summary: summary.sort((a, b) => (b.total || 0) - (a.total || 0)),
    })
  } catch (e) {
    console.error('import-wages-bulk error:', e)
    return res.status(500).json({ error: e.message || 'Import failed' })
  }
}
