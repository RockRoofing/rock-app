import { requireRole } from '../../lib/portalAuth'
import { getProject, get } from '../../lib/db'
import { buildVariationPDF } from '../../lib/variationPdf'

// Variation PDF and send.
//
//   GET  ?projectId=..&varNumber=V01[&download=1]   -> the PDF
//   POST { projectId, varNumber, to[], cc[], replyTo, subject, text }  -> emails it
//
// One file for both, because the send has to build exactly the same document the download
// gives you. Two files would drift.
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
      const bytes = await buildVariationPDF({ variation, project, logoUrl: process.env.LOGO_URL || '' })
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

  const { projectId, varNumber, to, cc, replyTo, subject, text } = req.body || {}
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (!recipients.length) return res.status(400).json({ error: 'At least one recipient is required' })
  if (!subject) return res.status(400).json({ error: 'Subject is required' })

  const { project, variation, error } = await loadVariation(projectId, varNumber)
  if (error) return res.status(404).json({ error })

  const RESEND_KEY = process.env.RESEND_API_KEY
  if (!RESEND_KEY) return res.status(500).json({ error: 'Email is not configured' })
  const FROM = process.env.COMMERCIAL_FROM_EMAIL || process.env.ACCOUNTS_FROM_EMAIL || process.env.FORMS_FROM_EMAIL || 'Rock Roofing Commercial <onboarding@resend.dev>'

  try {
    const bytes = await buildVariationPDF({ variation, project, logoUrl: process.env.LOGO_URL || '' })
    const b64 = Buffer.from(bytes).toString('base64')
    const fname = `Variation ${variation.varNumber} - ${[project.jobNo, project.name].filter(Boolean).join(' ')}.pdf`
      .replace(/[^a-zA-Z0-9 .-]/g, '')
    const ccList = (Array.isArray(cc) ? cc : [cc]).filter(Boolean)

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: recipients, subject,
        ...(ccList.length ? { cc: ccList } : {}),
        // Replies go to the person who sent it, not to a sending subdomain nobody reads -
        // a customer querying a variation must reach the person who raised it.
        ...(replyTo ? { reply_to: replyTo } : {}),
        text,
        attachments: [{ filename: fname, content: b64 }],
      }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d?.message || 'Send failed')
    return res.json({ ok: true, id: d.id, sentTo: recipients, cc: ccList })
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Could not send' })
  }
}
