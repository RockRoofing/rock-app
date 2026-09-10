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
// ONE TEST FOR "IS THIS VARIATION INSTRUCTED".
//
// The field is a boolean on records written by the current UI and the STRING 'yes'/'no'
// on older ones. `v.instructed !== false` counts a missing flag as instructed;
// `!!v.instructed` counts the string 'no' as instructed. Both are wrong, in opposite
// directions, and both were in the codebase.
export function isInstructed(v) {
  return !!v && (v.instructed === true || v.instructed === 'yes')
}

// ONE RULE FOR GROSS AFA, FOR EVERY SURFACE THAT SHOWS IT.
//
// This was written four times - dashboard.js, pages/project/[id].js,
// pages/api/project/[id].js and applications.js - in three different orders. The
// API copy let a stored override beat a live sent application outright, so Project
// Financials and the project report could contradict the retention register on the
// same job.
//
// THE SENT APPLICATION ALWAYS WINS. An override is only ever reached where no sent
// application exists.
//
//   1. the figure STAMPED by the latest sent application  - as issued, no arithmetic
//   2. rebuilt from the latest sent application           - only where nothing was stamped
//   3. a stored override                                  - always a leftover from an
//                                                            earlier send; there is no
//                                                            manual field in the UI
//   4. project details
//
// `records` is every settings record that might carry the stamp. Project settings
// are keyed by tracking option id OR job number and both can exist, so pass both;
// the most recently stamped one wins.
export function resolveGrossAfa(opts) {
  const o = opts || {}
  const records = (o.records || []).filter(Boolean)
  const apps = (o.applications || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0))
  const sentApps = apps.filter(a => a && a.status === 'sent')
  const latestSent = o.latestSent !== undefined
    ? o.latestSent
    : (sentApps.length ? sentApps[sentApps.length - 1] : null)

  const stamp = records
    .filter(r => r.afaOverride != null && isFinite(r.afaOverride))
    .sort((a, b) => (b.afaOverrideAt || 0) - (a.afaOverrideAt || 0))[0] || null

  // Only the application we are actually reading. A stamp left by an EARLIER
  // application is stale and ranks as an override, not as the current figure.
  const stampIsFromLatestSent = !!(latestSent && stamp
    && stamp.afaOverrideAppSeq != null
    && String(stamp.afaOverrideAppSeq) === String(latestSent.seq))

  const label = latestSent ? (latestSent.appNumber != null ? latestSent.appNumber : latestSent.seq) : ''

  // THE APPLICATION AS IT STANDS NOW, NOT THE STAMP LEFT BEHIND WHEN IT WAS SENT.
  //
  // The stamp is only rewritten on send, so editing a sent application without
  // re-sending leaves it behind. J228 showed 169,679.70 from the stamp against an
  // application reading 140,274.20 - the stamp was 29,405.50 out of date.
  //
  // Worse, the gross came from the stamp while the net came from the live summary,
  // so the difference between two unrelated sources was landing in the MCD column
  // and showing 29,405.50 of discount on a project set to 0%.
  //
  // The stored application is the application. Read it, and keep the stamp only as a
  // fallback for records that predate it or fail to recompute.
  let sum = o.sentSum
  if (!sum && latestSent) {
    let prevGross = 0
    if (latestSent.prevCertGross != null) prevGross = Number(latestSent.prevCertGross) || 0
    else for (const a of apps) { if ((a.seq || 0) < (latestSent.seq || 0)) prevGross = computeApplicationSummary(a, 0).grossCurrent || 0 }
    sum = computeApplicationSummary(latestSent, prevGross)
  }
  const live = (sum && sum.anticipatedFinalAccount != null && isFinite(sum.anticipatedFinalAccount) && sum.anticipatedFinalAccount > 0)
    ? Number(sum.anticipatedFinalAccount) : null
  // Does the stamp still agree with the application it claims to come from?
  const stampDisagrees = !!(stampIsFromLatestSent && live != null && Math.abs(Number(stamp.afaOverride) - live) > 1)

  if (live != null) {
    return { afa: live, source: `application ${label} (sent)`,
             fromApp: true, stamp, stampIsFromLatestSent, stampDisagrees, latestSent, sum }
  }

  if (stampIsFromLatestSent) {
    return { afa: Number(stamp.afaOverride), source: `application ${label} (stamped at send)`,
             fromApp: true, stamp, stampIsFromLatestSent: true, stampDisagrees: false, latestSent, sum }
  }

  if (stamp) {
    return { afa: Number(stamp.afaOverride), source: 'stored override (earlier application)',
             fromApp: false, stamp, stampIsFromLatestSent: false, stampDisagrees: false, latestSent, sum }
  }

  return { afa: (Number(o.contractValue) || 0) + (Number(o.instructedVarsTotal) || 0),
           source: 'project details', fromApp: false, stamp: null, stampIsFromLatestSent: false, stampDisagrees: false, latestSent, sum }
}

export function variationValueToDate(v) {
  // Same test as instructedVars. This gave the right answer on not-instructed variations
  // only because they tend to have no pctComplete - set one and the value was counted.
  if (!v || !isInstructed(v) || v.pctComplete == null) return 0
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
      // Same two faults as buildLiveVars, and worse here: this copy is FROZEN onto the
      // application when it is sent. A sent application would have kept a variation with
      // no builder block and instructed as a boolean - so its document and its digital
      // instruction could never be reproduced, even after the bug was fixed.
      instructed: (v.instructed === 'yes' || v.instructed === true) ? 'yes' : 'no',
      builder: v.builder || null,
      materials: v.materials || '0', labour: v.labour || '0', profit: v.profit || '0',
      pctComplete: (v.instructed === 'yes' || v.instructed === true) ? (stored.pctComplete != null ? stored.pctComplete : 0) : null,
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

  // INSTRUCTED MEANS INSTRUCTED, not "not explicitly denied".
  //
  // This read `v.instructed !== false`, which admits undefined, null and a missing
  // field - anything except a literal false. A variation created before the flag
  // existed, or one where it was never set, counted as instructed and went into the
  // Projected Final Account. On J-- that was V12 at 29,405.50 inflating the PFA while
  // the row beside it read "Not instructed".
  //
  // AND IT IS NOT ALWAYS A BOOLEAN. Older records store the STRING 'yes'/'no', so a
  // truthy test counts 'no' as instructed - the same fault in the other direction.
  // pages/api/project-cashflow.js documents this and normalises it once; the same test
  // is used here rather than inventing a third.
  const instructedVars = vars.filter(v => isInstructed(v))
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

  // WHAT MCD IS CHARGED ON.
  //
  // Main contractor's discount is not always a discount on the whole account. Plenty of
  // subcontracts apply it to the contract sum only, valuing variations separately and
  // charging nothing on materials you have bought and are storing.
  //
  // Both default to TRUE - the behaviour every existing application was built with. They
  // are stamped onto the application when it is created, like mcdPct and retentionPct, so
  // changing the project setting never alters a certificate that has already gone out.
  const mcdOnVars = app.mcdOnVariations !== false
  const mcdOnMos = app.mcdOnMaterials !== false

  // The part MCD is charged on, and the part added afterwards.
  const mcdBaseCur = measuredToDate + (mcdOnVars ? variationsToDate : 0) + (mcdOnMos ? materialsOnSite : 0)
  const afterMcdCur = (mcdOnVars ? 0 : variationsToDate) + (mcdOnMos ? 0 : materialsOnSite)
  const mcdSplit = !mcdOnVars || !mcdOnMos

  // RETENTION RELEASE.
  //
  // Retention already deducted, being claimed back. It is ADDED after the deduction, not
  // netted off the percentage - the contract still holds retention on the work; this is
  // the release of a half that has fallen due.
  //
  // Each half is measured against the retention on the FINAL ACCOUNT, not on the work
  // certified so far. A release claimed at 90% complete is still half of the whole
  // retention pot, which is what the contract says.
  // Retention on the final account, on the same basis as the certificate: MCD comes off
  // only what it applies to, and retention is charged on everything after that.
  const finalMcdBase = measuredContractSum + (mcdOnVars ? variationsFinal : 0)
  const finalAfter = mcdOnVars ? 0 : variationsFinal
  const finalSubTotal = (finalMcdBase - (finalMcdBase * (mcdPct / 100))) + finalAfter
  const retentionOnFinal = finalSubTotal * (retPct / 100)
  const halfRetention = retentionOnFinal / 2

  // RELEASED TO DATE IS CUMULATIVE.
  //
  // The Current column is the position on the job so far, not what this application does.
  // A half released on an earlier certificate is still released - so it belongs in
  // Current, and the difference against Previously is what THIS certificate claims.
  //
  // Read from this application OR any earlier one. Without the "or", an application that
  // ticks only the 2nd half counted one half in Current and one half in Previously, and
  // cancelled itself to zero - which is exactly what the 2nd release PDF showed.
  const prevRelRaw = prevReleases || {}
  const rel1 = !!app.retentionRelease1 || !!prevRelRaw.retentionRelease1
  const rel2 = !!app.retentionRelease2 || !!prevRelRaw.retentionRelease2
  // Claimed on THIS certificate - ticked here and not already released.
  const rel1New = rel1 && !prevRelRaw.retentionRelease1
  const rel2New = rel2 && !prevRelRaw.retentionRelease2
  const release1Value = rel1 ? halfRetention : 0
  const release2Value = rel2 ? halfRetention : 0
  const releasedTotal = release1Value + release2Value

  // What the PREVIOUS application had already released, so a half claimed last month is
  // not claimed again on this certificate. Without this, a release ticked once would
  // reappear in "this certificate" on every application after it.
  const prevReleased = ((prevRelRaw.retentionRelease1 ? halfRetention : 0)
    + (prevRelRaw.retentionRelease2 ? halfRetention : 0))

  // base   = what MCD is charged on
  // after   = variations / materials the discount does not touch, added back afterwards
  const mkCol = (base, after, released) => {
    const mcd = base * (mcdPct / 100)
    const subTotal = base - mcd            // after the discount, before the untouched parts
    const netBeforeRet = subTotal + (after || 0)
    const retention = netBeforeRet * (retPct / 100)
    const total = netBeforeRet - retention + (released || 0)
    return {
      gross: base + (after || 0),          // the whole account either way
      mcdBase: base, mcd, subTotal,
      after: after || 0, netBeforeRet,
      retention, released: released || 0, total,
    }
  }
  const current = mkCol(mcdBaseCur, afterMcdCur, releasedTotal)

  // THE PREVIOUS COLUMN NEEDS THE SAME SPLIT, and prevGross is a single number.
  //
  // Where we have the previous application we work its split out properly. Where we only
  // have a typed-in "previously certified (gross)" - a project part-certified before it
  // came into the app - there is nothing to split it by, so the whole figure is treated
  // as the MCD base. That matches how it behaved before, and it is the safer assumption:
  // it discounts more rather than less.
  let prevBase = num(prevGross)
  let prevAfter = 0
  if (mcdSplit && prevReleases && Array.isArray(prevReleases.contractWorks)) {
    try {
      const p = computeApplicationSummary({ ...prevReleases, mcdOnVariations: mcdOnVars, mcdOnMaterials: mcdOnMos }, 0, null)
      // Scale to the gross actually being used, so a manually adjusted prevGross still
      // splits in the same proportion the previous application had.
      const pGross = p.grossCurrent || 0
      if (pGross > 0) {
        const ratio = num(prevGross) / pGross
        prevBase = (p.measuredToDate + (mcdOnVars ? p.variationsToDate : 0) + (mcdOnMos ? p.materialsOnSite : 0)) * ratio
        prevAfter = ((mcdOnVars ? 0 : p.variationsToDate) + (mcdOnMos ? 0 : p.materialsOnSite)) * ratio
      }
    } catch { /* fall back to treating it all as the MCD base */ }
  }
  const previously = mkCol(prevBase, prevAfter, prevReleased)
  const thisCert = {
    gross: current.gross - previously.gross,
    mcdBase: current.mcdBase - previously.mcdBase,
    mcd: current.mcd - previously.mcd,
    subTotal: current.subTotal - previously.subTotal,
    after: current.after - previously.after,
    netBeforeRet: current.netBeforeRet - previously.netBeforeRet,
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
    // How MCD was applied, so the certificate can lay itself out to match.
    mcdOnVars, mcdOnMos, mcdSplit,
    // Retention release, for the summary block and the tracker.
    retentionOnFinal, halfRetention,
    // THE FINAL ACCOUNT AFTER MCD, on the certificate's own basis.
    //
    // MCD comes off only what it applies to - finalMcdBase - and whatever it does not
    // apply to is added back afterwards. The retention register needs exactly this
    // figure for its Final Account column; it was recomputing MCD across the whole
    // account instead, which is wrong wherever MCD is set to exclude variations.
    finalMcdBase, finalAfter, finalSubTotal,
    release1Value, release2Value, releasedTotal,
    // Which halves are released to date, and which are new on this certificate - so the
    // summary can show a half released earlier without claiming it again.
    rel1, rel2, rel1New, rel2New,
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
  // "PROPOSED Final Account and INTERIM Application for Payment" - both words matter.
  //
  // The final account is not agreed until the customer agrees it, so calling the document
  // "Final Account" states as settled something we are proposing. And the payment claimed
  // on it is still an interim payment under the contract. The full phrase says what the
  // document actually is.
  const FINAL_TITLE = 'Proposed Final Account and Interim Application for Payment'
  const title = isFinal ? FINAL_TITLE : (releases.length ? releases.join(' & ') : 'Application for Payment')
  // Short form for a filename and a list badge, where the full phrase is unusable.
  const titleShort = isFinal ? 'Proposed Final Account' : title
  const suffix = isFinal && releases.length ? ` (incl. ${releases.join(' & ')})` : ''

  return {
    isFinal,
    rel1, rel2,
    releases,                       // ['1st Retention Release', ...]
    title,                          // headline for the PDF
    titleShort,                     // filenames and badges
    titleFull: title + suffix,      // headline including any releases
    // Short tags for the list, in the order they should read.
    tags: [
      ...(isFinal ? ['FINAL ACCOUNT'] : []),
      ...(rel1 ? ['1ST RETENTION'] : []),
      ...(rel2 ? ['2ND RETENTION'] : []),
    ],
  }
}
