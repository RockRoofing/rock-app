import { get, set, getOpsProjects } from '../../lib/db'
import { put } from '@vercel/blob'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { getExternalUsers, externalCanAccessProject } from '../../lib/designUsers'
import { canAccessArea } from '../../lib/roles'
import { buildOMManual } from '../../lib/omsPdf'

// Build / retrieve the combined O&M Manual for a project.
//   GET  ?no=<projectNo>            -> { manual: { url, builtAt, builtBy, sections } | null, canEdit }
//   POST { projectNo, action:'build' } -> builds, stores, returns { manual }
const OKEY = (no) => `design:oms-manual:${no}`
const APP_URL = process.env.APP_URL || 'https://app.rockroofing.co.uk'
const LOGO_URL = `${APP_URL}/rock-logo.jpg`

const ROCK = {
  name: 'Rock Roofing Ltd',
  address: '', // filled from env if available; left blank otherwise
  phone: '',
  email: '',
  web: 'www.rockroofing.co.uk',
}

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}

async function resolveAccess(req, projectNo) {
  const u = verifySessionToken(readCookie(req, SESSION_COOKIE))
  if (!u) return { ok: false, code: 401 }
  if (u.role === 'external') {
    const ext = (await getExternalUsers()).find(x => x.id === u.id && x.active !== false)
    if (!ext || !externalCanAccessProject(ext, projectNo)) return { ok: false, code: 403 }
    return { ok: true, user: u, canEdit: false }   // customers can view/download, not build
  }
  if (!canAccessArea(u.role, 'design')) return { ok: false, code: 403 }
  return { ok: true, user: u, canEdit: true }
}

function currentNonSuperseded(arr) {
  // Keep only the current revision per family (non-superseded); fall back to any if a
  // family is all-superseded. Works for the drawings/calcs/techsub shape.
  const list = Array.isArray(arr) ? arr : []
  const byFam = {}
  for (const d of list) {
    const fam = d.familyId || d.id
    if (!byFam[fam]) byFam[fam] = { current: null, any: null }
    byFam[fam].any = byFam[fam].any || d
    if (!d.superseded) byFam[fam].current = d
  }
  return Object.values(byFam).map(f => f.current || f.any).filter(Boolean)
}

async function gatherSections(no) {
  const [techsubs, drawings, calcs, leaks, warranties] = await Promise.all([
    get(`design:techsubs:${no}`), get(`design:rock-drawings:${no}`), get(`design:calculations:${no}`),
    get(`design:leak-test-certs:${no}`), get(`design:warranties:${no}`),
  ])
  const tsFiles = currentNonSuperseded(techsubs).map(d => ({ name: d.name, url: d.url, contentType: d.contentType }))
  // Rock Roofing CONSTRUCTION ISSUE drawings only.
  const dwgFiles = currentNonSuperseded(drawings).filter(d => d.constructionIssue).map(d => ({ name: d.name, url: d.url, contentType: d.contentType }))
  const calcFiles = currentNonSuperseded(calcs).map(d => ({ name: d.name, url: d.url, contentType: d.contentType }))
  const leakFiles = ((leaks && leaks.files) || []).map(f => ({ name: f.name, url: f.url, contentType: f.contentType }))
  const warrFiles = ((warranties && warranties.files) || []).map(f => ({ name: f.name, url: f.url, contentType: f.contentType }))

  const all = [
    { title: 'Technical Submittal', files: tsFiles },
    { title: 'Rock Roofing Construction Issue Drawings', files: dwgFiles },
    { title: 'Calculations', files: calcFiles },
    { title: 'Leak Test Certificates', files: leakFiles },
    { title: 'Warranties', files: warrFiles },
  ]
  // Only include sections that actually have documents.
  return all.filter(s => s.files.length > 0)
}

async function projectMeta(no) {
  const ops = (await getOpsProjects()) || []
  const p = ops.find(x => String(x.projectNo) === String(no))
  const d = (p && p.data) || {}
  return {
    projectName: d.projectName || no,
    projectNo: no,
    projectAddress: d.projectAddress || d.siteLocation || '',
    mainContractor: { company: d.customerCompany || '', address: d.customerAddress || '' },
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const no = String(req.query.no || '').trim()
    if (!no) return res.status(400).json({ error: 'Missing project' })
    const acc = await resolveAccess(req, no)
    if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })
    const manual = (await get(OKEY(no))) || null
    // Report what WOULD be included, so the page can show a summary/enable the button.
    const sections = await gatherSections(no)
    return res.json({ manual, canEdit: acc.canEdit, available: sections.map(s => ({ title: s.title, count: s.files.length })) })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = req.body || {}
  const no = String(body.projectNo || '').trim()
  if (!no) return res.status(400).json({ error: 'Missing project' })
  const acc = await resolveAccess(req, no)
  if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })
  if (!acc.canEdit) return res.status(403).json({ error: 'Only Rock Roofing can build the O&M manual.' })

  if (body.action === 'build') {
    const sections = await gatherSections(no)
    if (!sections.length) return res.status(400).json({ error: 'Nothing to include yet - add Tech Subs, Construction Issue drawings, Calculations, Leak Test Certs or Warranties first.' })
    const meta = await projectMeta(no)
    let bytes
    try {
      bytes = await buildOMManual({
        project: { projectName: meta.projectName, projectNo: meta.projectNo, projectAddress: meta.projectAddress },
        sections, logoUrl: LOGO_URL, rockRoofing: ROCK, mainContractor: meta.mainContractor,
      })
    } catch (e) {
      return res.status(500).json({ error: 'Could not build the manual: ' + (e.message || 'error') })
    }
    let url = ''
    try {
      const safe = `${no}-OM-Manual-${Date.now()}.pdf`
      const blob = await put(`oms/${safe}`, Buffer.from(bytes), { access: 'public', contentType: 'application/pdf', addRandomSuffix: true })
      url = blob.url
    } catch (e) {
      return res.status(500).json({ error: 'Built the manual but could not store it: ' + (e.message || 'error') })
    }
    const manual = {
      url, builtAt: Date.now(), builtBy: acc.user.name || 'User',
      sections: sections.map(s => ({ title: s.title, count: s.files.length })),
      projectName: meta.projectName, projectNo: no,
    }
    await set(OKEY(no), manual)
    return res.json({ ok: true, manual })
  }

  return res.status(400).json({ error: 'Unknown action' })
}
