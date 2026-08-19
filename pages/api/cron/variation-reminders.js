import { getAllProjectSettings, saveProject, getProject, get } from '../../../lib/db'
import { createInstructToken, addWorkingDays } from '../../../lib/variationInstruct'
import { buildVariationPDF } from '../../../lib/variationPdf'

// Chases variations the customer has not instructed.
//
// THREE WORKING DAYS after the original send, not three calendar days: one sent on
// Thursday is chased the following Tuesday, so a reminder never lands at a weekend where
// it is buried by Monday morning.
//
// Sent ONCE. A variation that is still not instructed after that is a conversation to
// have, not another email to ignore - and an automated chase that repeats weekly trains
// people to filter it.
//
// ?dry=1 reports what it would send without sending. ?force=1 ignores the wait.
export default async function handler(req, res) {
  const dry = req.query.dry === '1'
  const force = req.query.force === '1'

  const out = { checked: 0, due: [], sent: [], skipped: 0, errors: [] }
  try {
    const all = await getAllProjectSettings()
    const now = Date.now()

    let cache = []
    try { cache = (await get('dashboard:cache')) || [] } catch {}

    const proto = req.headers['x-forwarded-proto'] || 'https'
    const origin = `${proto}://${req.headers.host}`
    const RESEND_KEY = process.env.RESEND_API_KEY
    const FROM = process.env.COMMERCIAL_FROM_EMAIL || process.env.ACCOUNTS_FROM_EMAIL || process.env.FORMS_FROM_EMAIL || 'Rock Roofing Commercial <onboarding@resend.dev>'

    for (const [projectId, proj] of Object.entries(all || {})) {
      const vars = Array.isArray(proj?.variations) ? proj.variations : []
      for (const v of vars) {
        const b = v.builder || {}
        if (!b.firstSentAt) continue                 // never sent - nothing to chase
        out.checked++
        if (v.instructed === 'yes') { out.skipped++; continue }      // already instructed
        if (b.reminderSentAt) { out.skipped++; continue }            // chased once already
        if (!(b.sentTo || []).length) { out.skipped++; continue }    // nobody to chase

        const dueAt = addWorkingDays(new Date(b.firstSentAt), 3).getTime()
        if (!force && now < dueAt) { out.skipped++; continue }

        const row = Array.isArray(cache) ? cache.find(p => String(p.xeroId) === String(projectId)) : null
        const project = { ...proj, jobNo: row?.jobNo || '', name: row?.name || '' }
        const label = [project.jobNo, project.name].filter(Boolean).join(' - ')
        const value = (parseFloat(v.materials) || 0) + (parseFloat(v.labour) || 0) + (parseFloat(v.profit) || 0)
        const money = '£' + value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

        out.due.push({ projectId, varNumber: v.varNumber, project: label, to: b.sentTo, sentAt: new Date(b.firstSentAt).toISOString() })
        if (dry || !RESEND_KEY) continue

        try {
          const bytes = await buildVariationPDF({ variation: v, project, logoUrl: `${origin}/rock-logo.jpg` })
          const b64 = Buffer.from(bytes).toString('base64')
          const fname = `Variation ${v.varNumber} - ${label}.pdf`.replace(/[^a-zA-Z0-9 .-]/g, '')
          const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

          for (const addr of b.sentTo) {
            const link = `${origin}/instruct/${createInstructToken({ projectId, varNumber: v.varNumber, email: addr })}`
            const text = `Hi,\n\n`
              + `Following up on variation ${v.varNumber} for ${label}, sent on ${new Date(b.firstSentAt).toLocaleDateString('en-GB')}.\n\n`
              + `We have not yet received your instruction. The variation is attached again for convenience.\n\n`
              + (b.subContractRef ? `Sub-Contract Ref: ${b.subContractRef}\n` : '')
              + (v.description ? `Description: ${v.description}\n` : '')
              + `Value: ${money}\n\n`
              + `Could you confirm your instruction so we can programme the works.\n\n`
              + `We are unable to proceed without your instruction via the below instruct button.\n\n`
              + `Kind regards\nRock Roofing Limited`
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: FROM, to: [addr],
                subject: `Reminder: Variation ${v.varNumber} - ${label}`,
                // Replies go back to whoever raised it, as they do on the original.
                ...(b.sentBy ? { reply_to: b.sentBy } : {}),
                text,
                // Button ABOVE the sign-off, same as the first send. Split on "Kind
                // regards" so it does not end up under the signature where people have
                // stopped reading.
                html: (() => {
                  const NOTICE = 'We are unable to proceed without your instruction via the below instruct button.'
                  const asHtml = (t) => esc(t).replace(/\n/g, '<br>').replace(esc(NOTICE), `<strong>${esc(NOTICE)}</strong>`)
                  const m = /\n(Kind regards|Best regards|Regards|Many thanks|Thanks|Cheers|Yours sincerely|Yours faithfully)\b/i.exec(text)
                  const head = m ? text.slice(0, m.index) : text
                  const tail = m ? text.slice(m.index) : ''
                  return `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;color:#1a1a2e;line-height:1.6">`
                    + asHtml(head)
                    + `<div style="margin:22px 0"><a href="${link}" style="display:inline-block;background:#15803d;color:#fff;`
                    + `text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:700;font-size:15px">`
                    + `Instruct variation ${esc(v.varNumber)}</a></div>`
                    + (tail ? asHtml(tail) : '')
                    + `<div style="margin-top:18px;font-size:12px;color:#888">This link is unique to you and records your instruction.<br>${esc(link)}</div></div>`
                })(),
                attachments: [{ filename: fname, content: b64 }],
              }),
            })
          }

          // Marked BEFORE anything else can go wrong with the next project, so a failure
          // half way through the run cannot double-chase the ones already done.
          const fresh = (await getProject(projectId)) || {}
          const next = (fresh.variations || []).map(x => String(x.varNumber) !== String(v.varNumber) ? x
            : ({ ...x, builder: { ...(x.builder || {}), reminderSentAt: Date.now() } }))
          await saveProject(projectId, { ...fresh, variations: next })
          out.sent.push({ projectId, varNumber: v.varNumber, to: b.sentTo })
        } catch (e) {
          out.errors.push({ projectId, varNumber: v.varNumber, error: e?.message || 'failed' })
        }
      }
    }
    return res.json({ ok: true, dry, force, ...out })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'failed', ...out })
  }
}
