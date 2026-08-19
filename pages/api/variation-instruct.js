import { getProject, saveProject, get } from '../../lib/db'
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
    return res.json({
      varNumber: variation.varNumber,
      projectName: [project.jobNo, project.name].filter(Boolean).join(' - '),
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

  const { token, name, role, company } = req.body || {}
  const { t, project, variation, error } = await load(token)
  if (error) return res.status(400).json({ error })
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Please enter your name.' })

  // Already instructed - report it rather than overwriting who did it and when.
  if (variation.instructed === 'yes') {
    return res.json({ ok: true, instruction: variation.builder?.instruction || null })
  }

  const instruction = {
    at: Date.now(),
    byName: String(name).trim(),
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

  return res.json({ ok: true, instruction })
}
