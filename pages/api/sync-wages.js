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

// ONE pass over ManualJournals, DATE-FILTERED to the window via a `where` clause
// so we only pull journals in range (not all history) — this is the speed fix.
// The list usually carries Date; if a journal's lines are omitted we fetch that
// one by ID (rare, and now over a small set). Match tracking by NAME (not GUID).
// Rate-limit-safe (429 backoff).
async function fetchAllWageLines(at, tid, fromDate) {
  const out = []
  // Xero `where` wants Date >= DateTime(y,m,d)
  const [fy, fm, fd] = fromDate.split('-').map(n => parseInt(n, 10))
  const where = encodeURIComponent(`Date>=DateTime(${fy},${fm},${fd})`)
  let page = 1
  let guard = 0
  while (guard++ < 100) {
    const url = `https://api.xero.com/api.xro/2.0/ManualJournals?where=${where}&page=${page}&pageSize=100`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${at}`, 'Xero-Tenant-Id': tid, Accept: 'application/json' } })
    if (res.status === 429) { await sleep((parseInt(res.headers.get('Retry-After') || '2', 10) + 1) * 1000); continue }
    if (!res.ok) break
    const data = await res.json()
    const journals = data.ManualJournals || []
    if (journals.length === 0) break
    for (const j of journals) {
      let dateStr = (j.Date && String(j.Date).match(/\d{4}-\d{2}-\d{2}/)) ? String(j.Date).slice(0, 10) : (j.DateString ? j.DateString.slice(0, 10) : null)
      let jLines = j.JournalLines
      // Only fetch by ID if this journal's lines OR date are missing (rare now that
      // we're date-filtered to a small set).
      if (!Array.isArray(jLines) || jLines.length === 0 || !dateStr) {
        for (let a = 0; a < 4; a++) {
          const r = await fetch(`https://api.xero.com/api.xro/2.0/ManualJournals/${j.ManualJournalID}`, { headers: { Authorization: `Bearer ${at}`, 'Xero-Tenant-Id': tid, Accept: 'application/json' } })
          if (r.status === 429) { await sleep((parseInt(r.headers.get('Retry-After') || '2', 10) + 1) * 1000); continue }
          if (!r.ok) { jLines = jLines || []; break }
          const full = (((await r.json()).ManualJournals || [])[0] || {})
          jLines = full.JournalLines || jLines || []
          if (!dateStr) dateStr = (full.Date && String(full.Date).match(/\d{4}-\d{2}-\d{2}/)) ? String(full.Date).slice(0, 10) : (full.DateString ? full.DateString.slice(0, 10) : null)
          await sleep(300); break
        }
      }
      if (dateStr && dateStr < fromDate) continue
      for (const jl of (jLines || [])) {
        if (String(jl.AccountCode) !== '320') continue
        const amount = (jl.LineAmount || 0)
        if (amount <= 0) continue
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
    page++; await sleep(600)
  }
  return out
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['accounts', 'management', 'admin'])) return
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  const isDebug = req.query?.debug === '1' || req.body?.debug === true
  const last = await redis.get('sync-wages:at').catch(() => null)
  if (!isDebug && last && Date.now() - new Date(last).getTime() < 45000) {
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

    // DIAGNOSTIC: ?debug=1 returns raw facts about what Xero gives us, without
    // writing anything — so we can see WHY the fetch is empty.
    if (req.query?.debug === '1' || req.body?.debug === true) {
      const tenantId2 = tokens.tenant_id
      const r = await fetch(`https://api.xero.com/api.xro/2.0/ManualJournals?page=1&pageSize=100`, { headers: { Authorization: `Bearer ${tokens.access_token}`, 'Xero-Tenant-Id': tenantId2, Accept: 'application/json' } })
      const status = r.status
      let body = {}
      try { body = await r.json() } catch {}
      const journals = body.ManualJournals || []
      const sample = journals.slice(0, 5).map(j => ({
        id: j.ManualJournalID, date: j.DateString || j.Date, status: j.Status,
        narration: (j.Narration || '').slice(0, 40),
        hasLines: Array.isArray(j.JournalLines), lineCount: (j.JournalLines || []).length,
        codes: [...new Set((j.JournalLines || []).map(l => String(l.AccountCode)))],
      }))
      // Also fetch first journal's detail to see if lines appear by-ID
      let detailSample = null
      if (journals[0]?.ManualJournalID) {
        const rd = await fetch(`https://api.xero.com/api.xro/2.0/ManualJournals/${journals[0].ManualJournalID}`, { headers: { Authorization: `Bearer ${tokens.access_token}`, 'Xero-Tenant-Id': tenantId2, Accept: 'application/json' } })
        if (rd.ok) {
          const jd = ((await rd.json()).ManualJournals || [])[0]
          detailSample = { lineCount: (jd?.JournalLines || []).length, codes: [...new Set((jd?.JournalLines || []).map(l => String(l.AccountCode)))], firstLineTracking: (jd?.JournalLines || [])[0]?.Tracking || [] }
        }
      }
      return res.json({ debug: true, listStatus: status, totalJournalsPage1: journals.length, windowFrom: winStr, sample, detailSample })
    }

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

    // SAFETY: if the fetch returned nothing at all, treat it as a failed pull and
    // do NOT wipe anything (rate-limit / error / empty response should never
    // delete existing wages). Abort cleanly.
    if (all.length === 0) {
      await redis.set('sync-wages:at', new Date().toISOString())
      return res.json({ ok: true, months, wageLinesFetched: 0, taggedToProjects: 0, untagged: 0, projectsTouched: 0, note: 'No wage journal lines returned from Xero — nothing changed (existing data left intact).' })
    }

    // Store per project — exact-mirror within window, but ONLY replace a project's
    // in-window wages when the fetch actually returned lines FOR THAT PROJECT.
    // If a project has no fresh lines, leave its existing data untouched (never
    // wipe on an empty result).
    for (const cp of cats) {
      const pid = cp.trackingOptionId
      const fresh = byProject.get(pid) || []
      if (fresh.length === 0) continue          // nothing fetched for this project -> leave as-is
      const existing = (await redis.get(`costs:wages:${pid}`).catch(() => null))?.lines || []
      const older = existing.filter(l => !l.date || l.date < winStr)
      const combined = [...older, ...fresh]
      const wTot = combined.reduce((s, l) => s + (l.amount || 0), 0)
      await redis.set(`costs:wages:${pid}`, { labourSpend: wTot, materialsSpend: 0, totalCosts: wTot, lines: combined, calculatedAt: new Date().toISOString(), source: 'sync_button' })
      await mergeCosts(redis, pid)
    }

    // Untagged wages -> unassigned bucket. Only replace in-window if we actually
    // fetched untagged lines; otherwise leave the existing bucket intact.
    if (untagged.length > 0) {
      const existingUn = (await redis.get('costs:untagged:wages').catch(() => null)) || []
      const olderUn = existingUn.filter(l => !l.date || l.date < winStr)
      await redis.set('costs:untagged:wages', [...olderUn, ...untagged])
    }

    await redis.del('dashboard:cache')
    await redis.set('sync-wages:at', new Date().toISOString())
    res.json({ ok: true, months, wageLinesFetched: all.length, taggedToProjects: taggedCount, untagged: untagged.length, projectsTouched: byProject.size })
  } catch (e) {
    console.error('sync-wages error:', e)
    res.status(500).json({ error: e.message })
  }
}
