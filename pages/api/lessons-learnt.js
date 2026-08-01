import { get, set, getLiveTasks, saveLiveTasks, getPortalUsers } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { canAccessArea, hasRole } from '../../lib/roles'
import { SEED_MINUTES } from '../../lib/lessonsSeed'

// Monthly Lessons Learnt: minutes + a manually-categorised lessons table.
// Lessons are entered as structured rows on each meeting (item + detail + departments);
// on "Meeting complete" they populate the table. No AI categorisation - the team picks
// the departments themselves.
//
// Stores:
//   ll:minutes  = [ { id, year, month, title, meetingDate, status, sections:{wins,kpi,upcoming,focus},
//                     lessonRows:[{id,item,detail,depts:[]}], actions:[{id,action,person,personName,pushed}] } ]
//   ll:lessons  = [ { id, source, monthLabel, year, month, item, detail, depts:[...] } ]
//   ll:seeded   = true
//
// GET  ?view=minutes | ?view=lessons | ?view=all
// POST { action:'save-minutes', minutes }         (draft autosave; upsert)
// POST { action:'complete', id }                  (lock + extract lessons into the table)
// POST { action:'add-lesson' | 'update-lesson' | 'delete-lesson', ... }
// POST { action:'categorise', text }              (AI department suggest for one lesson)

const MIN_KEY = 'll:minutes'
const LES_KEY = 'll:lessons'
const SEED_KEY = 'll:seeded'
const DEPTS = ['estimating', 'commercial', 'operations', 'accounting', 'sales']

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}
function sessionUser(req) { return verifySessionToken(readCookie(req, SESSION_COOKIE)) }

async function ensureSeed() {
  const seeded = await get(SEED_KEY)
  if (seeded) return
  const mins = await get(MIN_KEY)
  if (!mins || !mins.length) await set(MIN_KEY, SEED_MINUTES)
  // Lessons table starts EMPTY - it is populated only by completing future meetings.
  await set(SEED_KEY, true)
}


export default async function handler(req, res) {
  const u = sessionUser(req)
  if (!u || !canAccessArea(u.role, 'lessons-learnt')) return res.status(403).json({ error: 'No access' })
  await ensureSeed()

  if (req.method === 'GET') {
    const view = String(req.query.view || 'all')
    const out = {}
    if (view === 'minutes' || view === 'all') out.minutes = ((await get(MIN_KEY)) || []).sort(sortByDate)
    if (view === 'lessons' || view === 'all') out.lessons = ((await get(LES_KEY)) || []).sort((a, b) => sortByDate(b, a))
    out.depts = DEPTS
    // Portal users for the "person responsible" picker on meeting actions.
    const portal = (await getPortalUsers()) || []
    out.users = portal.filter(p => p.active !== false).map(p => ({ id: p.id, name: p.name || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email, email: p.email || '' }))
    out.isAdmin = hasRole(u.role, ['admin'])
    return res.json(out)
  }

  if (req.method === 'POST') {
    const body = req.body || {}

    if (body.action === 'save-minutes') {
      const m = body.minutes || {}
      if (!m.year || !m.month) return res.status(400).json({ error: 'year and month required' })
      const id = m.id || `${m.year}-${String(m.month).padStart(2, '0')}`
      const list = (await get(MIN_KEY)) || []
      const idx = list.findIndex(x => x.id === id)
      const existing = idx >= 0 ? list[idx] : null
      if (existing && existing.status === 'complete' && m.status !== 'complete' && !body.reopen) {
        return res.status(409).json({ error: 'Meeting already complete' })
      }
      const rec = {
        id, year: m.year, month: m.month,
        title: m.title || existing?.title || '',
        meetingDate: m.meetingDate ?? existing?.meetingDate ?? '',
        status: m.status || existing?.status || 'draft',
        sections: { ...(existing?.sections || {}), ...(m.sections || {}) },
        // NEW format: structured lesson rows (item + detail + depts). Old seeded
        // minutes keep their free-text sections.lessons for historical reference.
        lessonRows: Array.isArray(m.lessonRows) ? m.lessonRows : (existing?.lessonRows || []),
        actions: Array.isArray(m.actions) ? m.actions : (existing?.actions || []),
      }
      if (idx >= 0) list[idx] = rec; else list.push(rec)
      await set(MIN_KEY, list)
      return res.json({ ok: true, minutes: rec })
    }

    if (body.action === 'complete') {
      const list = (await get(MIN_KEY)) || []
      const idx = list.findIndex(x => x.id === body.id)
      if (idx < 0) return res.status(404).json({ error: 'Not found' })
      const rec = list[idx]
      rec.status = 'complete'
      list[idx] = rec
      await set(MIN_KEY, list)

      // Populate the lessons table from this meeting's structured lesson rows.
      // Departments are chosen by the team (no AI). Skip rows already present for this
      // meeting so completing twice doesn't duplicate.
      const MONTHNAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      const lessons = (await get(LES_KEY)) || []
      const existingRowIds = new Set(lessons.filter(l => l.source === rec.id).map(l => l.rowId).filter(Boolean))
      let added = 0
      for (const row of (rec.lessonRows || [])) {
        if (!row || (!row.item && !row.detail)) continue
        if (row.id && existingRowIds.has(row.id)) continue
        lessons.push({
          id: `les_${rec.id}_${row.id || Date.now()}_${added}`,
          rowId: row.id || '', source: rec.id,
          monthLabel: `${MONTHNAMES[rec.month]} ${rec.year}`, year: rec.year, month: rec.month,
          item: row.item || '', detail: row.detail || '',
          depts: Array.isArray(row.depts) ? row.depts.filter(d => DEPTS.includes(d)) : [],
        })
        added++
      }
      await set(LES_KEY, lessons)

      // Push MEETING ACTIONS into Operations live tasks - grouped under "Lessons Learnt".
      // Only NEW actions (pushed !== true) are sent.
      let pushed = 0
      if (Array.isArray(rec.actions) && rec.actions.length) {
        const liveTasks = await getLiveTasks()
        const existingIds = new Set(liveTasks.map(t => t.id))
        for (const a of rec.actions) {
          if (!a || !a.action || a.pushed === true) continue
          const taskId = `lltask_${rec.id}_${a.id || Math.random().toString(36).slice(2, 6)}`
          if (!existingIds.has(taskId)) {
            liveTasks.push({
              id: taskId, sourceLessons: rec.id, projectNo: '', projectName: 'Lessons Learnt',
              description: a.action, assignee: a.personName || a.person || '', assigneeId: a.person || '',
              closeOutDate: '', closed: false,
              comments: `From Lessons Learnt meeting: ${rec.title || rec.id}`,
              attachments: [], createdAt: Date.now(),
            })
          }
          a.pushed = true
          pushed++
        }
        await saveLiveTasks(liveTasks)
        list[idx] = rec
        await set(MIN_KEY, list)
      }
      return res.json({ ok: true, minutes: rec, lessonsAdded: added, actionsPushed: pushed })
    }

    // Manually add a lesson straight into the table.
    if (body.action === 'add-lesson') {
      const { item, detail, depts, source } = body
      if (!item && !detail) return res.status(400).json({ error: 'item or detail required' })
      const lessons = (await get(LES_KEY)) || []
      const row = { id: `les_manual_${Date.now()}`, rowId: '', source: source || 'manual', monthLabel: body.monthLabel || 'Manual', year: body.year || 0, month: body.month || 0, item: item || '', detail: detail || '', depts: Array.isArray(depts) ? depts.filter(d => DEPTS.includes(d)) : [] }
      lessons.push(row)
      await set(LES_KEY, lessons)
      return res.json({ ok: true, lesson: row })
    }
    if (body.action === 'update-lesson') {
      const lessons = (await get(LES_KEY)) || []
      const li = lessons.findIndex(l => l.id === body.id)
      if (li < 0) return res.status(404).json({ error: 'Not found' })
      if (body.item != null) lessons[li].item = body.item
      if (body.detail != null) lessons[li].detail = body.detail
      if (Array.isArray(body.depts)) lessons[li].depts = body.depts.filter(d => DEPTS.includes(d))
      await set(LES_KEY, lessons)
      return res.json({ ok: true, lesson: lessons[li] })
    }
    if (body.action === 'delete-lesson' || body.action === 'delete-lessons') {
      if (!hasRole(u.role, ['admin'])) return res.status(403).json({ error: 'Only admins can delete lessons' })
      const ids = new Set(body.action === 'delete-lessons' ? (Array.isArray(body.ids) ? body.ids : []) : [body.id])
      const lessons = ((await get(LES_KEY)) || []).filter(l => !ids.has(l.id))
      await set(LES_KEY, lessons)
      return res.json({ ok: true })
    }
    if (body.action === 'clear-lessons') {
      if (!hasRole(u.role, ['admin'])) return res.status(403).json({ error: 'Only admins can clear the table' })
      await set(LES_KEY, [])
      return res.json({ ok: true, cleared: true })
    }

    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(405).end()
}

function sortByDate(a, b) { return (b.year - a.year) || (b.month - a.month) }
