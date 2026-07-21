import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, fetchBankSummary } from '../../lib/xero'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

const CATEGORY_OF = (code, config) => {
  const cfg = config[String(code)]
  let c = cfg && cfg.category
  if (c === 'ignore') c = 'overheads'
  if (['labour', 'materials', 'overheads', 'sales'].includes(c)) return c
  if (String(code) === '320' || String(code) === '321') return 'labour'
  if (String(code) === '200') return 'sales'
  return 'materials'
}

// GET  /api/business-financials            -> summary from the P&L benchmark + cached bank data
// POST /api/business-financials { syncBank:true } -> refresh the Bank Summary (money in/out) per month
export default async function handler(req, res) {
  if (!requireRole(req, res, ['admin'])) return
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  const [benchmark, catConfig, bank] = await Promise.all([
    redis.get('xero:pl-benchmark').then(v => v || { months: {} }).catch(() => ({ months: {} })),
    redis.get('config:account-categorisation').then(v => v || {}).catch(() => ({})),
    redis.get('bank:summary-by-month').then(v => v || { months: {} }).catch(() => ({ months: {} })),
  ])

  if (req.method === 'POST' && (req.body || {}).syncBank) {
    try {
      let tokens = await getTokens()
      if (!tokens) return res.status(401).json({ error: 'Not connected to Xero' })
      try { const nt = await refreshXeroToken(tokens.refresh_token); if (nt?.access_token) { tokens = { ...tokens, ...nt }; await saveTokens(tokens) } } catch {}
      const tenantId = tokens.tenant_id
      const monthsBack = Math.min(parseInt(req.body.monthsBack || 18), 36)
      const months = {}
      const now = new Date()
      for (let i = monthsBack - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
        const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
        try {
          const bs = await fetchBankSummary(tokens.access_token, tenantId, from, to)
          months[from.slice(0, 7)] = bs
        } catch (e) { /* skip a month that fails */ }
      }
      const payload = { months, updatedAt: new Date().toISOString() }
      await redis.set('bank:summary-by-month', payload)
      return res.json({ ok: true, months: Object.keys(months).length, updatedAt: payload.updatedAt })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  // Assemble the monthly series for the summary charts from the P&L benchmark.
  const bm = benchmark.months || {}
  const bankM = bank.months || {}
  const monthKeys = [...new Set([...Object.keys(bm), ...Object.keys(bankM)])].sort()

  const series = monthKeys.map(mo => {
    const b = bm[mo] || {}
    const byCode = b.byCode || {}
    const abs = (v) => Math.abs(v || 0)
    const sales = abs(b.incomeTotal)
    const cos = abs(b.costOfSalesTotal)
    const overheads = abs(b.overheadsTotal)
    const grossMargin = sales > 0 ? (sales - cos) / sales : null
    // Labour breakdown: direct wages (320) vs subcontract labour (321/328/334).
    const directWages = abs(byCode['320'])
    const subContract = abs(byCode['321']) + abs(byCode['328']) + abs(byCode['334'])
    const bs = bankM[mo] || {}
    return {
      month: mo,
      sales,
      cos,
      overheads,
      grossMarginPct: grossMargin == null ? null : Math.round(grossMargin * 1000) / 10,
      directWages,
      subContract,
      cashIn: bs.cashIn || 0,
      cashOut: bs.cashOut || 0,
      cashNet: (bs.cashIn || 0) - (bs.cashOut || 0),
    }
  })

  // Cost-of-sale spend by category, aggregated across all months in the benchmark.
  const costPie = { labour: 0, materials: 0, overheads: 0 }
  for (const mo of Object.keys(bm)) {
    const b = bm[mo]
    for (const [code, val] of Object.entries(b.byCode || {})) {
      const sec = (b.codeSection && b.codeSection[code]) || ''
      if (sec === 'income') continue
      const cat = CATEGORY_OF(code, catConfig)
      if (cat === 'sales') continue
      if (cat === 'labour') costPie.labour += Math.abs(val || 0)
      else if (cat === 'overheads') costPie.overheads += Math.abs(val || 0)
      else costPie.materials += Math.abs(val || 0)
    }
  }

  return res.json({
    series,
    costPie,
    benchmarkUpdatedAt: benchmark.updatedAt || null,
    bankUpdatedAt: bank.updatedAt || null,
  })
}
