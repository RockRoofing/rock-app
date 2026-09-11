// THE DATE A FORM IS ABOUT, NOT THE DATE IT WAS SUBMITTED.
//
// A Daily Site Diary carries "Site Diary Date" as its second question, and that is
// the day the diary covers. The submission timestamp is just when somebody got round
// to typing it in.
//
// Forms Missing matched the SUBMITTED date against the allocated day:
//
//     s.submittedAt && iso(new Date(s.submittedAt)) === dk
//
// So a Monday diary filled in on Tuesday morning counted as Tuesday's, Monday read
// as missing, and Tuesday could read as done before it had happened. Anyone writing
// up the week on Friday had four missing days and one doing the work of five.
//
// Same rule as pages/forms/fill.js, which already uses it to pre-select the crew
// from the Gantt for the diary date. One definition, so a form that pre-fills from
// the date is scored on the same date.
export function dateFieldIdOf(form) {
  const f = (form && form.fields || []).find(x =>
    x.type === 'date' && /(site diary date|^date$|date for which)/i.test(x.label || ''))
  return f ? f.id : null
}

// The answer, normalised to YYYY-MM-DD. Returns '' where the form has no such field
// or it was left blank, so callers can fall back to the submission date rather than
// treating the form as undated.
export function formDateOf(form, answers) {
  const id = dateFieldIdOf(form)
  if (!id) return ''
  const v = answers ? answers[id] : null
  if (!v) return ''
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // A date input gives ISO, but a record written another way might not.
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
