import { requireRole } from '../../lib/portalAuth'
async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['management','admin'])) return;
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { fileData, projectName, projectId, fileName } = req.body
    if (!fileData || !projectId || !projectName) {
      return res.status(400).json({ error: 'fileData, projectId and projectName required' })
    }

    // Decode base64 CSV
    const csv = Buffer.from(fileData, 'base64').toString('utf8')
    const lines = csv.split('\n')
    if (lines.length < 2) return res.status(400).json({ error: 'Empty file' })

    // Parse headers
    const headers = parseCSVLine(lines[0])
    const idx = {
      invoiceNumber: headers.indexOf('InvoiceNumber'),
      invoiceDate: headers.indexOf('InvoiceDate'),
      total: headers.indexOf('Total'),
      trackingOption1: headers.indexOf('TrackingOption1'),
      contact: headers.indexOf('ContactName'),
      status: headers.indexOf('Status'),
      type: headers.indexOf('Type'),
      reference: headers.indexOf('Reference'),
      amountDue: headers.indexOf('InvoiceAmountDue'),
      amountPaid: headers.indexOf('InvoiceAmountPaid'),
    }

    if (idx.invoiceNumber === -1 || idx.total === -1) {
      return res.status(400).json({ error: 'Invalid CSV format — make sure you are uploading a Xero Sales Invoices export' })
    }

    // Parse invoice rows — one row per line item, deduplicate by invoice number
    const invoiceMap = new Map()

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const cols = parseCSVLine(line)
      if (cols.length < 3) continue

      const tracking = cols[idx.trackingOption1] || ''
      if (tracking !== projectName) continue

      const invoiceNumber = cols[idx.invoiceNumber]
      if (!invoiceNumber || invoiceMap.has(invoiceNumber)) continue

      const type = cols[idx.type] || ''
      if (type.toLowerCase().includes('credit note')) continue

      const total = parseFloat(cols[idx.total]) || 0
      if (total <= 0) continue

      invoiceMap.set(invoiceNumber, {
        invoiceNumber,
        date: parseDate(cols[idx.invoiceDate]),
        contact: cols[idx.contact] || '',
        reference: cols[idx.reference] || '',
        total,
        amountPaid: parseFloat(cols[idx.amountPaid]) || 0,
        amountDue: parseFloat(cols[idx.amountDue]) || 0,
        status: cols[idx.status] || '',
      })
    }

    const invoices = Array.from(invoiceMap.values())
    if (invoices.length === 0) {
      return res.status(400).json({ error: `No invoices found for project "${projectName}". Check the tracking category filter.` })
    }

    const totalInvoiced = invoices.reduce((s, i) => s + i.total, 0)

    const redis = await getRedis()
    if (!redis) return res.status(500).json({ error: 'No Redis connection' })

    const now = new Date().toISOString()
    await redis.set(`invoiced:latest:${projectId}`, {
      totalInvoiced,
      invoiceCount: invoices.length,
      calculatedAt: now,
      source: 'csv_upload',
      fileName: fileName || 'upload'
    })
    await redis.set(`invoiced:lines:${projectId}`, invoices)
    await redis.del('dashboard:cache')

    res.json({
      ok: true,
      projectId,
      invoiceCount: invoices.length,
      totalInvoiced,
      preview: invoices.slice(0, 3)
    })

  } catch (e) {
    console.error('Invoice upload error:', e)
    res.status(500).json({ error: e.message })
  }
}

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''))
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''))
  return result
}

function parseDate(dateStr) {
  if (!dateStr) return null
  // DD/MM/YYYY
  const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (match) return `${match[3]}-${match[2]}-${match[1]}`
  return dateStr.slice(0, 10)
}
