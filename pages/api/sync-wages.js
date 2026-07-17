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

// ONE pass over ManualJournals in the window. For each 320 (Direct Wages) line
// that is project-tagged, return it WITH the tracking option NAME (e.g.
// "J242-Winnersh") so we can match by name (not GUID, which was failing) — the
// same approach as the fixed invoice sync. Rate-limit-safe (429 backoff).
async function fetchAllWageLines(at, tid, fromDate) {
  const out = []
  let page = 1
  while (true) {
    const url = `https://api.xero.com/api.xro/2.0/ManualJournals?page=${page}&pageSize=100`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${at}`, 'Xero-Tenant-Id': tid, Accept: 'application/json' } })
    if (res.status === 429) { await sleep(2000); continue }
    if (!res.ok) break
    const data = await res.json()
    const journals = data.ManualJournals || []
    if (journals.length === 0) break
    for (const j of journals) {
      const dateStr = (j.Date && String(j.Date).match(/\d{4}-\d{2}-\d{2}/)) ? String(j.Date).slice(0, 10) : (j.DateString ? j.DateString.slice(0, 10) : null)
      if (dateStr && dateStr < fromDate) continue
      for (const jl of (j.JournalLines || [])) {
        if (String(jl.AccountCode) !== '320') continue
        const amount = (jl.LineAmount || 0)
        if (amount <= 0) continue                 // keep positive (debit) project lines
        const trackingNames = []
        for (const t of (jl.Tracking || [])) { if (t.Option) trackingNames.push(String(t.Option).trim().toLowerCase()) }
        out.push({
          date: dateStr, supplier: 'Direct Wages', description: jl.Description || 'Direct Wages',
          reference: j.Narration || j.ManualJournalID || '', amount, accountCode: '320',
          type: 'Labour', source: 'wages', xeroLineId: jl.JournalLineID || null, xeroJournalId: j.ManualJournalID || null,
          trackingNames,
        })
      }
    }
    if (journals.length < 100) break
    page++; await sleep(1200)
  }
  return out
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

    // Map tracking-option NAME -> project id (same basis as CSV import).
    const cats = await getProjectsFromCategories(tokens.access_token, tenantId)
    const nameToId = new Map()
    for (const cp of cats) nameToId.set((cp.name || '').trim().toLowerCase(), cp.trackingOptionId)

    // One pass over all wage journal lines in the window.
    const all = await fetchAllWageLines(tokens.access_token, tenantId, winStr)

    // Group tagged lines per project; collect untagged for the unassigned bucket.
    const byProject = new Map()
    const untagged = []
    let taggedCount = 0
    for (const l of all) {
      let pid = null
      for (const tn of l.trackingNames) { if (nameToId.has(tn)) { pid = nameToId.get(tn); break } }
      if (pid) { if (!byProject.has(pid)) byProject.set(pid, []); byProject.get(pid).push(l); taggedCount++ }
      else untagged.push(l)
    }

    // Store per project — exact-mirror within window (replace in-window, keep older).
    // Clear in-window wages for ALL known projects first so removed tags disappear.
    for (const cp of cats) {
      const pid = cp.trackingOptionId
      const fresh = byProject.get(pid) || []
      const existing = (await redis.get(`costs:wages:${pid}`).catch(() => null))?.lines || []
      const older = existing.filter(l => !l.date || l.date < winStr)
      const combined = [...older, ...fresh]
      if (combined.length === 0 && existing.length === 0) continue
      const wTot = combined.reduce((s, l) => s + (l.amount || 0), 0)
      await redis.set(`costs:wages:${pid}`, { labourSpend: wTot, materialsSpend: 0, totalCosts: wTot, lines: combined, calculatedAt: new Date().toISOString(), source: 'sync_button' })
      await mergeCosts(redis, pid)
    }

    // Untagged wages -> unassigned bucket (replace in-window, keep older).
    const existingUn = (await redis.get('costs:untagged:wages').catch(() => null)) || []
    const olderUn = existingUn.filter(l => !l.date || l.date < winStr)
    await redis.set('costs:untagged:wages', [...olderUn, ...untagged])

    await redis.del('dashboard:cache')
    await redis.set('sync-wages:at', new Date().toISOString())
    res.json({ ok: true, months, wageLinesFetched: all.length, taggedToProjects: taggedCount, untagged: untagged.length, projectsTouched: byProject.size })
  } catch (e) {
    console.error('sync-wages error:', e)
    res.status(500).json({ error: e.message })
  }
}
