import { get } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { hasRole } from '../../lib/roles'
import { getNotifications, saveNotifications, sendNotification, TASK_SETS } from '../../lib/notifications'

// Admin-only management of email notifications.
// GET                          -> { notifications, users, taskSets }
// POST { action:'save', notification }
// POST { action:'delete', id }
// POST { action:'test', id, testTo }   -> sends the email to testTo (or the rule's recipients)

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}
function user(req) { return verifySessionToken(readCookie(req, SESSION_COOKIE)) }

export default async function handler(req, res) {
  const u = user(req)
  if (!u || !hasRole(u.role, ['admin'])) return res.status(403).json({ error: 'Admin only' })

  if (req.method === 'GET') {
    const [notifications, portal] = await Promise.all([getNotifications(), get('portal:users').then(v => v || [])])
    const users = portal.filter(p => p.active !== false && p.email).map(p => ({ id: p.id, name: p.name || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email, email: p.email }))
    const taskSets = Object.fromEntries(Object.entries(TASK_SETS).map(([k, v]) => [k, { label: v.label, weekAnchor: v.weekAnchor }]))
    return res.json({ notifications, users, taskSets })
  }

  if (req.method === 'POST') {
    const { action } = req.body || {}
    const list = await getNotifications()

    if (action === 'save') {
      const n = req.body.notification || {}
      if (!n.name || !TASK_SETS[n.func] || !['weekly', 'monthly'].includes(n.cadence)) return res.status(400).json({ error: 'Name, function and cadence are required' })
      const clean = {
        id: n.id || `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: String(n.name).trim(),
        enabled: n.enabled !== false,
        func: n.func, cadence: n.cadence,
        trigger: n.trigger === 'incomplete' ? 'incomplete' : 'reminder',
        dueDay: n.dueDay != null ? (parseInt(n.dueDay, 10) || 0) : null,
        dueDom: n.dueDom != null ? (parseInt(n.dueDom, 10) || 15) : null,
        offsetDays: Math.max(0, parseInt(n.offsetDays, 10) || 0),
        recipientUserIds: Array.isArray(n.recipientUserIds) ? n.recipientUserIds : [],
        recipientEmails: Array.isArray(n.recipientEmails) ? n.recipientEmails.filter(e => /\S+@\S+/.test(e)) : [],
        subject: String(n.subject || '').trim(),
        body: String(n.body || '').trim(),
      }
      const idx = list.findIndex(x => x.id === clean.id)
      if (idx >= 0) list[idx] = clean; else list.push(clean)
      await saveNotifications(list)
      return res.json({ ok: true, notifications: list })
    }

    if (action === 'delete') {
      const next = list.filter(x => x.id !== req.body.id)
      await saveNotifications(next)
      return res.json({ ok: true, notifications: next })
    }

    if (action === 'test') {
      const n = list.find(x => x.id === req.body.id)
      if (!n) return res.status(404).json({ error: 'Not found' })
      const testTo = req.body.testTo && /\S+@\S+/.test(req.body.testTo) ? String(req.body.testTo).trim() : null
      const result = await sendNotification({ ...n, _testTo: testTo }, { test: !!testTo })
      return res.json({ ok: result.ok, ...result })
    }

    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(405).end()
}
