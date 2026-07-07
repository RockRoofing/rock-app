import { getTokens, saveTokens } from '../../../lib/db'
import { refreshXeroToken, extractJobNoFromDescription } from '../../../lib/xero'

const PROJECT_NAME_MAP = {
  'gas lane': 'J178',
  'russell hill': 'J190',
  'warwick road': 'J194',
  'chain walk': 'J196',
  'hollis croft': 'J197',
  'atlas street': 'J209',
  'royaltea': 'J219',
  'shenley wood': 'J223',
  'crystal palace': 'J224',
  'accrington community': 'J226',
  'farmstead drive': 'J228',
  'bosden': 'J229',
  'st chads': 'J230',
  'the squirrels': 'J235',
  'thurrock': 'J238',
  'mettis aerospace': 'J239',
  'market drayton': 'J240',
  'bradford works': 'J241',
  'winnersh': 'J242',
  'christchurch primary': 'J243',
  'waungron': 'J244',
  'lancaster moor': 'J147',
  'morfa road': 'J14',
  'siemens': 'J162',
}

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

export default async function handler(req, res) {
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis connection' })

  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'No tokens' })
    const newTokens = await refreshXeroToken(tokens.refresh_token)
    tokens = { ...tokens, ...newTokens }
    await saveTokens(tokens)

    const tenantId = tokens.tenant_id
    const PAGES_PER_CALL = 20

    const progress = await redis.get('backfill:labour:progress') || { page: 1, done: false }

    if (progress.done) {
      return res.json({ ok: true, message: 'Backfill already complete', done: true })
    }

    const labourByJob = {}
    let page = progress.page
    let totalProcessed = 0
    let reachedEnd = false

    for (let i = 0; i < PAGES_PER_CALL; i++) {
      const url = `https://api.xero.com/api.xro/2.0/Invoices?Type=ACCPAY&page=${page}&pageSize=100`

      const r = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Xero-Tenant-Id': tenantId,
          'Accept': 'application/json',
          'If-Modified-Since': 'Thu, 01 Jun 2023 00:00:00 GMT'
        }
      })

      if (!r.ok) break

      const data = await r.json()
      const invoices = data.Invoices || []
      totalProcessed += invoices.length

      for (const inv of invoices) {
        // First pass — find job number anywhere on the invoice
        let jobNo = null

        // Check invoice reference field first
        jobNo = extractJobNoFromDescription(inv.Reference, PROJECT_NAME_MAP)

        // If not found, scan all line item descriptions
        if (!jobNo) {
          for (const line of inv.LineItems || []) {
            jobNo = extractJobNoFromDescription(line.Description, PROJECT_NAME_MAP)
            if (jobNo) break
          }
        }

        if (!jobNo) continue

        // Second pass — sum all 321 lines using that job number
        for (const line of inv.LineItems || []) {
          if (line.AccountCode !== '321') continue
          const amount = line.LineAmount || 0
          labourByJob[jobNo] = (labourByJob[jobNo] || 0) + amount
        }
      }

      if (invoices.length < 100) {
        reachedEnd = true
        break
      }

      page++
      await new Promise(r => setTimeout(r, 300))
    }

    const existing = await redis.get('backfill:labour') || {}
    const merged = { ...existing }
    for (const [job, amount] of Object.entries(labourByJob)) {
      merged[job] = (merged[job] || 0) + amount
    }
    await redis.set('backfill:labour', merged)

    if (reachedEnd) {
      await redis.set('backfill:labour:progress', { page, done: true })
      await redis.del('dashboard:cache')
    } else {
      await redis.set('backfill:labour:progress', { page, done: false })
    }

    res.json({
      ok: true,
      done: reachedEnd,
      pagesProcessed: reachedEnd ? page - progress.page + 1 : PAGES_PER_CALL,
      currentPage: page,
      invoicesProcessed: totalProcessed,
      jobsFound: Object.keys(labourByJob).length,
      totalJobsStored: Object.keys(merged).length,
      message: reachedEnd ? 'Backfill complete!' : `Page ${page} reached — call again to continue`
    })

  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
