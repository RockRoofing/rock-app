import { getProject, saveProject, get } from '../../lib/db'
import { projectLabel } from '../../lib/variationInstruct'
import { verifyInstructToken } from '../../lib/variationInstruct'
import { buildVariationPDF } from '../../lib/variationPdf'

// The customer-facing instruction endpoint.
//
// DELIBERATELY NOT BEHIND requireRole. The token IS the authentication - the customer has
// no portal account, and requiring one would mean nobody ever instructs anything. The
// token is signed, names one variation, names the address it was issued to, and expires.
//
//   GET  ?token=..            -> what is being instructed, for the page
//   GET  ?token=..&pdf=1      -> the variation document
//   POST { token, name }      -> record the instruction
async function load(token) {
  const t = verifyInstructToken(token)
  if (!t) return { error: 'This link is not valid or has expired.' }
  const project = (await getProject(t.projectId)) || {}
  const vars = Array.isArray(project.variations) ? project.variations : []
  const variation = vars.find(v => String(v.varNumber) === String(t.varNumber))
  if (!variation) return { error: 'That variation could not be found.' }

  let jobNo = '', name = ''
  try {
    const cache = await get('dashboard:cache')
    const row = Array.isArray(cache) ? cache.find(p => String(p.xeroId) === String(t.projectId)) : null
    jobNo = row?.jobNo || ''; name = row?.name || ''
  } catch {}
  return { t, project: { ...project, jobNo, name }, variation }
}

const valueOf = (v) => (parseFloat(v.materials) || 0) + (parseFloat(v.labour) || 0) + (parseFloat(v.profit) || 0)

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { token, pdf } = req.query
    const { t, project, variation, error } = await load(token)
    if (error) return res.status(400).json({ error })

    if (pdf) {
      const proto = req.headers['x-forwarded-proto'] || 'https'
      const bytes = await buildVariationPDF({ variation, project, logoUrl: `${proto}://${req.headers.host}/rock-logo.jpg` })
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `inline; filename="Variation ${variation.varNumber}.pdf"`)
      return res.send(Buffer.from(bytes))
    }

    const b = variation.builder || {}
    // WHO THIS LINK WAS SENT TO, looked up on the handover so the page can fill their
    // details in for them. Somebody confirming a variation should not have to type their
    // own job title - and a prefilled field is far more likely to come back correct than
    // an empty one.
    const contact = (project.customerContacts || [])
      .find(c => String(c.email || '').toLowerCase() === String(t.email || '').toLowerCase()) || null
    return res.json({
      sentTo: t.email || '',
      contact: contact ? { name: contact.name || '', role: contact.title || '' } : null,
      customerCompany: project.customerCompany || project.customer || '',
      varNumber: variation.varNumber,
      projectName: projectLabel(project.jobNo, project.name),
      description: variation.description || '',
      subContractRef: b.subContractRef || '',
      date: b.date ? new Date(b.date).toLocaleDateString('en-GB') : '',
      requestedBy: b.requestedBy || '',
      value: valueOf(variation),
      // Already instructed: show the confirmation rather than the button, so a second
      // click on the same link cannot record a second instruction.
      instructed: variation.instructed === 'yes',
      instruction: b.instruction || null,
    })
  }

  if (req.method !== 'POST') return res.status(405).end()

  const { token, name, firstName, lastName, role, company } = req.body || {}
  const { t, project, variation, error } = await load(token)
  if (error) return res.status(400).json({ error })
  // Enforced HERE as well as on the page. A browser check is a convenience; this is the
  // record that would be produced if an instruction were ever disputed, so it has to be
  // complete whatever posted it.
  const missing = [
    ['first name', firstName], ['last name', lastName], ['role', role], ['company', company],
  ].filter(([, v]) => !String(v || '').trim()).map(([l]) => l)
  if (missing.length) return res.status(400).json({ error: `Please enter your ${missing.join(', ')}.` })

  // Already instructed - report it rather than overwriting who did it and when.
  if (variation.instructed === 'yes') {
    return res.json({ ok: true, instruction: variation.builder?.instruction || null })
  }

  const instruction = {
    at: Date.now(),
    byName: String(name || `${firstName} ${lastName}`).trim(),
    byFirstName: String(firstName).trim(),
    byLastName: String(lastName).trim(),
    // Role and company, asked for on the page. A signature on a variation is worth more
    // when it says WHO signed it - "Jack Belshaw, Senior QS, Barnfield Construction"
    // stands up in a way that "Jack" does not.
    byRole: String(role || '').trim(),
    byCompany: String(company || '').trim(),
    // The address the LINK was issued to, not one typed on the page - that is what makes
    // this evidence rather than a name in a box.
    byEmail: t.email || '',
    ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '',
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
  }

  const vars = Array.isArray(project.variations) ? project.variations : []
  const next = vars.map(v => String(v.varNumber) !== String(t.varNumber) ? v : ({
    ...v,
    // The field every other page already reads. The tracker, the anticipated final
    // account, applications and the cash flow all key off this - so instructing here
    // updates every one of them with no further work.
    instructed: 'yes',
    builder: { ...(v.builder || {}), instruction },
  }))

  // Re-read immediately before writing: a variation edited in the portal while the
  // customer had the page open would otherwise be rolled back by this save.
  const fresh = (await getProject(t.projectId)) || {}
  await saveProject(t.projectId, { ...fresh, variations: next })
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (url && tok) await new Redis({ url, token: tok }).del('dashboard:cache')
  } catch {}

  // CONFIRM IT BACK TO EVERYONE WHO WAS ON THE ORIGINAL, with the document carrying the
  // instruction on it. Both sides then hold the same signed copy, which is the point of
  // capturing it - and the person who instructed gets a receipt without having to ask.
  try {
    const RESEND_KEY = process.env.RESEND_API_KEY
    const b = variation.builder || {}
    const audience = [...new Set([...(b.sentTo || []), ...(b.sentCc || []), b.sentBy].filter(Boolean))]
    if (RESEND_KEY && audience.length) {
      const proto = req.headers['x-forwarded-proto'] || 'https'
      const withInstruction = { ...variation, instructed: 'yes', builder: { ...b, instruction } }
      const bytes = await buildVariationPDF({ variation: withInstruction, project, logoUrl: `${proto}://${req.headers.host}/rock-logo.jpg` })
      const label = projectLabel(project.jobNo, project.name)
      const who = [instruction.byName, instruction.byRole, instruction.byCompany].filter(Boolean).join(', ')
      const FROM = process.env.NOTIFY_FROM_EMAIL || process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
      const text = `Variation ${variation.varNumber} for ${label} has been instructed.\n\n`
        + `Instructed by ${who}\n`
        + `on ${new Date(instruction.at).toLocaleString('en-GB')}\n`
        + (instruction.byEmail ? `via the authenticated link sent to ${instruction.byEmail}\n` : '')
        + `\nThe variation is attached, showing the instruction on it.\n\n`
        + `Kind regards\nRock Roofing Limited`
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: audience,
          subject: `Instructed: Variation ${variation.varNumber} - ${label}`,
          ...(b.sentBy ? { reply_to: b.sentBy } : {}),
          text,
          attachments: [{
            filename: `Variation ${variation.varNumber} - INSTRUCTED.pdf`.replace(/[^a-zA-Z0-9 .-]/g, ''),
            content: Buffer.from(bytes).toString('base64'),
          }],
        }),
      })
    }
  } catch { /* the instruction is recorded; the confirmation is secondary */ }

  return res.json({ ok: true, instruction })
}
