import { get, set, keys, getPortalUsers } from './db'
import { getExternalUsers, externalCanAccessProject } from './designUsers'
import { canAccessArea } from './roles'

const APP_URL = process.env.PORTAL_URL || 'https://app.rockroofing.co.uk'

export const rfiKey = (no) => `design:rfis:${no}`
// One flag per project holding what's happened today that still needs a daily email.
//   design:rfis-pending:<no> = { date:'YYYY-MM-DD', newRfis:n, comments:n, emailedDate:'' }
export const pendingKey = (no) => `design:rfis-pending:${no}`
// Per-user last-seen time for a project's RFIs (unread = activity newer than this).
export const seenKey = (no, userId) => `design:rfis-seen:${no}:${userId}`

// Everyone (internal design users + external customers) with access to this project.
export async function projectRecipients(projectNo) {
  const [portal, ext] = await Promise.all([getPortalUsers(), getExternalUsers()])
  const out = []
  for (const p of (portal || [])) {
    if (p.active === false) continue
    if (!canAccessArea(p.role, 'design')) continue
    out.push({ id: p.id, name: p.name || [p.firstName, p.lastName].filter(Boolean).join(' '), email: p.email || '', external: false })
  }
  for (const e of (ext || [])) {
    if (e.active === false) continue
    if (!externalCanAccessProject(e, projectNo)) continue
    out.push({ id: e.id, name: e.name, email: e.email || '', external: true })
  }
  return out
}

export async function allRfiProjectNos() {
  try {
    const ks = await keys('design:rfis:*')
    // Exclude the counter keys (design:rfis-next:*) and other suffixes.
    return (ks || [])
      .filter(k => /^design:rfis:[^:]+$/.test(k))
      .map(k => k.slice('design:rfis:'.length))
  } catch { return [] }
}

export async function projectDisplayName(projectNo) {
  try {
    const d = await fetch(`${APP_URL}/api/planning`).then(r => r.json())
    const p = (d.projects || []).find(x => String(x.projectNo || x.jobNo || '') === String(projectNo))
    return p ? (p.name || '') : ''
  } catch { return '' }
}

// UK date string (YYYY-MM-DD) - used to gate "once per day".
export function ukDate(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (t) => p.find(x => x.type === t).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

// Record that activity happened on a project today (accumulates counts for the day).
export async function recordPending(projectNo, kind) {
  const today = ukDate()
  let pend = await get(pendingKey(projectNo))
  if (!pend || pend.date !== today) pend = { date: today, newRfis: 0, comments: 0, emailedDate: pend?.emailedDate || '' }
  if (kind === 'rfi') pend.newRfis++
  else if (kind === 'comment') pend.comments++
  await set(pendingKey(projectNo), pend)
}

// The latest activity time on an RFI (created, or newest comment).
export function rfiLastActivity(rfi) {
  let t = rfi.issuedAt || rfi.createdAt || 0
  for (const c of (rfi.comments || [])) if (c.at > t) t = c.at
  return t
}

// Mark a project's RFIs as seen NOW for a user (called when they open the tracker).
export async function markSeen(projectNo, userId) {
  if (!userId) return
  await set(seenKey(projectNo, userId), Date.now())
}

// Per-user read map for a project: { [rfiId]: lastActivityTsSeen }. An RFI is unread if
// its latest activity is newer than what this user has seen (or never seen).
export const readMapKey = (no, userId) => `design:rfis-read:${no}:${userId}`
export async function getReadMap(no, userId) {
  if (!userId) return {}
  return (await get(readMapKey(no, userId))) || {}
}
export async function markRfiRead(no, userId, rfi) {
  if (!userId || !rfi) return
  const m = await getReadMap(no, userId)
  m[rfi.id] = rfiLastActivity(rfi)
  await set(readMapKey(no, userId), m)
}
export function unreadFromMap(rfis, readMap) {
  const m = readMap || {}
  return (rfis || []).filter(r => rfiLastActivity(r) > (m[r.id] || 0)).map(r => r.id)
}

// Given rfis + a user's last-seen time, which rfi ids are unread (have newer activity)?
export function unreadIds(rfis, seenTs) {
  const ts = seenTs || 0
  return (rfis || []).filter(r => rfiLastActivity(r) > ts).map(r => r.id)
}

// ---- Email building ----
const FROM = process.env.FORMS_FROM_EMAIL || process.env.NOTIFY_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
const REPLY_TO = process.env.FORMS_REPLY_TO || 'notifications@rockroofing.co.uk'
const esc = (s) => String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;')
const shell = (inner) => `<div style="font-family:system-ui,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a19">${inner}<p style="font-size:12px;color:#999;margin-top:24px">Rock Roofing Ltd</p></div>`
const btn = (href, label) => `<p style="margin:22px 0"><a href="${href}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:600;display:inline-block">${label}</a></p>`

// Phrase for a daily digest: distinguishes new comments, new documents, or both.
// e.g. (2,0)->"new comments"  (0,1)->"a new document"  (1,3)->"a new comment and new documents"
function activityPhrase(comments, docs) {
  const c = comments || 0, d = docs || 0
  const cPart = c === 1 ? 'a new comment' : 'new comments'
  const dPart = d === 1 ? 'a new document' : 'new documents'
  if (c > 0 && d > 0) return `${cPart} and ${dPart}`
  if (d > 0) return dPart
  return cPart
}
// Whole opening line for a digest, given the area label.
function digestLine(comments, docs, area, projectName) {
  const phrase = activityPhrase(comments, docs)
  const been = ((comments || 0) + (docs || 0)) === 1 ? 'has been' : 'have been'
  const verb = (docs || 0) > 0 && (comments || 0) === 0 ? 'added to' : 'added to'
  return `There ${been} ${phrase} ${verb} ${area} for your project <strong>${esc(projectName)}</strong> today. Please log in to review.`
}
const rfiLink = (no) => `${APP_URL}/design/${encodeURIComponent(no)}/rfis`

export async function sendMail(to, subject, html) {
  const key = process.env.RESEND_API_KEY
  if (!key || !to) return { sent: false }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html }),
    })
    return { sent: r.ok }
  } catch { return { sent: false } }
}

export function dailyDigestHtml({ name, projectName, projectNo, comments, docs }) {
  return shell(`
    <h2>Hi ${esc(name) || 'there'},</h2>
    <p>${digestLine(comments, docs, 'RFIs', projectName || projectNo)}</p>
    ${btn(rfiLink(projectNo), 'Open the RFI tracker')}
    <p style="font-size:13px;color:#666">Link: <a href="${rfiLink(projectNo)}">${rfiLink(projectNo)}</a></p>
  `)
}

function rfiTableHtml(rfis, personName) {
  const rows = rfis.map(r => {
    const req = r.requiredDate ? new Date(r.requiredDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
    // Overdue (red) / Due in Xd (orange) marker - mirrors the RFI tracker.
    let marker = ''
    if (r.status !== 'resolved' && r.requiredDate) {
      const days = Math.ceil((new Date(r.requiredDate + 'T23:59:59') - new Date()) / 86400000)
      if (days < 0) marker = `<span style="margin-left:6px;background:#fee2e2;color:#dc2626;border-radius:20px;padding:1px 8px;font-size:11px;font-weight:700;white-space:nowrap">Overdue</span>`
      else if (days <= 5) marker = `<span style="margin-left:6px;background:#fef3c7;color:#d97706;border-radius:20px;padding:1px 8px;font-size:11px;font-weight:700;white-space:nowrap">Due in ${days}d</span>`
    }
    return `<tr>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;font-weight:700;white-space:nowrap">${esc(r.number)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee">${esc(r.description || '-')}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(req)}${marker}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(personName ? personName(r.responsibleUserId) : '') || '-'}</td>
    </tr>`
  }).join('')
  return `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:10px 0">
    <thead><tr style="background:#faf9f7">
      <th style="text-align:left;padding:7px 10px;border-bottom:2px solid #eee">RFI</th>
      <th style="text-align:left;padding:7px 10px;border-bottom:2px solid #eee">Description</th>
      <th style="text-align:left;padding:7px 10px;border-bottom:2px solid #eee">Required by</th>
      <th style="text-align:left;padding:7px 10px;border-bottom:2px solid #eee">Responsible</th>
    </tr></thead><tbody>${rows}</tbody></table>`
}

export function outstandingDigestHtml({ name, projectName, projectNo, rfis, personName }) {
  return shell(`
    <h2>Hi ${esc(name) || 'there'},</h2>
    <p>These RFIs are still outstanding on project <strong>${esc(projectName || projectNo)}</strong> and need a response:</p>
    ${rfiTableHtml(rfis, personName)}
    ${btn(rfiLink(projectNo), 'Open the RFI tracker')}
  `)
}

// ---- Rock Drawings notifications (mirror the Tech Sub comment model) ----
export const rdKey = (no) => `design:rock-drawings:${no}`
export const rdPendingKey = (no) => `design:rock-drawings-pending:${no}`
export const rdReadMapKey = (no, userId) => `design:rock-drawings-read:${no}:${userId}`

export async function rdRecordPendingComment(no) {
  const today = ukDate()
  let pend = await get(rdPendingKey(no))
  if (!pend || pend.date !== today) pend = { date: today, comments: 0, docs: 0, emailedDate: pend?.emailedDate || '' }
  pend.comments++
  await set(rdPendingKey(no), pend)
}
export async function rdRecordPendingDoc(no) {
  const today = ukDate()
  let pend = await get(rdPendingKey(no))
  if (!pend || pend.date !== today) pend = { date: today, comments: 0, docs: 0, emailedDate: pend?.emailedDate || '' }
  pend.docs = (pend.docs || 0) + 1
  await set(rdPendingKey(no), pend)
}
export function rdLastActivity(doc) {
  let t = doc.uploadedAt || 0
  for (const c of (doc.comments || [])) if (c.at > t) t = c.at
  return t
}
export async function rdGetReadMap(no, userId) {
  if (!userId) return {}
  return (await get(rdReadMapKey(no, userId))) || {}
}
export async function rdMarkRead(no, userId, doc) {
  if (!userId || !doc) return
  const m = await rdGetReadMap(no, userId)
  m[doc.id] = rdLastActivity(doc)
  await set(rdReadMapKey(no, userId), m)
}
export function rdUnread(docs, readMap) {
  const m = readMap || {}
  return (docs || []).filter(d => rdLastActivity(d) > (m[d.id] || 0)).map(d => d.id)
}
export async function allRockDrawingProjectNos() {
  try {
    const ks = await keys('design:rock-drawings:*')
    return (ks || []).filter(k => /^design:rock-drawings:[^:]+$/.test(k)).map(k => k.slice('design:rock-drawings:'.length))
  } catch { return [] }
}
export function rockDrawingDigestHtml({ name, projectName, projectNo, comments, docs }) {
  const link = `${APP_URL}/design/${encodeURIComponent(projectNo)}/rock-drawings`
  return shell(`
    <h2>Hi ${esc(name) || 'there'},</h2>
    <p>${digestLine(comments, docs, 'Rock Drawings', projectName || projectNo)}</p>
    ${btn(link, 'Open Rock Drawings')}
    <p style="font-size:13px;color:#666">Link: <a href="${link}">${link}</a></p>
  `)
}

// ---- Calculations notifications (mirror the Rock Drawings model) ----
export const calcKey = (no) => `design:calculations:${no}`
export const calcPendingKey = (no) => `design:calculations-pending:${no}`
export const calcReadMapKey = (no, userId) => `design:calculations-read:${no}:${userId}`

export async function calcRecordPendingComment(no) {
  const today = ukDate()
  let pend = await get(calcPendingKey(no))
  if (!pend || pend.date !== today) pend = { date: today, comments: 0, docs: 0, emailedDate: pend?.emailedDate || '' }
  pend.comments++
  await set(calcPendingKey(no), pend)
}
export async function calcRecordPendingDoc(no) {
  const today = ukDate()
  let pend = await get(calcPendingKey(no))
  if (!pend || pend.date !== today) pend = { date: today, comments: 0, docs: 0, emailedDate: pend?.emailedDate || '' }
  pend.docs = (pend.docs || 0) + 1
  await set(calcPendingKey(no), pend)
}
export function calcLastActivity(doc) {
  let t = doc.uploadedAt || 0
  for (const c of (doc.comments || [])) if (c.at > t) t = c.at
  return t
}
export async function calcGetReadMap(no, userId) {
  if (!userId) return {}
  return (await get(calcReadMapKey(no, userId))) || {}
}
export async function calcMarkRead(no, userId, doc) {
  if (!userId || !doc) return
  const m = await calcGetReadMap(no, userId)
  m[doc.id] = calcLastActivity(doc)
  await set(calcReadMapKey(no, userId), m)
}
export function calcUnread(docs, readMap) {
  const m = readMap || {}
  return (docs || []).filter(d => calcLastActivity(d) > (m[d.id] || 0)).map(d => d.id)
}
export async function allCalculationProjectNos() {
  try {
    const ks = await keys('design:calculations:*')
    return (ks || []).filter(k => /^design:calculations:[^:]+$/.test(k)).map(k => k.slice('design:calculations:'.length))
  } catch { return [] }
}
export function calculationDigestHtml({ name, projectName, projectNo, comments, docs }) {
  const link = `${APP_URL}/design/${encodeURIComponent(projectNo)}/calculations`
  return shell(`
    <h2>Hi ${esc(name) || 'there'},</h2>
    <p>${digestLine(comments, docs, 'Calculations', projectName || projectNo)}</p>
    ${btn(link, 'Open Calculations')}
    <p style="font-size:13px;color:#666">Link: <a href="${link}">${link}</a></p>
  `)
}

// ---- Tech Sub notifications (mirror the RFI comment model) ----
export const tsKey = (no) => `design:techsubs:${no}`
export const tsPendingKey = (no) => `design:techsubs-pending:${no}`
export const tsReadMapKey = (no, userId) => `design:techsubs-read:${no}:${userId}`

export async function tsRecordPendingComment(no) {
  const today = ukDate()
  let pend = await get(tsPendingKey(no))
  if (!pend || pend.date !== today) pend = { date: today, comments: 0, docs: 0, emailedDate: pend?.emailedDate || '' }
  pend.comments++
  await set(tsPendingKey(no), pend)
}
export async function tsRecordPendingDoc(no) {
  const today = ukDate()
  let pend = await get(tsPendingKey(no))
  if (!pend || pend.date !== today) pend = { date: today, comments: 0, docs: 0, emailedDate: pend?.emailedDate || '' }
  pend.docs = (pend.docs || 0) + 1
  await set(tsPendingKey(no), pend)
}
export function tsLastActivity(doc) {
  let t = doc.uploadedAt || 0
  for (const c of (doc.comments || [])) if (c.at > t) t = c.at
  return t
}
export async function tsGetReadMap(no, userId) {
  if (!userId) return {}
  return (await get(tsReadMapKey(no, userId))) || {}
}
export async function tsMarkRead(no, userId, doc) {
  if (!userId || !doc) return
  const m = await tsGetReadMap(no, userId)
  m[doc.id] = tsLastActivity(doc)
  await set(tsReadMapKey(no, userId), m)
}
export function tsUnread(docs, readMap) {
  const m = readMap || {}
  return (docs || []).filter(d => tsLastActivity(d) > (m[d.id] || 0)).map(d => d.id)
}
export async function allTechSubProjectNos() {
  try {
    const ks = await keys('design:techsubs:*')
    return (ks || []).filter(k => /^design:techsubs:[^:]+$/.test(k)).map(k => k.slice('design:techsubs:'.length))
  } catch { return [] }
}
export function techSubDigestHtml({ name, projectName, projectNo, comments, docs }) {
  const link = `${APP_URL}/design/${encodeURIComponent(projectNo)}/tech-sub`
  return shell(`
    <h2>Hi ${esc(name) || 'there'},</h2>
    <p>${digestLine(comments, docs, 'Tech Subs', projectName || projectNo)}</p>
    ${btn(link, 'Open the Tech Sub page')}
    <p style="font-size:13px;color:#666">Link: <a href="${link}">${link}</a></p>
  `)
}
