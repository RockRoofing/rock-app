import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, fetchProfitAndLoss, fetchAccountCodeMap, fetchGeneralLedgerByAccountMonth } from '../../lib/xero'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Pulls ONLY the Profit & Loss benchmark (the "In Xero" figures) — cheap:
// one API call per month, 6 months = ~6 calls. Safe to run on demand.
export default async function handler(req, res) {
  if (!requireRole(req, res, ['accounts', 'management', 'admin'])) return
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  try {
    let tokens = await getTokens()
    if (!tokens?.refresh_token) return res.status(400).json({ error: 'Xero not connected.' })
    try {
      const nt = await refreshXeroToken(tokens.refresh_token)
      if (nt?.access_token) { tokens = { ...tokens, ...nt }; await saveTokens(tokens) }
    } catch (e) { return res.status(400).json({ error: 'Could not refresh Xero token — reconnect Xero.' }) }

    const tenantId = tokens.tenant_id
    const months = {}
    let monthsPulled = 0
    const now = new Date()
    // One Chart-of-Accounts fetch so P&L lines carry account CODES (lets the grey
    // P&L reference respect the app's code-based Account Categorisation).
    const nameToCode = await fetchAccountCodeMap(tokens.access_token, tenantId).catch(() => ({}))
    for (let k = 0; k < 13; k++) {   // current + previous 12 months (full FY + same-month-last-year)
      const d = new Date(now.getFullYear(), now.getMonth() - k, 1)
      const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
      try {
        const pl = await fetchProfitAndLoss(tokens.access_token, tenantId, from, to, nameToCode)
        months[from.slice(0, 7)] = {
          accounts: pl.accounts,
          bySection: pl.bySection,
          byCode: pl.byCode,
          codeSection: pl.codeSection || {},
          incomeTotal: pl.incomeTotal,
          costOfSalesTotal: pl.costOfSalesTotal,
          overheadsTotal: pl.overheadsTotal || 0,
        }
        monthsPulled++
        await sleep(250)
      } catch (e) { console.error('P&L pull failed for', from, e.message) }
    }

    if (monthsPulled === 0) return res.status(502).json({ error: 'Xero returned no P&L data. Try again shortly.' })

    // Merge with any existing benchmark so we don't lose months outside this window.
    const existing = (await redis.get('xero:pl-benchmark').catch(() => null)) || { months: {} }
    const mergedMonths = { ...(existing.months || {}), ...months }
    const payload = { months: mergedMonths, updatedAt: new Date().toISOString() }
    await redis.set('xero:pl-benchmark', payload)

    // -- General-ledger pull for OVERHEAD and SALES codes (one pass) --
    // Used by the Budgets cell drill-down (overheads) and the new Sales page (sales).
    // Full-replace so back-dated items, credit notes, edits and voids are picked up.
    let ledgerMonths = 0
    try {
      const catConfig = (await redis.get('config:account-categorisation').catch(() => null)) || {}
      const normCat = (code) => {
        const cfg = catConfig[String(code)]
        let c = cfg && cfg.category
        if (c === 'ignore') c = 'overheads'
        if (['labour', 'materials', 'overheads', 'sales'].includes(c)) return c
        if (String(code) === '320' || String(code) === '321') return 'labour'
        if (String(code) === '200') return 'sales'
        return 'materials'
      }
      const overheadCodes = new Set()
      const salesCodes = new Set()
      const consider = (code) => {
        const cat = normCat(code)
        if (cat === 'overheads') overheadCodes.add(String(code))
        else if (cat === 'sales') salesCodes.add(String(code))
      }
      for (const code of Object.keys(catConfig)) consider(code)
      for (const mo of Object.keys(mergedMonths)) {
        for (const code of Object.keys(mergedMonths[mo].byCode || {})) consider(code)
        // Any code the P&L puts in the INCOME section is a sales code, whatever its
        // number - so the ledger pull matches the chart's sales figure exactly.
        const cs = mergedMonths[mo].codeSection || {}
        for (const code of Object.keys(cs)) {
          if (cs[code] === 'income') salesCodes.add(String(code))
        }
      }
      salesCodes.add('200')   // Sales is always code 200

      const monthKeys = Object.keys(months).sort()
      const fromDateStr = monthKeys.length ? `${monthKeys[0]}-01` : null
      const allCodes = new Set([...overheadCodes, ...salesCodes])
      if (allCodes.size && fromDateStr) {
        const glResult = await fetchGeneralLedgerByAccountMonth(tokens.access_token, tenantId, fromDateStr, allCodes)
        const { byCodeMonth } = glResult
        // Split into overhead vs sales ledgers.
        const ohLedger = {}, salesLedger = {}
        for (const code of Object.keys(byCodeMonth)) {
          if (overheadCodes.has(code)) ohLedger[code] = byCodeMonth[code]
          if (salesCodes.has(code)) salesLedger[code] = byCodeMonth[code]
        }
        const now = new Date().toISOString()
        const fetchMeta = { pages: glResult.pages, totalJournalsSeen: glResult.totalJournalsSeen, journalCount: glResult.journalCount, lastError: glResult.lastError || null, salesCodes: [...salesCodes], overheadCodes: [...overheadCodes] }
        await redis.set('overhead:ledger', { byCodeMonth: ohLedger, updatedAt: now, fromDate: fromDateStr, fetchMeta })
        await redis.set('sales:ledger', { byCodeMonth: salesLedger, updatedAt: now, fromDate: fromDateStr, fetchMeta })
        ledgerMonths = Object.keys(byCodeMonth).length
      }
    } catch (e) {
      console.error('ledger pull failed:', e.message)
    }

    res.json({ ok: true, monthsPulled, ledgerAccounts: ledgerMonths, updatedAt: payload.updatedAt })
  } catch (e) {
    console.error('sync-benchmark error:', e)
    res.status(500).json({ error: e.message })
  }
}
