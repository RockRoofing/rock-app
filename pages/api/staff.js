import { getStaff, saveStaff, getClient } from '../../lib/db'
import withTenant from '../../lib/withTenant'

async function clearCache() {
  try {
    const redis = await getClient()
    await redis.del('dashboard:cache')
  } catch {}
}

async function handler(req, res) {
  if (req.method === 'GET') {
    const staff = await getStaff()
    return res.json(staff)
  }

  if (req.method === 'POST') {
    const { members } = req.body
    if (!Array.isArray(members)) {
      return res.status(400).json({ error: 'members must be an array' })
    }
    await saveStaff({ members })
    await clearCache()
    return res.json({ ok: true })
  }

  res.status(405).end()
}

export default withTenant(handler)
