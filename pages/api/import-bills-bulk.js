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
const KNOWN_COS_CODES = ['310', '311', '320', '321', '322', '325', '328', '329', '330', '331', '333', '334', '335', '336']
function categoryFor(code, name, config) {
  const cfg = config[String(code)] || config[String(name)]
  if (cfg) {
    let c = cfg.category
    if (c === 'ignore') c = 'overheads'   // legacy migration
    if (['labour', 'materials', 'overheads', 'uncategorised'].includes(c)) return c
  }
  const c = String(code)
  if (DEFAULT_LABOUR_CODES.includes(c)) return 'labour'
  if (KNOWN_COS_CODES.includes(c)) return 'materials'
  return 'uncategorised'   // unknown codes excluded & flagged until categorised
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['accounts', 'management', 'admin'])) return
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
      if (category === 'ignore' || category === 'overheads' || category === 'uncategorised') continue

      if (!byProject.has(tracking)) byProject.set(tracking, { labour: 0, materials: 0, total: 0, lines: [] })
      const g = byProject.get(tracking)
      const isLabour = category === 'labour'
      g.total += amount
      if (isLabour) g.labour += amount; else g.materials += amount
      g.lines.push({ ...lineRec, accountName: '', type: isLabour ? 'Labour' : 'Materials' })
    }

    // ── Dates PRESENT in this file (replace per-day, NOT a min..max span, so a
    //    stray outlier date can only ever affect its own day) ──
    const fileDates = new Set()
    for (const g of byProject.values()) for (const l of g.lines) if (l.date) fileDates.add(l.date)
    for (const l of untagged) if (l.date) fileDates.add(l.date)
    const inRange = (d) => d && fileDates.has(d)   // "in range" == a day the file covers
    const rangeFrom = [...fileDates].sort()[0] || null
    const rangeTo = [...fileDates].sort().slice(-1)[0] || null

    // For the "days in app not covered by this file" warning: gather the days that
    // currently have bill data in the app (across projects + untagged) BEFORE we
    // replace anything, so we can tell the user which days this upload left alone.
    const existingDayValue = {}   // 'YYYY-MM-DD' -> total £ currently in app
    try {
      const allIds = [...new Set([...(await redis.get('projects:list').catch(() => null) || []).map(p => p.id)])].filter(Boolean)
      for (const id of allIds) {
        const rec = await redis.get(`costs:bills:${id}`).catch(() => null)
        for (const l of (rec?.lines || [])) if (l.date) existingDayValue[l.date] = (existingDayValue[l.date] || 0) + (l.amount || 0)
      }
      const un = (await redis.get('costs:untagged:bills').catch(() => null)) || []
      for (const l of un) if (l.date) existingDayValue[l.date] = (existingDayValue[l.date] || 0) + (l.amount || 0)
    } catch {}

    // Store untagged bills — replace only the DAYS present in the file; keep the rest.
    let untaggedKept = 0
    if (fileDates.size) {
      const existingUn = (await redis.get('costs:untagged:bills').catch(() => null)) || []
      const outside = existingUn.filter(l => !inRange(l.date))
      untaggedKept = outside.length
      await redis.set('costs:untagged:bills', [...outside, ...untagged])
    } else if (untagged.length) {
      const existingUn = (await redis.get('costs:untagged:bills').catch(() => null)) || []
      await redis.set('costs:untagged:bills', [...existingUn, ...untagged])
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
    let totalReplaced = 0, projectsCleared = 0
    const summary = []

    // Build a set of all known projectIds (so we can clear the range even for
    // projects NOT present in this file — exact mirror: if it's not in Xero's
    // export for this range, it shouldn't remain in the app for this range).
    const allProjectIds = new Set([...trackingByName.values()])
    // Map tracking name -> lines from this file.
    const fileByProjectId = new Map()
    for (const [tracking, g] of byProject.entries()) {
      const projectId = trackingByName.get(tracking.toLowerCase())
      if (!projectId) { unmatched++; summary.push({ project: tracking, matched: false, total: g.total }); continue }
      matched++
      fileByProjectId.set(projectId, { tracking, lines: g.lines })
    }

    for (const projectId of allProjectIds) {
      const fileEntry = fileByProjectId.get(projectId)
      const fileLines = fileEntry ? fileEntry.lines : []
      const existing = (await redis.get(`costs:bills:${projectId}`).catch(() => null))?.lines || []
      // Keep existing lines OUTSIDE the file's date range; replace INSIDE with file lines.
      const outside = rangeFrom ? existing.filter(l => !inRange(l.date)) : existing
      const removedInRange = existing.length - outside.length
      const combined = [...outside, ...fileLines]

      // If nothing changed for this project (no file lines, nothing removed), skip write.
      if (fileLines.length === 0 && removedInRange === 0) continue

      if (fileLines.length === 0 && removedInRange > 0) projectsCleared++
      totalReplaced += fileLines.length

      const labour = combined.filter(l => l.type === 'Labour').reduce((s, l) => s + (l.amount || 0), 0)
      const materials = combined.filter(l => l.type !== 'Labour').reduce((s, l) => s + (l.amount || 0), 0)
      await redis.set(`costs:bills:${projectId}`, {
        labourSpend: labour, materialsSpend: materials, totalCosts: labour + materials, lines: combined,
        calculatedAt: new Date().toISOString(), source: 'bills_bulk',
      })
      await mergeCosts(redis, projectId)
      if (fileEntry) summary.push({ project: fileEntry.tracking, matched: true, labour, materials, total: labour + materials, lines: combined.length, replacedInRange: fileLines.length, removedInRange })
    }

    try { await redis.set('costs:seen-accounts', seenAccounts) } catch {}
    await redis.del('dashboard:cache')
    await redis.set('sync-bills:at', new Date().toISOString())

    // Days that have bill data in the app but are NOT covered by this file — but
    // ONLY flag gaps WITHIN the file's own date span (between its earliest and
    // latest date). Days far outside the file's period aren't relevant and would
    // otherwise list all of history on every single-month upload.
    const daysNotCovered = (rangeFrom && rangeTo) ? Object.entries(existingDayValue)
      .filter(([d]) => !fileDates.has(d) && d >= rangeFrom && d <= rangeTo)
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => b.date.localeCompare(a.date)) : []

    return res.json({
      ok: true,
      mode: 'replace-by-range',
      rangeFrom, rangeTo,
      projectsMatched: matched,
      projectsUnmatched: unmatched,
      totalLinesProcessed: [...byProject.values()].reduce((s, g) => s + g.lines.length, 0),
      linesReplacedInRange: totalReplaced,
      projectsClearedInRange: projectsCleared,
      untaggedLines: untagged.length,
      untaggedKept,
      unmatchedProjects: unmatched,
      daysCovered: fileDates.size,
      daysNotCovered,
      totalCosts: summary.filter(s => s.matched).reduce((s, x) => s + (x.total || 0), 0),
      summary: summary.sort((a, b) => (b.total || 0) - (a.total || 0)),
    })
  } catch (e) {
    console.error('import-bills-bulk error:', e)
    return res.status(500).json({ error: e.message || 'Import failed' })
  }
}
