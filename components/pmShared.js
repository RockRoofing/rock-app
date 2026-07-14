// Shared helpers for Project Management tables (Risk Log, Live Tasks, Procurement).

// Traffic-light colouring for a target/deadline date cell:
//   Green  — more than 1 week away
//   Orange — 1 week or less away (but not yet passed)
//   Red    — today or in the past
// Returns a style object to spread onto the cell.
export function dateCellStyle(dateStr) {
  if (!dateStr) return {}
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  if (isNaN(d)) return {}
  const days = Math.round((d - today) / 86400000)
  if (days <= 0) return { background: '#fef2f2', color: '#991b1b', fontWeight: 600 }      // red: today or later
  if (days <= 7) return { background: '#fff7ed', color: '#9a3412', fontWeight: 600 }       // orange: within a week
  return { background: '#ecfdf5', color: '#065f46' }                                        // green: >1 week away
}

// Whether a lead-in period from a required-on-site date means we're already too
// late to procure (used by Procurement). leadInWeeks from requiredDate backwards;
// if that latest-order date is before today, we're short on time.
export function procurementLate(requiredOnSite, leadInWeeks) {
  if (!requiredOnSite || !leadInWeeks) return false
  const req = new Date(requiredOnSite); if (isNaN(req)) return false
  const latestOrder = new Date(req.getTime() - Number(leadInWeeks) * 7 * 86400000)
  const today = new Date(); today.setHours(0, 0, 0, 0); latestOrder.setHours(0, 0, 0, 0)
  return latestOrder < today
}

// Colour key legend matching dateCellStyle: red = overdue (today or past),
// orange = within a week, green = more than a week away.
export function DateColourKey() {
  const item = (bg, color, label) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#666' }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, background: bg, border: `1px solid ${color}22` }} />
      {label}
    </span>
  )
  return (
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', margin: '0 0 14px', padding: '8px 12px', background: '#fafafa', border: '1px solid #efefef', borderRadius: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#888' }}>Key:</span>
      {item('#fef2f2', '#991b1b', 'Overdue (today or past)')}
      {item('#fff7ed', '#9a3412', 'Due within a week')}
      {item('#ecfdf5', '#065f46', 'More than a week away')}
    </div>
  )
}
