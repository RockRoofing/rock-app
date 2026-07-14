import {
  get, set,
  getOpsProjects, getOpsUsers, getProjectFiles,
  getRamsApprovals, getRamsSignatures,
} from './db'

// ── RAMS email notifications ────────────────────────────────────────────────
// Uses Resend (RESEND_API_KEY + FORMS_FROM_EMAIL). All senders are best-effort
// and never throw into the caller.

const FROM = () => process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
const KEY_RESEND = () => process.env.RESEND_API_KEY

async function sendEmail({ to, subject, html }) {
  const key = KEY_RESEND()
  if (!key || !to) return false
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM(), to, subject, html }),
    })
    return r.ok
  } catch { return false }
}

function shell(bodyHtml) {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1a1a19">${bodyHtml}<p style="font-size:12px;color:#999;margin-top:24px">Rock Roofing Site App</p></div>`
}

const SITEAPP_URL = 'https://siteapp.rockroofing.co.uk'

// Which Site App users can access a project (mirrors the app's projectAccess rule).
function userCanAccess(u, projectNo) {
  const pa = u.projectAccess
  return pa == null || pa === 'all' || (Array.isArray(pa) && pa.map(String).includes(String(projectNo)))
}

function projLabel(p) {
  const name = p.data?.projectName || p.projectName || ''
  return name ? `${p.projectNo} — ${name}` : p.projectNo
}

// ── 1. Operative allocated to a project (first time) ────────────────────────
// Called from the planning "assign" action. Dedupes so each op is emailed once
// per project (until they're fully unassigned and re-added).
const ALLOC_KEY = 'ops:rams-notified:allocation'   // { "<opId>:<projectNo>": ts }

export async function notifyAllocation({ projectNo, opId }) {
  try {
    if (!projectNo || !opId) return
    const dedupe = (await get(ALLOC_KEY)) || {}
    const k = `${opId}:${projectNo}`
    if (dedupe[k]) return              // already notified for this project
    // Resolve the operative's email via the roster (allocations use roster ids).
    const roster = (await get('ops:operatives-roster')) || []
    const op = roster.find(o => o.id === opId)
    const email = op?.email
    const projects = await getOpsProjects()
    const p = projects.find(x => x.projectNo === projectNo)
    if (!p) return
    dedupe[k] = Date.now()
    await set(ALLOC_KEY, dedupe)       // mark first so we never double-send
    if (!email) return
    const label = projLabel(p)
    await sendEmail({
      to: email,
      subject: `You've been allocated to ${label}`,
      html: shell(`
        <h2 style="color:#1a1a19">New project allocation</h2>
        <p style="font-size:15px">Hi ${op.firstName || 'there'},</p>
        <p style="font-size:15px">You've been allocated to work on <strong>${label}</strong>.</p>
        <p style="font-size:15px">Open the Site App to see the project's drawings, RAMS and deliveries.</p>
        <p style="text-align:center;margin:24px 0"><a href="${SITEAPP_URL}" style="background:#ca8a04;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block">Open the Site App</a></p>`),
    })
  } catch (e) { console.error('notifyAllocation failed:', e) }
}

// Clear the allocation dedupe when an operative is fully removed from a project,
// so a future re-allocation notifies again.
export async function clearAllocationNotice({ projectNo, opId }) {
  try {
    const dedupe = (await get(ALLOC_KEY)) || {}
    const k = `${opId}:${projectNo}`
    if (dedupe[k]) { delete dedupe[k]; await set(ALLOC_KEY, dedupe) }
  } catch {}
}

// ── 2. New project added → notify "all projects" Site App users ─────────────
// Called when an ops project becomes active/created.
const NEWPROJ_KEY = 'ops:rams-notified:new-project'   // { "<projectNo>": ts }

export async function notifyNewProject({ projectNo }) {
  try {
    if (!projectNo) return
    const done = (await get(NEWPROJ_KEY)) || {}
    if (done[projectNo]) return
    const projects = await getOpsProjects()
    const p = projects.find(x => x.projectNo === projectNo)
    if (!p) return
    done[projectNo] = Date.now()
    await set(NEWPROJ_KEY, done)
    const users = await getOpsUsers()
    const label = projLabel(p)
    const recipients = users.filter(u => u.active !== false && u.projectAccess === 'all' && u.email)
    for (const u of recipients) {
      await sendEmail({
        to: u.email,
        subject: `New project added — ${label}`,
        html: shell(`
          <h2 style="color:#1a1a19">New project available</h2>
          <p style="font-size:15px">Hi ${u.firstName || 'there'},</p>
          <p style="font-size:15px">A new project has been added and you now have access to it: <strong>${label}</strong>.</p>
          <p style="text-align:center;margin:24px 0"><a href="${SITEAPP_URL}" style="background:#ca8a04;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block">Open the Site App</a></p>`),
      })
    }
  } catch (e) { console.error('notifyNewProject failed:', e) }
}

// ── 3. RAMS uploaded → notify operatives on that project to sign ────────────
// Called when a RAMS file is added to a project. Emails users who can access it.
export async function notifyRamsUploaded({ projectNo, fileName }) {
  try {
    if (!projectNo) return
    const projects = await getOpsProjects()
    const p = projects.find(x => x.projectNo === projectNo)
    if (!p) return
    const users = await getOpsUsers()
    const label = projLabel(p)
    const recipients = users.filter(u => u.active !== false && u.email && userCanAccess(u, projectNo))
    for (const u of recipients) {
      await sendEmail({
        to: u.email,
        subject: `RAMS to sign — ${label}`,
        html: shell(`
          <h2 style="color:#1a1a19">New RAMS to sign</h2>
          <p style="font-size:15px">Hi ${u.firstName || 'there'},</p>
          <p style="font-size:15px">RAMS ${fileName ? `(<strong>${fileName}</strong>) ` : ''}have been uploaded for <strong>${label}</strong>. Once they've been approved, you'll need to read and sign onto them in the Site App.</p>
          <p style="text-align:center;margin:24px 0"><a href="${SITEAPP_URL}" style="background:#ca8a04;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block">Open the Site App</a></p>`),
      })
    }
  } catch (e) { console.error('notifyRamsUploaded failed:', e) }
}

// ── 4. Reminders every 2 days until signed (called from the daily cron) ──────
// For each project with a current RAMS at the 'operatives' stage, email each
// accessing operative who hasn't signed, at most once every 2 days.
const REMIND_KEY = 'ops:rams-notified:reminder'   // { "<opEmail>:<projectNo>:<fileId>": lastTs }
const TWO_DAYS = 2 * 86400000

export async function runRamsReminders({ force = false } = {}) {
  const key = KEY_RESEND()
  if (!key) return { ok: false, reason: 'email not configured' }
  const projects = (await getOpsProjects()).filter(p => (p.status || 'active') === 'active')
  const users = await getOpsUsers()
  const lastSent = (await get(REMIND_KEY)) || {}
  const now = Date.now()
  let sent = 0, considered = 0

  for (const p of projects) {
    const files = await getProjectFiles(p.projectNo)
    const ramsFiles = (files || []).filter(f => f.category === 'rams')
    if (!ramsFiles.length) continue
    const [appr, sigs] = await Promise.all([getRamsApprovals(p.projectNo), getRamsSignatures(p.projectNo)])
    const label = projLabel(p)

    for (const f of ramsFiles) {
      const rec = appr[f.id]
      // Only remind once operatives can actually sign.
      if (!rec || (rec.stage !== 'operatives' && rec.stage !== 'complete')) continue
      const signedBy = sigs[f.id] || {}
      const recipients = users.filter(u => u.active !== false && u.email && userCanAccess(u, p.projectNo))
      for (const u of recipients) {
        if (u.id && signedBy[u.id]) continue     // already signed this version
        considered++
        const dk = `${u.email.toLowerCase()}:${p.projectNo}:${f.id}`
        const prev = lastSent[dk] || 0
        if (!force && now - prev < TWO_DAYS) continue
        const ok = await sendEmail({
          to: u.email,
          subject: `Reminder: RAMS still to sign — ${label}`,
          html: shell(`
            <h2 style="color:#1a1a19">RAMS still awaiting your signature</h2>
            <p style="font-size:15px">Hi ${u.firstName || 'there'},</p>
            <p style="font-size:15px">You still need to read and sign onto the RAMS${f.name ? ` (<strong>${f.name}</strong>)` : ''} for <strong>${label}</strong>. Please do this before starting on site.</p>
            <p style="text-align:center;margin:24px 0"><a href="${SITEAPP_URL}" style="background:#dc2626;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block">Sign the RAMS now</a></p>`),
        })
        if (ok) { lastSent[dk] = now; sent++ }
      }
    }
  }
  await set(REMIND_KEY, lastSent)
  return { ok: true, sent, considered }
}
