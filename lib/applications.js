// Shared helpers for the Applications feature (server + client).
import { lineRateTotal } from './contractRatesParser'

// Build the application's Contract Works rows from the locked contracted-rates
// items. Above-the-line, non-struck ITEM rows only, auto-renumbered 1..n.
// Headings are carried through (kind:'heading') so the document keeps structure,
// but they are not numbered and carry no % complete.
export function buildContractWorksFromRates(items) {
  const list = Array.isArray(items) ? items : []
  const above = list.filter(x => x.section === 'above' && !x.struck)
  let n = 0
  return above.map(x => {
    if (x.kind === 'heading') {
      return { id: x.id, kind: 'heading', description: x.description || '', bold: !!x.bold, underline: !!x.underline, red: !!x.red, plainHeading: !!x.plainHeading }
    }
    n += 1
    const total = lineRateTotal(x)
    return {
      id: x.id,
      kind: 'item',
      code: String(n),                 // auto-renumbered
      origCode: x.code || '',
      description: x.description || '',
      qty: x.qty ?? null,
      unit: x.unit || '',
      rate: x.rate ?? null,
      total,
      pctComplete: 0,
      bold: !!x.bold, underline: !!x.underline, red: !!x.red,
    }
  })
}

const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }

// Value-to-date for a contract-works row = total * pctComplete/100.
export function worksValueToDate(row) {
  if (!row || row.kind !== 'item') return 0
  return (num(row.total) * num(row.pctComplete)) / 100
}

// A variation's full value (materials + labour + profit).
export function variationValue(v) {
  return num(v.materials) + num(v.labour) + num(v.profit)
}
// Value to date. Not-instructed variations (pctComplete null) contribute 0.
export function variationValueToDate(v) {
  if (!v || v.instructed === false || v.pctComplete == null) return 0
  return (variationValue(v) * num(v.pctComplete)) / 100
}

// Stable key for matching a tracker variation to per-application data
// (% complete, attachments). varNumber + description is what the tracker uses.
export function varKey(v) {
  return `${(v.varNumber || '').trim()}|${(v.description || v.descriptionFull || '').trim().slice(0, 80)}`
}

// Build the variation list to display/total for an application.
// - Draft: LIVE from the tracker; merges the app's stored per-variation % + attachments.
// - Sent (frozen): uses the app's own stored `variations` snapshot.
// Not-instructed variations carry pctComplete = null (no % / N/A, excluded from totals).
export function buildAppVariations(app, trackerVariations) {
  if (app && app.status && app.status !== 'draft' && Array.isArray(app.variations)) {
    return app.variations
  }
  const perVar = (app && app.variationData) || {}
  return (trackerVariations || []).map(v => {
    const key = varKey(v)
    const stored = perVar[key] || {}
    return {
      key,
      varNumber: v.varNumber || '',
      description: v.descriptionFull || v.description || '',
      instructed: !!v.instructed,
      materials: v.materials || '0', labour: v.labour || '0', profit: v.profit || '0',
      pctComplete: v.instructed ? (stored.pctComplete != null ? stored.pctComplete : 0) : null,
      attachments: Array.isArray(stored.attachments) ? stored.attachments : [],
    }
  })
}

// Compute the full Summary for an application, given the application itself and
// the previous application's cumulative "current" figures (for This Cert).
//   app: { contractWorks, variations, materials, mcdPct, retentionPct }
//   prev: { grossCurrent } (previously certified gross, cumulative) or null
export function computeApplicationSummary(app, prevGross = 0) {
  const cw = Array.isArray(app.contractWorks) ? app.contractWorks : []
  const vars = Array.isArray(app.variations) ? app.variations : []
  const mats = Array.isArray(app.materials) ? app.materials : []

  const measuredContractSum = cw.reduce((s, r) => s + (r.kind === 'item' ? num(r.total) : 0), 0)
  const measuredToDate = cw.reduce((s, r) => s + worksValueToDate(r), 0)

  const instructedVars = vars.filter(v => v.instructed !== false)
  const variationsFinal = instructedVars.reduce((s, v) => s + variationValue(v), 0)
  const variationsToDate = vars.reduce((s, v) => s + variationValueToDate(v), 0)

  const materialsOnSite = mats.reduce((s, m) => s + num(m.total != null ? m.total : (num(m.qty) * num(m.rate))), 0)

  // Certificate block: Gross (current cumulative) across the three columns.
  const grossCurrent = measuredToDate + variationsToDate + materialsOnSite
  const mcdPct = num(app.mcdPct)
  const retPct = num(app.retentionPct)

  const mkCol = (gross) => {
    const mcd = gross * (mcdPct / 100)
    const subTotal = gross - mcd
    const retention = subTotal * (retPct / 100)
    const total = subTotal - retention
    return { gross, mcd, subTotal, retention, total }
  }
  const current = mkCol(grossCurrent)
  const previously = mkCol(num(prevGross))
  const thisCert = {
    gross: current.gross - previously.gross,
    mcd: current.mcd - previously.mcd,
    subTotal: current.subTotal - previously.subTotal,
    retention: current.retention - previously.retention,
    total: current.total - previously.total,
  }

  return {
    // top block
    measuredContractSum, measuredToDate,
    variationsFinal, variationsToDate,
    materialsOnSite,
    contractSum: measuredContractSum,
    applicationTotal: grossCurrent,
    anticipatedFinalAccount: measuredContractSum + variationsFinal,
    // certificate block
    grossCurrent,
    current, previously, thisCert,
  }
}

// Given a day-of-month + a month (Date at day 1) + optional override, return a
// Date for that day in that month.
function dayInMonth(year, monthIdx, day) {
  const d = parseInt(day)
  if (!d) return null
  const last = new Date(year, monthIdx + 1, 0).getDate()
  return new Date(year, monthIdx, Math.min(d, last))
}

// Resolve the four application dates for a given month (YYYY-MM), from the
// project's day-of-month settings + monthly overrides.
export function resolveAppDates(monthKey, settings) {
  const [y, m] = String(monthKey || '').split('-').map(Number)
  const out = { appDate: '', valDate: '', paymentDate: '', finalDate: '' }
  if (!y || !m) return out
  const monthIdx = m - 1
  const ov = (settings.dateOverrides && settings.dateOverrides[monthKey]) || {}
  const iso = (d) => d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0] : ''

  out.appDate = ov.applicationDate || iso(dayInMonth(y, monthIdx, settings.applicationDay))
  out.valDate = ov.valuationDate || iso(dayInMonth(y, monthIdx, settings.valuationDay))
  // payment day usually falls the following month
  let payDate = null
  if (ov.paymentDate) { out.paymentDate = ov.paymentDate }
  else if (settings.paymentDay) {
    payDate = dayInMonth(y, monthIdx + 1, settings.paymentDay)
    out.paymentDate = iso(payDate)
  }
  // final date = payment due + finalPaymentDays (default 0 => same as payment)
  const finalDays = parseInt(settings.finalPaymentDays)
  if (payDate && finalDays) {
    const f = new Date(payDate); f.setDate(f.getDate() + finalDays)
    out.finalDate = iso(f)
  } else {
    out.finalDate = out.paymentDate
  }
  return out
}
