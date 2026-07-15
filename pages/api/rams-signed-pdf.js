import { getProjectFiles, getRamsApprovals, getRamsSignatures, getOpsProject } from '../../lib/db'
import { buildSignedRamsPDF } from '../../lib/signedRamsPdf'

// GET /api/rams-signed-pdf?no=<projectNo>
//     -> { revisions: [{ fileId, name, uploadedAt, stage, signedCount }] }  (newest first)
// GET /api/rams-signed-pdf?no=<projectNo>&fileId=<id>
//     -> application/pdf (original RAMS + appended signature/approval record)
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { no, fileId } = req.query
    if (!no) return res.status(400).json({ error: 'Project number required' })

    const files = (await getProjectFiles(no)) || []
    const ramsFiles = files.filter(f => f.category === 'rams').sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0))
    const approvals = await getRamsApprovals(no)
    const allSigs = await getRamsSignatures(no)

    // List revisions (no fileId given).
    if (!fileId) {
      const revisions = ramsFiles.map(f => {
        const stage = (approvals[f.id] && approvals[f.id].stage) || 'cm'
        const sigs = allSigs[f.id] || {}
        const opCount = Object.entries(sigs).filter(([opId, r]) =>
          !(opId.startsWith('cm:') || opId.startsWith('director:') || r.role === 'Contracts Manager' || r.role === 'Director')).length
        return { fileId: f.id, name: f.name, uploadedAt: f.uploadedAt || 0, stage, signedCount: opCount }
      })
      return res.json({ revisions })
    }

    // Generate the signed PDF for a specific revision.
    const file = ramsFiles.find(f => f.id === fileId)
    if (!file) return res.status(404).json({ error: 'RAMS revision not found' })

    let ramsBytes = null
    try { if (file.url) { const r = await fetch(file.url); if (r.ok) ramsBytes = new Uint8Array(await r.arrayBuffer()) } } catch {}

    let projectName = ''
    try { const p = await getOpsProject(no); projectName = p?.data?.projectName || p?.projectName || '' } catch {}

    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]
    const host = req.headers['x-forwarded-host'] || req.headers.host
    const logoUrl = host ? `${proto}://${host}/rock-logo.jpg` : null

    const pdfBytes = await buildSignedRamsPDF({
      ramsBytes,
      fileName: file.name || 'RAMS.pdf',
      project: { projectNo: no, projectName },
      approval: approvals[fileId] || null,
      signatures: allSigs[fileId] || {},
      logoUrl,
    })

    const base = (file.name || 'RAMS').replace(/\.pdf$/i, '')
    const outName = `${no} - ${base} - SIGNED.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${outName.replace(/["\\]/g, '')}"`)
    res.setHeader('Cache-Control', 'no-store')
    return res.send(Buffer.from(pdfBytes))
  } catch (e) {
    console.error('rams-signed-pdf error:', e)
    return res.status(500).json({ error: e.message || 'Failed to build signed RAMS' })
  }
}
