import { requireRole } from '../../lib/portalAuth'
import { LABOUR_ACCOUNTS, COST_OF_SALE_ACCOUNTS, extractJobNoFromDescription } from '../../lib/xero'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

function parseCSV(text) {
  const lines = text.split('\n')
  if (lines.length < 2) return []
  
  const headers = parseCSVLine(lines[0])
  const descIdx = headers.indexOf('Description')
  const accountIdx = headers.indexOf('AccountCode')
  const amountIdx = headers.indexOf('LineAmount')
  const invoiceNoIdx = headers.indexOf('InvoiceNumber')
  const dateIdx = headers.indexOf('InvoiceDate')

  if (descIdx === -1 || accountIdx === -1 || amountIdx === -1) {
    throw new Error('Invalid CSV format — missing required columns')
  }

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cols = parseCSVLine(lines[i])
    rows.push({
      invoiceNumber: cols[invoiceNoIdx] || '',
      description: cols[descIdx] || '',
      accountCode: cols[accountIdx] || '',
      lineAmount: parseFloat(cols[amountIdx]) || 0,
      date: cols[dateIdx] || ''
    })
  }
  return rows
}

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuotes = !inQuotes
    } else if (line[i] === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += line[i]
    }
  }
  result.push(current.trim())
  return result
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['management','admin'])) return;
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const csvText = req.body
    if (!csvText) return res.status(400).json({ error: 'No data received' })

    const rows = parseCSV(csvText)
    const redis = await getRedis()

    // Load already processed invoice numbers
    const processedInvoices = (redis ? await redis.get('uploaded:invoices') : null) || {}

    const labourByJob = {}
    const materialsByJob = {}
    let matchedLines = 0
    let skippedDuplicates = 0
    const newInvoiceNumbers = {}

    for (const row of rows) {
      if (!COST_OF_SALE_ACCOUNTS.includes(row.accountCode)) continue
      if (row.lineAmount <= 0) continue

      const jobNo = extractJobNoFromDescription(row.description)
      if (!jobNo) continue

      // Skip if this invoice was already processed
      if (row.invoiceNumber && processedInvoices[row.invoiceNumber]) {
        skippedDuplicates++
        continue
      }

      matchedLines++
      if (row.invoiceNumber) newInvoiceNumbers[row.invoiceNumber] = true

      if (LABOUR_ACCOUNTS.includes(row.accountCode)) {
        labourByJob[jobNo] = (labourByJob[jobNo] || 0) + row.lineAmount
      } else {
        materialsByJob[jobNo] = (materialsByJob[jobNo] || 0) + row.lineAmount
      }
    }

    if (redis) {
      const existingLabour = await redis.get('costs:labour') || {}
      const existingMaterials = await redis.get('costs:materials') || {}

      const mergedLabour = { ...existingLabour }
      const mergedMaterials = { ...existingMaterials }

      for (const [job, amount] of Object.entries(labourByJob)) {
        mergedLabour[job] = (mergedLabour[job] || 0) + amount
      }
      for (const [job, amount] of Object.entries(materialsByJob)) {
        mergedMaterials[job] = (mergedMaterials[job] || 0) + amount
      }

      await redis.set('costs:labour', mergedLabour)
      await redis.set('costs:materials', mergedMaterials)
      await redis.set('uploaded:invoices', { ...processedInvoices, ...newInvoiceNumbers })
      await redis.del('dashboard:cache')
    }

    const labourTotal = Object.values(labourByJob).reduce((s, v) => s + v, 0)
    const materialsTotal = Object.values(materialsByJob).reduce((s, v) => s + v, 0)

    res.json({
      ok: true,
      linesProcessed: rows.length,
      matchedLines,
      skippedDuplicates,
      projectsUpdated: new Set([...Object.keys(labourByJob), ...Object.keys(materialsByJob)]).size,
      labourTotal: Math.round(labourTotal),
      materialsTotal: Math.round(materialsTotal)
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}
