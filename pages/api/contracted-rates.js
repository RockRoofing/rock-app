import { requireRole } from '../../lib/portalAuth'
import { getProject, saveProject } from '../../lib/db'

// Drop the dashboard snapshot so Project Financials (Budget Tracker + EOM) rebuild
// from fresh project data. Called after CR-lock updates the project's budgets — the
// dashboard caches for 4h, so without this the tables show stale numbers.
async function clearDashboardCache() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return
    const redis = new Redis({ url, token })
    await redis.del('dashboard:cache')
  } catch {}
}

// When contracted rates are LOCKED, push the CR totals into the project's edit
// details as the source of truth (overwriting any manual entries):
//   Original Contract Value  <- above-the-line total
//   Labour budget            <- above-the-line labour
//   Materials budget         <- above-the-line materials
// NOTE: getProject(id) returns the settings object itself, so these live at the
// top level of `project` (e.g. project.contractValue), not project.settings.*.
function populateBudgetsFromCR(project) {
  const items = project?.contractedRates?.items || []
  const t = computeRateTotals(items)
  project.contractValue = Number(t.aboveTotal || 0)
  project.labourBudget = Number(t.aboveLabour || 0)
  project.materialsBudget = Number(t.aboveMaterials || 0)
  project.budgetsFromCRAt = Date.now()
}
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
      const { items, locked, fileName, sourceTotal, discountPct } = req.body
      if (!Array.isArray(items)) return res.status(400).json({ error: 'items required' })
      const existing = project.contractedRates || {}
      project.contractedRates = {
        items,
        locked: !!locked,
        fileName: fileName != null ? fileName : (existing.fileName || ''),
        sourceTotal: sourceTotal != null ? sourceTotal : (existing.sourceTotal ?? null),
        discountPct: discountPct != null ? discountPct : (existing.discountPct ?? 0),
        uploadedAt: existing.uploadedAt || Date.now(),
        savedAt: Date.now(),
        savedBy: req.body.author || '',
      }
      // When the rates are locked, the CR totals become the source of truth for the
      // project's contract value + labour/materials budgets (overwrites manual).
      if (project.contractedRates.locked) populateBudgetsFromCR(project)
      await saveProject(projectId, project)
      if (project.contractedRates.locked) await clearDashboardCache()
      return res.json({ ok: true, contractedRates: project.contractedRates })
    }

    // Set/clear the lock only.
    if (action === 'set-lock') {
      if (!project.contractedRates) return res.status(400).json({ error: 'No contracted rates to lock.' })
      project.contractedRates.locked = !!req.body.locked
      project.contractedRates.savedAt = Date.now()
      if (project.contractedRates.locked) populateBudgetsFromCR(project)
      await saveProject(projectId, project)
      if (project.contractedRates.locked) await clearDashboardCache()
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
