// THE BUSINESS'S TODAY. One rule, one answer, everywhere.
//
// WHY THIS EXISTS
// ---------------
// Pages were computing "today" two different ways in the same file:
//
//   new Date().toISOString().slice(0, 10)   -> the UTC date
//   `${d.getFullYear()}-${...getDate()}`    -> the VIEWER'S LOCAL date
//
// In the UK those agree for 23 hours a day, so the split was invisible. Viewed
// from New Zealand (UTC+12) they are different dates for TWELVE hours a day,
// and the 13-week cash flow moved depending on where the person was sitting.
//
// Neither of them was right. A valuation date, a payment date and a VAT date
// are all facts about the BUSINESS, not about whoever happens to be looking.
// A figure must not change because someone opened it on holiday.
//
// So: today is today in the business's own timezone, wherever the viewer is.
//
// MULTI-TENANCY
// -------------
// The timezone is a per-customer setting in waiting. Rock Roofing is
// Europe/London; a New Zealand customer would be Pacific/Auckland. When the
// tenant record exists, pass its timezone in rather than changing any caller.

export const DEFAULT_TZ = 'Europe/London'

// YYYY-MM-DD for "now" in the given timezone.
//
// Built from formatToParts rather than a locale string, because locale output
// formats vary by runtime and a date that is silently DD/MM somewhere is
// exactly the class of bug this file exists to end.
export function businessToday(tz = DEFAULT_TZ) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date())
    const get = (t) => (parts.find(p => p.type === t) || {}).value
    const y = get('year'), m = get('month'), d = get('day')
    if (y && m && d) return `${y}-${m}-${d}`
  } catch {}
  // Intl or the timezone unavailable: UTC is wrong by at most a day and is
  // never undefined, which is the failure that actually breaks a comparison.
  return new Date().toISOString().slice(0, 10)
}

// A Date object sitting at MIDDAY on the business's today.
//
// For anything that needs a Date rather than a string - mondayOf(), addDays(),
// getDay(). Midday, not midnight, so a daylight-saving shift of an hour in
// either direction cannot move it onto the previous or next day. A week anchor
// that jumps by one day once a year is the kind of fault nobody traces.
export function businessNow(tz = DEFAULT_TZ) {
  return new Date(businessToday(tz) + 'T12:00:00')
}

// Same, for an arbitrary date rather than now.
export function businessDay(date, tz = DEFAULT_TZ) {
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d)
    const get = (t) => (parts.find(p => p.type === t) || {}).value
    const y = get('year'), m = get('month'), dd = get('day')
    if (y && m && dd) return `${y}-${m}-${dd}`
  } catch {}
  return d.toISOString().slice(0, 10)
}
