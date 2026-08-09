import { get, set, getOpsProjects } from '../../lib/db'
import { put } from '@vercel/blob'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { getExternalUsers, externalCanAccessProject } from '../../lib/designUsers'
import { canAccessArea } from '../../lib/roles'
import { buildOMManual } from '../../lib/omsPdf'
import { sendOmReadyNotice } from '../../lib/designEmail'

// Build / retrieve the combined O&M Manual for a project.
//   GET  ?no=<projectNo>            -> { manual, revisions, canEdit, available, readiness }
//   POST { projectNo, action:'build' } -> builds a NEW revision, returns { manual, revisions }
// Store: design:oms-manual:<no> = { current: <manual>, revisions: [<manual>, ...newest first] }
// Each manual: { url, builtAt, builtBy, sections, projectName, projectNo, revision }
const OKEY = (no) => `design:oms-manual:${no}`
const APP_URL = process.env.APP_URL || 'https://app.rockroofing.co.uk'
const LOGO_URL = `${APP_URL}/rock-logo.jpg`

const ROCK = {
  name: 'Rock Roofing Ltd',
  address: '483 Green Lanes, London, N13 4BS',
  phone: '0330 165 8924',
  email: 'info@rockroofing.co.uk',
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
  const curDrawings = currentNonSuperseded(drawings)
  const curCalcs = currentNonSuperseded(calcs)
  const curTechSubs = currentNonSuperseded(techsubs)
  // Each Tech Sub becomes its OWN section (Tech Sub 1, Tech Sub 2, ...) with its own
  // separator sheet and its own line in the contents.
  const techSubSections = curTechSubs.map((d, i) => ({
    title: `Tech Sub ${i + 1}${d.title ? ` - ${d.title}` : ''}`,
    files: [{ name: d.name, url: d.url, contentType: d.contentType }],
  }))
  // Rock Drawings AND Calculations: only items marked CONSTRUCTION ISSUE are included.
  const dwgFiles = curDrawings.filter(d => d.constructionIssue).map(d => ({ name: d.name, url: d.url, contentType: d.contentType }))
  const calcFiles = curCalcs.filter(d => d.constructionIssue).map(d => ({ name: d.name, url: d.url, contentType: d.contentType }))
  const leakFiles = ((leaks && leaks.files) || []).map(f => ({ name: f.name, url: f.url, contentType: f.contentType }))
  const warrFiles = ((warranties && warranties.files) || []).map(f => ({ name: f.name, url: f.url, contentType: f.contentType }))

  const all = [
    ...techSubSections,
    { title: 'Rock Roofing Construction Issue Drawings', files: dwgFiles },
    { title: 'Calculations', files: calcFiles },
    { title: 'Leak Test Certificates', files: leakFiles },
    { title: 'Warranties', files: warrFiles },
  ]

  // Readiness: what's missing, and what's current-but-not-yet-Construction-Issue (so would
  // be left out). These drive the "check with your Design Manager" warning.
  const notCiDrawings = curDrawings.filter(d => !d.constructionIssue).length
  const notCiCalcs = curCalcs.filter(d => !d.constructionIssue).length
  const missing = all.filter(s => s.files.length === 0).map(s => s.title)
  if (curTechSubs.length === 0) missing.unshift('Technical Submittal')
  const warnings = []
  if (notCiDrawings > 0) warnings.push(`${notCiDrawings} drawing${notCiDrawings === 1 ? '' : 's'} not yet marked Construction Issue (will be left out)`)
  if (notCiCalcs > 0) warnings.push(`${notCiCalcs} calculation${notCiCalcs === 1 ? '' : 's'} not yet marked Construction Issue (will be left out)`)

  const sections = all.filter(s => s.files.length > 0)
  return { sections, readiness: { missing, warnings, notCiDrawings, notCiCalcs, ready: missing.length === 0 && warnings.length === 0 } }
}

async function customersFor(no) {
  const ext = (await getExternalUsers()) || []
  return ext.filter(e => e.active !== false && externalCanAccessProject(e, no))
    .map(e => ({ id: e.id, name: e.name || [e.firstName, e.lastName].filter(Boolean).join(' '), email: e.email || '', company: e.company || 'Customer' }))
    .filter(c => c.email)
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

async function readStore(no) {
  const raw = await get(OKEY(no))
  if (!raw) return { current: null, revisions: [] }
  // Migrate the old single-manual shape to the new revisions shape.
  if (raw.url && !raw.revisions) {
    const m = { ...raw, revision: raw.revision || 1 }
    return { current: m, revisions: [m] }
  }
  return { current: raw.current || null, revisions: raw.revisions || [] }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const no = String(req.query.no || '').trim()
    if (!no) return res.status(400).json({ error: 'Missing project' })
    const acc = await resolveAccess(req, no)
    if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })
    const store = await readStore(no)
    // Report what WOULD be included + readiness, so the page can warn and enable the button.
    const { sections, readiness } = await gatherSections(no)
    const customers = acc.canEdit ? await customersFor(no) : []
    return res.json({ manual: store.current, revisions: store.revisions, canEdit: acc.canEdit, available: sections.map(s => ({ title: s.title, count: s.files.length })), readiness, customers })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = req.body || {}
  const no = String(body.projectNo || '').trim()
  if (!no) return res.status(400).json({ error: 'Missing project' })
  const acc = await resolveAccess(req, no)
  if (!acc.ok) return res.status(acc.code).json({ error: acc.code === 401 ? 'Not logged in' : 'No access' })
  if (!acc.canEdit) return res.status(403).json({ error: 'Only Rock Roofing can build the O&M manual.' })

  if (body.action === 'build') {
    const { sections } = await gatherSections(no)
    if (!sections.length) return res.status(400).json({ error: 'Nothing to include yet - add Tech Subs, Construction Issue drawings, Calculations, Leak Test Certs or Warranties first.' })
    const store = await readStore(no)
    const nextRev = (store.revisions.reduce((m, r) => Math.max(m, r.revision || 0), 0) || 0) + 1
    const meta = await projectMeta(no)
    let bytes
    try {
      bytes = await buildOMManual({
        project: { projectName: meta.projectName, projectNo: meta.projectNo, projectAddress: meta.projectAddress },
        sections, logoUrl: LOGO_URL, rockRoofing: ROCK, mainContractor: meta.mainContractor, revision: nextRev,
      })
    } catch (e) {
      return res.status(500).json({ error: 'Could not build the manual: ' + (e.message || 'error') })
    }
    let url = ''
    try {
      const safe = `${no}-OM-Manual-Rev${nextRev}-${Date.now()}.pdf`
      const blob = await put(`oms/${safe}`, Buffer.from(bytes), { access: 'public', contentType: 'application/pdf', addRandomSuffix: true })
      url = blob.url
    } catch (e) {
      return res.status(500).json({ error: 'Built the manual but could not store it: ' + (e.message || 'error') })
    }
    const manual = {
      url, builtAt: Date.now(), builtBy: acc.user.name || 'User',
      sections: sections.map(s => ({ title: s.title, count: s.files.length })),
      projectName: meta.projectName, projectNo: no, revision: nextRev,
    }
    const revisions = [manual, ...store.revisions]   // newest first; older revisions kept
    await set(OKEY(no), { current: manual, revisions })
    return res.json({ ok: true, manual, revisions })
  }

  if (body.action === 'notify') {
    const store = await readStore(no)
    if (!store.current) return res.status(400).json({ error: 'Build the O&M Manual before notifying customers.' })
    const ids = Array.isArray(body.recipientIds) ? body.recipientIds : []
    if (!ids.length) return res.status(400).json({ error: 'Pick at least one customer to notify.' })
    const customers = await customersFor(no)
    const chosen = customers.filter(c => ids.includes(c.id))
    if (!chosen.length) return res.status(400).json({ error: 'No valid recipients.' })
    const meta = await projectMeta(no)
    const omLink = `${APP_URL}/design/${encodeURIComponent(no)}/oms`
    let sent = 0
    const failed = []
    for (const c of chosen) {
      const r = await sendOmReadyNotice({ to: c.email, recipientName: c.name, projectNo: no, projectName: meta.projectName, omLink, senderName: acc.user.name || '' })
      if (r.sent) sent++; else failed.push(c.name)
    }
    return res.json({ ok: true, sent, failed })
  }

  return res.status(400).json({ error: 'Unknown action' })
}
