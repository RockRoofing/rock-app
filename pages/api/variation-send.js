import { requireRole } from '../../lib/portalAuth'
import { getProject, get } from '../../lib/db'
import { buildVariationPDF } from '../../lib/variationPdf'
import { createInstructToken, projectLabel } from '../../lib/variationInstruct'

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
      const fname = `Variation ${variation.varNumber} - ${projectLabel(project.jobNo, project.name)}.pdf`
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
  // NOT accounts receivable.
  //
  // The chain used to be COMMERCIAL_FROM_EMAIL || ACCOUNTS_FROM_EMAIL || ..., and with
  // COMMERCIAL unset every variation email went out from the accounts receivable address.
  // A variation is a request to authorise works, not a demand for payment, and coming
  // from accounts invites exactly the wrong reading of it.
  //
  // ACCOUNTS_FROM_EMAIL is out of the chain entirely - it was never the right address for
  // this, and leaving it as a fallback means it comes back the moment another variable is
  // unset.
  //
  // Replies still go to the person who raised it, which is unchanged.
  const FROM = process.env.NOTIFY_FROM_EMAIL || process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'

  try {
    const bytes = await buildVariationPDF({ variation, project, logoUrl: logoFor(req) })
    const b64 = Buffer.from(bytes).toString('base64')
    const fname = `Variation ${variation.varNumber} - ${projectLabel(project.jobNo, project.name)}.pdf`
      .replace(/[^a-zA-Z0-9 .-]/g, '')
    const ccList = (Array.isArray(cc) ? cc : [cc]).filter(Boolean)

    // ONE EMAIL PER RECIPIENT, so each carries a link issued to THAT address. A single
    // email to four people would give four identical links, and the instruction would only
    // ever be able to say "someone at the customer clicked it".
    const proto = req.headers['x-forwarded-proto'] || 'https'
    const origin = `${proto}://${req.headers.host}`
    const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // THE BUTTON GOES TO THE "TO" RECIPIENT ONLY.
    //
    // The CC list rides on the FIRST recipient's email, so a CC'd person received a copy
    // of that person's message carrying THAT PERSON'S link. Clicking it recorded the
    // instruction against an address that was not theirs - the record named the wrong
    // person, specifically and confidently.
    //
    // Everyone else gets the variation and is told who has been asked to instruct it.
    const htmlFor = (addr, canInstruct) => {
      const link = canInstruct ? `${origin}/instruct/${createInstructToken({ projectId, varNumber, email: addr })}` : ''
      // The one line that has to be noticed gets bolded in the HTML. Matched on its own
      // text so it stays bold even if the rest of the message is edited before sending.
      const NOTICE = 'We are unable to proceed without your instruction via the below instruct button.'
      const button = canInstruct
        ? `<div style="margin:22px 0">`
          + `<a href="${link}" style="display:inline-block;background:#15803d;color:#fff;text-decoration:none;`
          + `padding:13px 26px;border-radius:8px;font-weight:700;font-size:15px">Instruct variation ${esc(varNumber)}</a>`
          + `</div>`
        // A CC'd reader gets told whose action it is, rather than a button that would
        // record the instruction against somebody else.
        : `<div style="margin:22px 0;padding:12px 14px;background:#f8f9fa;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#555">`
          + `${esc(recipients[0] || 'The recipient')} has been asked to instruct this variation. You are copied in for information.`
          + `</div>`

      // THE BUTTON GOES ABOVE THE SIGN-OFF, not after it.
      //
      // Appending it to the whole body put it below "Kind regards" and the sender's
      // details - so the one thing the email exists to get clicked sat underneath the
      // signature, which is where people stop reading.
      //
      // Split on the sign-off. If the wording has been edited and there is no "Kind
      // regards" to find, it falls back to the end rather than losing the button.
      const SIGNOFF = /\n(Kind regards|Best regards|Regards|Many thanks|Thanks|Cheers|Yours sincerely|Yours faithfully)\b/i
      const m = SIGNOFF.exec(text)
      const head = m ? text.slice(0, m.index) : text
      const tail = m ? text.slice(m.index) : ''
      const asHtml = (t) => esc(t).replace(/\n/g, '<br>').replace(esc(NOTICE), `<strong>${esc(NOTICE)}</strong>`)

      return `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;color:#1a1a2e;line-height:1.6">`
        + asHtml(head)
        + button
        + (tail ? asHtml(tail) : '')
        + (canInstruct
          ? `<div style="margin-top:18px;font-size:12px;color:#888">`
            + `This link is unique to you and records your instruction against this variation. `
            + `If the button does not work, use this address:<br>${esc(link)}`
            + `</div>`
          : '')
        + `</div>`
    }

    let last = null
    for (const addr of recipients) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: [addr], subject,
          // NO CC HERE. Attaching the cc list to this email is what gave a copied-in
          // reader the To recipient's own instruct link. They get their own message
          // below, without a button.
          ...(replyTo ? { reply_to: replyTo } : {}),
          text, html: htmlFor(addr, addr === recipients[0]),
          attachments: [{ filename: fname, content: b64 }],
        }),
      })
      last = r
      if (!r.ok) break
    }

    // The copied-in, in one email of their own. No button, and told whose action it is.
    if (ccList.length) {
      const r2 = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: ccList, subject,
          ...(replyTo ? { reply_to: replyTo } : {}),
          text, html: htmlFor('', false),
          attachments: [{ filename: fname, content: b64 }],
        }),
      })
      if (!last || last.ok) last = r2
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
          // Kept so the instruction confirmation can go back to exactly the people who
          // were on the original - the person who instructed it is not always the one
          // who needs to know it has been.
          sentCc: ccList,
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
