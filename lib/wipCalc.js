// Single source of truth for the WIP calculation, used by the WIP page API, the
// dashboard/EOM (commercial.js), and each project's WIP tab, so all three always
// agree.
//
// WIP for a project in a given month =
//   (post-valuation costs, grossed up at the project margin)
//   + each manual adjustment for that month, grossed up at ITS OWN margin
//     (falling back to the project margin when the adjustment has none).
//
// "Post-valuation costs" = cost lines dated AFTER the valuation date and ON OR BEFORE
// the end of that month. If the valuation date is the last day of the month, this
// window is empty and there is no cost-driven WIP.

// Gross an amount to its WIP value at a margin. Works identically for positive and
// negative amounts (amount / (1 - margin)) so equal-and-opposite amounts at the same
// margin cancel exactly. A null/0/>=1 margin passes the amount through unchanged.
export function grossAtMargin(amount, margin) {
  const m = (margin != null && margin < 1) ? margin : 0
  return (amount || 0) / (1 - m)
}

// costLines: [{ date, amount, ... }]
// invoiceLines: [{ date, sales200|subTotal, creditNote }]
// valStr: 'YYYY-MM-DD' valuation date for the month
// monthEndStr: 'YYYY-MM-DD' last day of the month
// adjustments: this-month manual adjustments [{ amount, margin }]
// opts: { marginOverride }  (percent as a number, e.g. 14.4, or null)
export function computeProjectWip({ costLines = [], invoiceLines = [], valStr, monthEndStr, adjustments = [], marginOverride = null }) {
  const postValCosts = costLines.filter(l => l.date && valStr && l.date > valStr && (!monthEndStr || l.date <= monthEndStr))
  const postValTotal = postValCosts.reduce((s, l) => s + (l.amount || 0), 0)

  // Live achieved margin = (invoiced - costs to valuation date) / invoiced. Override
  // (a percentage) wins if provided.
  let calculatedMargin = null
  {
    const costsToDate = costLines.filter(l => l.date && valStr && l.date <= valStr).reduce((s, l) => s + (l.amount || 0), 0)
    const invVal = (i) => (i.sales200 != null ? i.sales200 : (i.subTotal != null ? i.subTotal : 0))
    const invoicedToDate = invoiceLines.filter(l => l.date && valStr && l.date <= valStr).reduce((s, l) => s + invVal(l), 0)
    calculatedMargin = invoicedToDate > 0 ? (invoicedToDate - costsToDate) / invoicedToDate : null
  }
  const marginIsOverride = marginOverride != null && marginOverride !== ''
  const margin = marginIsOverride ? parseFloat(marginOverride) / 100 : calculatedMargin

  let wipValue = grossAtMargin(postValTotal, margin)
  for (const a of adjustments) {
    const am = (a.margin != null && a.margin !== '') ? Number(a.margin) / 100 : margin
    wipValue += grossAtMargin(a.amount || 0, am)
  }
  wipValue = Math.max(0, wipValue)

  const adjTotal = adjustments.reduce((s, a) => s + (a.amount || 0), 0)
  const wipCost = postValTotal + adjTotal
  const wipProfit = wipValue - wipCost

  return { postValCosts, postValTotal, adjTotal, margin, marginIsOverride, calculatedMargin, wipValue, wipProfit, wipCost }
}
