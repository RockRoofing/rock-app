import { getPreStart } from './db'

// IS THE PRE-START DONE?
//
// Pre-Start Minutes are NOT a Site App form. They live in their own store, one
// record per project at ops:prestart:{projectNo}, filled in from the project page
// rather than submitted through the Forms App.
//
// Both the Forms Missing page and the Monday chaser looked for them in the form
// SUBMISSION index:
//
//     subs.some(s => s.formTitle.toLowerCase().includes('pre-start'))
//
// Nothing ever writes a Pre-Start there, so that test could only ever return false.
// Every project needing one read as Missing however many times it had been done -
// and the cron emailed the Contracts Manager about it again every Monday.
//
// DONE MEANS SENT. The form is only complete once it has been issued - sentAt, or
// sentManually where it went out some other way and was marked off. At that point it
// locks and cannot be edited, which is the same line the project page draws.
export function preStartSentAt(rec) {
  if (!rec) return 0
  if (rec.sentAt) return Number(rec.sentAt) || 0
  // Marked as sent by hand, with no timestamp on older records - treat the last save
  // as the moment, rather than discarding a Pre-Start that was genuinely issued.
  if (rec.sentManually) return Number(rec.updatedAt) || 1
  return 0
}

export function isPreStartDone(rec) {
  return preStartSentAt(rec) > 0
}

// Done AS AT a moment - used per week by the Forms Missing page, so a week that
// closed before the minutes existed is not retrospectively marked complete, while a
// Pre-Start issued weeks ago still counts for every week after it.
export function isPreStartDoneBy(rec, whenMs) {
  const t = preStartSentAt(rec)
  return t > 0 && t <= whenMs
}

// One read per project. There are a couple of dozen live projects, so this is cheap,
// and it keeps both callers on the same rule rather than each fetching its own way.
export async function loadPreStarts(projectNos) {
  const out = {}
  await Promise.all((projectNos || []).map(async (no) => {
    if (!no) return
    try { out[no] = await getPreStart(no) } catch { out[no] = null }
  }))
  return out
}
