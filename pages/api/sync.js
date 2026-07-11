import { requireRole } from '../../lib/portalAuth'
import { saveCachedDeals, saveLastSync, saveFieldMap, getCachedDeals } from '../../lib/db'
import { fetchAllDeals, discoverFieldMap } from '../../lib/pipedrive'

export default async function handler(req, res) {
  if (!requireRole(req, res, ['management','admin'])) return;
  if (req.method !== 'POST') return res.status(405).end()
  try {
    // Always refresh fields on every sync
    const fieldMap = await discoverFieldMap()
    await saveFieldMap(fieldMap)

    const freshDeals = await fetchAllDeals(fieldMap)
    
    // Preserve webhook-set fields that aren't available in bulk API
    const existingDeals = await getCachedDeals() || []
    const existingMap = new Map(existingDeals.map(d => [String(d.id), d]))
    
    const deals = freshDeals.map(d => {
      const existing = existingMap.get(String(d.id))
      return {
        ...d,
        // Preserve firstContactDate set by webhook
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
    return res.status(500).json({ error: err.message })
  }
}
