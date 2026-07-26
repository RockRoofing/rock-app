// Shared cash-flow event helpers (used by the 13-week and 12-month cash flow pages).
export const pad = (n) => String(n).padStart(2, '0')
export const normName = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\b(ltd|limited|plc|llp|uk|co|company|the)\b/g, '').replace(/[^a-z0-9]/g, '').trim()
export const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; return new Date(x.getTime() - wd * 86400000) }
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
export const clampDay = (y, m, day) => Math.min(day, daysInMonth(y, m))

// Build every scheduled overhead cash event across a date window [start,end].
// Returns [{ date:'YYYY-MM-DD', amount, code }]. Applies carry-forwards.
export function overheadEvents(schedule, budgets, start, end, predictedByCodeMonth) {
  const events = []
  // Distinct months spanned by the window (plus a month either side for safety).
  const months = []
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cur <= last) { months.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1) }

  // The amount to schedule for a code in a given month: prefer the per-month predicted
  // spend (from the Budgets page), fall back to the flat monthly budget. If the code is
  // VAT-flagged, gross it up by 20% for the cash-out timing (input VAT nets off later
  // at the VAT return, so this only affects WHEN the cash moves, not the net total).
  const amountFor = (code, mk, sc) => {
    const pm = predictedByCodeMonth && predictedByCodeMonth[code]
    let base = (pm && pm[mk] != null) ? (Number(pm[mk]) || 0) : Number(budgets[code] || 0)
    if (sc && sc.vat) base = base * 1.20
    return base
  }

  for (const [code, sc] of Object.entries(schedule || {})) {
    if (!sc || !sc.mode) continue

    // Net carry adjustments per month for this code: subtract from 'from', add to 'to'.
    const carryAdj = {}
    for (const c of (sc.carry || [])) {
      const amt = Number(c.amount || 0)
      if (!amt || !c.from || !c.to) continue
      carryAdj[c.from] = (carryAdj[c.from] || 0) - amt
      carryAdj[c.to] = (carryAdj[c.to] || 0) + amt
    }

    for (const mDate of months) {
      const y = mDate.getFullYear(), m = mDate.getMonth()
      const mk = `${y}-${pad(m + 1)}`
      const adj = carryAdj[mk] || 0
      const monthlyBudget = amountFor(code, mk, sc)
      if (!monthlyBudget && sc.mode !== 'multiday' && !adj) continue

      if (sc.mode === 'oneday') {
        const amount = monthlyBudget + adj
        if (Math.abs(amount) < 0.005) continue
        const day = clampDay(y, m, Number(sc.day || 28))
        events.push({ date: `${mk}-${pad(day)}`, amount, code })
      } else if (sc.mode === 'multiday') {
        // Specific-day splits; carry adjustment is applied pro-rata across the splits.
        // Gross up each split by 20% when the code is VAT-flagged (matches the +VAT tick).
        const vatMult = sc.vat ? 1.20 : 1
        const splits = (sc.days || []).filter(d => Number(d.amount) || d.amount === 0)
        const base = splits.reduce((s, d) => s + (Number(d.amount) || 0), 0)
        for (const d of splits) {
          const share = base ? (Number(d.amount) || 0) / base : 1 / (splits.length || 1)
          const amount = (Number(d.amount) || 0) * vatMult + adj * share
          if (Math.abs(amount) < 0.005) continue
          const day = clampDay(y, m, Number(d.day || 28))
          events.push({ date: `${mk}-${pad(day)}`, amount, code })
        }
      } else if (sc.mode === 'even') {
        // Spread across the weeks that start in this month: one event per Monday.
        const total = monthlyBudget + adj
        if (Math.abs(total) < 0.005) continue
        const mondays = []
        let d = mondayOf(new Date(y, m, 1))
        if (d.getMonth() !== m) d = new Date(d.getTime() + 7 * 86400000)
        while (d.getMonth() === m && d.getFullYear() === y) { mondays.push(new Date(d)); d = new Date(d.getTime() + 7 * 86400000) }
        const per = mondays.length ? total / mondays.length : total
        for (const md of mondays) events.push({ date: isoDay(md), amount: per, code })
      }
    }
  }
  return events.filter(e => e.date >= isoDay(start) && e.date <= isoDay(end))
}

// Recurring cash commitments (e.g. vehicle finance / HP) that aren't in the P&L.
// Each: { id, name, amount, day (1-31), start?: 'YYYY-MM', end?: 'YYYY-MM' }.
export function commitmentEvents(commitments, start, end) {
  const events = []
  const months = []
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cur <= last) { months.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1) }
  for (const c of (commitments || [])) {
    const amount = Number(c.amount || 0)
    if (!amount) continue
    for (const mDate of months) {
      const y = mDate.getFullYear(), m = mDate.getMonth()
      const mk = `${y}-${pad(m + 1)}`
      if (c.start && mk < c.start) continue
      if (c.end && mk > c.end) continue
      const day = clampDay(y, m, Number(c.day || 1))
      events.push({ date: `${mk}-${pad(day)}`, amount, name: c.name || 'Commitment' })
    }
  }
  return events.filter(e => e.date >= isoDay(start) && e.date <= isoDay(end))
}

// Retention releases (unreceived) as dated cash-in events.
export function retentionEvents(entries) {
  const out = []
  for (const e of (entries || [])) {
    if ((e.retStatus || '') === 'complete') { /* still include unreceived flags below */ }
    const r1 = parseFloat(e.release1Value || 0) || 0
    const r2 = parseFloat(e.release2Value || 0) || 0
    if (r1 && !e.release1Received && e.release1Date) out.push({ date: e.release1Date, amount: r1 })
    if (r2 && !e.release2Received && e.release2Date) out.push({ date: e.release2Date, amount: r2 })
  }
  return out
}
