// ONE MODEL OF THE FINANCIAL YEAR BY MONTH, shared by the Forecast P&L and the
// Forecast Balance Sheet.
//
// Both pages used to build revenue, cost of sale and overheads per month from
// cf.projForecasts with the rules written out separately in each file, and the
// Forecast Margin page made a third copy. Every rule that mattered - the supersede
// test, capping cost at the valuation date, letting an undated line fall to the
// period end, grossing revenue up for retention - had to be fixed in each place,
// and they drifted every time one was missed.
//
// This is that model, written once. A manual month typed on the P&L therefore
// reaches the balance sheet by construction rather than by remembering to patch it.

export function fyMonths(endYear) {
  const out = [`${endYear - 1}-12`]
  for (let m = 1; m <= 11; m++) out.push(`${endYear}-${String(m).padStart(2, '0')}`)
  return out
}

// The financial year runs DECEMBER to NOVEMBER, same as the Budgets tab.
export function currentFyEnd(now = new Date()) {
  return now.getMonth() >= 11 ? now.getFullYear() + 1 : now.getFullYear()
}

export const monthShort = (mo) => {
  const [y, m] = String(mo).split('-').map(Number)
  if (!y || !m) return mo
  return `${new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' })} ${String(y).slice(2)}`
}

export function projLabel(fc) {
  const no = fc.projectNo ? String(fc.projectNo) : ''
  const nm = (fc.projectName || '').trim()
  if (no && nm) return nm.startsWith(no) ? nm : `${no} - ${nm}`
  // A negotiated job is prefixed so it is never mistaken for a live one - it is a
  // deal, not a contract, and the money is far less certain.
  const key = String(fc.projectKey || '')
  if (key.startsWith('N:')) return nm ? `${nm} (negotiated)` : `Deal ${key.slice(2)} (negotiated)`
  return nm || no || key.replace(/^L:/, '') || '(unnamed)'
}

const numOrNull = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

// A manual month counts only if at least one figure was actually typed. An entry of
// all-empty strings is the same as no entry, so clearing the boxes returns the month
// to forecast rather than pinning it at zero.
export function manualEntry(manual, mo) {
  const e = (manual || {})[mo]
  if (!e || typeof e !== 'object') return null
  const revenue = numOrNull(e.revenue)
  const cos = numOrNull(e.cos)
  const materials = numOrNull(e.materials)
  const labour = numOrNull(e.labour)
  if (revenue == null && cos == null && materials == null && labour == null) return null
  // Cost of sale defaults to materials plus labour where they are given and it is
  // not. Typing all three and having the total ignored would be worse, so an
  // explicit cos always wins and the page flags the two disagreeing.
  const derived = (materials || 0) + (labour || 0)
  return {
    revenue: revenue || 0,
    cos: cos != null ? cos : derived,
    materials, labour,
    cosTyped: cos != null,
    splitTyped: materials != null || labour != null,
    note: String(e.note || ''),
  }
}

// WIP IS A TIMING JOURNAL, NOT EXTRA REVENUE.
//
// Xero posts WIP to a sales code at month end and reverses it on the 1st, so across any
// two consecutive ACTUAL months it nets to nothing and cannot move a total.
//
// At the LAST actual month it can. The accrual sits in Xero's income for that month, but
// the reversal falls in a FORECAST month, which is built from the project forecasts and
// never sees it. The forecast then re-earns the same work when it is certified. Counted
// once in the actual month and again in the forecast.
//
// So it comes off the year - unless the last actual month IS the year end, where the
// journal is a genuine part of that year's result and belongs in it.
//
// The figure comes from wip:lock:<month>, written when WIP is signed off in Commercial.
// Where that month was never signed off, the most recent earlier lock is used and
// `exact` goes false, so the page can name the month it actually came from rather than
// quietly using the wrong one.
export function resolveWip({ months, rows, wipLocks, include }) {
  const locks = (wipLocks && typeof wipLocks === 'object') ? wipLocks : {}
  const actualMonths = rows.filter(r => r.isActual).map(r => r.mo).sort()
  const lastActual = actualMonths.length ? actualMonths[actualMonths.length - 1] : null
  const fyEndMonth = months.length ? months[months.length - 1] : null

  const none = {
    available: false, amount: 0, month: null, lastActual, fyEndMonth,
    isFyEnd: false, autoInclude: false, include: false, adjustment: 0, exact: true,
    reason: lastActual ? 'no signed-off WIP found for or before ' + lastActual : 'no actual months yet',
  }
  if (!lastActual) return none

  const numFor = (mo) => {
    const l = locks[mo]
    if (l == null) return null
    const n = Number((l && typeof l === 'object') ? l.totalWip : l)
    return isNaN(n) ? null : n
  }

  let month = lastActual
  let amount = numFor(lastActual)
  let exact = true
  if (amount == null) {
    const earlier = Object.keys(locks).filter(k => /^\d{4}-\d{2}$/.test(k) && k <= lastActual).sort()
    if (earlier.length) { month = earlier[earlier.length - 1]; amount = numFor(month); exact = false }
  }
  if (amount == null) return none

  const isFyEnd = lastActual === fyEndMonth
  const autoInclude = isFyEnd
  // null / undefined means "leave it on automatic". Only an explicit true or false from
  // the tick overrides, so the default keeps following the year end as it moves.
  const resolved = (include === true || include === false) ? include : autoInclude
  return {
    available: true, amount, month, lastActual, fyEndMonth, isFyEnd,
    autoInclude, include: resolved,
    // Revenue only - the journal is Dr WIP, Cr Sales, so there is no cost side.
    adjustment: resolved ? 0 : -amount,
    exact, reason: null,
  }
}

export function buildForecastMonths({ oh, mg, cf, manual, fyEnd, wipLocks, wipInclude }) {
  if (!oh || !mg || !cf) return null
  const year = fyEnd || currentFyEnd()
  const months = fyMonths(year)

  // A month is ACTUAL when it has been switched to actual on Budgets. That switch is
  // already the single decision about which months are closed; a second rule here
  // would give two tabs that disagree about the same month.
  const actualSet = new Set(oh.actualMonths || [])

  const byMonth = {}
  for (const m of (mg.months || [])) byMonth[m.month] = m

  // Invoices by the month they were RAISED - that is the P&L date, not the due date.
  // Not counted as revenue in a forecast month (revenue without its cost is not
  // revenue), but reported so a half-closed month is visible.
  const invByMonth = {}
  for (const i of (cf.receivables || [])) {
    if (i.type && i.type !== 'ACCREC') continue
    const d = i.date || i.dueDate || ''
    if (!d) continue
    const k = String(d).slice(0, 7)
    invByMonth[k] = (invByMonth[k] || 0) + (i.total || i.amountDue || 0)
  }

  // ---- Project forecasts on the ACCRUAL dates ---------------------------------
  const fRev = {}, fMat = {}, fLab = {}
  const detail = {}   // month -> project -> { revenue, materials, labour }
  const bucket = (mo, nm) => {
    if (!detail[mo]) detail[mo] = {}
    if (!detail[mo][nm]) detail[mo][nm] = { revenue: 0, materials: 0, labour: 0 }
    return detail[mo][nm]
  }

  for (const fc of (cf.projForecasts || [])) {
    const a = fc.accrual
    if (!a) continue
    // SUPERSEDED BY A REAL APPLICATION - skip it. The period has been applied for and
    // its income is in Xero, so counting the forecast puts the same work in twice.
    if (fc.latestAppEnd && fc.to && fc.to <= fc.latestAppEnd) continue
    const nm = projLabel(fc)

    for (const r of (a.revenueByMonth || [])) {
      if (!r.month || !r.amount) continue
      fRev[r.month] = (fRev[r.month] || 0) + r.amount
      bucket(r.month, nm).revenue += r.amount
    }

    // COST FOLLOWS THE REVENUE IT SUPPORTS. Held against the month of the PERIOD it
    // belongs to, capped at the valuation date; an undated line falls to the period
    // end rather than being dropped silently.
    const bound = (fc.valDate || fc.to || '').slice(0, 7)
    const put = (totals, field, x) => {
      const own = x.date ? String(x.date).slice(0, 7) : bound
      const k = (bound && own > bound) ? bound : own
      if (!k || !x.amount) return
      totals[k] = (totals[k] || 0) + x.amount
      bucket(k, nm)[field] += x.amount
    }
    for (const x of (a.materials || [])) put(fMat, 'materials', x)
    for (const x of (a.labour || [])) put(fLab, 'labour', x)
  }

  // ---- Overheads from the Budgets predicted grid --------------------------------
  const fOh = {}
  for (const byM of Object.values(oh.predictedByCodeMonth || {})) {
    for (const [mo, v] of Object.entries(byM || {})) fOh[mo] = (fOh[mo] || 0) + (Number(v) || 0)
  }

  const rows = months.map(mo => {
    const man = manualEntry(manual, mo)
    const isActual = actualSet.has(mo)
    const a = byMonth[mo] || {}
    // MANUAL WINS over an actual month. Typed figures are a deliberate act and
    // silently discarding them because a month was later switched would be worse
    // than the reverse; the page says when both apply so it is never a surprise.
    const source = man ? 'manual' : (isActual ? 'actual' : 'forecast')

    const revenue = man ? man.revenue : (isActual ? (a.income || 0) : (fRev[mo] || 0))
    const cos = man ? man.cos : (isActual ? (a.cos || 0) : ((fMat[mo] || 0) + (fLab[mo] || 0)))
    // Overheads are never overridden - the Budgets grid already has them right.
    const overheads = isActual ? (a.overheads || 0) : (fOh[mo] || 0)

    // Xero returns ONE cost-of-sales total for a closed month, so the split only
    // exists on forecast months, or where it has been typed.
    const materials = man ? man.materials : (isActual ? null : (fMat[mo] || 0))
    const labour = man ? man.labour : (isActual ? null : (fLab[mo] || 0))

    return {
      mo, source,
      isActual: source === 'actual',
      isManual: source === 'manual',
      alsoActual: !!(man && isActual),
      cosDisagrees: !!(man && man.cosTyped && man.splitTyped &&
        Math.abs(man.cos - ((man.materials || 0) + (man.labour || 0))) > 1),
      revenue, cos, overheads,
      materials, labour,
      invoiced: invByMonth[mo] || 0,
      gross: revenue - cos,
      net: revenue - cos - overheads,
      // Per-project detail only exists where the figures came from the forecasts.
      projects: source === 'forecast' ? (detail[mo] || {}) : null,
    }
  })

  const totals = rows.reduce((s, r) => ({
    revenue: s.revenue + r.revenue,
    cos: s.cos + r.cos,
    overheads: s.overheads + r.overheads,
    gross: s.gross + r.gross,
    net: s.net + r.net,
    aRev: s.aRev + (r.source !== 'forecast' ? r.revenue : 0),
    fRev: s.fRev + (r.source === 'forecast' ? r.revenue : 0),
  }), { revenue: 0, cos: 0, overheads: 0, gross: 0, net: 0, aRev: 0, fRev: 0 })

  // THE MONTHLY COLUMNS ARE NEVER TOUCHED by this. Each month stays exactly as Xero
  // reports it or as the forecast builds it; the WIP comes off the YEAR only. That means
  // the FY total deliberately does not equal the sum of the columns, and the gap is
  // exactly the WIP figure - which the page states rather than leaving it looking like
  // an arithmetic fault.
  const wip = resolveWip({
    months, rows,
    wipLocks: wipLocks || (oh && oh.wipLocks) || {},
    include: wipInclude === undefined ? (oh ? oh.plWipInclude : null) : wipInclude,
  })
  const adjTotals = {
    ...totals,
    revenue: totals.revenue + wip.adjustment,
    gross: totals.gross + wip.adjustment,
    net: totals.net + wip.adjustment,
    aRev: totals.aRev + wip.adjustment,
  }

  return {
    fyEnd: year, months, rows, totals, adjTotals, wip,
    actualCount: rows.filter(r => r.source === 'actual').length,
    manualCount: rows.filter(r => r.source === 'manual').length,
  }
}
