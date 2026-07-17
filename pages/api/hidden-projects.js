// Shared list of project ids hidden from the commercial views (Project
// Financials, Retention, Application Calendar, Commercial Scorecard). Stored as a
// single KV key so every user sees the same set — any logged-in user can edit it.
// Default is VISIBLE: a project only disappears if its id is in this list.
export default async function handler(req, res) {
  try {
    const { Redis } = await import('@upstash/redis')
    const redis = Redis.fromEnv()
    const KEY = 'config:hidden-projects'

    if (req.method === 'GET') {
      const hidden = (await redis.get(KEY).catch(() => null)) || []
      return res.json({ hidden })
    }

    if (req.method === 'POST') {
      const { hidden } = req.body || {}
      if (!Array.isArray(hidden)) return res.status(400).json({ error: 'hidden must be an array of project ids' })
      const clean = [...new Set(hidden.map(String))]
      await redis.set(KEY, clean)
      return res.json({ ok: true, hidden: clean })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
