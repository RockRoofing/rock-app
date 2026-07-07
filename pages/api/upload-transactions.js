import { getProject } from '../../lib/db'

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
}

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

const ACCOUNT_CODE_MAP = {
  'CIS Labour Expense': '321',
  'Direct Wages': '320',
  'Cost of Goods Sold': '310',
  'Material': '311',
  'CIS Materials Purchased': '322',
  'Direct Expenses': '325',
  'Sub Contractors': '328',
  'Hotels': '329',
  'Fuel, Parking & Tolls': '330',
  'Food and Drinks': '331',
  'Plant and Equipment Hire': '333',
  'Sub-Contract Bona Fide': '334',
  'Vehicle fines': '335',
  'Design Services': '336',
}

const LABOUR_ACCOUNT_CODES = ['321', '320']

function excelDateToString(val) {
  if (!val) return null
  if (typeof val === 'string') {
    if (val.match(/^\d{4}-\d{2}-\d{2}/)) return val.slice(0, 10)
    if (val.match(/^\d{2}\/\d{2}\/\d{4}/)) {
      const [d, m, y] = val.split('/')
      return `${y}-${m}-${d}`
    }
    return null
  }
  if (typeof val === 'number') {
    const date = new Date((val - 25569) * 86400 * 1000)
    return date.toISOString().slice(0, 10)
  }
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { fileData, projectId, fileName } = req.body
    if (!fileData || !projectId) {
      return res.status(400).json({ error: 'fileData and projectId required' })
    }

    const xlsx = await import('xlsx')
    const buffer = Buffer.from(fileData, 'base64')
    const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: false })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true })

    let currentAccount = null
    let currentAccountCode = null
    const lines = []
    let labourTotal = 0
    let materialsTotal = 0
    let total = 0

    for (const row of rows) {
      if (!row || row.length === 0) continue
      const first = row[0]
      if (first === null || first === undefined) continue
      const firstStr = String(first).trim()

      if (['Account Transactions', 'Date', 'Rock Roofing Limited'].includes(firstStr)) continue
      if (firstStr.toLowerCase().includes('period') || firstStr.toLowerCase().includes('projects is')) continue

      const isHeader = row.slice(1).every(cell => cell === null || cell === undefined || cell === '')
      if (isHeader && ACCOUNT_CODE_MAP[firstStr]) {
        currentAccount = firstStr
        currentAccountCode = ACCOUNT_CODE_MAP[firstStr]
        continue
      }

      if (!currentAccountCode) continue

      const dateStr = excelDateToString(first)
      if (!dateStr) continue

      const description = row[2] ? String(row[2]) : ''
      const reference = row[3] ? String(row[3]) : ''
      const debitRaw = parseFloat(String(row[7] || '0').replace(/[£,]/g, '')) || 0
      const creditRaw = parseFloat(String(row[8] || '0').replace(/[£,]/g, '')) || 0
      const amount = debitRaw - creditRaw

      if (amount === 0) continue

      const isLabour = LABOUR_ACCOUNT_CODES.includes(currentAccountCode)
      total += amount
      if (isLabour) labourTotal += amount
      else materialsTotal += amount

      // Extract supplier name from description (first part before " - ")
      const supplier = description.split(' - ')[0] || description

      lines.push({
        date: dateStr,
        supplier,
        description,
        reference,
        amount,
        accountCode: currentAccountCode,
        accountName: currentAccount,
        type: isLabour ? 'Labour' : 'Materials'
      })
    }

    if (lines.length === 0) {
      return res.status(400).json({ error: 'No transactions found in file. Make sure you are uploading a Xero Account Transactions export.' })
    }

    const redis = await getRedis()
    if (!redis) return res.status(500).json({ error: 'No Redis connection' })

    const now = new Date().toISOString()
    await redis.set(`costs:latest:${projectId}`, {
      labourSpend: labourTotal,
      materialsSpend: materialsTotal,
      totalCosts: total,
      calculatedAt: now,
      source: 'excel_upload',
      fileName: fileName || 'upload'
    })
    await redis.set(`costs:lines:${projectId}`, lines)
    await redis.del('dashboard:cache')

    res.json({
      ok: true,
      projectId,
      transactions: lines.length,
      labourTotal,
      materialsTotal,
      total,
      preview: lines.slice(0, 3)
    })

  } catch (e) {
    console.error('Upload error:', e)
    res.status(500).json({ error: e.message })
  }
}
