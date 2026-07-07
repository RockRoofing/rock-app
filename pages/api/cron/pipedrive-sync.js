import { saveCachedDeals, saveLastSync, saveFieldMap, getCachedDeals } from '../../../lib/db'
import { fetchAllDeals, discoverFieldMap } from '../../../lib/pipedrive'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  const isVercelCron = req.headers['x-vercel-cron'] === '1'
  const isManual = req.query.secret === process.env.SYNC_SECRET
  if (!isVercelCron && !isManual) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const fieldMap = await discoverFieldMap()
    await saveFieldMap(fieldMap)

    const freshDeals = await fetchAllDeals(fieldMap)
    
    // Preserve webhook-set fields
    const existingDeals = await getCachedDeals() || []
    const existingMap = new Map(existingDeals.map(d => [String(d.id), d]))
    
    const deals = freshDeals.map(d => {
      const existing = existingMap.get(String(d.id))
      return {
        ...d,
        firstContactDate: existing?.firstContactDate || d.firstContactDate || null,
        everIn1stContact: existing?.everIn1stContact || d.everIn1stContact || false,
        receivedDate: existing?.receivedDate || d.receivedDate || null,
        everInReceived: existing?.everInReceived || d.everInReceived || false,
      }
    })

    await saveCachedDeals(deals)
    await saveLastSync(new Date().toISOString())

    return res.status(200).json({ success: true, dealCount: deals.length })
  } catch (err) {
    console.error('Pipedrive sync error:', err)
    return res.status(500).json({ error: err.message })
  }
}
