// Returns the last-synced timestamp for each Xero data type, so the Bookkeeping
// and Commercial pages can show a "last synced" stamp. Read-only, no auth-sensitive
// data (just ISO timestamps).
export default async function handler(req, res) {
  try {
    const { Redis } = await import('@upstash/redis')
    const redis = Redis.fromEnv()
    const [invoices, wages, bills, benchmark] = await Promise.all([
      redis.get('sync-invoices:at').catch(() => null),
      redis.get('sync-wages:at').catch(() => null),
      redis.get('sync-bills:at').catch(() => null),
      redis.get('xero:pl-benchmark').then(v => v?.updatedAt || null).catch(() => null),
    ])
    res.json({ invoices, wages, bills, benchmark })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
