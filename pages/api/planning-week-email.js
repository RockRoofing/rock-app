import { assembleWeek } from './planning-week'

// POST /api/planning-week-email
//   { weeks:[mondayISO,...], includeOpIds:[...] }  -> emails each INCLUDED operative their allocation
//   across the given weeks. FUTURE dates only (today onward); Actual/past days are never emailed.
export const config = { api: { bodyParser: { sizeLimit: '6mb' } } }

const DAY = 86400000
const DOWFULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fmtDM = (s) => parseISO(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
const dow = (s) => DOWFULL[(parseISO(s).getDay() + 6) % 7]

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  if (!RESEND_KEY) return res.status(200).json({ sent: 0, error: 'Email not configured' })

  try {
    const { weeks, includeOpIds } = req.body || {}
    const weekList = Array.isArray(weeks) && weeks.length ? weeks : [null]
    const includeSet = Array.isArray(includeOpIds) ? new Set(includeOpIds) : null
    const todayKey = iso(new Date())

    // Assemble all requested weeks, then collapse to per-operative future-only day lists.
    const perOp = {}  // opId -> { name, email, days: [{date, entries:[{projectName,half,status}]}] }
    for (const wk of weekList) {
      const week = await assembleWeek(wk)
      for (const row of week.rows) {
        if (row.unnamed) continue                 // never email the TBC/unnamed rows
        if (includeSet && !includeSet.has(row.opId)) continue
        row.cells.forEach((c, i) => {
          if (!c) return
          const dk = week.days[i]
          if (dk < todayKey) return               // future only (skip past)
          const entries = c.entries.filter(e => e.status !== 'actual')  // never email actuals
          if (!entries.length) return
          perOp[row.opId] = perOp[row.opId] || { name: row.name, email: row.email, days: [] }
          perOp[row.opId].days.push({ date: dk, entries })
        })
      }
    }

    let sent = 0; const skipped = []
    for (const [opId, info] of Object.entries(perOp)) {
      if (!info.email) { skipped.push(`${info.name} (no email)`); continue }
      info.days.sort((a, b) => a.date.localeCompare(b.date))
      const lines = info.days.map(d => {
        const parts = d.entries.map(e => {
          const colour = e.status === 'provisional' ? '#2563eb' : '#16a34a' // blue provisional, green confirmed
          const label = `${e.projectName}${e.half !== 'full' ? ` (${e.half.toUpperCase()})` : ''}`
          return `<span style="color:${colour};font-weight:600">${label}</span>`
        }).join('<span style="color:#999">, </span>')
        const weekend = [0, 6].includes(parseISO(d.date).getDay())
        return `<tr><td style="padding:6px 14px 6px 0;color:${weekend ? '#b91c1c' : '#333'};font-weight:600;white-space:nowrap">${dow(d.date)} ${fmtDM(d.date)}</td><td style="padding:6px 0">${parts}</td></tr>`
      }).join('')

      // Unique project -> address list for the projects this operative is on.
      const addrMap = {}
      for (const d of info.days) for (const e of d.entries) { if (!addrMap[e.projectName]) addrMap[e.projectName] = e.projectAddress || '' }
      const addrLines = Object.entries(addrMap).map(([name, addr]) =>
        `<li style="margin-bottom:6px"><strong>${name}</strong>${addr ? `<br/><span style="color:#666">${addr}</span>` : `<br/><span style="color:#bbb">Address not set</span>`}</li>`
      ).join('')

      const html = `
        <div style="font-family:system-ui,Arial,sans-serif;max-width:560px">
          <h2 style="color:#1a1a19;margin:0 0 2px">Your upcoming project allocation</h2>
          <p style="color:#666;margin:0 0 12px">Hi ${info.name.split(' ')[0] || ''}, here's your allocation for the period ahead.</p>
          <div style="margin:0 0 14px;font-size:12.5px;color:#555">
            <span style="display:inline-block;margin-right:16px"><span style="display:inline-block;width:11px;height:11px;border-radius:2px;background:#16a34a;vertical-align:middle;margin-right:5px"></span>Confirmed</span>
            <span style="display:inline-block"><span style="display:inline-block;width:11px;height:11px;border-radius:2px;background:#2563eb;vertical-align:middle;margin-right:5px"></span>Provisional</span>
          </div>
          <table style="font-size:14px;border-collapse:collapse">${lines}</table>
          <h3 style="color:#1a1a19;margin:22px 0 8px;font-size:15px">Project addresses</h3>
          <ul style="font-size:14px;padding-left:18px;margin:0">${addrLines}</ul>
          <p style="color:#999;font-size:12px;margin-top:18px">Provisional dates may still change. Please contact the office with any queries.</p>
        </div>`

      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: info.email, subject: `Rock Roofing Project Allocation`, html }),
        })
        if (resp.ok) sent++; else skipped.push(`${info.name} (send failed)`)
      } catch { skipped.push(`${info.name} (send error)`) }
    }
    return res.status(200).json({ sent, skipped, total: Object.keys(perOp).length })
  } catch (e) {
    console.error('planning-week-email error:', e)
    return res.status(500).json({ error: e.message || 'Email failed' })
  }
}
