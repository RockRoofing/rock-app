import { requireRole } from '../../lib/portalAuth'
import { getProject, saveProject } from '../../lib/db'
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
  if (!requireRole(req, res, ['post-contract','management','admin'])) return;
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })
  const KEY = 'retention:entries'

  if (req.method === 'GET') {
    try {
      const data = await redis.get(KEY)
      return res.json({ entries: data || [] })
    } catch { return res.json({ entries: [] }) }
  }

  if (req.method === 'POST') {
    // BULK IMPORT.
    //
    // Nine rows one at a time is nine round trips and nine cache clears, and a failure
    // half way leaves you not knowing which landed. One request, one write.
    //
    // Matched on REF. Re-uploading the same file updates those rows rather than creating
    // a second set - the commonest reason to upload again is that a figure was wrong.
    if (Array.isArray(req.body?.entries)) {
      const incoming = req.body.entries.filter(e => e && String(e.ourRef || '').trim())
      let all = []
      try { const d = await redis.get(KEY); if (d) all = d } catch {}

      let added = 0, updated = 0
      for (const e of incoming) {
        const ref = String(e.ourRef).trim().toLowerCase()
        const i = all.findIndex(x => String(x.ourRef || '').trim().toLowerCase() === ref)
        if (i >= 0) { all[i] = { ...all[i], ...e, id: all[i].id }; updated++ }
        else {
          all.push({ ...e, id: `ret_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, manual: true, trackerOnly: true })
          added++
        }
      }
      await redis.set(KEY, all)
      try { await redis.del('dashboard:cache') } catch {}
      return res.json({ entries: all, added, updated })
    }

    const { entry } = req.body
    if (!entry) return res.status(400).json({ error: 'Missing entry' })
    let entries = []
    try { const d = await redis.get(KEY); if (d) entries = d } catch {}
    if (entry.id) {
      // Update existing
      entries = entries.map(e => e.id === entry.id ? { ...e, ...entry } : e)
    } else {
      // New entry (either a pure manual row, or a manual OVERRIDE of a Xero row
      // — the latter carries an xeroId).
      entry.id = `ret_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      entry.manual = entry.xeroId ? false : true
      entries.push(entry)
    }
    await redis.set(KEY, entries)
    // The Retention Tracker is the source of truth for a project's stage
    // (live/defects/complete), which Project Financials reads. Any save may change
    // status, so always refresh the dashboard cache.
    try { await redis.del('dashboard:cache') } catch {}
    // comment back to the project's retentionComments so Project Details stays in
    // step. (Only comments sync back — all other fields are read-only from the
    // project; manual VAT stays only in the tracker.)
    try {
      if (entry.xeroId && entry.comments != null) {
        const settings = (await getProject(entry.xeroId)) || {}
        if ((settings.retentionComments || '') !== entry.comments) {
          await saveProject(entry.xeroId, { ...settings, retentionComments: entry.comments })
          try { await redis.del('dashboard:cache') } catch {}
        }
      }
    } catch (e) { console.error('retention comment write-back failed:', e) }

    return res.json({ entries })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    let entries = []
    try { const d = await redis.get(KEY); if (d) entries = d } catch {}
    entries = entries.filter(e => e.id !== id)
    await redis.set(KEY, entries)
    try { await redis.del('dashboard:cache') } catch {}
    return res.json({ entries })
  }

  res.status(405).end()
}
