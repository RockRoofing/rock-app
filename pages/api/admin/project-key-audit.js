import withTenant from '../../../lib/withTenant'
import { getClient } from '../../../lib/db'
import { requireRole } from '../../../lib/portalAuth'

// WHICH PROJECTS ARE STORED UNDER TWO KEYS. READ ONLY. WRITES NOTHING.
//
// A project's settings record can be stored under its Xero TRACKING OPTION ID
// or under its JOB NUMBER. Both are written with saveProject(id, ...) and both
// end up at project:<id>, so nothing distinguishes them at the storage layer.
//
// The consequence, which is what sent me here:
//
//   getAllProjectSettings()  scans EVERY project:* key and returns each record
//                            under whatever key it happens to be stored at. So
//                            the applications summary finds everything.
//
//   getProject(id)           reads ONE exact key. So the per-project view finds
//                            only the record stored under the id the page asked
//                            for.
//
// An application written to one key is therefore visible in the summary table
// and invisible when you open the project. Nothing errors. The record is not
// lost - it is under the other key.
//
// This has caused at least four separate faults across this project. It has been
// on the open-items list as "a script listing every project holding settings
// under BOTH keys - worth enumerating once". This is that script.
//
// GET /api/admin/project-key-audit
//   ?full=1   include every record, not only the duplicated ones

const JOBNO = /^(J\d+|RR\d+)$/i

async function handler(req, res) {
  if (!requireRole(req, res, ['admin', 'management'])) return
  const redis = await getClient()

  // NAME THE RECORDS.
  //
  // A project settings record stores no job number and no name, so the first
  // version of this listed 36 uuids and told you nothing about which project
  // each one was. The dashboard snapshot holds the mapping from tracking option
  // id to job number, so it is read here purely to label them.
  //
  // It also answers the more useful question: is this key still a LIVE Xero
  // tracking option at all? A settings record whose key is not in the live list
  // cannot be selected anywhere in the portal - the project picker is built from
  // the live list - while still being counted by anything that scans every
  // project:* key. That is exactly the shape of "it shows in the table but I
  // cannot open it".
  let live = new Map()
  try {
    const snap = await redis.get('dashboard:cache')
    const rows = Array.isArray(snap) ? snap : (snap && Array.isArray(snap.projects) ? snap.projects : [])
    for (const r of rows) {
      if (r && r.xeroId) live.set(String(r.xeroId), { jobNo: r.jobNo || '', name: r.name || '', status: r.status || '', inXero: r.inXero !== false })
    }
  } catch {}

  const keys = await redis.keys('project:*')
  const records = []
  for (const k of keys) {
    const id = k.replace(/^project:/, '')
    let v = null
    try { v = await redis.get(k) } catch {}
    if (!v || typeof v !== 'object') { records.push({ key: k, id, unreadable: true }); continue }
    const l = live.get(String(id)) || null
    records.push({
      key: k,
      id,
      keyLooksLike: JOBNO.test(id) ? 'job number' : 'tracking option id',
      // From the dashboard snapshot, not from the record.
      liveJobNo: l ? l.jobNo : '',
      liveName: l ? l.name : '',
      liveStatus: l ? l.status : '',
      // TRUE means nothing in the portal can select this project, because every
      // picker is built from the live list.
      orphan: !l,
      // The job number the record CLAIMS, which is how the two halves of a pair
      // are matched. A record keyed by tracking id usually still carries it.
      jobNo: v.jobNo || v.projectNo || (JOBNO.test(id) ? id.toUpperCase() : ''),
      projectName: v.projectName || v.name || '',
      applications: Array.isArray(v.applications) ? v.applications.length : 0,
      applicationsSent: Array.isArray(v.applications)
        ? v.applications.filter(a => a && a.status && a.status !== 'draft').length : 0,
      variations: Array.isArray(v.variations) ? v.variations.length : 0,
      hasContractedRates: !!(v.contractedRates && Object.keys(v.contractedRates).length),
      contractValue: v.contractValue ?? null,
      fields: Object.keys(v).length,
    })
  }

  // Pair them up by the job number each record claims.
  const byJob = {}
  for (const r of records) {
    const j = String(r.jobNo || '').toUpperCase()
    if (!j) continue
    ;(byJob[j] = byJob[j] || []).push(r)
  }

  const duplicated = []
  for (const [job, rows] of Object.entries(byJob)) {
    if (rows.length < 2) continue
    // What each side holds that the other does not - the part that decides which
    // record a page is actually reading.
    duplicated.push({
      jobNo: job,
      records: rows.map(r => ({
        key: r.key,
        keyLooksLike: r.keyLooksLike,
        applications: r.applications,
        applicationsSent: r.applicationsSent,
        variations: r.variations,
        hasContractedRates: r.hasContractedRates,
        fields: r.fields,
      })),
      // A split is worse than a duplicate: it means each key holds something the
      // other does not, so neither record is the whole project.
      split: {
        applications: rows.filter(r => r.applications > 0).length > 1
          || (rows.some(r => r.applications > 0) && rows.some(r => r.applications === 0)),
        variations: rows.filter(r => r.variations > 0).length > 1
          || (rows.some(r => r.variations > 0) && rows.some(r => r.variations === 0)),
      },
    })
  }

  // The ones that cannot be opened, holding something worth opening.
  const orphansWithContent = records.filter(r => r.orphan && ((r.applications || 0) > 0 || (r.variations || 0) > 0))

  const out = {
    totalProjectRecords: records.length,
    liveProjectsInSnapshot: live.size,
    orphanRecords: records.filter(r => r.orphan).length,
    orphansHoldingApplicationsOrVariations: orphansWithContent.map(r => ({
      key: r.key, applications: r.applications, applicationsSent: r.applicationsSent,
      variations: r.variations, fields: r.fields, contractValue: r.contractValue,
    })),
    jobNumbersWithMoreThanOneRecord: duplicated.length,
    duplicated: duplicated.sort((a, b) => a.jobNo.localeCompare(b.jobNo)),
    note: 'Read only. Nothing has been changed. A record is not lost - it is under the other key.',
  }
  if (req.query.full === '1') out.allRecords = records.sort((a, b) => String(a.jobNo).localeCompare(String(b.jobNo)))

  return res.json(out)
}

export default withTenant(handler)
