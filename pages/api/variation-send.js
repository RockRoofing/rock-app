import { requireRole } from '../../lib/portalAuth'
import { getProject, get } from '../../lib/db'
import { buildVariationPDF } from '../../lib/variationPdf'
import { createInstructToken } from '../../lib/variationInstruct'

// Variation PDF and send.
//
//   GET  ?projectId=..&varNumber=V01[&download=1]   -> the PDF
//   POST { projectId, varNumber, to[], cc[], replyTo, subject, text }  -> emails it
//
// One file for both, because the send has to build exactly the same document the download
// gives you. Two files would drift.
// The logo is served from the site itself, the same way the application PDF does it -
// LOGO_URL was never set, which is why the variation came out without one.
const logoFor = (req) => {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  return `${proto}://${req.headers.host}/rock-logo.jpg`
}

async function loadVariation(projectId, varNumber) {
  const project = (await getProject(projectId)) || {}
  const vars = Array.isArray(project.variations) ? project.variations : []
  const variation = vars.find(v => String(v.varNumber) === String(varNumber))
  if (!variation) return { error: 'Variation not found' }

  // jobNo and name come from the dashboard cache, as they do for applications.
  let jobNo = '', name = ''
  try {
    const cache = await get('dashboard:cache')
    const row = Array.isArray(cache) ? cache.find(p => String(p.xeroId) === String(projectId)) : null
    jobNo = row?.jobNo || ''
    name = row?.name || ''
  } catch { /* the document still builds without them */ }

  return { project: { ...project, jobNo, name }, variation }
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return

  if (req.method === 'GET') {
    const { projectId, varNumber } = req.query
    if (!projectId || !varNumber) return res.status(400).json({ error: 'projectId and varNumber are required' })
    const { project, variation, error } = await loadVariation(projectId, varNumber)
    if (error) return res.status(404).json({ error })
    try {
      const bytes = await buildVariationPDF({ variation, project, logoUrl: logoFor(req) })
      const fname = `Variation ${variation.varNumber} - ${[project.jobNo, project.name].filter(Boolean).join(' ')}.pdf`
        .replace(/[^a-zA-Z0-9 .-]/g, '')
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${fname}"`)
      return res.send(Buffer.from(bytes))
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Could not build the PDF' })
    }
  }

  if (req.method !== 'POST') return res.status(405).end()

  const { projectId, varNumber, to, cc, replyTo, subject, text, reminder } = req.body || {}
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (!recipients.length) return res.status(400).json({ error: 'At least one recipient is required' })
  if (!subject) return res.status(400).json({ error: 'Subject is required' })

  const { project, variation, error } = await loadVariation(projectId, varNumber)
  if (error) return res.status(404).json({ error })

  const RESEND_KEY = process.env.RESEND_API_KEY
  if (!RESEND_KEY) return res.status(500).json({ error: 'Email is not configured' })
  const FROM = process.env.COMMERCIAL_FROM_EMAIL || process.env.ACCOUNTS_FROM_EMAIL || process.env.FORMS_FROM_EMAIL || 'Rock Roofing Commercial <onboarding@resend.dev>'

  try {
    const bytes = await buildVariationPDF({ variation, project, logoUrl: logoFor(req) })
    const b64 = Buffer.from(bytes).toString('base64')
    const fname = `Variation ${variation.varNumber} - ${[project.jobNo, project.name].filter(Boolean).join(' ')}.pdf`
      .replace(/[^a-zA-Z0-9 .-]/g, '')
    const ccList = (Array.isArray(cc) ? cc : [cc]).filter(Boolean)

    // ONE EMAIL PER RECIPIENT, so each carries a link issued to THAT address. A single
    // email to four people would give four identical links, and the instruction would only
    // ever be able to say "someone at the customer clicked it".
    const proto = req.headers['x-forwarded-proto'] || 'https'
    const origin = `${proto}://${req.headers.host}`
    const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const htmlFor = (addr) => {
      const link = `${origin}/instruct/${createInstructToken({ projectId, varNumber, email: addr })}`
      return `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;color:#1a1a2e;line-height:1.6">`
        + esc(text).replace(/\n/g, '<br>')
        + `<div style="margin:24px 0">`
        + `<a href="${link}" style="display:inline-block;background:#15803d;color:#fff;text-decoration:none;`
        + `padding:13px 26px;border-radius:8px;font-weight:700;font-size:15px">Instruct variation ${esc(varNumber)}</a>`
        + `</div>`
        + `<div style="font-size:12px;color:#888">`
        + `This link is unique to you and records your instruction against this variation. `
        + `If the button does not work, use this address:<br>${esc(link)}`
        + `</div></div>`
    }

    let last = null
    for (const addr of recipients) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: [addr], subject,
          // Only the first recipient carries the cc, or the team gets one copy each.
          ...(ccList.length && addr === recipients[0] ? { cc: ccList } : {}),
          ...(replyTo ? { reply_to: replyTo } : {}),
          text, html: htmlFor(addr),
          attachments: [{ filename: fname, content: b64 }],
        }),
      })
      last = r
      if (!r.ok) break
    }
    const r = last
    const d = await r.json()
    if (!r.ok) throw new Error(d?.message || 'Send failed')

    // Record that it went, and to whom. Without this the tracker cannot tell a draft from
    // something the customer has already had - which is the difference between chasing an
    // instruction and forgetting to ask for one.
    try {
      const { saveProject } = await import('../../lib/db')
      const fresh = (await getProject(projectId)) || {}
      const vars = Array.isArray(fresh.variations) ? fresh.variations : []
      const next = vars.map(v => String(v.varNumber) !== String(varNumber) ? v : ({
        ...v,
        builder: {
          ...(v.builder || {}),
          // firstSentAt is the clock the reminder runs off, and it does NOT move when a
          // reminder goes out - otherwise chasing would push the next chase back for ever.
          firstSentAt: (v.builder || {}).firstSentAt || Date.now(),
          sentAt: Date.now(),
          sentTo: recipients, sentBy: replyTo || '',
          ...(reminder ? { lastReminderAt: Date.now(), reminderCount: ((v.builder || {}).reminderCount || 0) + 1 } : {}),
        },
      }))
      await saveProject(projectId, { ...fresh, variations: next })
    } catch { /* the email has gone; the flag is secondary */ }

    return res.json({ ok: true, id: d.id, sentTo: recipients, cc: ccList })
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Could not send' })
  }
}
