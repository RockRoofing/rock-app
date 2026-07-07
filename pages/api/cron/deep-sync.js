import { getTokens, saveTokens, getAllProjectSettings, getEffectiveValuationDate } from '../../../lib/db'
import { refreshXeroToken, getProjectsFromCategories } from '../../../lib/xero'

const OVERLAP_DAYS = 120
const LABOUR_ACCOUNT_CODES = ['321', '320']
const COST_OF_SALE_ACCOUNTS = ['321', '322', '310', '311', '331', '330', '329', '333', '334', '335', '336']

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

function dedupKey(line) {
  return `${line.date}|${line.amount}|${line.accountCode}|${String(line.description).slice(0, 30)}`
}

async function fetchBillsForProject(accessToken, tenantId, trackingOptionId, trackingCategoryId, fromDate) {
  const lines = []
  let labourTotal = 0
  let materialsTotal = 0
  let page = 1

  while (true) {
    let url = `https://api.xero.com/api.xro/2.0/Invoices?Type=ACCPAY&page=${page}&pageSize=100&DateFrom=${fromDate}`
    if (trackingCategoryId) {
      url += `&TrackingCategoryID=${trackingCategoryId}&TrackingOptionID=${trackingOptionId}`
    }

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Xero-Tenant-Id': tenantId,
        Accept: 'application/json'
      }
    })
    if (!res.ok) break
    const data = await res.json()
    const invoices = data.Invoices || []
    if (invoices.length === 0) break

    for (const inv of invoices) {
      await sleep(80)
      const r2 = await fetch(
        `https://api.xero.com/api.xro/2.0/Invoices/${inv.InvoiceID}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-Tenant-Id': tenantId,
            Accept: 'application/json'
          }
        }
      )
      if (!r2.ok) continue
      const d2 = await r2.json()
      const full = (d2.Invoices || [])[0]
      if (!full) continue

      const matchedLines = (full.LineItems || []).filter(line =>
        (line.Tracking || []).some(t => t.TrackingOptionID === trackingOptionId)
      )
      if (matchedLines.length === 0) continue

      for (const line of matchedLines) {
        if (!COST_OF_SALE_ACCOUNTS.includes(line.AccountCode)) continue
        if (line.AccountCode === '320') continue
        const amount = line.LineAmount || 0
        const isLabour = LABOUR_ACCOUNT_CODES.includes(line.AccountCode)
        if (isLabour) labourTotal += amount
        else materialsTotal += amount
        lines.push({
          date: full.DateString?.slice(0, 10),
          supplier: full.Contact?.Name || '',
          description: line.Description || '',
          amount,
          accountCode: line.AccountCode,
          type: isLabour ? 'Labour' : 'Materials'
        })
      }
    }

    if (invoices.length < 100) break
    page++
    await sleep(300)
  }

  return { lines, labourTotal, materialsTotal }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis connection' })

  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'No tokens' })
    const newTokens = await refreshXeroToken(tokens.refresh_token)
    tokens = { ...tokens, ...newTokens }
    await saveTokens(tokens)

    const tenantId = tokens.tenant_id
    const categoryProjects = await getProjectsFromCategories(tokens.access_token, tenantId)
    const activeProjects = categoryProjects.filter(p => p.status !== 'ARCHIVED')

    if (activeProjects.length === 0) return res.json({ ok: true, message: 'No active projects' })

    // Get rotation pointer — which project to sync tonight
    let pointer = 0
    try {
      const stored = await redis.get('deep-sync:pointer')
      if (stored !== null) pointer = parseInt(stored) || 0
    } catch {}

    // Wrap around if needed
    if (pointer >= activeProjects.length) pointer = 0

    const cp = activeProjects[pointer]
    const projectId = cp.trackingOptionId
    const catId = cp.trackingCategoryId

    // Calculate from date (120 days ago)
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - OVERLAP_DAYS)
    const fromDateStr = fromDate.toISOString().split('T')[0]

    // Fetch bills for this project from last 120 days
    const { lines: newLines, labourTotal: newLabour, materialsTotal: newMaterials } = await fetchBillsForProject(
      tokens.access_token, tenantId, projectId, catId, fromDateStr
    )

    // Load existing cost lines from Redis
    let existingLines = []
    try {
      const stored = await redis.get(`costs:lines:${projectId}`)
      if (stored) existingLines = stored
    } catch {}

    // Split existing lines into old (before overlap window) and recent
    const existingOld = existingLines.filter(l => l.date && l.date < fromDateStr)
    const existingRecent = existingLines.filter(l => !l.date || l.date >= fromDateStr)

    // Deduplicate: new API lines take precedence over existing recent lines
    const existingKeys = new Set(existingRecent.map(dedupKey))
    const trulyNew = newLines.filter(l => !existingKeys.has(dedupKey(l)))

    // Merge: old lines + existing recent + truly new
    const mergedLines = [...existingOld, ...existingRecent, ...trulyNew]

    // Recalculate totals from merged lines
    let totalLabour = 0
    let totalMaterials = 0
    for (const line of mergedLines) {
      if (LABOUR_ACCOUNT_CODES.includes(line.accountCode)) totalLabour += line.amount
      else totalMaterials += line.amount
    }

    // Save merged data
    const now = new Date().toISOString()
    await redis.set(`costs:latest:${projectId}`, {
      labourSpend: totalLabour,
      materialsSpend: totalMaterials,
      totalCosts: totalLabour + totalMaterials,
      calculatedAt: now,
      source: 'deep_sync'
    })
    await redis.set(`costs:lines:${projectId}`, mergedLines)

    // Advance rotation pointer
    await redis.set('deep-sync:pointer', (pointer + 1) % activeProjects.length)
    await redis.del('dashboard:cache')

    res.json({
      ok: true,
      project: cp.jobNo,
      fromDate: fromDateStr,
      newBillLines: newLines.length,
      trulyNewLines: trulyNew.length,
      totalLines: mergedLines.length,
      totalLabour,
      totalMaterials,
      nextProject: activeProjects[(pointer + 1) % activeProjects.length]?.jobNo
    })

  } catch (e) {
    console.error('Deep sync error:', e)
    res.status(500).json({ error: e.message })
  }
}

