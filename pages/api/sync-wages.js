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

// Parse Xero's Microsoft-JSON date "/Date(1551312000000+0000)/" -> "YYYY-MM-DD".
// Handles the /Date(ms)/ form and plain ISO. Wage lines MUST have a date for the
// EOM report to be accurate, so callers should skip any line this can't resolve.
function parseXeroDate(v) {
  if (!v) return null
  const s = String(v)
  const m = s.match(/\/Date\((-?\d+)/)          // /Date(1551312000000+0000)/
  if (m) { const d = new Date(parseInt(m[1], 10)); return isNaN(d) ? null : d.toISOString().slice(0, 10) }
  const iso = s.match(/\d{4}-\d{2}-\d{2}/)       // already ISO (fallback)
  return iso ? iso[0] : null
}
// Best available date for a journal: Date, then DateString, then UpdatedDateUTC.
function journalDate(j) {
  return parseXeroDate(j.Date) || parseXeroDate(j.DateString) || parseXeroDate(j.UpdatedDateUTC) || null
}

// ONE pass over ManualJournals. The list ALREADY includes JournalLines and the
// date (in /Date(ms)/ format) — confirmed via diagnostic — so NO per-item fetch
// (that was the slowness). Filter to the window in code. For each 320 (Direct
// Wages) project-tagged line, return it WITH the tracking option NAME (match by
// name, not GUID). Rate-limit-safe (429 backoff).
async function fetchAllWageLines(at, tid, fromDate) {
  const out = []
  let skippedNoDate = 0
  let page = 1
  let guard = 0
  while (guard++ < 100) {
    const url = `https://api.xero.com/api.xro/2.0/ManualJournals?order=${encodeURIComponent('Date DESC')}&page=${page}&pageSize=100`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${at}`, 'Xero-Tenant-Id': tid, Accept: 'application/json' } })
    if (res.status === 429) { await sleep((parseInt(res.headers.get('Retry-After') || '2', 10) + 1) * 1000); continue }
    if (!res.ok) break
    const data = await res.json()
    const journals = data.ManualJournals || []
    if (journals.length === 0) break
    let allOlderThanWindow = journals.length > 0
    for (const j of journals) {
      const dateStr = journalDate(j)
      if (dateStr && dateStr >= fromDate) allOlderThanWindow = false
      if (dateStr && dateStr < fromDate) continue        // outside window
      for (const jl of (j.JournalLines || [])) {
        if (String(jl.AccountCode) !== '320') continue
        const amount = (jl.LineAmount || 0)
        if (amount <= 0) continue                          // keep positive (debit) project lines
        // A wage line without a resolvable date can't be attributed to a month, so
        // it would corrupt the EOM report. Skip it (and count it) rather than store
        // an undated line.
        if (!dateStr) { skippedNoDate++; continue }
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
    // Newest-first: once an entire page is older than the window, we're done.
    if (allOlderThanWindow) break
    if (journals.length < 100) break
    page++; await sleep(400)
  }
  out._skippedNoDate = skippedNoDate
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
        id: j.ManualJournalID,
        Date_raw: j.Date, DateString_raw: j.DateString,
        topLevelKeys: Object.keys(j),
        status: j.Status,
        narration: (j.Narration || '').slice(0, 40),
        hasLines: Array.isArray(j.JournalLines), lineCount: (j.JournalLines || []).length,
        codes: [...new Set((j.JournalLines || []).map(l => String(l.AccountCode)))],
      }))
      // Also fetch first journal's detail to see if lines + date appear by-ID
      let detailSample = null
      if (journals[0]?.ManualJournalID) {
        const rd = await fetch(`https://api.xero.com/api.xro/2.0/ManualJournals/${journals[0].ManualJournalID}`, { headers: { Authorization: `Bearer ${tokens.access_token}`, 'Xero-Tenant-Id': tenantId2, Accept: 'application/json' } })
        if (rd.ok) {
          const jd = ((await rd.json()).ManualJournals || [])[0]
          detailSample = {
            Date_raw: jd?.Date, DateString_raw: jd?.DateString,
            topLevelKeys: jd ? Object.keys(jd) : [],
            lineCount: (jd?.JournalLines || []).length,
            codes: [...new Set((jd?.JournalLines || []).map(l => String(l.AccountCode)))],
            firstLineKeys: (jd?.JournalLines || [])[0] ? Object.keys((jd.JournalLines)[0]) : [],
            firstLineTracking: (jd?.JournalLines || [])[0]?.Tracking || [],
          }
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

    // Store per project. Rebuild the line set so duplicates can't accumulate:
    //  • Keep genuine OLDER dated lines (before the window) — the sync only fetched
    //    the window, so we mustn't lose history.
    //  • Add the freshly-fetched in-window lines.
    //  • Deduplicate by Xero JournalLineID (fresh wins). Legacy lines without an
    //    xeroLineId that also have NO date are dropped — these were the orphaned
    //    "book under tracking categories" adjustments that could never leave the
    //    window and were being re-kept on every sync (the duplication bug).
    for (const cp of cats) {
      const pid = cp.trackingOptionId
      const fresh = byProject.get(pid) || []
      if (fresh.length === 0) continue          // nothing fetched for this project -> leave as-is
      const existing = (await redis.get(`costs:wages:${pid}`).catch(() => null))?.lines || []
      // Older dated history only (undated legacy orphans are intentionally excluded).
      const olderDated = existing.filter(l => l.date && l.date < winStr)
      const combinedRaw = [...olderDated, ...fresh]
      // De-dupe: prefer a stable Xero line id; otherwise fall back to a content key.
      const seen = new Set()
      const combined = []
      for (const l of combinedRaw) {
        const key = l.xeroLineId ? `id:${l.xeroLineId}` : `c:${l.date || 'ND'}|${(l.amount || 0).toFixed(2)}|${(l.description || '').trim()}|${l.reference || ''}`
        if (seen.has(key)) continue
        seen.add(key); combined.push(l)
      }
      const wTot = combined.reduce((s, l) => s + (l.amount || 0), 0)
      await redis.set(`costs:wages:${pid}`, { labourSpend: wTot, materialsSpend: 0, totalCosts: wTot, lines: combined, calculatedAt: new Date().toISOString(), source: 'sync_button' })
      await mergeCosts(redis, pid)
    }

    // Untagged wages -> unassigned bucket. Same rebuild rule: older dated history +
    // fresh, de-duplicated, undated legacy orphans dropped.
    if (untagged.length > 0) {
      const existingUn = (await redis.get('costs:untagged:wages').catch(() => null)) || []
      const olderUn = existingUn.filter(l => l.date && l.date < winStr)
      const seenUn = new Set()
      const combinedUn = []
      for (const l of [...olderUn, ...untagged]) {
        const key = l.xeroLineId ? `id:${l.xeroLineId}` : `c:${l.date || 'ND'}|${(l.amount || 0).toFixed(2)}|${(l.description || '').trim()}|${l.reference || ''}`
        if (seenUn.has(key)) continue
        seenUn.add(key); combinedUn.push(l)
      }
      await redis.set('costs:untagged:wages', combinedUn)
    }

    await redis.del('dashboard:cache')
    await redis.set('sync-wages:at', new Date().toISOString())
    res.json({ ok: true, months, wageLinesFetched: all.length, skippedNoDate: all._skippedNoDate || 0, taggedToProjects: taggedCount, untagged: untagged.length, projectsTouched: byProject.size })
  } catch (e) {
    console.error('sync-wages error:', e)
    res.status(500).json({ error: e.message })
  }
}
