import { requireRole } from '../../lib/portalAuth'
import { getProject, saveProject } from '../../lib/db'
import { parseTakeOffRows, computeRateTotals } from '../../lib/contractRatesParser'

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } }

// Contracted Rates live inside the project settings under `contractedRates`:
//   { items: [...], locked: bool, uploadedAt, uploadedBy, fileName, sourceTotal }
// so they travel with the project and are available to the Application later.

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return

  if (req.method === 'GET') {
    const { projectId } = req.query
    if (!projectId) return res.status(400).json({ error: 'projectId required' })
    const project = (await getProject(projectId)) || {}
    return res.json({ contractedRates: project.contractedRates || null, variations: project.variations || [] })
  }

  if (req.method === 'POST') {
    const { action, projectId } = req.body || {}

    // Parse an uploaded xlsm/xlsx into items WITHOUT saving (preview before commit).
    // Accepts either a Blob URL (large files, preferred) or base64 (small files).
    if (action === 'parse-upload') {
      const { fileData, fileUrl, fileName } = req.body
      let buffer
      try {
        if (fileUrl) {
          const resp = await fetch(fileUrl)
          if (!resp.ok) return res.status(400).json({ error: 'Could not fetch the uploaded file.' })
          buffer = Buffer.from(await resp.arrayBuffer())
        } else if (fileData) {
          const b64 = String(fileData).includes(',') ? String(fileData).split(',')[1] : fileData
          buffer = Buffer.from(b64, 'base64')
        } else {
          return res.status(400).json({ error: 'fileUrl or fileData required' })
        }
      } catch (e) {
        return res.status(400).json({ error: 'Could not read the upload: ' + e.message })
      }
      let rows, sheetName
      try {
        const xlsx = await import('xlsx')
        const wb = xlsx.read(buffer, { type: 'buffer', cellDates: false })
        sheetName = wb.SheetNames.find(s => s.trim().toUpperCase() === 'TAKE OFF')
          || wb.SheetNames.find(s => /take\s*off/i.test(s))
        if (!sheetName) return res.status(400).json({ error: 'No "TAKE OFF" tab found in the workbook.' })
        rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null })
      } catch (e) {
        return res.status(400).json({ error: 'Could not read the file: ' + e.message })
      }
      const parsed = parseTakeOffRows(rows)
      if (parsed.error) return res.status(400).json({ error: parsed.error })
      const totals = computeRateTotals(parsed.items)
      return res.json({ ok: true, items: parsed.items, totals, sheetName, fileName: fileName || '' })
    }

    if (!projectId) return res.status(400).json({ error: 'projectId required' })
    const project = (await getProject(projectId)) || {}

    // Save the (possibly edited) rate set + lock state.
    if (action === 'save') {
      const { items, locked, fileName, sourceTotal } = req.body
      if (!Array.isArray(items)) return res.status(400).json({ error: 'items required' })
      const existing = project.contractedRates || {}
      project.contractedRates = {
        items,
        locked: !!locked,
        fileName: fileName != null ? fileName : (existing.fileName || ''),
        sourceTotal: sourceTotal != null ? sourceTotal : (existing.sourceTotal ?? null),
        uploadedAt: existing.uploadedAt || Date.now(),
        savedAt: Date.now(),
        savedBy: req.body.author || '',
      }
      await saveProject(projectId, project)
      return res.json({ ok: true, contractedRates: project.contractedRates })
    }

    // Set/clear the lock only.
    if (action === 'set-lock') {
      if (!project.contractedRates) return res.status(400).json({ error: 'No contracted rates to lock.' })
      project.contractedRates.locked = !!req.body.locked
      project.contractedRates.savedAt = Date.now()
      await saveProject(projectId, project)
      return res.json({ ok: true, contractedRates: project.contractedRates })
    }

    // Delete the whole set so a fresh file can be uploaded.
    if (action === 'delete') {
      delete project.contractedRates
      await saveProject(projectId, project)
      return res.json({ ok: true })
    }

    // Append a below-the-line item to the project's variations (variation tracker).
    if (action === 'to-variation') {
      const v = req.body.variation || {}
      if (!v.description && !v.varNumber) return res.status(400).json({ error: 'Nothing to add.' })
      const vars = Array.isArray(project.variations) ? [...project.variations] : []
      vars.push({
        varNumber: v.varNumber || '',
        description: v.description || '',
        descriptionFull: v.descriptionFull || v.description || '',
        sourceItems: Array.isArray(v.sourceItems) ? v.sourceItems : [],
        instructed: !!v.instructed,
        materials: v.materials || '0',
        labour: v.labour || '0',
        profit: v.profit || '0',
      })
      project.variations = vars
      await saveProject(projectId, project)
      return res.json({ ok: true, variations: vars })
    }

    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(405).end()
}
