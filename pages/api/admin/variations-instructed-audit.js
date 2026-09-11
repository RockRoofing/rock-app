import { saveProject } from '../../../lib/db'
import { requireRole } from '../../../lib/portalAuth'
import { isInstructed } from '../../../lib/applications'

// AUDIT AND REPAIR THE `instructed` FLAG ACROSS EVERY PROJECT.
//
// Two separate jobs, and they are deliberately not the same job:
//
//   1. SHAPE. Some records hold the string 'yes'/'no', some a boolean. That is
//      lossless to convert - 'yes' means instructed and always did - so it is applied
//      to everything without asking.
//
//   2. MEANING. The Variation Builder wrote 'no' over variations that had been
//      instructed elsewhere, because its guard only recognised the string 'yes'. That
//      IS lossy: the record no longer says it was ever instructed, and nothing in it
//      distinguishes "withdrawn by the builder" from "genuinely never instructed".
//
//      So this does not guess. It looks for EVIDENCE and reports it:
//
//        - a SENT application whose frozen copy of that variation says instructed.
//          An application that went to the customer with the variation marked
//          instructed is proof it was instructed at that date.
//        - the other settings record for the same project saying instructed, where a
//          project is held under both a tracking id and a job number.
//
//      Anything with evidence is listed with the evidence. Nothing is changed unless
//      the call says apply: 'restore'.
//
// GET                      -> report only, changes nothing
// POST { apply: 'shape' }  -> convert strings to booleans
// POST { apply: 'restore' }-> shape, PLUS re-instruct where there is evidence
const KEYS_PREFIX = 'project:'

function variationsOf(rec) {
  return Array.isArray(rec && rec.variations) ? rec.variations : []
}
const vkey = (v) => String((v && v.varNumber) || '').trim().toUpperCase()

export default async function handler(req, res) {
  // Admin only. It rewrites the instructed flag, which moves the anticipated final
  // account on every surface that reads it.
  const session = requireRole(req, res, ['admin'])
  if (!session) return

  const apply = req.method === 'POST' ? String(req.body?.apply || '') : ''
  if (apply && !['shape', 'restore'].includes(apply)) {
    return res.status(400).json({ error: "apply must be 'shape' or 'restore'" })
  }

  let redis = null
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (url && token) redis = new Redis({ url, token })
  } catch { /* handled below */ }
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  // Every project record, by key.
  let keys = []
  try {
    let cursor = 0
    do {
      const [next, batch] = await redis.scan(cursor, { match: `${KEYS_PREFIX}*`, count: 500 })
      cursor = Number(next)
      keys.push(...batch)
    } while (cursor)
  } catch (e) {
    return res.status(500).json({ error: `Could not list projects: ${e.message}` })
  }
  keys = [...new Set(keys)]

  const records = new Map()
  for (const k of keys) {
    try { const r = await redis.get(k); if (r && typeof r === 'object') records.set(k, r) } catch { /* skip */ }
  }

  // Evidence: a SENT application's frozen copy saying instructed.
  const sentEvidence = new Map()   // `${key}|${varNumber}` -> application label
  for (const [k, rec] of records) {
    for (const app of (Array.isArray(rec.applications) ? rec.applications : [])) {
      if (!app || app.status !== 'sent') continue
      for (const v of (Array.isArray(app.variations) ? app.variations : [])) {
        if (isInstructed(v) && vkey(v)) {
          sentEvidence.set(`${k}|${vkey(v)}`, `application ${app.appNumber || app.seq || '?'} (sent)`)
        }
      }
    }
  }

  // Evidence: the OTHER record for the same project saying instructed. Projects can be
  // held under a tracking id and a job number at once - the cause of several faults.
  const instructedAnywhere = new Map()  // varNumber -> the key that says so
  for (const [k, rec] of records) {
    for (const v of variationsOf(rec)) if (isInstructed(v) && vkey(v)) instructedAnywhere.set(`${rec.jobNo || k}|${vkey(v)}`, k)
  }

  const report = []
  let shapeFixed = 0, restored = 0, projectsTouched = 0

  for (const [k, rec] of records) {
    const vars = variationsOf(rec)
    if (!vars.length) continue
    let changed = false
    const next = vars.map((v) => {
      if (!v || typeof v !== 'object') return v
      const nowTrue = isInstructed(v)
      const isString = typeof v.instructed === 'string'
      const entry = {
        project: rec.jobNo || k, key: k, varNumber: v.varNumber || '(no number)',
        description: String(v.description || '').slice(0, 80),
        stored: v.instructed, instructed: nowTrue,
        value: (Number(v.materials) || 0) + (Number(v.labour) || 0) + (Number(v.profit) || 0),
      }

      let out = v
      if (isString) {
        entry.shapeFix = `"${v.instructed}" -> ${nowTrue}`
        if (apply) { out = { ...out, instructed: nowTrue }; changed = true; shapeFixed++ }
      }

      if (!nowTrue) {
        const ev = sentEvidence.get(`${k}|${vkey(v)}`)
          || (instructedAnywhere.get(`${rec.jobNo || k}|${vkey(v)}`) && instructedAnywhere.get(`${rec.jobNo || k}|${vkey(v)}`) !== k
                ? `the other settings record for this project` : null)
        if (ev) {
          entry.evidenceOfInstruction = ev
          entry.builtInBuilder = !!v.builder
          if (apply === 'restore') { out = { ...out, instructed: true }; changed = true; restored++ }
        } else if (v.builder) {
          // No evidence, but it came from the builder - the population the fault could
          // have touched. Listed so it can be eyeballed, never changed automatically.
          entry.reviewSuggested = 'built in the Variation Builder and not instructed - check against the customer instruction'
        }
      }
      if (entry.shapeFix || entry.evidenceOfInstruction || entry.reviewSuggested) report.push(entry)
      return out
    })

    if (changed && apply) {
      await saveProject(k.slice(KEYS_PREFIX.length), { ...rec, variations: next })
      projectsTouched++
    }
  }

  if (apply) { try { await redis.del('dashboard:cache') } catch { /* non-fatal */ } }

  res.json({
    ok: true,
    mode: apply || 'report only - nothing changed',
    projectsScanned: records.size,
    projectsTouched,
    shapeFixed,
    restored,
    needsReview: report.filter(r => r.reviewSuggested).length,
    report: report.sort((a, b) => String(a.project).localeCompare(String(b.project))),
  })
}
