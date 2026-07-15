// Shared de-duplication keys, used by BOTH the bulk uploads and the nightly
// deep-sync, so partial uploads accumulate and never double-count — and so an
// upload and the sync agree on what's "the same" transaction.
//
// Xero's CSV/Excel exports don't include line GUIDs, so keys fall back to stable
// business identifiers that are present in both the exports and the API.

export function costLineKey(l) {
  if (l && l.xeroLineId) return `L:${l.xeroLineId}`
  if (l && (l.source === 'wages' || l.accountCode === '320')) return `W:${l.date}|${l.amount}|320`
  return `K:${l?.reference || ''}|${l?.accountCode || ''}|${l?.amount}`
}

export function invoiceLineKey(l) {
  if (!l) return ''
  if (l.invoiceNumber) return `N:${l.invoiceNumber}`
  if (l.xeroInvoiceId) return `I:${l.xeroInvoiceId}`
  return `${l.date}|${l.total ?? l.amountDue}`
}

// Merge new lines into existing, de-duplicated by keyFn. New lines WIN (so a
// re-upload of the same transaction refreshes it rather than duplicating).
export function mergeDedupe(existing, incoming, keyFn) {
  const map = new Map()
  for (const l of (existing || [])) map.set(keyFn(l), l)
  let added = 0
  for (const l of (incoming || [])) {
    const k = keyFn(l)
    if (!map.has(k)) added++
    map.set(k, l)
  }
  return { merged: [...map.values()], added }
}
