import { get, getTeamMembers } from '../../../lib/db'
import { runFormsWeeklyNotify } from './forms-weekly-notify'
import { runDeliveriesNotify } from './deliveries-notify'

// Daily digest dispatcher (Hobby-friendly single daily cron doing two jobs):
//  - MONDAY: weekly forms digest to CMs (Pre-Start) and Supervisors (Start on Site / Site Diary / WAH).
//  - 1st OF MONTH: H&S training expiry digest to Operations Managers.
// Runs DAILY at 07:00; each job self-guards to its own day. ?force=1 runs both now (testing).

const parseISO = (s) => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const fmt = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

async function buildPeople() {
  const [roster, portal] = await Promise.all([
    get('ops:operatives-roster').then(v => v || []),
    get('portal:users').then(v => v || []),
  ])
  const people = {}
  for (const o of roster) people[`op:${o.id}`] = `${o.firstName || ''} ${o.lastName || ''}`.trim()
  for (const u of portal) { const n = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || ''; if (n) people[`pu:${u.id}`] = n }
  return people
}

export default async function handler(req, res) {
  try {
    const force = req.query.force === '1'
    const now = new Date()

    // ── Monday: weekly forms digest ──
    let formsResult = { skipped: 'not Monday' }
    if (force || now.getDay() === 1) {
      try { formsResult = await runFormsWeeklyNotify({ force }) } catch (e) { formsResult = { ok: false, error: e.message } }
    }

    // ── DAILY: deliveries expected today -> notify site supervisors ──
    let deliveriesResult = {}
    try { deliveriesResult = await runDeliveriesNotify({ force }) } catch (e) { deliveriesResult = { ok: false, error: e.message } }

    // ── 1st of month: H&S expiry digest ──
    if (!force && now.getDate() !== 1) return res.status(200).json({ ok: true, forms: formsResult, deliveries: deliveriesResult, expiry: 'skipped (not 1st)' })

    const RESEND_KEY = process.env.RESEND_API_KEY
    const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
    if (!RESEND_KEY) return res.status(200).json({ ok: false, reason: 'email not configured' })

    const [columns, data, people, team] = await Promise.all([
      get('ops:hs-matrix-columns').then(v => v || []),
      get('ops:hs-matrix-data').then(v => v || {}),
      buildPeople(),
      getTeamMembers(),
    ])
    const colLabel = Object.fromEntries(columns.map(c => [c.id, c.label]))

    const nowMid = new Date(); nowMid.setHours(0, 0, 0, 0)
    const twoMonths = new Date(nowMid.getTime()); twoMonths.setMonth(twoMonths.getMonth() + 2)

    const expired = []; const soon = []
    for (const [pid, cols] of Object.entries(data)) {
      for (const [colId, cell] of Object.entries(cols || {})) {
        if (!cell || cell.noExpiry || !cell.date) continue
        const d = parseISO(cell.date); if (!d) continue
        const row = { person: people[pid] || '(unknown)', training: colLabel[colId] || colId, date: d }
        if (d < nowMid) expired.push(row)
        else if (d < twoMonths) soon.push(row)
      }
    }
    expired.sort((a, b) => a.date - b.date); soon.sort((a, b) => a.date - b.date)

    // recipients: Operations Managers, else ALERT_EMAIL
    let recips = (team || []).filter(m => m.active !== false && /operations manager/i.test(m.jobRole || m.role || '')).map(m => m.email).filter(Boolean)
    if (!recips.length && process.env.ALERT_EMAIL) recips = [process.env.ALERT_EMAIL]
    recips = [...new Set(recips)]
    if (!recips.length) return res.status(200).json({ ok: false, reason: 'no recipients' })

    const rowHtml = (r, colour) => `<tr><td style="padding:5px 14px 5px 0">${r.person}</td><td style="padding:5px 14px 5px 0">${r.training}</td><td style="padding:5px 0;color:${colour};font-weight:600">${fmt(r.date)}</td></tr>`
    const section = (title, rows, colour) => rows.length
      ? `<h3 style="margin:18px 0 6px;font-size:15px;color:#1a1a19">${title} (${rows.length})</h3><table style="font-size:13px;border-collapse:collapse"><tr style="color:#888;font-size:11px"><td style="padding-right:14px">Person</td><td style="padding-right:14px">Training</td><td>Expiry</td></tr>${rows.map(r => rowHtml(r, colour)).join('')}</table>`
      : ''

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;max-width:640px">
        <h2 style="color:#1a1a19;margin:0 0 4px">H&S Training — expiry digest</h2>
        <p style="color:#666;margin:0 0 6px">Monthly summary of training that has expired or expires within 2 months.</p>
        ${expired.length || soon.length ? '' : '<p style="color:#16a34a">Nothing expired or expiring within 2 months. All up to date.</p>'}
        ${section('Expired', expired, '#b91c1c')}
        ${section('Expiring within 2 months', soon, '#9a3412')}
        <p style="color:#999;font-size:12px;margin-top:18px">Manage records in the portal: H&amp;S → H&amp;S Training Matrix.</p>
      </div>`

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: recips, subject: `H&S Training expiry digest — ${now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`, html }),
    })
    return res.status(200).json({ ok: r.ok, forms: formsResult, deliveries: deliveriesResult, recipients: recips.length, expired: expired.length, soon: soon.length })
  } catch (e) {
    console.error('hs-expiry-email error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
