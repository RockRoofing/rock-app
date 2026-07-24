import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, fetchBankSummary, fetchOutstandingBills, fetchOutstandingReceivables } from '../../lib/xero'

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

  const view = req.query.view || (req.body && req.body.view) || 'summary'

  // ── Budgets (stored monthly targets per category) ─────────────────────────
  if (view === 'budgets') {
    if (req.method === 'POST') {
      const { budgets } = req.body || {}
      if (budgets && typeof budgets === 'object') {
        await redis.set('config:business-budgets', budgets)
        return res.json({ ok: true })
      }
      return res.status(400).json({ error: 'budgets object required' })
    }
    const budgets = await redis.get('config:business-budgets').then(v => v || {}).catch(() => ({}))
    // Actuals by month from the benchmark: sales, cos, overheads.
    const bm = benchmark.months || {}
    const actuals = {}
    for (const mo of Object.keys(bm)) {
      const b = bm[mo]
      actuals[mo] = {
        sales: Math.abs(b.incomeTotal || 0),
        costOfSales: Math.abs(b.costOfSalesTotal || 0),
        overheads: Math.abs(b.overheadsTotal || 0),
      }
    }
    return res.json({ budgets, actuals, benchmarkUpdatedAt: benchmark.updatedAt || null })
  }

  // -- Overheads budget grid (mirror of the Overheads P&L by financial year) --
  // Rows = every account categorised 'overheads'; columns = FY months.
  // Stores per-code/per-month budgets and a per-code forecast method.
  if (view === 'budgets-overheads') {
    if (req.method === 'POST') {
      const { budgets, forecastMethods, forecastOverrides, hiddenRows, lockForecast } = req.body || {}
      if (budgets !== undefined) await redis.set('config:overhead-budgets', budgets || {})
      if (forecastMethods !== undefined) await redis.set('config:overhead-forecast-methods', forecastMethods || {})
      if (forecastOverrides !== undefined) await redis.set('config:overhead-forecast-overrides', forecastOverrides || {})
      if (hiddenRows !== undefined) await redis.set('config:overhead-hidden-rows', hiddenRows || [])
      if (req.body && req.body.card3moCodes !== undefined) await redis.set('config:overhead-3mo-card-codes', req.body.card3moCodes || [])
      // Lock in a full-year forecast snapshot (kept as a dated history).
      if (lockForecast) {
        const locks = (await redis.get('config:overhead-forecast-locks').catch(() => null)) || []
        locks.unshift({
          lockedAt: new Date().toISOString(),
          fyEnd: lockForecast.fyEnd || null,
          total: Number(lockForecast.total) || 0,
          note: lockForecast.note || '',
        })
        // Keep the most recent 24 locks.
        await redis.set('config:overhead-forecast-locks', locks.slice(0, 24))
      }
      return res.json({ ok: true })
    }

    const [budgets, forecastMethods, forecastOverrides, hiddenRows, forecastLocks, card3moCodes, chart] = await Promise.all([
      redis.get('config:overhead-budgets').then(v => v || {}).catch(() => ({})),          // { code: amount }  (flat monthly budget)
      redis.get('config:overhead-forecast-methods').then(v => v || {}).catch(() => ({})),  // { code: 1|2|3 }
      redis.get('config:overhead-forecast-overrides').then(v => v || {}).catch(() => ({})),// { code: { 'YYYY-MM': amount } }
      redis.get('config:overhead-hidden-rows').then(v => v || []).catch(() => ([])),        // [ code, ... ]
      redis.get('config:overhead-forecast-locks').then(v => v || []).catch(() => ([])),     // [ {lockedAt, fyEnd, total, note} ]
      redis.get('config:overhead-3mo-card-codes').then(v => v || null).catch(() => null),   // [ code ] or null = all
      redis.get('config:chart-of-accounts').then(v => v || []).catch(() => ([])),
    ])
    const chartNames = {}
    for (const a of (Array.isArray(chart) ? chart : [])) chartNames[String(a.code)] = a.name

    const bm = benchmark.months || {}

    // Which codes are overheads: any code categorised 'overheads' in the config,
    // PLUS any code that appears in the benchmark and resolves to 'overheads'.
    const overheadCodes = new Set()
    for (const [code, cfg] of Object.entries(catConfig)) {
      if (CATEGORY_OF(code, catConfig) === 'overheads') overheadCodes.add(String(code))
    }
    for (const mo of Object.keys(bm)) {
      for (const code of Object.keys(bm[mo].byCode || {})) {
        if (CATEGORY_OF(code, catConfig) === 'overheads') overheadCodes.add(String(code))
      }
    }

    const overheadAccounts = [...overheadCodes].map(code => ({
      code,
      name: (catConfig[code] && catConfig[code].name) || chartNames[code] || '',
    })).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))

    // Per-code, per-month ACTUALS from the benchmark (magnitude).
    const actualsByCode = {}
    for (const { code } of overheadAccounts) {
      actualsByCode[code] = {}
      for (const mo of Object.keys(bm)) {
        const v = (bm[mo].byCode || {})[code]
        if (v != null) actualsByCode[code][mo] = Math.abs(v)
      }
    }

    // Which months have benchmark data at all (so the client knows a month is
    // "complete" = has actuals). A month is treated as complete if it exists in the
    // benchmark AND is not in the future.
    const availableMonths = Object.keys(bm).sort()

    return res.json({
      overheadAccounts,
      actualsByCode,
      availableMonths,
      budgets,
      forecastMethods,
      forecastOverrides,
      hiddenRows,
      forecastLocks,
      card3moCodes,
      benchmarkUpdatedAt: benchmark.updatedAt || null,
    })
  }

  // -- Sales by transaction date (includes WIP, which posts to code 200) --
  // Monthly totals from the P&L benchmark (sales codes); line-level detail from the
  // stored sales ledger captured at sync time.
  if (view === 'sales') {
    if (req.method === 'POST') {
      if (req.body && req.body.monthlyTarget !== undefined) {
        await redis.set('config:sales-monthly-target', Number(req.body.monthlyTarget) || 0)
      }
      return res.json({ ok: true })
    }
    const bm = benchmark.months || {}
    const normCategory = (code) => {
      const c = CATEGORY_OF(code, catConfig)
      if (String(code) === '200') return 'sales'
      return c
    }
    // Sales codes = code 200, anything categorised 'sales', plus any code the P&L
    // classifies in the INCOME section (matches the chart to the ledger).
    const salesCodes = new Set(['200'])
    for (const code of Object.keys(catConfig)) if (normCategory(code) === 'sales') salesCodes.add(String(code))
    for (const mo of Object.keys(bm)) {
      const cs = bm[mo].codeSection || {}
      for (const code of Object.keys(cs)) if (cs[code] === 'income') salesCodes.add(String(code))
    }

    const ledger = (await redis.get('sales:ledger').catch(() => null)) || { byCodeMonth: {} }
    const monthlyTarget = (await redis.get('config:sales-monthly-target').catch(() => null)) || 0
    let tokenScope = null
    try { const tk = await getTokens(); tokenScope = tk?.scope || null } catch {}
    // Flatten ledger lines to a single list. Ledger is already signed: sales +,
    // reductions -.
    const lines = []
    for (const code of Object.keys(ledger.byCodeMonth || {})) {
      for (const mo of Object.keys(ledger.byCodeMonth[code] || {})) {
        for (const l of ledger.byCodeMonth[code][mo]) {
          lines.push({ ...l, code, month: mo, amount: (l.amount || 0) })
        }
      }
    }
    lines.sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    // BAR = sum of the SAME lines shown in the table, per month. This guarantees the
    // bar and the table total always agree (and both are the live figure).
    const byMonth = {}
    for (const l of lines) {
      const mk = (l.date || '').slice(0, 7) || l.month
      if (!mk) continue
      byMonth[mk] = Math.round(((byMonth[mk] || 0) + (l.amount || 0)) * 100) / 100
    }

    // Keep the P&L benchmark figure per month as a cross-check (not charted).
    const plByMonth = {}
    for (const mo of Object.keys(bm)) {
      let sum = 0
      const codes = bm[mo].byCode || {}
      for (const code of salesCodes) if (codes[code] != null) sum += Math.abs(codes[code])
      if (sum !== 0 || codes['200'] != null) plByMonth[mo] = Math.round(sum * 100) / 100
    }

    // Diagnostic: which codes contributed to the chart (from benchmark) vs which codes
    // the sales ledger actually holds. If these differ, the ledger pull is keyed to a
    // code the sales P&L figure doesn't use.
    const benchmarkSalesCodes = {}
    for (const mo of Object.keys(bm)) {
      for (const code of Object.keys(bm[mo].byCode || {})) {
        if (salesCodes.has(String(code))) benchmarkSalesCodes[code] = (benchmarkSalesCodes[code] || 0) + Math.abs(bm[mo].byCode[code])
      }
    }
    const ledgerCodes = Object.keys(ledger.byCodeMonth || {})
    const diag = {
      salesCodesRequested: [...salesCodes],
      benchmarkSalesCodes,                    // codes+totals the chart is built from
      ledgerCodesPresent: ledgerCodes,        // codes the sales ledger actually has
      ledgerLineCount: lines.length,
      fetchMeta: ledger.fetchMeta || null,    // pages/journals/error from the ledger pull
      tokenScope,                             // what the CURRENT Xero token actually grants
      hasJournalsScope: !!(tokenScope && tokenScope.includes('accounting.journals.read')),
      ledgerUpdatedAt: ledger.updatedAt || null,
    }

    return res.json({
      byMonth,
      plByMonth,
      lines,
      salesCodes: [...salesCodes],
      monthlyTarget,
      diag,
      benchmarkUpdatedAt: benchmark.updatedAt || null,
      ledgerUpdatedAt: ledger.updatedAt || null,
    })
  }
  // Reads the stored ledger captured at sync time (view=overhead-transactions).
  if (view === 'overhead-transactions') {
    const code = String(req.query.code || (req.body && req.body.code) || '')
    const month = String(req.query.month || (req.body && req.body.month) || '')
    if (!code || !month) return res.status(400).json({ error: 'code and month required' })
    const ledger = (await redis.get('overhead:ledger').catch(() => null)) || { byCodeMonth: {} }
    const lines = (ledger.byCodeMonth?.[code]?.[month]) || []
    const total = lines.reduce((s, l) => s + (l.amount || 0), 0)
    return res.json({ code, month, lines, total, ledgerUpdatedAt: ledger.updatedAt || null })
  }

  // ── Bills to pay (money out) / Invoices owed (money in) ───────────────────
  if (view === 'bills' || view === 'invoices') {
    const key = view === 'bills' ? 'bank:outstanding-bills' : 'bank:outstanding-receivables'
    if (req.method === 'POST' && (req.body || {}).sync) {
      try {
        let tokens = await getTokens()
        if (!tokens) return res.status(401).json({ error: 'Not connected to Xero' })
        try { const nt = await refreshXeroToken(tokens.refresh_token); if (nt?.access_token) { tokens = { ...tokens, ...nt }; await saveTokens(tokens) } } catch {}
        const items = view === 'bills'
          ? await fetchOutstandingBills(tokens.access_token, tokens.tenant_id)
          : await fetchOutstandingReceivables(tokens.access_token, tokens.tenant_id)
        const payload = { items, updatedAt: new Date().toISOString() }
        await redis.set(key, payload)
        return res.json({ ok: true, count: items.length, updatedAt: payload.updatedAt })
      } catch (e) { return res.status(500).json({ error: e.message }) }
    }
    const stored = await redis.get(key).then(v => v || { items: [] }).catch(() => ({ items: [] }))
    return res.json({ items: stored.items || [], updatedAt: stored.updatedAt || null })
  }

  // ── Cash flow forecast ────────────────────────────────────────────────────
  if (view === 'cashflow') {
    const [billsStore, recStore] = await Promise.all([
      redis.get('bank:outstanding-bills').then(v => v || { items: [] }).catch(() => ({ items: [] })),
      redis.get('bank:outstanding-receivables').then(v => v || { items: [] }).catch(() => ({ items: [] })),
    ])
    // Current cash at bank = latest month's closing balance from the bank summary.
    const bankMonths = bank.months || {}
    const latestKey = Object.keys(bankMonths).sort().pop()
    const cashAtBank = latestKey ? (bankMonths[latestKey].closing || 0) : 0
    // Recent monthly overhead average (for predicted overheads in the forecast).
    const bm = benchmark.months || {}
    const ohVals = Object.keys(bm).sort().slice(-3).map(mo => Math.abs(bm[mo].overheadsTotal || 0))
    const avgOverheadMonthly = ohVals.length ? ohVals.reduce((a, b) => a + b, 0) / ohVals.length : 0
    // History of closing balances for the "where cash has been" line.
    const history = Object.keys(bankMonths).sort().map(mo => ({ month: mo, closing: bankMonths[mo].closing || 0 }))
    return res.json({
      cashAtBank,
      bills: billsStore.items || [],
      receivables: recStore.items || [],
      avgOverheadMonthly,
      history,
      billsUpdatedAt: billsStore.updatedAt || null,
      receivablesUpdatedAt: recStore.updatedAt || null,
    })
  }

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
