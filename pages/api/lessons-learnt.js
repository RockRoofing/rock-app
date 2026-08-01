import { get, set, getLiveTasks, saveLiveTasks, getPortalUsers } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { canAccessArea } from '../../lib/roles'
import { SEED_MINUTES, SEED_LESSONS } from '../../lib/lessonsSeed'

// Monthly Lessons Learnt: minutes + an AI-categorised lessons table.
// Stores:
//   ll:minutes  = [ { id, year, month, title, meetingDate, status:'draft'|'complete',
//                     sections:{wins,kpi,upcoming,focus,lessons}, actions:[{id,action,person,pushed}] } ]
//   ll:lessons  = [ { id, source, monthLabel, year, month, text, depts:[...] } ]
//   ll:seeded   = true (one-time seed guard)
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
  const [mins, less] = await Promise.all([get(MIN_KEY), get(LES_KEY)])
  if (!mins || !mins.length) await set(MIN_KEY, SEED_MINUTES)
  if (!less || !less.length) await set(LES_KEY, SEED_LESSONS)
  await set(SEED_KEY, true)
}

// Rule-based fallback categoriser (used if the AI call is unavailable).
const KW = {
  estimating: ['tender', 'estimat', 'pric', 'quote', 'rate', 'costing', 'provisional sum', 'ibg', 'schedule', 'spec', 'xps', 'crane'],
  commercial: ['variation', 'application', 'payless', 'payment notic', 'retention', 'final account', 'substantiat', 'qs', 'commercial', 'instruction', 'verbal order', 'purchase order', 'margin', 'credit', 'downtime'],
  operations: ['site diar', 'handover', 'water ingress', 'quality', 'form', 'install', 'membrane', 'roof', 'felt', 'hot melt', 'fixing', 'leak', 'on site', 'onsite', 'delivery', 'deliveries', 'plant', 'labour planning', 'subbie', 'subcontractor', 'h&s', 'health and safety', 'near miss', 'programme', 'fonn', 'insulation', 'upstand', 'deck', 'mansafe'],
  accounting: ['invoic', 'bookkeep', 'xero', 'payroll', 'credit control', 'cashflow', 'cash flow', 'vat', 'timesheet', 'billing', 'overpay'],
  sales: ['sales', 'enquir', 'inquir', 'website', 'customer feedback', 'new customer', 'lead', 'end user', 'marketing'],
}
function ruleCategorise(text) {
  const t = (text || '').toLowerCase()
  const found = DEPTS.filter(d => KW[d].some(k => t.includes(k)))
  return found.length ? found : ['operations']
}

// AI categoriser via the Anthropic API (best-effort; falls back to rules).
async function aiCategorise(text) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return ruleCategorise(text)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 60,
        messages: [{ role: 'user', content: `Categorise this construction-company lesson-learnt note into one or more departments from this exact list: estimating, commercial, operations, accounting, sales. Reply ONLY with a JSON array of the matching lowercase department strings, nothing else.\n\nNote: "${text}"` }],
      }),
    })
    const d = await r.json()
    const txt = (d.content || []).map(b => b.text || '').join('').trim().replace(/```json|```/g, '')
    const arr = JSON.parse(txt)
    const clean = (Array.isArray(arr) ? arr : []).map(s => String(s).toLowerCase()).filter(s => DEPTS.includes(s))
    return clean.length ? [...new Set(clean)] : ruleCategorise(text)
  } catch { return ruleCategorise(text) }
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
      // Don't allow silent overwrite of a completed meeting via draft-save.
      if (existing && existing.status === 'complete' && m.status !== 'complete' && !body.reopen) {
        return res.status(409).json({ error: 'Meeting already complete' })
      }
      const rec = {
        id, year: m.year, month: m.month,
        title: m.title || existing?.title || '',
        meetingDate: m.meetingDate ?? existing?.meetingDate ?? '',
        status: m.status || existing?.status || 'draft',
        sections: { ...(existing?.sections || {}), ...(m.sections || {}) },
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

      // Extract each lesson line -> AI-categorised rows in the table (skip if this
      // meeting's lessons are already present, so completing twice doesn't duplicate).
      const lessons = (await get(LES_KEY)) || []
      const already = new Set(lessons.filter(l => l.source === rec.id).map(l => l.text.trim()))
      const lines = String(rec.sections?.lessons || '').split('\n').map(s => s.trim()).filter(Boolean)
      const MONTHNAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      let added = 0
      for (const line of lines) {
        if (already.has(line)) continue
        const depts = await aiCategorise(line)
        lessons.push({ id: `les_${rec.id}_${Date.now()}_${added}`, source: rec.id, monthLabel: `${MONTHNAMES[rec.month]} ${rec.year}`, year: rec.year, month: rec.month, text: line, depts })
        added++
      }
      await set(LES_KEY, lessons)

      // Push MEETING ACTIONS into the Operations live tasks list - grouped under
      // "Lessons Learnt" (not a real project). Only NEW actions (pushed !== true) are
      // sent, so seeded/historical actions are never pushed and re-completing won't
      // duplicate. Person responsible is carried as the assignee.
      let pushed = 0
      if (Array.isArray(rec.actions) && rec.actions.length) {
        const liveTasks = await getLiveTasks()
        const existingIds = new Set(liveTasks.map(t => t.id))
        for (const a of rec.actions) {
          if (!a || !a.action || a.pushed === true) continue
          const taskId = `lltask_${rec.id}_${a.id || Math.random().toString(36).slice(2, 6)}`
          if (!existingIds.has(taskId)) {
            liveTasks.push({
              id: taskId,
              sourceLessons: rec.id,
              projectNo: '',
              projectName: 'Lessons Learnt',
              description: a.action,
              assignee: a.personName || a.person || '',
              assigneeId: a.person || '',
              closeOutDate: '',
              closed: false,
              comments: `From Lessons Learnt meeting: ${rec.title || rec.id}`,
              attachments: [],
              createdAt: Date.now(),
            })
          }
          a.pushed = true
          pushed++
        }
        await saveLiveTasks(liveTasks)
        // persist the pushed flags back onto the meeting
        list[idx] = rec
        await set(MIN_KEY, list)
      }
      return res.json({ ok: true, minutes: rec, lessonsAdded: added, actionsPushed: pushed })
    }

    if (body.action === 'add-lesson') {
      const { text, depts, source } = body
      if (!text) return res.status(400).json({ error: 'text required' })
      const lessons = (await get(LES_KEY)) || []
      const dd = Array.isArray(depts) && depts.length ? depts.filter(d => DEPTS.includes(d)) : await aiCategorise(text)
      const row = { id: `les_manual_${Date.now()}`, source: source || 'manual', monthLabel: body.monthLabel || 'Manual', year: body.year || 0, month: body.month || 0, text, depts: dd }
      lessons.push(row)
      await set(LES_KEY, lessons)
      return res.json({ ok: true, lesson: row })
    }
    if (body.action === 'update-lesson') {
      const lessons = (await get(LES_KEY)) || []
      const idx = lessons.findIndex(l => l.id === body.id)
      if (idx < 0) return res.status(404).json({ error: 'Not found' })
      if (body.text != null) lessons[idx].text = body.text
      if (Array.isArray(body.depts)) lessons[idx].depts = body.depts.filter(d => DEPTS.includes(d))
      await set(LES_KEY, lessons)
      return res.json({ ok: true, lesson: lessons[idx] })
    }
    if (body.action === 'delete-lesson') {
      const lessons = ((await get(LES_KEY)) || []).filter(l => l.id !== body.id)
      await set(LES_KEY, lessons)
      return res.json({ ok: true })
    }
    if (body.action === 'categorise') {
      const depts = await aiCategorise(body.text || '')
      return res.json({ ok: true, depts })
    }

    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(405).end()
}

function sortByDate(a, b) { return (b.year - a.year) || (b.month - a.month) }
