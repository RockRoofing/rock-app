import { saveProject, getProject } from '../../../../lib/db'

async function clearCache() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return
    const redis = new Redis({ url, token })
    await redis.del('dashboard:cache')
  } catch {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { id } = req.query
  // Merge with existing settings so a partial update (e.g. just wipMarginOverride
  // from the WIP page) doesn't wipe the rest. Full-object callers are unaffected.
  const existing = (await getProject(id)) || {}

  // OWNED ELSEWHERE - never written from here.
  //
  // This endpoint takes whatever the caller sends and merges it. The Project Details form
  // posts its entire settings object back, and that object is the WHOLE project record -
  // including contractedRates and applications, which it never edits and may be holding a
  // stale copy of.
  //
  // The effect: lock the contracted rates, then save project details from a page loaded
  // before the lock, and the lock silently reverted. Applications then refused to create
  // one, correctly reporting rates that were not locked - while the rates page still
  // showed them locked from its own state.
  //
  // Applications are on the list for the same reason: a stale copy posted back here would
  // undo a certificate.
  const OWNED_ELSEWHERE = ['contractedRates', 'applications']
  const incoming = { ...req.body }
  for (const k of OWNED_ELSEWHERE) delete incoming[k]

  // A SHRINKING VARIATIONS LIST IS ALMOST ALWAYS A BUG.
  //
  // Variations are only ever added and edited; the one place that deletes them removes a
  // single row. So a POST carrying FEWER than we already hold means the caller built its
  // list from the wrong place - which is exactly what the Variation Builder was doing,
  // silently writing one variation over a project's whole history.
  //
  // Refused rather than merged: merging would paper over the caller's bug and leave two
  // versions of the truth. A deletion of one row still passes, because that is a
  // difference of one.
  // WHICH ROWS SURVIVE, not how many.
  //
  // The count test I shipped allowed any reduction of one - and "two variations on the
  // tracker, the builder posts one" is a reduction of one. It allowed the exact case that
  // lost V01 and V02.
  //
  // A legitimate delete removes ONE row and keeps the rest. Anything that drops a
  // variation the caller was not deleting is a caller reading the wrong list, and is
  // refused by name so the loss is visible instead of silent.
  if (Array.isArray(incoming.variations) && Array.isArray(existing.variations) && existing.variations.length) {
    const key = (v) => `${String(v.varNumber || '').trim().toUpperCase()}|${String(v.description || '').trim().slice(0, 40)}`
    const incomingKeys = new Set(incoming.variations.map(key))
    const dropped = existing.variations.filter(v => !incomingKeys.has(key(v)))
    if (dropped.length > 1) {
      return res.status(409).json({
        error: `Refused: this would drop ${dropped.length} variations (${dropped.map(v => v.varNumber || v.description || '?').join(', ')}). `
          + `Deleting one at a time is fine; losing several means the caller built its list from the wrong place.`,
        dropped: dropped.map(v => v.varNumber || ''),
      })
    }
  }

  await saveProject(id, { ...existing, ...incoming })
  await clearCache()
  res.json({ ok: true })
}
