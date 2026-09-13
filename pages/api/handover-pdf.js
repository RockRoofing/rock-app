import { getOpsProjects, getTemplate } from '../../lib/db'
import { requireRole } from '../../lib/portalAuth'
import { IHM_SECTIONS } from '../../lib/ihmSchema'
import { buildHandoverPDF } from '../../lib/handoverPdf'
import withTenant from '../../lib/withTenant'

// GET /api/handover-pdf?no=J228  ->  the Internal Handover Minutes as a PDF
//
// Built server-side from the stored project data and the SAME sections the form
// renders, so the document cannot drift from the screen. Pre-Contract raise it,
// Operations read it, and both download the identical file.
const logoFor = (req) => {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  return `${proto}://${req.headers.host}/rock-logo.jpg`
}

async function handler(req, res) {
  // Pre-contract raise the handover, post-contract and management live off it.
  const session = requireRole(req, res, ['pre-contract', 'post-contract', 'management', 'admin'])
  if (!session) return
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }) }

  const no = String(req.query.no || '').trim()
  if (!no) return res.status(400).json({ error: 'Missing project number' })

  try {
    const projects = await getOpsProjects()
    const project = (projects || []).find(p => p.projectNo === no)
    if (!project) return res.status(404).json({ error: 'No handover found for that project' })

    // The CUSTOMISED sections where admin has saved a template, otherwise the code
    // default - the same resolution /api/templates does for the form. A handover
    // printed from the stock schema when the form asked different questions would
    // be a different document from the one the meeting worked through.
    let sections = IHM_SECTIONS
    try {
      const stored = await getTemplate('ihm')
      if (stored && Array.isArray(stored.sections) && stored.sections.length) sections = stored.sections
    } catch { /* fall back to the code schema */ }

    const data = project.data || {}
    const bytes = await buildHandoverPDF({
      sections,
      data,
      projectNo: project.projectNo,
      projectName: data.projectName || '',
      logoUrl: logoFor(req),
    })

    const safe = `${project.projectNo || 'handover'}-${(data.projectName || 'Internal Handover')}`
      .replace(/[^\w\-. ]+/g, '').trim().replace(/\s+/g, '-')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${safe}-IHM.pdf"`)
    return res.status(200).send(Buffer.from(bytes))
  } catch (e) {
    // JSON, not a half-written PDF - the browser would otherwise download a broken
    // file and the person would have no idea what went wrong.
    return res.status(500).json({ error: e && e.message ? e.message : 'Could not build the PDF' })
  }
}

export default withTenant(handler)
