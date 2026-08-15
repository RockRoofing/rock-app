import { get, getPortalUsers } from './db'
import { normRole } from './roles'

// Daily email: each person gets THEIR OWN activities that are due today or overdue.
//
// Reads crm:activities:open - the flat list of everything outstanding across every project,
// kept up to date on every write - so this does not have to walk thousands of per-deal
// keys. Project titles come from crm:deals.
//
// Nobody with nothing due gets an email.

const OPEN_ACTIVITIES = 'crm:activities:open'
const DEALS_KEY = 'crm:deals'

const esc = (s) => String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Today in UK local time as YYYY-MM-DD, so the comparison against a due date matches what
// people see on screen rather than drifting with UTC.
function ukToday() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const g = (t) => p.find((x) => x.type === t)?.value || ''
  return `${g('year')}-${g('month')}-${g('day')}`
}

const fmtDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)

// Match an activity's assignee to a portal user. Same rules as the CRM screen: exact,
// then a unique first name, then a unique last name - so "James" reaches James McVeigh,
// but a first name shared by two people is left alone rather than guessed at.
function buildMatcher(users) {
  const exact = new Map(), first = new Map(), last = new Map()
  for (const u of users) {
    const n = u.name.trim().toLowerCase()
    exact.set(n, u)
    const parts = u.name.trim().split(/\s+/)
    const f = parts[0].toLowerCase()
    const l = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
    if (f) first.set(f, first.has(f) ? null : u)
    if (l) last.set(l, last.has(l) ? null : u)
  }
  return (raw) => {
    const t = String(raw || '').trim().toLowerCase()
    if (!t) return null
    return exact.get(t) || first.get(t) || last.get(t) || null
  }
}

// Everything due today or before, grouped by the person responsible.
export async function collectDueActivities() {
  const [open, deals, portal] = await Promise.all([
    get(OPEN_ACTIVITIES).then((v) => (Array.isArray(v) ? v : [])),
    get(DEALS_KEY).then((v) => (Array.isArray(v) ? v : [])),
    getPortalUsers(),
  ])

  const users = (portal || [])
    .filter((u) => u.active !== false && u.email)
    .filter((u) => ['pre-contract', 'admin'].includes(normRole(u.role)))
    .map((u) => ({
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || u.username || '',
      email: u.email,
    }))
    .filter((u) => u.name)

  const match = buildMatcher(users)
  const today = ukToday()

  // Only OPEN projects - chasing activities on a job already won or lost is noise, and it
  // matches what the Activities tab shows.
  const dealById = new Map(deals.map((d) => [String(d.id), d]))

  const byEmail = new Map()
  for (const a of open) {
    if (!a.due || a.due > today) continue
    const deal = dealById.get(String(a.dealId))
    if (!deal || deal.status !== 'open') continue
    const u = match(a.assignee)
    if (!u) continue
    if (!byEmail.has(u.email)) byEmail.set(u.email, { user: u, items: [] })
    byEmail.get(u.email).items.push({
      text: a.text || 'Activity',
      due: a.due,
      overdueDays: a.due < today ? daysBetween(a.due, today) : 0,
      project: deal.title || '',
      dealId: a.dealId,
      company: deal.fields?.organization || '',
    })
  }

  for (const v of byEmail.values()) v.items.sort((x, y) => String(x.due).localeCompare(String(y.due)))
  return { today, groups: Array.from(byEmail.values()) }
}

function buildEmail(group, today, baseUrl) {
  const overdue = group.items.filter((i) => i.overdueDays > 0)
  const dueToday = group.items.filter((i) => i.overdueDays === 0)
  const firstName = (group.user.name || '').split(' ')[0] || 'there'

  const table = (list, colour) => `
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">
      ${list.map((i) => `<tr style="border-top:1px solid #eee">
        <td style="padding:7px 10px 7px 0;vertical-align:top">
          <div style="font-weight:600;color:#1a1a19">${esc(i.text)}</div>
          <div style="color:#888;font-size:12px">${esc(i.project)}${i.company ? ' &middot; ' + esc(i.company) : ''}</div>
        </td>
        <td style="padding:7px 0;vertical-align:top;white-space:nowrap;text-align:right;color:${colour};font-weight:600">
          ${fmtDate(i.due)}${i.overdueDays > 0 ? `<div style="font-size:11px">${i.overdueDays} day${i.overdueDays === 1 ? '' : 's'} overdue</div>` : ''}
        </td>
      </tr>`).join('')}
    </table>`

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:640px;color:#1a1a19">
      <h2 style="margin:0 0 4px">Your activities for today</h2>
      <p style="color:#666;margin:0 0 16px;font-size:13px">Hi ${esc(firstName)} - ${group.items.length} activit${group.items.length === 1 ? 'y' : 'ies'} due or overdue.</p>
      ${overdue.length ? `<h3 style="margin:18px 0 0;font-size:15px;color:#b91c1c">Overdue (${overdue.length})</h3>${table(overdue, '#b91c1c')}` : ''}
      ${dueToday.length ? `<h3 style="margin:18px 0 0;font-size:15px;color:#15803d">Due today (${dueToday.length})</h3>${table(dueToday, '#15803d')}` : ''}
      <p style="margin-top:22px"><a href="${baseUrl}/crm" style="background:#2a7de1;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600">Open the CRM</a></p>
      <p style="color:#999;font-size:11.5px;margin-top:18px">You are getting this because these activities are assigned to you. Nothing due means no email.</p>
    </div>`

  const subject = overdue.length
    ? `${overdue.length} overdue${dueToday.length ? ` and ${dueToday.length} due today` : ''}`
    : `${dueToday.length} activit${dueToday.length === 1 ? 'y' : 'ies'} due today`

  return { subject: `CRM: ${subject}`, html }
}

export async function sendDailyActivityEmails({ dryRun } = {}) {
  const { today, groups } = await collectDueActivities()
  if (!groups.length) return { ok: true, today, sent: 0, note: 'Nobody has anything due or overdue.' }

  const key = process.env.RESEND_API_KEY
  const from = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  const baseUrl = process.env.PORTAL_BASE_URL || 'https://app.rockroofing.co.uk'

  const summary = groups.map((g) => ({ to: g.user.email, name: g.user.name, count: g.items.length }))
  if (dryRun) return { ok: true, today, dryRun: true, wouldSend: summary }
  if (!key) return { ok: false, error: 'Email not configured (RESEND_API_KEY)', wouldSend: summary }

  let sent = 0
  const failed = []
  for (const g of groups) {
    const { subject, html } = buildEmail(g, today, baseUrl)
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [g.user.email], subject, html }),
      })
      if (r.ok) sent++; else failed.push(g.user.email)
    } catch { failed.push(g.user.email) }
  }
  return { ok: true, today, sent, failed, recipients: summary }
}
