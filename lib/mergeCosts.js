// Combine all cost sources for a project into the single cache the dashboard
// reads (costs:latest:<id> / costs:lines:<id>). Sources are stored separately so
// uploading Bills doesn't wipe Wages and vice-versa:
//   costs:bills:<id>   — from the Bills bulk import
//   costs:wages:<id>   — from the Direct Wages bulk import
//   costs:manual:<id>  — from the legacy per-project Account Transactions upload
// Each source stores { labourSpend, materialsSpend, totalCosts, lines:[...] }.

const SOURCES = ['bills', 'wages', 'manual']

export async function mergeCosts(redis, id) {
  let labour = 0, materials = 0, total = 0
  let lines = []
  for (const s of SOURCES) {
    const rec = await redis.get(`costs:${s}:${id}`).catch(() => null)
    if (!rec) continue
    labour += rec.labourSpend || 0
    materials += rec.materialsSpend || 0
    total += rec.totalCosts || ((rec.labourSpend || 0) + (rec.materialsSpend || 0))
    if (Array.isArray(rec.lines)) lines = lines.concat(rec.lines)
  }
  await redis.set(`costs:latest:${id}`, {
    labourSpend: labour, materialsSpend: materials, totalCosts: total,
    calculatedAt: new Date().toISOString(), source: 'merged',
  })
  await redis.set(`costs:lines:${id}`, lines)
  return { labour, materials, total, lineCount: lines.length }
}
