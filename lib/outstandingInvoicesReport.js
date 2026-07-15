import { getPortalUsers } from './db'
import { normRole } from './roles'
import { buildOutstandingInvoicesPDF } from './outstandingInvoicesPdf'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

const parseDMY = (s) => {
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1])
  const d = new Date(s); return isNaN(d) ? null : d
}

const RECIPIENTS_KEY = 'invoice:weekly-recipients'   // extra external emails [str]
const META_KEY = 'invoice:meta'

// Assemble the outstanding-invoice rows from the cached dashboard projects + meta.
export async function gatherOutstandingInvoices({ baseUrl } = {}) {
  const redis = await getRedis()
  const meta = redis ? ((await redis.get(META_KEY)) || {}) : {}

  // Read the cached dashboard (avoid recomputation / Xero calls).
  let projects = []
  try {
    if (redis) {
      const cached = await redis.get('dashboard:cache')
      if (cached) projects = cached
    }
    if (!projects.length && baseUrl) {
      const d = await fetch(`${baseUrl}/api/dashboard`).then(r => r.json())
      projects = d.projects || []
    }
  } catch {}

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const rows = []
  for (const p of projects) {
    for (const inv of (p._invoiceLines || [])) {
      const due = inv.amountDue != null ? inv.amountDue : ((inv.total || 0) - (inv.amountPaid || 0))
      if (!(due > 0.005)) continue
      const dd = parseDMY(inv.dueDate)
      const overdueBy = dd ? Math.floor((today - dd) / 86400000) : 0
      const m = meta[inv.invoiceNumber] || {}
      rows.push({
        invoiceNumber: inv.invoiceNumber || '',
        reference: inv.reference || p.name || '',
        customer: inv.contact || p.customer || '',
        date: inv.date || '',
        dueDate: inv.dueDate || '',
        overdueBy: overdueBy > 0 ? overdueBy : null,
        expectedDate: m.expectedDate || '',
        paid: inv.amountPaid || 0,
        due,
        highRisk: !!p.highRisk,
        qsName: p.qsName || '',
        comments: m.comments || [],
        emails: m.emails || [],
      })
    }
  }
  rows.sort((a, b) => (b.overdueBy || -1) - (a.overdueBy || -1))
  return rows
}

export async function getWeeklyRecipients() {
  const redis = await getRedis()
  if (!redis) return []
  return (await redis.get(RECIPIENTS_KEY)) || []
}
export async function setWeeklyRecipients(list) {
  const redis = await getRedis()
  if (redis) await redis.set(RECIPIENTS_KEY, list)
}

// Internal recipients: portal users with post-contract / management / admin access.
async function internalRecipients() {
  const users = await getPortalUsers()
  const allowed = ['post-contract', 'management', 'admin']
  return users
    .filter(u => u.active !== false && u.email && allowed.includes(normRole(u.role)))
    .map(u => u.email)
}

// Build + send the weekly report. Returns a summary object.
export async function sendWeeklyOverdueReport({ baseUrl, extraRecipients, dryRun } = {}) {
  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'

  const invoices = await gatherOutstandingInvoices({ baseUrl })
  const internal = await internalRecipients()
  const external = extraRecipients || await getWeeklyRecipients()
  const to = [...new Set([...internal, ...external].filter(Boolean))]

  const logoUrl = baseUrl ? `${baseUrl}/rock-logo.jpg` : null
  const pdfBytes = await buildOutstandingInvoicesPDF({ invoices, includeComments: true, logoUrl })
  const b64 = Buffer.from(pdfBytes).toString('base64')

  const overdue = invoices.filter(i => i.overdueBy)
  const money = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n || 0)
  const dateLabel = new Date().toLocaleDateString('en-GB')
  const fmtDue = (s) => {
    if (!s) return '—'
    let d = null
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(s)
    else { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m) d = new Date(+m[3], +m[2] - 1, +m[1]) }
    return d && !isNaN(d) ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : String(s)
  }

  if (dryRun || !RESEND_KEY) return { ok: !!dryRun, wouldSendTo: to, invoiceCount: invoices.length, note: RESEND_KEY ? 'dry run' : 'email not configured', pdfBytes }

  const rowsHtml = invoices.map(i => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:600">${i.invoiceNumber || '—'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${i.reference || '—'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${i.customer || '—'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;color:${i.overdueBy ? '#dc2626' : '#333'}">${fmtDue(i.dueDate)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#dc2626;font-weight:600">${i.overdueBy ? i.overdueBy + ' days' : ''}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(i.due)}</td>
      </tr>`).join('')

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:0 auto;color:#1a1a19">
      <h2 style="color:#1a1a19">Rock Roofing Outstanding Invoices — Weekly Report (${dateLabel})</h2>
      <p style="font-size:15px">${invoices.length} outstanding invoice${invoices.length === 1 ? '' : 's'}${overdue.length ? `, of which <span style="color:#dc2626">${overdue.length} overdue</span>` : ''}.</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:8px">
        <thead>
          <tr style="background:#f5f5f5">
            <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd">Inv Number</th>
            <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd">Ref</th>
            <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd">To</th>
            <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd">Due Date</th>
            <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd">Overdue</th>
            <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ddd">Due</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="font-size:13px;color:#777;margin-top:14px">The full list, with comments and emails to date for each invoice, is attached as a PDF.</p>
    </div>`

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to, subject: `Rock Roofing Outstanding Invoices - Weekly Report (${dateLabel})`,
      html, attachments: [{ filename: `Outstanding-Invoices-${new Date().toISOString().slice(0, 10)}.pdf`, content: b64 }],
    }),
  })
  return { ok: resp.ok, sentTo: to, invoiceCount: invoices.length, status: resp.status }
}
