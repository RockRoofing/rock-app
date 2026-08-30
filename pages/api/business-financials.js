import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens, getProject } from '../../lib/db'
import { computeApplicationSummary, backfillAppNumbers } from '../../lib/applications'
import { refreshXeroToken, fetchBankSummary, fetchOutstandingBills, fetchOutstandingReceivables, fetchVatPosition, fetchBankAndCardBalances } from '../../lib/xero'

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

// Per-code, per-month PREDICTED spend for the current financial year. Mirrors the
// Budgets page logic so the Cash Schedule / Cash Flow use the same month-by-month
// figure. codes = array of code strings; actualsByCode = { code: { 'YYYY-MM': amt } };
// availableMonths = months with benchmark data; budgets/forecastMethods/forecastOverrides
// are the saved configs.
const nowMonthKeyServer = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

function computePredictedByCodeMonth(codes, actualsByCode, availableMonths, budgets, forecastMethods, forecastOverrides) {
  const availableSet = new Set(availableMonths)
  const d = new Date()
  const nowKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const fyOfMonth = (mo) => { const [y, m] = mo.split('-').map(Number); return m === 12 ? y + 1 : y }
  const curFyEnd = fyOfMonth(nowKey)
  const fyMonthList = (endYear) => { const out = [`${endYear - 1}-12`]; for (let m = 1; m <= 11; m++) out.push(`${endYear}-${String(m).padStart(2, '0')}`); return out }
  const curFyMonths = fyMonthList(curFyEnd)
  const isCompleteMo = (mo) => mo < nowKey && availableSet.has(mo)
  const actualOfCode = (code, mo) => {
    const m = actualsByCode[code] || {}
    if (mo in m) return m[mo]
    return availableSet.has(mo) ? 0 : null
  }
  const baseForecastOf = (code) => {
    const raw = forecastMethods[code] || 1
    const m = actualsByCode[code] || {}
    if (raw === 'budget') { const b = budgets[code]; if (b !== '' && b != null) return Number(b) }
    const method = Number(raw)
    if (method === 4) {
      const prev = fyMonthList(curFyEnd - 1).filter(mo => availableSet.has(mo)).map(mo => actualOfCode(code, mo)).filter(v => v != null)
      return prev.length ? prev.reduce((s, v) => s + v, 0) / prev.length : null
    }
    if (method === 3) {
      const completed = curFyMonths.filter(isCompleteMo).sort()
      return completed.length ? actualOfCode(code, completed[completed.length - 1]) : null
    }
    if (method === 2) {
      const completed = Object.keys(m).filter(isCompleteMo).sort().slice(-3)
      return completed.length ? completed.reduce((s, k) => s + m[k], 0) / completed.length : null
    }
    const fyC = curFyMonths.filter(isCompleteMo).map(k => (k in m ? m[k] : 0))
    return fyC.length ? fyC.reduce((s, v) => s + v, 0) / fyC.length : null
  }
  const effBudgetOf = (code) => { const v = budgets[code]; if (v !== '' && v != null) return Number(v); return baseForecastOf(code) }
  const out = {}
  for (const code of codes) {
    out[code] = {}
    for (const mo of curFyMonths) {
      if (isCompleteMo(mo)) { out[code][mo] = actualOfCode(code, mo); continue }
      const ov = forecastOverrides[code]?.[mo]
      if (ov != null && ov !== '') { out[code][mo] = Number(ov); continue }
      const base = baseForecastOf(code)
      out[code][mo] = base != null ? base : (effBudgetOf(code) || 0)
    }
  }
  return { predicted: out, currentFyMonths: curFyMonths }
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
      if (req.body && req.body.cashflowSchedule !== undefined) await redis.set('config:overhead-cashflow-schedule', req.body.cashflowSchedule || {})
      if (req.body && req.body.cashCommitments !== undefined) await redis.set('config:cash-commitments', req.body.cashCommitments || [])
      if (req.body && req.body.card3moCodes !== undefined) await redis.set('config:overhead-3mo-card-codes', req.body.card3moCodes || [])
      // Months explicitly switched from forecast to Xero actuals. A month passing is not
      // enough - somebody has to say the ledger is ready, because a month rolls over long
      // before its bills are all in and swapping automatically replaces a considered
      // forecast with a half-posted month.
      if (req.body && req.body.actualMonths !== undefined) await redis.set('config:overhead-actual-months', Array.isArray(req.body.actualMonths) ? req.body.actualMonths : [])
      // Per-cell comments, keyed "<accountCode>|<YYYY-MM>". A flat map rather than nested
      // per account, so writing one comment does not involve rewriting an account's whole
      // set - two people commenting at once would otherwise lose one.
      if (req.body && req.body.cellComments !== undefined) await redis.set('config:overhead-cell-comments', req.body.cellComments || {})
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
    const actualMonthsStored = await redis.get('config:overhead-actual-months').then(v => Array.isArray(v) ? v : null).catch(() => null)
    const cellComments = await redis.get('config:overhead-cell-comments').then(v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}).catch(() => ({}))
    const cashflowSchedule = await redis.get('config:overhead-cashflow-schedule').then(v => v || {}).catch(() => ({}))
    const cashCommitments = await redis.get('config:cash-commitments').then(v => v || []).catch(() => ([]))
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

    // Per-code, per-month PREDICTED spend for the CURRENT financial year (mirrors the
    // Budgets page so the Cash Schedule can use each month's predicted figure).
    const { predicted: predictedByCodeMonth, currentFyMonths: curFyMonths } = computePredictedByCodeMonth(
      overheadAccounts.map(a => a.code), actualsByCode, availableMonths, budgets, forecastMethods, forecastOverrides
    )

    return res.json({
      overheadAccounts,
      actualsByCode,
      availableMonths,
      predictedByCodeMonth,
      currentFyMonths: curFyMonths,
      budgets,
      forecastMethods,
      forecastOverrides,
      hiddenRows,
      cellComments,
      // FIRST RUN: the key has never been written, so every past month with data is
      // treated as already switched. That is exactly the old behaviour, so nothing moves
      // on deploy - without it every forecast method that averages history would find no
      // completed months and the whole grid would read zero.
      //
      // null (never set) is deliberately distinguished from [] (everything switched off
      // on purpose), which an `|| []` would have flattened into the same thing.
      actualMonths: actualMonthsStored != null
        ? actualMonthsStored
        : availableMonths.filter(mo => mo < nowMonthKeyServer()),
      forecastLocks,
      card3moCodes,
      cashflowSchedule,
      cashCommitments,
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
  if (view === 'vat') {
    const redis2 = await getRedis()
    // Save a filed Box 5 for a month.
    if (req.method === 'POST' && (req.body?.action === 'set-filed')) {
      const month = String(req.body.month || '')
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'bad month' })
      const store = (await redis2.get('vat:filed').catch(() => null)) || {}
      const box5 = req.body.box5 === '' || req.body.box5 == null ? null : Number(req.body.box5)
      if (box5 == null) delete store[month]
      else store[month] = { box5, direction: req.body.direction === 'payable' ? 'payable' : 'refund', updatedAt: new Date().toISOString() }
      await redis2.set('vat:filed', store)
      return res.json({ ok: true, filed: store })
    }

    const from = String(req.query.from || (req.body && req.body.from) || '')
    const to = String(req.query.to || (req.body && req.body.to) || '')
    const doRefresh = req.method === 'POST' && req.body?.action === 'refresh'
    const filed = (await redis2.get('vat:filed').catch(() => null)) || {}

    if (!doRefresh) {
      // Fast path: return the cached estimate + filed figures. No Xero calls.
      const cached = (await redis2.get('vat:estimate').catch(() => null)) || { months: {}, updatedAt: null }
      return res.json({ months: cached.months || {}, filed, estimateUpdatedAt: cached.updatedAt || null, diag: cached.meta || null })
    }

    // Refresh path: recompute the estimate from Xero and cache it.
    let tokens = await getTokens()
    let months = {}, meta = { lastError: 'Xero not connected' }
    if (tokens?.access_token) {
      try { const nt = await refreshXeroToken(tokens.refresh_token); if (nt?.access_token) { tokens = { ...tokens, ...nt }; await saveTokens(tokens) } } catch {}
      const est = await fetchVatPosition(tokens.access_token, tokens.tenant_id, from, to)
      months = est.months; meta = est.meta
      // Only overwrite the cache if we actually got data - never clobber good data with an empty/errored pull.
      const gotData = months && Object.keys(months).length > 0
      if (gotData) {
        await redis2.set('vat:estimate', { months, meta, updatedAt: new Date().toISOString(), from, to })
      } else {
        const prev = (await redis2.get('vat:estimate').catch(() => null)) || null
        if (prev) months = prev.months
        return res.json({ months, filed, estimateUpdatedAt: prev?.updatedAt || null, diag: { ...meta, note: 'no data from Xero - kept previous cache' } })
      }
    }
    return res.json({ months, filed, estimateUpdatedAt: new Date().toISOString(), diag: meta })
  }

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
        const diag = {}
        const items = view === 'bills'
          ? await fetchOutstandingBills(tokens.access_token, tokens.tenant_id, diag)
          : await fetchOutstandingReceivables(tokens.access_token, tokens.tenant_id)
        const payload = { items, updatedAt: new Date().toISOString() }
        await redis.set(key, payload)
        // Broken down, so "0 overpayments" is visible on the sync message instead of
        // looking identical to a successful sync that simply found none.
        const overpayments = items.filter(i => i.isOverpayment).length
        const credits = items.filter(i => i.isCreditNote && !i.isOverpayment).length
        return res.json({
          ok: true, count: items.length, updatedAt: payload.updatedAt,
          bills: items.length - credits - overpayments, credits, overpayments,
          // The actual reason, if a sub-fetch failed. Without this a permissions problem
          // on the Overpayments endpoint is indistinguishable from having none.
          overpaymentError: diag.overpaymentError || null,
          overpaymentDetail: diag.overpaymentDetail || null,
          // What the CURRENT token actually grants, straight off the stored token. The
          // only way to tell "the reconnect has not happened" from "the reconnect
          // happened and Xero still refused" - which need completely different actions.
          tokenScope: tokens.scope || null,
          creditNoteError: diag.creditNoteError || null,
        })
      } catch (e) { return res.status(500).json({ error: e.message }) }
    }
    const stored = await redis.get(key).then(v => v || { items: [] }).catch(() => ({ items: [] }))
    // Chart of accounts, so the account filter can show names rather than bare codes.
    // Only the codes actually present on these bills are returned - the full chart is
    // hundreds of accounts and most never appear on a supplier bill.
    const chartArr = await redis.get('config:chart-of-accounts').then(v => v || []).catch(() => ([]))
    const nameByCode = {}
    for (const a of (Array.isArray(chartArr) ? chartArr : [])) nameByCode[String(a.code)] = a.name || ''
    const present = new Set()
    for (const it of (stored.items || [])) for (const c of (it.lineCodes || [])) present.add(String(c))
    const accounts = [...present].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(code => ({ code, name: nameByCode[code] || '' }))
    return res.json({ items: stored.items || [], updatedAt: stored.updatedAt || null, accounts })
  }

  // ── Cash flow forecast ────────────────────────────────────────────────────
  if (view === 'margin') {
    const bm = benchmark.months || {}
    const months = Object.keys(bm).sort().map(mo => {
      const m = bm[mo]
      const income = Math.abs(m.incomeTotal || 0)
      const cos = Math.abs(m.costOfSalesTotal || 0)
      const overheads = Math.abs(m.overheadsTotal || 0)
      const grossProfit = income - cos
      const netProfit = income - cos - overheads
      return {
        month: mo, income, cos, overheads, grossProfit, netProfit,
        grossMargin: income ? (grossProfit / income) * 100 : null,
        netMargin: income ? (netProfit / income) * 100 : null,
      }
    })
    return res.json({ months, benchmarkUpdatedAt: benchmark.updatedAt || null })
  }

  // GET ONLY.
  //
  // This block had NO method check, and `view` is read from the POST body as well as the
  // query - so every invoice-finance POST fell in here, was answered with the GET
  // payload, and returned before reaching the save handlers below. The client saw a 200
  // with sensible-looking JSON and reported success. Nothing was ever written: not the
  // insured limits, not the settings, not the imported list.
  //
  // The save handlers are further down the file, so ordering alone decided this.
  if (view === 'invoice-finance' && req.method !== 'POST') {
    const [ifConfig, ifLimits, ifLimitsMeta, ifDrawnHistory, dashCache, appPaidOverrides] = await Promise.all([
      redis.get('config:if-settings').then(v => v || {}).catch(() => ({})),
      redis.get('config:if-debtor-limits').then(v => v || {}).catch(() => ({})),
      redis.get('config:if-limits-meta').then(v => v || null).catch(() => null),
      redis.get('config:if-drawn-history').then(v => Array.isArray(v) ? v : []).catch(() => ([])),
      redis.get('dashboard:cache').then(v => v || null).catch(() => null),
      redis.get('config:if-app-paid').then(v => v || {}).catch(() => ({})),  // { appId: true/false }
    ])

    // Parse an "App N" number out of an invoice reference/description.
    const appNumFromRef = (s) => {
      const m = String(s || '').match(/\bApp(?:lication)?\.?\s*(?:no\.?\s*)?(\d+)/i)
      return m ? parseInt(m[1], 10) : null
    }

    // EVERYTHING ON THIS PAGE COMES OFF dashboard:cache.
    //
    // If that key is empty the loop below runs zero times, projects comes back empty, and
    // the page shows "No applications found" - which looks exactly like a code fault and
    // is not one. The cache has a 4-hour TTL and is dropped whenever a new cache marker
    // ships, so it goes cold routinely and only the Dashboard rebuilds it.
    //
    // Reported explicitly rather than returning a silent empty list.
    const projects = []
    const dash = Array.isArray(dashCache) ? dashCache : []
    const dashboardCacheEmpty = !dash.length
    for (const p of dash) {
      if (!p || !p.xeroId) continue
      let full = {}
      try { full = (await getProject(p.xeroId)) || {} } catch { full = {} }
      const apps = Array.isArray(full.applications) ? full.applications.slice() : []
      if (!apps.length) continue
      backfillAppNumbers(apps)
      const sorted = apps.sort((a, b) => (a.seq || 0) - (b.seq || 0))
      const prevGrossFor = (app) => {
        let prev = null
        for (const a of sorted) { if ((a.seq || 0) < (app.seq || 0)) prev = a }
        if (!prev) return 0
        return app.prevCertGross != null ? app.prevCertGross : computeApplicationSummary(prev, 0).grossCurrent
      }
      // Invoice lines for this project (for paid-status matching).
      const invLines = (p._invoiceLines || [])
      const appRows = sorted
        .filter(a => a.status && a.status !== 'draft')   // only real (submitted/sent) applications
        .map(app => {
          const summary = computeApplicationSummary(app, prevGrossFor(app))
          const thisCertNet = summary?.thisCert?.total || 0
          const appNo = app.appNumber || app.seq || null
          // Auto-match to an invoice by "App N" in ref/number.
          let matchInv = null
          if (appNo != null) {
            matchInv = invLines.find(l => appNumFromRef(l.reference) === appNo || appNumFromRef(l.invoiceNumber) === appNo) || null
          }
          const autoPaid = matchInv ? ((matchInv.amountDue || 0) <= 0.005) : null   // null = unmatched
          const override = appPaidOverrides[app.id]
          const paid = override != null ? !!override : (autoPaid === true)
          return {
            id: app.id,
            appNumber: appNo,
            monthKey: app.monthKey || '',
            status: app.status || '',
            thisCertNet,
            // CUMULATIVE components at this application, for the Bibby eligibility caps.
            // Cumulative, not this-cert: the caps are "materials on site funded up to 25%
            // of contract value", which is a position, not an increment.
            measuredToDate: summary?.measuredToDate || 0,
            variationsToDate: summary?.variationsToDate || 0,
            materialsOnSite: summary?.materialsOnSite || 0,
            grossToDate: summary?.grossCurrent || 0,
            retentionPctUsed: app.retentionPct != null ? Number(app.retentionPct) : null,
            // Due date, for Bibby's AGE DISAPPROVAL. finalDate is the contractual final
            // date for payment; paymentDate is the due date. Either serves - the point is
            // how far past due the item is.
            dueDate: app.finalDate || app.paymentDate || '',
            // A GROSS-ENTERED application with previously-certified BLANK computes its
            // thisCert as the FULL cumulative value. That is a data fault, not a large
            // application, and on this page it inflates fundable debt by a whole account.
            prevCertBlank: (app.seq || 0) > 1 && app.prevCertGross == null,
            matched: !!matchInv,
            matchedInvoice: matchInv ? (matchInv.invoiceNumber || matchInv.reference || '') : '',
            autoPaid,
            paidOverride: override != null ? !!override : null,
            paid,
          }
        })
      if (!appRows.length) continue
      projects.push({
        xeroId: p.xeroId,
        name: p.name || '',
        customer: p.customer || '',
        // Contract value is what every Bibby percentage is measured against.
        contractValue: p.contractValue || 0,
        applications: appRows,
        // UNPAID SALES INVOICES - the DEBT Bibby assign. The application beside it is the
        // evidence of what the invoice consists of, which is what the eligibility caps
        // need and an invoice cannot give.
        //
        // Invoice-based rather than application-based because an application entered
        // GROSS with "previously certified" left blank computes thisCert as the FULL
        // cumulative value - so one badly set-up application inflates the funding
        // position by its whole account. An invoice has no such failure mode.
        invoices: invLines
          .filter(l => (l.amountDue != null ? l.amountDue : ((l.total || 0) - (l.amountPaid || 0))) > 0.005)
          .map(l => {
            const ref = `${l.reference || ''} ${l.invoiceNumber || ''}`
            return {
              invoiceNumber: l.invoiceNumber || '',
              reference: l.reference || '',
              date: l.date || '', dueDate: l.dueDate || '',
              amountDue: l.amountDue != null ? l.amountDue : ((l.total || 0) - (l.amountPaid || 0)),
              total: l.total || 0,
              appNumber: appNumFromRef(l.reference) ?? appNumFromRef(l.invoiceNumber) ?? null,
              // Retention release invoices are not fundable debt under the facility.
              // Detected by the note, which is how they are marked in practice - so a
              // retention invoice raised WITHOUT the note will not be caught, and that
              // is worth knowing rather than trusting silently.
              isRetention: /retention|retn\b/i.test(ref),
            }
          }),
      })
    }

    return res.json({
      projects,
      settings: {
        advanceRate: ifConfig.advanceRate != null ? ifConfig.advanceRate : 60,
        drawn: ifConfig.drawn != null ? ifConfig.drawn : 0,
        facilityCap: ifConfig.facilityCap != null ? ifConfig.facilityCap : 500000,
        // Bibby eligibility caps, confirmed with them. Stored so they can be changed at
        // facility review without a deploy.
        mosCapPct: ifConfig.mosCapPct != null ? ifConfig.mosCapPct : 25,
        varCapPct: ifConfig.varCapPct != null ? ifConfig.varCapPct : 25,
        certCeilingPct: ifConfig.certCeilingPct != null ? ifConfig.certCeilingPct : 90,
        // Normalised on the way OUT too, so a 0 already sitting in Redis from the old
        // version reads as blank without anyone having to clear it by hand.
        highInvolvement: (ifConfig.highInvolvement == null || Number(ifConfig.highInvolvement) === 0) ? '' : ifConfig.highInvolvement,
        highInvolvementPct: ifConfig.highInvolvementPct != null ? ifConfig.highInvolvementPct : 35,
        ageDays: ifConfig.ageDays != null ? ifConfig.ageDays : 90,
      },
      // Which build of THIS FILE is answering. Two files changed in pkg596 and the API
      // one is the one that carries the fix - if only the page was deployed the symptom
      // is identical to nothing being deployed at all, and there is no way to tell them
      // apart from the screen.
      apiVersion: 'pkg607',   // must match EXPECTED_API in invoice-finance.js
      dashboardCacheEmpty,
      // Sorted oldest first; the LAST entry is the current drawn balance.
      drawnHistory: ifDrawnHistory,
      debtorLimits: ifLimits,        // { [customerName]: { insuredLimit } }
      limitsMeta: ifLimitsMeta,      // { importedAt, count, matched, unmatched, fileName }
    })
  }

  if (req.method === 'POST' && (req.body || {}).view === 'invoice-finance' && (req.body || {}).action === 'save-app-paid') {
    try {
      const { appId, paid } = req.body || {}
      if (!appId) return res.status(400).json({ ok: false, error: 'missing appId' })
      const map = await redis.get('config:if-app-paid').then(v => v || {}).catch(() => ({}))
      if (paid === null) delete map[appId]; else map[appId] = !!paid
      await redis.set('config:if-app-paid', map)
      return res.json({ ok: true })
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }) }
  }

  if (req.method === 'POST' && (req.body || {}).view === 'invoice-finance' && (req.body || {}).action === 'save-settings') {
    try {
      const s = (req.body || {}).settings || {}
      const cfg = {
        advanceRate: Number(s.advanceRate) || 0,
        drawn: Number(s.drawn) || 0,
        retentionPct: Number(s.retentionPct) || 0,
        facilityCap: Number(s.facilityCap) || 0,
        // The save handler WHITELISTS fields, so anything not listed here is silently
        // dropped - the setting would appear to save and be gone on reload.
        //
        // `?? 25` rather than `|| 25`: a deliberate 0% cap is a real setting ("fund no
        // materials at all") and `||` would quietly turn it back into 25.
        mosCapPct: Number(s.mosCapPct ?? 25),
        varCapPct: Number(s.varCapPct ?? 25),
        certCeilingPct: Number(s.certCeilingPct ?? 90),
        // '' must survive as '' - it means "use the calculation". Number('')||0 would
        // turn it into a deliberate zero override and kill the calculated figure.
        // Zero is stored as '' so it can never masquerade as a deliberate override. The
        // previous version wrote `Number(x) || 0`, leaving a literal 0 on every existing
        // record - which would suppress the calculated figure for ever.
        highInvolvement: (s.highInvolvement === '' || s.highInvolvement == null || Number(s.highInvolvement) === 0) ? '' : Number(s.highInvolvement),
        highInvolvementPct: Number(s.highInvolvementPct ?? 35),
        ageDays: Number(s.ageDays ?? 90),
      }
      await redis.set('config:if-settings', cfg)
      return res.json({ ok: true, settings: cfg })
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }) }
  }

  // DRAWN BALANCE HISTORY. Drawn is a point-in-time figure read off a Bibby statement,
  // not something the app can know - so it is recorded WITH THE DATE IT APPLIES TO and
  // the most recent one is used. A single overwritten number goes stale silently and
  // there is no way to tell a figure entered this morning from one entered in March.
  if (req.method === 'POST' && (req.body || {}).view === 'invoice-finance' && (req.body || {}).action === 'save-drawn') {
    try {
      const { date, amount, remove } = req.body || {}
      const list = await redis.get('config:if-drawn-history').then(v => Array.isArray(v) ? v : []).catch(() => ([]))
      let next
      if (remove) {
        next = list.filter(e => e.date !== remove)
      } else {
        if (!date) return res.status(400).json({ ok: false, error: 'A date is required.' })
        // One entry per date - re-entering a date corrects it rather than stacking two
        // readings for the same day, which would make "most recent" ambiguous.
        next = [...list.filter(e => e.date !== date), { date, amount: Number(amount) || 0, at: new Date().toISOString() }]
      }
      next.sort((a, b) => String(a.date).localeCompare(String(b.date)))
      await redis.set('config:if-drawn-history', next)
      return res.json({ ok: true, drawnHistory: next })
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }) }
  }

  // The IF page publishes its computed position here so the Cash Flow can use the SAME
  // figures instead of keeping a second, simpler model of the facility.
  if (req.method === 'POST' && (req.body || {}).view === 'invoice-finance' && (req.body || {}).action === 'publish-position') {
    try {
      const p = (req.body || {}).position || {}
      await redis.set('config:if-position', {
        totalAdvance: Number(p.totalAdvance) || 0,
        drawn: Number(p.drawn) || 0,
        drawnAsAt: p.drawnAsAt || null,
        approvedLedger: Number(p.approvedLedger) || 0,
        highInvolvement: Number(p.highInvolvement) || 0,
        at: new Date().toISOString(),
      })
      return res.json({ ok: true })
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }) }
  }

  if (req.method === 'POST' && (req.body || {}).view === 'invoice-finance' && (req.body || {}).action === 'save-limits') {
    try {
      const limits = (req.body || {}).debtorLimits || {}
      await redis.set('config:if-debtor-limits', limits)
      // Import provenance kept in a SEPARATE key, not folded into the limits map - that
      // map is a flat { name: {...} } and adding a meta entry to it would turn up as a
      // debtor called "importedAt" on every screen that walks it.
      const meta = (req.body || {}).importMeta
      if (meta) {
        await redis.set('config:if-limits-meta', {
          importedAt: new Date().toISOString(),
          count: Number(meta.count) || 0,
          matched: Number(meta.matched) || 0,
          unmatched: Number(meta.unmatched) || 0,
          fileName: String(meta.fileName || '').slice(0, 120),
        })
      }
      const savedMeta = await redis.get('config:if-limits-meta').catch(() => null)
      return res.json({ ok: true, debtorLimits: limits, limitsMeta: savedMeta || null })
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }) }
  }

  // GET ONLY - same trap as invoice-finance above. `view` is read from the POST body too,
  // so without this check every cashflow POST landed here, got the GET payload back, and
  // returned before reaching save-lumps, refresh-balances, save-finance,
  // save-bill-paydate or save-bill-cis - all five of which sit further down the file.
  if (view === 'cashflow' && req.method !== 'POST') {
    const [billsStore, recStore, dashCache] = await Promise.all([
      redis.get('bank:outstanding-bills').then(v => v || { items: [] }).catch(() => ({ items: [] })),
      redis.get('bank:outstanding-receivables').then(v => v || { items: [] }).catch(() => ({ items: [] })),
      redis.get('dashboard:cache').then(v => v || null).catch(() => null),
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

    const [ohBudgets, cashflowSchedule, vatFiled, vatEstimate, retentionStore, invoiceMeta, balancesStore, manualBalances, financeCfg, ifSettings, ifLimits, billPayDates, billCisFlags, ohForecastMethods, ohForecastOverrides, cashCommitments] = await Promise.all([
      redis.get('config:overhead-budgets').then(v => v || {}).catch(() => ({})),
      redis.get('config:overhead-cashflow-schedule').then(v => v || {}).catch(() => ({})),
      redis.get('vat:filed').then(v => v || {}).catch(() => ({})),
      redis.get('vat:estimate').then(v => v || { months: {} }).catch(() => ({ months: {} })),
      redis.get('retention:entries').then(v => v || { entries: [] }).catch(() => ({ entries: [] })),
      redis.get('invoice:meta').then(v => v || {}).catch(() => ({})),
      redis.get('bank:account-balances').then(v => v || null).catch(() => null),
      redis.get('config:manual-balances').then(v => Array.isArray(v) ? v : []).catch(() => ([])),
      redis.get('config:cashflow-finance').then(v => v || {}).catch(() => ({})),
      redis.get('config:if-settings').then(v => v || {}).catch(() => ({})),
      redis.get('config:if-debtor-limits').then(v => v || {}).catch(() => ({})),
      redis.get('config:bill-payment-dates').then(v => v || {}).catch(() => ({})),
      redis.get('config:bill-cis-flags').then(v => v || {}).catch(() => ({})),
      redis.get('config:overhead-forecast-methods').then(v => v || {}).catch(() => ({})),
      redis.get('config:overhead-forecast-overrides').then(v => v || {}).catch(() => ({})),
      redis.get('config:cash-commitments').then(v => v || []).catch(() => ([])),
    ])

    // Invoice-finance availability, matching the Invoice Finance page rules:
    // per debtor, fundable = outstanding - materials - retention%, advance = min(rate% x
    // fundable, insured limit); total capped at the facility cap; minus drawn.
    // INVOICE FINANCE FIGURES COME FROM THE INVOICE FINANCE PAGE.
    //
    // What was here was a SECOND, older model of the facility - a flat 10% retention
    // deduction, the insured limit capping the ADVANCE rather than the debt, no High
    // Involvement, no eligibility caps, no age rule - and it read the old single `drawn`
    // setting rather than the dated history. It could never agree with the Invoice
    // Finance page, and two different availability figures on two pages is worse than
    // one that is slightly wrong.
    //
    // The IF page now writes its computed position to config:if-position whenever it
    // loads, and this reads it. One calculation, one answer, and the Cash Flow says
    // where the number came from.
    let ifAvailability = null
    try {
      const pos = await redis.get('config:if-position').catch(() => null)
      if (pos && pos.totalAdvance != null) {
        ifAvailability = {
          totalAdvance: Math.round(Number(pos.totalAdvance) || 0),
          drawn: Math.round(Number(pos.drawn) || 0),
          availability: Math.round((Number(pos.totalAdvance) || 0) - (Number(pos.drawn) || 0)),
          drawnAsAt: pos.drawnAsAt || null,
          asAt: pos.at || null,
          source: 'invoice-finance-page',
        }
      }
    } catch { ifAvailability = null }

    // Prefer the live per-account balances (bank cash only) for opening cash; fall
    // back to the old bank-summary closing balance if we've never fetched balances.
    const liveBankTotal = balancesStore && balancesStore.ok ? (balancesStore.bankTotal || 0) : null
    const openingCash = liveBankTotal != null ? liveBankTotal : cashAtBank

    // Build receivables from the SAME source as the Invoices Owed page - the dashboard
    // project invoice lines (project-linked outstanding invoices) - so the two pages
    // reconcile. Falls back to bank:outstanding-receivables only if the dashboard cache
    // is empty. Only outstanding (amountDue > 0) lines are kept.
    let receivables
    if (dashCache && Array.isArray(dashCache)) {
      const rows = []
      for (const p of dashCache) {
        for (const inv of (p._invoiceLines || [])) {
          const total = inv.total || 0
          const paid = inv.amountPaid || 0
          const due = inv.amountDue != null ? inv.amountDue : (total - paid)
          if (!(due > 0.005)) continue
          const number = inv.invoiceNumber || ''
          const meta = invoiceMeta[number] || null
          rows.push({
            id: inv.invoiceID || number,
            number,
            invoiceNumber: number,
            contact: inv.contact || p.customer || '',
            date: inv.date || '',
            dueDate: inv.dueDate || '',
            total,
            amountDue: due,
            reference: inv.reference || '',
            expectedDate: (meta && meta.expectedDate) || '',
            projectName: p.name || '',
            projectNo: p.jobNo || '',
          })
        }
      }
      receivables = rows
    } else {
      // Fallback: all outstanding receivables (previous behaviour).
      receivables = (recStore.items || []).map(i => {
        const meta = invoiceMeta[i.invoiceNumber] || invoiceMeta[i.number] || null
        return { ...i, expectedDate: (meta && meta.expectedDate) || '' }
      })
    }

    // Attach planned payment date + CIS status. CIS auto-defaults to bills on account
    // 321 (cisAuto from the sync); a manual flag in config overrides it either way.
    const bills = (billsStore.items || []).map(b => {
      const manual = billCisFlags[b.id]   // true / false (explicit) / undefined
      const cis = (manual === undefined || manual === null) ? !!b.cisAuto : !!manual
      return { ...b, payDate: billPayDates[b.id] || '', cis, cisAuto: !!b.cisAuto, lineCodes: b.lineCodes || [] }
    })

    // Per-month predicted overhead spend (same as Budgets page) so the forecast times
    // each overhead using that month's predicted figure, not one flat budget.
    const ohActualsByCode = {}
    const ohCodes = new Set(Object.keys(ohBudgets || {}))
    for (const mo of Object.keys(bm)) {
      for (const code of Object.keys(bm[mo].byCode || {})) {
        if (CATEGORY_OF(code, catConfig) === 'overheads') ohCodes.add(String(code))
      }
    }
    for (const code of ohCodes) {
      ohActualsByCode[code] = {}
      for (const mo of Object.keys(bm)) {
        const v = (bm[mo].byCode || {})[code]
        if (v != null) ohActualsByCode[code][mo] = Math.abs(v)
      }
    }
    const availMonths = Object.keys(bm).sort()
    const { predicted: predictedByCodeMonth } = computePredictedByCodeMonth(
      [...ohCodes], ohActualsByCode, availMonths, ohBudgets, ohForecastMethods, ohForecastOverrides
    )
    // Overhead code -> name (for the weekly overhead breakdown on the Cash Flow page).
    const cfChart = await redis.get('config:chart-of-accounts').then(v => v || []).catch(() => ([]))
    const cfChartNames = {}
    for (const a of (Array.isArray(cfChart) ? cfChart : [])) cfChartNames[String(a.code)] = a.name
    const overheadNames = {}
    for (const code of ohCodes) overheadNames[code] = (catConfig[code] && catConfig[code].name) || cfChartNames[code] || code

    // Project cash flow forecasts (from the Commercial Cash Flow page). Scanned from
    // cashflow:hyp-apps:*, flattened to dated cash movements, each tagged with its
    // project so the weekly forecast can suppress it where a REAL invoice/bill exists.
    const projForecasts = []
    try {
      let cursor = 0
      const keys = []
      do {
        const [next, batch] = await redis.scan(cursor, { match: 'cashflow:hyp-apps:*', count: 200 })
        cursor = Number(next)
        for (const k of (batch || [])) keys.push(k)
      } while (cursor)
      // Map planning project key -> a display/project name for matching to invoices/bills.
      const dashByNo = {}
      // Latest application valuation date per job number, for the supersede rule below.
      const recByNo = {}
      for (const p of (Array.isArray(dashCache) ? dashCache : [])) {
        if (!p.jobNo) continue
        dashByNo[String(p.jobNo)] = p.name || ''
        // From the dashboard cache's own field. It was reading p.applications, which does
        // NOT exist on the cache - applications live under settings.applications there.
        // So latestAppEnd was always empty and the supersede rule never fired once, which
        // is why the double count survived.
        recByNo[String(p.jobNo)] = p.latestAppEnd || ''
      }
      for (const k of keys) {
        const pk = k.replace('cashflow:hyp-apps:', '')
        // pk is "L:<projectNo>" (live/draft) or "N:<dealId>" (negotiated).
        const projectNo = pk.startsWith('L:') ? pk.slice(2) : ''
        const projectName = projectNo ? (dashByNo[projectNo] || '') : ''
        const list = (await redis.get(k).catch(() => ([]))) || []
        for (const fc of list) {
          projForecasts.push({
            projectKey: pk,
            projectNo,
            projectName,
            salesSchedule: fc.salesSchedule || (fc.salesDate ? [{ date: fc.salesDate, amount: fc.revenueThisPeriod || 0 }] : []),
            labourSchedule: fc.labourSchedule || [],
            // MATERIALS. `amount` is resolved at SAVE time - a line can be a percentage
            // of the materials budget (mode: 'pct') and only then becomes a figure. Any
            // line saved before `amount` existed, or any pct line saved without a budget,
            // has no amount at all and was contributing ZERO with nothing to say so.
            //
            // Falls back to `value` for a plain line. A pct line without an amount cannot
            // be resolved here - the budget is not in this payload - so it is reported
            // rather than silently counted as nil.
            matItems: (fc.matItems || []).map(m => ({
              date: m.payDate,
              amount: (m.amount != null && m.amount !== '') ? Number(m.amount) || 0
                    : (m.mode === 'pct' ? 0 : Number(m.value) || 0),
              // Diagnostics for the banner: money that cannot be scheduled and why.
              unresolved: (m.amount == null || m.amount === '') && m.mode === 'pct',
              undated: !m.payDate,
              raw: Number(m.amount != null && m.amount !== '' ? m.amount : m.value) || 0,
            })),
            from: fc.from, to: fc.to,
            // Latest APPLICATION valuation date on this project. A forecast whose period
            // has already been applied for is history - the money is now a real invoice,
            // and counting both is the double-count.
            latestAppEnd: (() => {
              const rec = projectNo ? (dashByNo[projectNo] != null ? recByNo[String(projectNo)] : null) : null
              return rec || ''
            })(),
          })
        }
      }
    } catch {}

    return res.json({
      cashAtBank: openingCash,
      cashAtBankLegacy: cashAtBank,
      balances: balancesStore || null,
      financeCfg,
      manualBalances,
      ifAvailability,
      bills,
      billPayDates,
      billCisFlags,
      receivables,
      projForecasts,
      cashflowLumps: (await redis.get('config:cashflow-lumps').then(v => v || []).catch(() => ([]))),
      avgOverheadMonthly,
      history,
      ohBudgets,
      predictedByCodeMonth,
      overheadNames,
      cashCommitments,
      cashflowSchedule,
      vatFiled,
      vatEstimateMonths: vatEstimate.months || {},
      retentionEntries: retentionStore.entries || [],
      billsUpdatedAt: billsStore.updatedAt || null,
      receivablesUpdatedAt: recStore.updatedAt || null,
    })
  }

  // Manual cash-flow "lumps" for future/unknown projects (12-month forecast).
  if (req.method === 'POST' && (req.body || {}).view === 'cashflow' && (req.body || {}).action === 'save-lumps') {
    try {
      const lumps = Array.isArray((req.body || {}).lumps) ? req.body.lumps : []
      await redis.set('config:cashflow-lumps', lumps)
      return res.json({ ok: true, lumps })
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }) }
  }

  // Refresh live bank + credit-card balances from Xero (Balance Sheet).
  if (req.method === 'POST' && (req.body || {}).view === 'cashflow' && (req.body || {}).action === 'refresh-balances') {
    try {
      let tokens = await getTokens()
      if (!tokens) return res.status(401).json({ error: 'Not connected to Xero' })
      try { const nt = await refreshXeroToken(tokens.refresh_token); if (nt?.access_token) { tokens = { ...tokens, ...nt }; await saveTokens(tokens) } } catch {}
      const bal = await fetchBankAndCardBalances(tokens.access_token, tokens.tenant_id)
      const payload = { ...bal, updatedAt: new Date().toISOString() }
      if (bal.ok) await redis.set('bank:account-balances', payload)
      return res.json(payload)
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message })
    }
  }

  // Save invoice-finance / facility settings.
  // MANUAL BALANCES, each with the date it was read.
  //
  // Xero's Balance Sheet gives the BOOK balance - only what has been entered and
  // reconciled. The bank's real position is the STATEMENT balance, which the API does not
  // expose at all. So a figure read off online banking this morning is worth more than an
  // automated one that is quietly a week behind reconciliation.
  if (req.method === 'POST' && (req.body || {}).view === 'cashflow' && (req.body || {}).action === 'save-manual-balances') {
    try {
      const list = Array.isArray((req.body || {}).balances) ? req.body.balances : []
      const clean = list
        .filter(b => b && String(b.name || '').trim())
        .map(b => ({
          name: String(b.name).trim().slice(0, 80),
          kind: b.kind === 'card' ? 'card' : 'bank',
          balance: Number(b.balance) || 0,
          asAt: String(b.asAt || '').slice(0, 10),
        }))
      await redis.set('config:manual-balances', clean)
      return res.json({ ok: true, manualBalances: clean })
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }) }
  }

  if (req.method === 'POST' && (req.body || {}).view === 'cashflow' && (req.body || {}).action === 'save-finance') {
    try {
      const cfg = (req.body || {}).financeCfg || {}
      await redis.set('config:cashflow-finance', cfg)
      return res.json({ ok: true, financeCfg: cfg })
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message })
    }
  }

  // Save a manual planned payment date for a bill (or clear it with empty string).
  if (req.method === 'POST' && (req.body || {}).view === 'cashflow' && (req.body || {}).action === 'save-bill-paydate') {
    try {
      const { billId, payDate } = req.body || {}
      if (!billId) return res.status(400).json({ ok: false, error: 'missing billId' })
      const map = await redis.get('config:bill-payment-dates').then(v => v || {}).catch(() => ({}))
      if (payDate) map[billId] = payDate; else delete map[billId]
      await redis.set('config:bill-payment-dates', map)
      return res.json({ ok: true })
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message })
    }
  }

  // Flag/unflag a bill as CIS labour. Stores an explicit true/false so an
  // auto-detected (account 321) bill can be manually un-ticked (gross status).
  if (req.method === 'POST' && (req.body || {}).view === 'cashflow' && (req.body || {}).action === 'save-bill-cis') {
    try {
      const { billId, cis } = req.body || {}
      if (!billId) return res.status(400).json({ ok: false, error: 'missing billId' })
      const map = await redis.get('config:bill-cis-flags').then(v => v || {}).catch(() => ({}))
      map[billId] = !!cis   // store explicit boolean (overrides auto-detection)
      await redis.set('config:bill-cis-flags', map)
      return res.json({ ok: true })
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message })
    }
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
    const netMargin = sales > 0 ? (sales - cos - overheads) / sales : null
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
      netMarginPct: netMargin == null ? null : Math.round(netMargin * 1000) / 10,
      overheadPct: sales > 0 ? Math.round((overheads / sales) * 1000) / 10 : null,
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
