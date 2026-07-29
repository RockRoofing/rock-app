import { get, set } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { canAccessArea } from '../../lib/roles'

// Commercial team weekly & monthly objectives. A simple Yes/No grid: objective x month.
// Store: commercial:objectives = { weekly: { "<objId>|<YYYY-MM>": {v:'yes'|'no', by, at} },
//                                  monthly: { ... } }
//
// GET                         -> { data }
// POST { cadence, objId, month, value } -> set one cell (value 'yes'|'no'|'' to clear)

const KEY = 'commercial:objectives'

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}
function user(req) { return verifySessionToken(readCookie(req, SESSION_COOKIE)) }

export default async function handler(req, res) {
  const u = user(req)
  if (!u || !canAccessArea(u.role, 'commercial')) return res.status(403).json({ error: 'No access' })

  if (req.method === 'GET') {
    const data = (await get(KEY)) || { weekly: {}, monthly: {} }
    return res.json({ data })
  }

  if (req.method === 'POST') {
    const { cadence, objId, month, value } = req.body || {}
    if (!['weekly', 'monthly'].includes(cadence)) return res.status(400).json({ error: 'Bad cadence' })
    if (!objId || !/^\d{4}-\d{2}$/.test(month || '')) return res.status(400).json({ error: 'Bad objective/month' })
    const data = (await get(KEY)) || { weekly: {}, monthly: {} }
    if (!data[cadence]) data[cadence] = {}
    const cellKey = `${objId}|${month}`
    if (value === 'yes' || value === 'no') {
      data[cadence][cellKey] = { v: value, by: u.name || u.email || '', at: Date.now() }
    } else {
      delete data[cadence][cellKey]
    }
    await set(KEY, data)
    return res.json({ ok: true, data })
  }

  res.status(405).end()
}
