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

// A works line only counts (Total, % complete, value-to-date) when it's a complete
// measurable item: qty + unit + rate + total all present and non-zero total.
export function isMeasurableWorks(r) {
  return !!r && r.kind === 'item' && r.qty != null && String(r.unit || '').trim() !== '' && r.rate != null && r.total != null && num(r.total) !== 0
}

// Value-to-date for a contract-works row = total * pctComplete/100.
export function worksValueToDate(row) {
  if (!isMeasurableWorks(row)) return 0
  return (num(row.total) * num(row.pctComplete)) / 100
}

// A variation's full value (materials + labour + profit).
export function variationValue(v) {
  return num(v.materials) + num(v.labour) + num(v.profit)
}
// A material-on-site line total, including its per-line mark-up %.
export function materialLineTotal(m) {
  const base = m.total != null ? num(m.total) : (num(m.qty) * num(m.rate))
  return base * (1 + num(m.markupPct) / 100)
}
// Value claimed to date for a material line = marked-up total x % complete.
// Defaults to 100% when no pctComplete is set (materials on site are usually
// claimed in full), but can be reduced.
export function materialValueToDate(m) {
  const pct = m.pctComplete == null ? 100 : num(m.pctComplete)
  return materialLineTotal(m) * pct / 100
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
export function computeApplicationSummary(app, prevGross = 0, prevReleases = null) {
  const cw = Array.isArray(app.contractWorks) ? app.contractWorks : []
  const vars = Array.isArray(app.variations) ? app.variations : []
  const mats = Array.isArray(app.materials) ? app.materials : []

  const measuredContractSum = cw.reduce((s, r) => s + (isMeasurableWorks(r) ? num(r.total) : 0), 0)
  const measuredToDate = cw.reduce((s, r) => s + worksValueToDate(r), 0)

  const instructedVars = vars.filter(v => v.instructed !== false)
  const variationsFinal = instructedVars.reduce((s, v) => s + variationValue(v), 0)
  const variationsToDate = vars.reduce((s, v) => s + variationValueToDate(v), 0)

  const materialLineTotalFn = (m) => {
    const base = m.total != null ? num(m.total) : (num(m.qty) * num(m.rate))
    return base * (1 + num(m.markupPct) / 100)
  }
  const materialToDateFn = (m) => materialLineTotalFn(m) * ((m.pctComplete == null ? 100 : num(m.pctComplete)) / 100)
  const matItems = mats.filter(m => m.kind !== 'group')
  const materialsFinal = matItems.reduce((s, m) => s + materialLineTotalFn(m), 0)
  const materialsOnSite = matItems.reduce((s, m) => s + materialToDateFn(m), 0)

  // Certificate block: Gross (current cumulative) across the three columns.
  const grossCurrent = measuredToDate + variationsToDate + materialsOnSite
  const mcdPct = num(app.mcdPct)
  const retPct = num(app.retentionPct)

  // RETENTION RELEASE.
  //
  // Retention already deducted, being claimed back. It is ADDED after the deduction, not
  // netted off the percentage - the contract still holds retention on the work; this is
  // the release of a half that has fallen due.
  //
  // Each half is measured against the retention on the FINAL ACCOUNT, not on the work
  // certified so far. A release claimed at 90% complete is still half of the whole
  // retention pot, which is what the contract says.
  const finalGross = measuredContractSum + variationsFinal
  const finalSubTotal = finalGross - (finalGross * (mcdPct / 100))
  const retentionOnFinal = finalSubTotal * (retPct / 100)
  const halfRetention = retentionOnFinal / 2

  const rel1 = !!app.retentionRelease1
  const rel2 = !!app.retentionRelease2
  const release1Value = rel1 ? halfRetention : 0
  const release2Value = rel2 ? halfRetention : 0
  const releasedTotal = release1Value + release2Value

  // What the PREVIOUS application had already released, so a half claimed last month is
  // not claimed again on this certificate. Without this, a release ticked once would
  // reappear in "this certificate" on every application after it.
  const prevRel = prevReleases || {}
  const prevReleased = ((prevRel.retentionRelease1 ? halfRetention : 0)
    + (prevRel.retentionRelease2 ? halfRetention : 0))

  const mkCol = (gross, released) => {
    const mcd = gross * (mcdPct / 100)
    const subTotal = gross - mcd
    const retention = subTotal * (retPct / 100)
    const total = subTotal - retention + (released || 0)
    return { gross, mcd, subTotal, retention, released: released || 0, total }
  }
  const current = mkCol(grossCurrent, releasedTotal)
  const previously = mkCol(num(prevGross), prevReleased)
  const thisCert = {
    gross: current.gross - previously.gross,
    mcd: current.mcd - previously.mcd,
    subTotal: current.subTotal - previously.subTotal,
    retention: current.retention - previously.retention,
    released: current.released - previously.released,
    total: current.total - previously.total,
  }

  return {
    // top block
    measuredContractSum, measuredToDate,
    variationsFinal, variationsToDate,
    materialsOnSite,
    materialsFinal,
    contractSum: measuredContractSum,
    applicationTotal: grossCurrent,
    anticipatedFinalAccount: measuredContractSum + variationsFinal,
    // certificate block
    grossCurrent,
    // Retention release, for the summary block and the tracker.
    retentionOnFinal, halfRetention,
    release1Value, release2Value, releasedTotal,
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
// monthKey is normally "2026-08". A project applying more often than monthly uses
// "2026-08#2" for the second period in that month - the month it belongs to, then which
// one it is. The month is always the part before the #, so anything grouping by month
// still works; only the override lookup needs the full key.
export function resolveAppDates(monthKey, settings) {
  const raw = String(monthKey || '')
  const monthPart = raw.split('#')[0]
  const [y, m] = monthPart.split('-').map(Number)
  const out = { appDate: '', valDate: '', paymentDate: '', finalDate: '' }
  if (!y || !m) return out
  const monthIdx = m - 1
  // The exact period's dates. NO fallback to the month's own row for an extra period -
  // period 2 borrowing period 1's dates would silently produce two applications on the
  // same date, which is worse than leaving them blank to be filled in.
  const ov = (settings.dateOverrides && settings.dateOverrides[raw]) || {}
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

// Assign permanent customer-facing appNumbers to any SENT application that lacks
// one (e.g. sent before this field existed). The Nth sent app in creation (seq)
// order becomes N, respecting any numbers already stored. Mutates + returns apps,
// and reports whether anything changed so the caller can persist.
export function backfillAppNumbers(apps) {
  const list = Array.isArray(apps) ? apps : []
  const sentInOrder = list
    .filter(a => a && a.status && a.status !== 'draft')
    .sort((a, b) => (a.seq || 0) - (b.seq || 0))
  let n = 0, changed = false
  for (const a of sentInOrder) {
    if (a.appNumber) { n = a.appNumber; continue }
    n = n + 1
    a.appNumber = n
    changed = true
  }
  return { apps: list, changed, maxSent: n }
}


// WHAT THIS APPLICATION IS, in words.
//
// One place, used by the email subject, the email body, the PDF title and the badges on
// the application list. Four descriptions written separately would say four slightly
// different things about the same document, and the one that reaches the customer is the
// one that matters.
//
// The rules, as specified:
//   - Final Account only when the flag is ticked. Releasing retention does NOT make an
//     application a final account, and saying so would be a claim about the contract that
//     nobody has made.
//   - a release is named by which half it is
//   - both can be true at once: a final account that also releases the second half
export function describeApplication(app, opts = {}) {
  const { prevReleases = null } = opts
  const isFinal = !!app.isFinalAccount
  // Only halves being claimed ON THIS application - one already claimed last month is not
  // news to the customer and should not be in the subject line.
  const rel1 = !!app.retentionRelease1 && !(prevReleases && prevReleases.retentionRelease1)
  const rel2 = !!app.retentionRelease2 && !(prevReleases && prevReleases.retentionRelease2)

  const releases = []
  if (rel1) releases.push('1st Retention Release')
  if (rel2) releases.push('2nd Retention Release')

  // The document's own title. Final Account wins as the headline; releases are added
  // after it rather than replacing it.
  const title = isFinal ? 'Final Account' : (releases.length ? releases.join(' & ') : 'Application for Payment')
  const suffix = isFinal && releases.length ? ` (incl. ${releases.join(' & ')})` : ''

  return {
    isFinal,
    rel1, rel2,
    releases,                       // ['1st Retention Release', ...]
    title,                          // headline for the PDF
    titleFull: title + suffix,      // headline including any releases
    // Short tags for the list, in the order they should read.
    tags: [
      ...(isFinal ? ['FINAL ACCOUNT'] : []),
      ...(rel1 ? ['1ST RETENTION'] : []),
      ...(rel2 ? ['2ND RETENTION'] : []),
    ],
  }
}
