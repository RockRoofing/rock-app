import { getProject, saveProject, getClient } from '../../../../lib/db'

async function clearCache() {
  try {
    const redis = await getClient()
    await redis.del('dashboard:cache')
  } catch {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { id } = req.query
  const { wipMarginOverride } = req.body
  const existing = await getProject(id) || {}
  await saveProject(id, { ...existing, wipMarginOverride })
  await clearCache()
  res.json({ ok: true })
}
