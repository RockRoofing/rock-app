import { get, set, getOpsProjects, getPortalUsers } from '../../lib/db'
import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { buildCardsForProject, buildCardsForProjectAsync, getProcessTemplate, saveProcessTemplate } from '../../lib/projectProcessTemplate'

// Project Process Kanban board.
// Stores:
//   ops:project-process        = { columns: [ { projectNo, name, customer, cards:[...] } ] }
//   ops:project-process-seen   = [projectNo, ...]   baseline of projects known at init +
//                                 every project ever auto-considered, so we only auto-add
//                                 projects that appear AFTER the board is first set up.
const BOARD_KEY = 'ops:project-process'
const SEEN_KEY = 'ops:project-process-seen'
const FROM = process.env.NOTIFY_FROM_EMAIL || process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
const APP_URL = process.env.PORTAL_URL || 'https://app.rockroofing.co.uk'

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  for (const part of raw.split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')) }
  return null
}
function sessionUser(req) { return verifySessionToken(readCookie(req, SESSION_COOKIE)) }

async function getBoard() { return (await get(BOARD_KEY)) || { columns: [] } }
async function saveBoard(b) { await set(BOARD_KEY, b) }

// Current live Ops projects (active/draft), as { projectNo, name, customer }.
async function liveProjects() {
  const ops = await getOpsProjects()
  return (ops || [])
    .filter(p => { const s = p.status || 'active'; return s === 'active' || s === 'draft' })
    .map(p => ({ projectNo: p.projectNo, name: p.data?.projectName || p.projectNo, customer: p.data?.customerCompany || '' }))
}

// Auto-add projects that appeared AFTER the board was first initialised. The first time
// this runs it records every current project as the baseline (so existing projects are
// NOT dumped in). Any project not in the baseline and not yet on the board is auto-added.
async function autoSync(board) {
  const live = await liveProjects()
  let seen = await get(SEEN_KEY)
  if (!seen) {
    // First init: baseline = everything that exists right now (do not add them).
    seen = live.map(p => p.projectNo)
    await set(SEEN_KEY, seen)
    return board
  }
  const seenSet = new Set(seen)
  const onBoard = new Set(board.columns.map(c => c.projectNo))
  let changed = false
  for (const p of live) {
    if (seenSet.has(p.projectNo)) continue      // already baselined / considered
    // New project - add it and mark seen.
    board.columns.push({ projectNo: p.projectNo, name: p.name, customer: p.customer, cards: await buildCardsForProjectAsync(get) })
    seen.push(p.projectNo)
    seenSet.add(p.projectNo)
    onBoard.add(p.projectNo)
    changed = true
  }
  if (changed) { await set(SEEN_KEY, seen); await saveBoard(board) }
  return board
}

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, reason: 'no api key' }
  if (!to) return { ok: false, reason: 'no recipient' }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    })
    if (!r.ok) return { ok: false, reason: `resend ${r.status}` }
    return { ok: true }
  } catch (e) { return { ok: false, reason: e.message } }
}

export default async function handler(req, res) {
  const u = sessionUser(req)
  if (!u) return res.status(401).json({ error: 'Not authenticated' })

  if (req.method === 'GET') {
    if (req.query.template) {
      const template = await getProcessTemplate(get)
      return res.json({ template })
    }
    let board = await getBoard()
    board = await autoSync(board)
    const portal = await getPortalUsers()
    const users = portal.filter(p => p.active !== false).map(p => ({
      id: p.id, name: p.name || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email, email: p.email || '',
    }))
    // Projects that could be added manually (live projects not already on the board).
    const onBoard = new Set(board.columns.map(c => c.projectNo))
    const addable = (await liveProjects()).filter(p => !onBoard.has(p.projectNo))
    return res.json({ board, users, addable })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = req.body || {}
  const board = await getBoard()
  const col = (projectNo) => board.columns.find(c => c.projectNo === projectNo)
  const card = (projectNo, cardId) => { const c = col(projectNo); return c ? c.cards.find(x => x.id === cardId) : null }

  try {
    if (body.action === 'add-project') {
      // Add an existing project by projectNo (from the dropdown).
      const p = (await liveProjects()).find(x => x.projectNo === body.projectNo)
      if (!p) return res.status(404).json({ error: 'Project not found' })
      if (col(p.projectNo)) return res.json({ ok: true, board }) // already there
      board.columns.push({ projectNo: p.projectNo, name: p.name, customer: p.customer, cards: await buildCardsForProjectAsync(get) })
      // Mark as seen so it isn't considered "new" later.
      const seen = (await get(SEEN_KEY)) || []
      if (!seen.includes(p.projectNo)) { seen.push(p.projectNo); await set(SEEN_KEY, seen) }
      await saveBoard(board)
      return res.json({ ok: true, board })
    }

    if (body.action === 'remove-project') {
      board.columns = board.columns.filter(c => c.projectNo !== body.projectNo)
      await saveBoard(board)
      return res.json({ ok: true })
    }

    if (body.action === 'set-card-meta') {
      const c = card(body.projectNo, body.cardId)
      if (!c) return res.status(404).json({ error: 'Card not found' })
      if (body.dueDate != null) c.dueDate = body.dueDate
      if (body.assignee != null) {
        c.assignee = body.assignee
        const portal = await getPortalUsers()
        const pu = portal.find(p => p.id === body.assignee)
        c.assigneeName = pu ? (pu.name || [pu.firstName, pu.lastName].filter(Boolean).join(' ') || pu.email) : ''
      }
      if (body.notes != null) c.notes = body.notes
      await saveBoard(board)
      return res.json({ ok: true })
    }

    if (body.action === 'toggle-item') {
      const c = card(body.projectNo, body.cardId)
      const it = c && c.items.find(x => x.id === body.itemId)
      if (!it) return res.status(404).json({ error: 'Item not found' })
      it.done = !it.done
      await saveBoard(board)
      return res.json({ ok: true })
    }

    if (body.action === 'add-item') {
      const c = card(body.projectNo, body.cardId)
      if (!c) return res.status(404).json({ error: 'Card not found' })
      const text = String(body.text || '').trim()
      if (!text) return res.status(400).json({ error: 'Text required' })
      c.items.push({ id: `it_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text, done: false })
      await saveBoard(board)
      return res.json({ ok: true })
    }

    if (body.action === 'edit-item') {
      const c = card(body.projectNo, body.cardId)
      const it = c && c.items.find(x => x.id === body.itemId)
      if (!it) return res.status(404).json({ error: 'Item not found' })
      it.text = String(body.text || '').trim()
      await saveBoard(board)
      return res.json({ ok: true })
    }

    if (body.action === 'delete-item') {
      const c = card(body.projectNo, body.cardId)
      if (!c) return res.status(404).json({ error: 'Card not found' })
      c.items = c.items.filter(x => x.id !== body.itemId)
      await saveBoard(board)
      return res.json({ ok: true })
    }

    if (body.action === 'reorder-items') {
      const c = card(body.projectNo, body.cardId)
      if (!c) return res.status(404).json({ error: 'Card not found' })
      const order = Array.isArray(body.order) ? body.order : []
      const map = new Map(c.items.map(i => [i.id, i]))
      const next = order.map(id => map.get(id)).filter(Boolean)
      // append any not in the order (safety)
      for (const it of c.items) if (!order.includes(it.id)) next.push(it)
      c.items = next
      await saveBoard(board)
      return res.json({ ok: true })
    }

    if (body.action === 'post-chat') {
      const c = card(body.projectNo, body.cardId)
      if (!c) return res.status(404).json({ error: 'Card not found' })
      const text = String(body.text || '').trim()
      if (!text) return res.status(400).json({ error: 'Message required' })
      const portal = await getPortalUsers()
      const uname = (p) => p.name || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email
      // Resolve @mentions: match names present in the message against portal users.
      const mentionIds = Array.isArray(body.mentions) ? body.mentions.filter(Boolean) : []
      const msg = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        authorId: u.id || '', authorName: u.name || u.email || 'User',
        text, ts: Date.now(), mentions: mentionIds,
      }
      if (!Array.isArray(c.chat)) c.chat = []
      c.chat.push(msg)
      await saveBoard(board)

      // Email each mentioned user.
      const colRec = col(body.projectNo)
      const link = `${APP_URL}/operations/project-process?project=${encodeURIComponent(body.projectNo)}&card=${encodeURIComponent(body.cardId)}`
      const results = []
      for (const mid of mentionIds) {
        const pu = portal.find(p => p.id === mid)
        if (!pu || !pu.email) continue
        const subject = `You were tagged on ${colRec?.name || body.projectNo} - ${c.role}`
        const html = `
          <div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
            <p>Hi ${uname(pu)},</p>
            <p><strong>${msg.authorName}</strong> tagged you in the Project Process board.</p>
            <p><strong>Project:</strong> ${colRec?.name || ''} (${body.projectNo})<br/>
               <strong>Role card:</strong> ${c.role}</p>
            <p style="background:#f5f3ff;border-left:3px solid #6d28d9;padding:10px 14px;margin:12px 0">${text.replace(/</g, '&lt;')}</p>
            <p><a href="${link}" style="background:#0f766e;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;display:inline-block">Open the card</a></p>
          </div>`
        const r = await sendEmail(pu.email, subject, html)
        results.push({ to: pu.email, ...r })
      }
      return res.json({ ok: true, message: msg, notified: results })
    }

    if (body.action === 'save-template') {
      const template = await saveProcessTemplate(set, body.template)
      return res.json({ ok: true, template })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}
