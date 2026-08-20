// PROJECT IDENTITY REGISTER
// =========================
// Until now, the ONLY register of which projects exist was the Xero tracking
// category. Every commercial surface enumerates from it: Project Financials,
// Retention, Applications, Cashflow, the Application Calendar, Bookkeeping, the
// project page. Nothing on our side ever stored a project's name or job number.
//
// So deleting a tracking option in Xero deleted the project from the portal.
// Not the data - the data (project:<id>, retention:entries, costs:*, invoiced:*)
// all survived untouched - but the app could no longer LIST it, which amounts to
// the same thing when you are trying to chase a retention.
//
// This register fixes that. Every project seen in Xero is recorded here with the
// identity fields Xero was the sole source of. Anything we have seen before but
// Xero no longer returns is a GHOST: it still appears everywhere, flagged, with
// its financial caches frozen at the last sync (correct - there is nothing left
// to sync).
//
// Archiving in Xero was already survivable (getProjectsFromCategories asks for
// includeArchived=true). Deletion is what this covers.

export const REGISTRY_KEY = 'projects:registry'

// { [trackingOptionId]: { name, jobNo, trackingCategoryId, firstSeen, lastSeenInXero } }
export async function readRegistry(redis) {
  if (!redis) return {}
  try {
    const r = await redis.get(REGISTRY_KEY)
    return (r && typeof r === 'object' && !Array.isArray(r)) ? r : {}
  } catch { return {} }
}

const today = () => new Date().toISOString().slice(0, 10)

// Record every project Xero currently returns, and return the whole register.
//
// Writes only when something actually changed, so a dashboard rebuild that finds
// nothing new costs one read and no write.
//
// NOTE: this only ever ADDS or UPDATES. It never removes an entry, because an
// entry disappearing from Xero is exactly the case this exists to survive.
export async function syncRegistry(redis, categoryProjects) {
  const registry = await readRegistry(redis)
  if (!redis || !Array.isArray(categoryProjects)) return registry

  const day = today()
  let changed = false

  for (const cp of categoryProjects) {
    const id = cp && cp.trackingOptionId
    if (!id) continue
    const key = String(id)
    const prev = registry[key] || {}
    const next = {
      name: cp.name || prev.name || '',
      jobNo: cp.jobNo || prev.jobNo || '',
      trackingCategoryId: cp.trackingCategoryId || prev.trackingCategoryId || '',
      firstSeen: prev.firstSeen || day,
      lastSeenInXero: day,
    }
    if (
      prev.name !== next.name ||
      prev.jobNo !== next.jobNo ||
      prev.trackingCategoryId !== next.trackingCategoryId ||
      prev.firstSeen !== next.firstSeen ||
      prev.lastSeenInXero !== next.lastSeenInXero
    ) changed = true
    registry[key] = next
  }

  if (changed) {
    try { await redis.set(REGISTRY_KEY, registry) } catch {}
  }
  return registry
}

// Everything we have a record of that Xero no longer returns, shaped exactly like
// a Xero tracking option so callers can concatenate the two lists and change
// nothing else.
export function ghostsFromRegistry(registry, categoryProjects) {
  const live = new Set((categoryProjects || []).map(cp => String(cp && cp.trackingOptionId)))
  const out = []
  for (const [id, r] of Object.entries(registry || {})) {
    if (live.has(String(id))) continue
    if (!r) continue
    out.push({
      trackingOptionId: id,
      trackingCategoryId: r.trackingCategoryId || '',
      name: r.name || '',
      jobNo: r.jobNo || '',
      status: 'DELETED',
      inXero: false,
      lastSeenInXero: r.lastSeenInXero || null,
    })
  }
  // Stable order by job number so the tail of the list does not shuffle between
  // rebuilds.
  return out.sort((a, b) => String(a.jobNo || '').localeCompare(String(b.jobNo || ''), undefined, { numeric: true }))
}

// Identity for a single project when Xero has no such option. Used by the project
// page, which used to 404 outright.
export async function identityFromRegistry(redis, id) {
  const registry = await readRegistry(redis)
  const r = registry[String(id)]
  if (!r) return null
  return {
    trackingOptionId: String(id),
    trackingCategoryId: r.trackingCategoryId || '',
    name: r.name || '',
    jobNo: r.jobNo || '',
    status: 'DELETED',
    inXero: false,
    lastSeenInXero: r.lastSeenInXero || null,
  }
}
