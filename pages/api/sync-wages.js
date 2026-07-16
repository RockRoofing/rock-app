import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, getProjectsFromCategories } from '../../lib/xero'
import { mergeCosts } from '../../lib/mergeCosts'

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

async function fetchWages(at, tid, trackingOptionId, fromDate) {
  const lines = []
  let page = 1
  const modifiedSince = new Date(fromDate + 'T00:00:00Z').toUTCString()
  while (true) {
    const url = `https://api.xero.com/api.xro/2.0/ManualJournals?page=${page}&pageSize=100`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${at}`, 'Xero-Tenant-Id': tid, Accept: 'application/json', 'If-Modified-Since': modifiedSince } })
    if (!res.ok) break
    const data = await res.json()
    const journals = data.ManualJournals || []
    if (journals.length === 0) break
    for (const j of journals) {
      const dateStr = (j.Date && String(j.Date).match(/\d{4}-\d{2}-\d{2}/)) ? String(j.Date).slice(0, 10) : (j.DateString ? j.DateString.slice(0, 10) : null)
      if (dateStr && dateStr < fromDate) continue
      for (const jl of (j.JournalLines || [])) {
        if (jl.AccountCode !== '320') continue
        const tagged = (jl.Tracking || []).some(t => t.TrackingOptionID === trackingOptionId)
        if (!tagged) continue
        const amount = (jl.LineAmount || 0)
        if (amount <= 0) continue
        lines.push({
          date: dateStr, supplier: 'Direct Wages', description: jl.Description || 'Direct Wages',
          reference: j.Narration || j.ManualJournalID || '', amount, accountCode: '320',
          type: 'Labour', source: 'wages', xeroLineId: jl.JournalLineID || null, xeroJournalId: j.ManualJournalID || null,
        })
      }
    }
    if (journals.length < 100) break
    page++; await sleep(300)
  }
  return lines
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['accounts', 'management', 'admin'])) return
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  const last = await redis.get('sync-wages:at').catch(() => null)
  if (last && Date.now() - new Date(last).getTime() < 45000) {
    return res.status(429).json({ error: 'Just synced — please wait a moment before syncing again.' })
  }

  try {
    let tokens = await getTokens()
    if (!tokens?.refresh_token) return res.status(400).json({ error: 'Xero not connected.' })
    try { const nt = await refreshXeroToken(tokens.refresh_token); if (nt?.access_token) { tokens = { ...tokens, ...nt }; await saveTokens(tokens) } }
    catch { return res.status(400).json({ error: 'Could not refresh Xero token — reconnect Xero.' }) }
    const tenantId = tokens.tenant_id

    const months = Math.min(24, Math.max(1, parseInt(req.body?.months) || 6))
    const win = new Date(); win.setMonth(win.getMonth() - months)
    const winStr = win.toISOString().split('T')[0]

    const cats = await getProjectsFromCategories(tokens.access_token, tenantId)
    let projectsDone = 0, wageLinesTotal = 0
    for (const cp of cats) {
      const pid = cp.trackingOptionId
      try {
        const wLines = await fetchWages(tokens.access_token, tenantId, pid, winStr)
        const existing = (await redis.get(`costs:wages:${pid}`).catch(() => null))?.lines || []
        const outside = existing.filter(l => !l.date || l.date < winStr)
        const combined = [...outside, ...wLines]
        const wTot = combined.reduce((s, l) => s + (l.amount || 0), 0)
        await redis.set(`costs:wages:${pid}`, { labourSpend: wTot, materialsSpend: 0, totalCosts: wTot, lines: combined, calculatedAt: new Date().toISOString(), source: 'sync_button' })
        await mergeCosts(redis, pid)
        projectsDone++; wageLinesTotal += wLines.length
        await sleep(120)
      } catch (e) { console.error('sync wages failed', cp.jobNo, e.message) }
    }

    await redis.del('dashboard:cache')
    await redis.set('sync-wages:at', new Date().toISOString())
    res.json({ ok: true, months, projectsDone, wageLinesRefreshed: wageLinesTotal })
  } catch (e) {
    console.error('sync-wages error:', e)
    res.status(500).json({ error: e.message })
  }
}
