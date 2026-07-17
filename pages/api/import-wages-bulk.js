import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, getProjectsFromCategories } from '../../lib/xero'
import { mergeCosts } from '../../lib/mergeCosts'
import { costLineKey, mergeDedupe } from '../../lib/costDedupe'
import * as xlsx from 'xlsx'

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

const num = (x) => { const n = parseFloat(String(x ?? '').replace(/[£,]/g, '')); return isNaN(n) ? 0 : n }
function excelDate(v) {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.toISOString().slice(0, 10) }
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  // "28 Feb 2023" / "28 Sept 2023" style (Xero Account Transactions text dates)
  const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12' }
  const t = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(s)
  if (t) {
    const mo = MONTHS[t[2].slice(0, 4).toLowerCase()] || MONTHS[t[2].slice(0, 3).toLowerCase()]
    if (mo) return `${t[3]}-${mo}-${t[1].padStart(2, '0')}`
  }
  return s
}

// Header names we accept for each field (from Xero Account Transactions export).
const H = {
  date: ['Date'],
  desc: ['Description'],
  ref: ['Reference'],
  debit: ['Debit (GBP)', 'Debit'],
  credit: ['Credit (GBP)', 'Credit'],
  net: ['Net (GBP)', 'Gross (GBP)'],
  projects: ['Projects'],   // the tracking category column
  code: ['Account Code'],
}
function colIndex(headers, names) {
  for (const n of names) { const i = headers.indexOf(n); if (i !== -1) return i }
  return -1
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['accounts', 'management', 'admin'])) return
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { fileData } = req.body
    if (!fileData) return res.status(400).json({ error: 'No file provided' })

    const wb = xlsx.read(Buffer.from(fileData, 'base64'), { type: 'buffer', cellDates: true })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })

    // Find the header row (the one containing 'Date' and 'Projects').
    let hIdx = rows.findIndex(r => Array.isArray(r) && r.includes('Date') && r.includes('Projects'))
    if (hIdx === -1) {
      return res.status(400).json({ error: 'Could not find a "Projects" column. Re-run the Account Transactions report with ALL COLUMNS selected (so the Projects tracking column is included), then re-upload.' })
    }
    const headers = rows[hIdx].map(h => (h == null ? '' : String(h).trim()))
    const col = {
      date: colIndex(headers, H.date), desc: colIndex(headers, H.desc), ref: colIndex(headers, H.ref),
      debit: colIndex(headers, H.debit), credit: colIndex(headers, H.credit), net: colIndex(headers, H.net),
      projects: colIndex(headers, H.projects), code: colIndex(headers, H.code),
    }
    if (col.projects === -1) {
      return res.status(400).json({ error: 'No "Projects" column found. Make sure all columns are selected when exporting.' })
    }

    const redis = await getRedis()
    if (!redis) return res.status(500).json({ error: 'No Redis connection' })
    const seenAccounts = (await redis.get('costs:seen-accounts').catch(() => null)) || {}
    if (!seenAccounts['320']) seenAccounts['320'] = 'Direct Wages'

    // Only import lines that carry a project tag. Blank-Projects lines are the
    // contra/pool side of the tracking-transfer journals (and the original lump
    // journal) — including them would net to zero, so they are skipped.
    const byProject = new Map()
    const untagged = []   // wage debits with NO project tag (unallocated)
    for (let i = hIdx + 1; i < rows.length; i++) {
      const r = rows[i]
      if (!Array.isArray(r)) continue
      const proj = col.projects !== -1 ? r[col.projects] : null

      // Amount: prefer Debit-Credit (GBP); fall back to Net (GBP).
      let amount = 0
      if (col.debit !== -1 || col.credit !== -1) amount = num(r[col.debit]) - num(r[col.credit])
      else if (col.net !== -1) amount = num(r[col.net])
      if (amount === 0) continue

      if (!proj || !String(proj).trim()) {
        // Untagged wage line. Only positive (debit) amounts represent unallocated
        // cost; the negative contra lines are the transfer reversals — skip those.
        if (amount > 0) {
          untagged.push({
            date: excelDate(col.date !== -1 ? r[col.date] : null),
            supplier: 'Direct Wages',
            description: col.desc !== -1 ? String(r[col.desc] || '') : 'Direct Wages',
            reference: col.ref !== -1 ? String(r[col.ref] || '') : '',
            amount, accountCode: '320', accountName: 'Direct Wages', source: 'wages',
          })
        }
        continue
      }
      const tracking = String(proj).trim()

      if (!byProject.has(tracking)) byProject.set(tracking, { labour: 0, lines: [] })
      const g = byProject.get(tracking)
      g.labour += amount
      g.lines.push({
        date: excelDate(col.date !== -1 ? r[col.date] : null),
        supplier: 'Direct Wages',
        description: col.desc !== -1 ? String(r[col.desc] || '') : 'Direct Wages',
        reference: col.ref !== -1 ? String(r[col.ref] || '') : '',
        amount,
        accountCode: '320',
        accountName: 'Direct Wages',
        type: 'Labour',
        source: 'wages',
      })
    }

    if (untagged.length) {
      const existingUn = (await redis.get('costs:untagged:wages').catch(() => null)) || []
      const { merged } = mergeDedupe(existingUn, untagged, costLineKey)
      await redis.set('costs:untagged:wages', merged)
    }

    if (byProject.size === 0 && untagged.length === 0) {
      return res.status(400).json({ error: 'No wage lines found. Check the Projects column is populated in the export.' })
    }

    // Resolve tracking names -> trackingOptionId (cost cache key).
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
      if (!projectId) { unmatched++; summary.push({ project: tracking, matched: false, total: g.labour }); continue }
      matched++
      const existing = (await redis.get(`costs:wages:${projectId}`).catch(() => null))?.lines || []
      const { merged, added } = mergeDedupe(existing, g.lines, costLineKey)
      totalAdded += added
      const labour = merged.reduce((s, l) => s + (l.amount || 0), 0)
      await redis.set(`costs:wages:${projectId}`, {
        labourSpend: labour, materialsSpend: 0, totalCosts: labour, lines: merged,
        calculatedAt: new Date().toISOString(), source: 'wages_bulk',
      })
      await mergeCosts(redis, projectId)
      summary.push({ project: tracking, matched: true, labour, total: labour, lines: merged.length, added })
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
    console.error('import-wages-bulk error:', e)
    return res.status(500).json({ error: e.message || 'Import failed' })
  }
}
