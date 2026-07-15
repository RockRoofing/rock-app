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

// ── Chain handoff notifications ─────────────────────────────────────────────
// Find the project's CM as a Site App user (match by name to the project's
// contractsManager). Returns the ops user or null.
async function findProjectCM(project) {
  const cmName = (project.data?.contractsManager || '').trim().toLowerCase()
  if (!cmName) return null
  const norm = s => (s || '').trim().toLowerCase()
  const nameMatches = (full) => {
    if (!full) return false
    if (full === cmName) return true
    const a = full.split(/\s+/), b = cmName.split(/\s+/)
    return a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1]
  }
  // 1) Prefer a Site App user (they log in there to approve).
  const users = await getOpsUsers()
  const siteUser = users.find(u => u.active !== false && u.email && nameMatches(norm([u.firstName, u.lastName].filter(Boolean).join(' ') || u.name)))
  if (siteUser) return siteUser
  // 2) Fall back to a Portal user with the same name (CMs are portal users too),
  //    so the email still reaches them even if they're not a Site App user yet.
  try {
    const portal = (await get('portal:users')) || []
    const pu = portal.find(u => u.active !== false && u.email && nameMatches(norm([u.firstName, u.lastName].filter(Boolean).join(' ') || u.name)))
    if (pu) return { firstName: pu.firstName || (pu.name || '').split(' ')[0] || '', email: pu.email }
  } catch {}
  return null
}

async function projectByNo(projectNo) {
  const projects = await getOpsProjects()
  return projects.find(x => x.projectNo === projectNo) || null
}

// RAMS uploaded → the CM is first in the chain: ask them to approve.
export async function notifyCmToApprove({ projectNo, fileName }) {
  try {
    const p = await projectByNo(projectNo); if (!p) return
    const cm = await findProjectCM(p); if (!cm?.email) return
    const label = projLabel(p)
    await sendEmail({
      to: cm.email,
      subject: `RAMS to approve — ${label}`,
      html: shell(`
        <h2 style="color:#1a1a19">RAMS ready for your approval</h2>
        <p style="font-size:15px">Hi ${cm.firstName || 'there'},</p>
        <p style="font-size:15px">As Rock Roofing Contracts Manager for <strong>${label}</strong>, RAMS ${fileName ? `(<strong>${fileName}</strong>) ` : ''}have been uploaded and need your approval to start the sign-off process.</p>
        <p style="text-align:center;margin:24px 0"><a href="${SITEAPP_URL}" style="background:#ca8a04;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block">Approve in the Site App</a></p>`),
    })
  } catch (e) { console.error('notifyCmToApprove failed:', e) }
}

// CM approved → notify the designated Director to approve/sign.
export async function notifyDirectorToApprove({ projectNo, fileName }) {
  try {
    let director = (await get('ops:rams-director')) || null
    // Fallback: if no designated director stored, or its email is missing, try the
    // Portal user(s) with jobRole 'Director'.
    if (!director?.email) {
      try {
        const portal = (await get('portal:users')) || []
        const d = portal.find(u => (u.jobRole || '') === 'Director' && u.active !== false && u.email)
        if (d) director = { name: d.name || `${d.firstName || ''} ${d.lastName || ''}`.trim(), email: d.email }
      } catch {}
    }
    if (!director?.email) { console.error('notifyDirectorToApprove: no director email set'); return }
    const p = await projectByNo(projectNo); if (!p) return
    const label = projLabel(p)
    const sent = await sendEmail({
      to: director.email,
      subject: `RAMS to approve — ${label}`,
      html: shell(`
        <h2 style="color:#1a1a19">RAMS ready for Director approval</h2>
        <p style="font-size:15px">Hi ${(director.name || '').split(' ')[0] || 'there'},</p>
        <p style="font-size:15px">The Contracts Manager has approved the RAMS ${fileName ? `(<strong>${fileName}</strong>) ` : ''}for <strong>${label}</strong>. As Rock Roofing Director, please review and sign onto them in the Site App.</p>
        <p style="text-align:center;margin:24px 0"><a href="${SITEAPP_URL}" style="background:#ca8a04;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block">Approve in the Site App</a></p>`),
    })
    if (!sent) console.error('notifyDirectorToApprove: email send failed (check RESEND_API_KEY / FORMS_FROM_EMAIL / director email deliverability)')
  } catch (e) { console.error('notifyDirectorToApprove failed:', e) }
}

// Director approved → tell the CM to send it to the customer's Site Manager.
export async function notifyCmToSendSiteManager({ projectNo, fileName }) {
  try {
    const p = await projectByNo(projectNo); if (!p) return
    const cm = await findProjectCM(p); if (!cm?.email) return
    const label = projLabel(p)
    await sendEmail({
      to: cm.email,
      subject: `RAMS ready to send to Site Manager — ${label}`,
      html: shell(`
        <h2 style="color:#1a1a19">Send RAMS to the Site Manager</h2>
        <p style="font-size:15px">Hi ${cm.firstName || 'there'},</p>
        <p style="font-size:15px">The Director has approved the RAMS ${fileName ? `(<strong>${fileName}</strong>) ` : ''}for <strong>${label}</strong>. Please send them to the customer's Site Manager for approval from the Site App.</p>
        <p style="text-align:center;margin:24px 0"><a href="${SITEAPP_URL}" style="background:#ca8a04;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block">Open the Site App</a></p>`),
    })
  } catch (e) { console.error('notifyCmToSendSiteManager failed:', e) }
}

// Site Manager rejected — "requires edits". Email the project CM and Director.
export async function notifySiteManagerRejection({ projectNo, fileName, byName, notes, cmName, directorName }) {
  try {
    const p = await projectByNo(projectNo); if (!p) { console.error('sm-reject: project not found', projectNo); return }
    const label = projLabel(p)

    // Resolve a person's email by name across Site App users then Portal users.
    const resolveEmail = async (nm) => {
      if (!nm) return ''
      const key = nm.trim().toLowerCase()
      const nameMatches = (full) => {
        if (!full) return false
        if (full === key) return true
        const a = full.split(/\s+/), b = key.split(/\s+/)
        return a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1]
      }
      try {
        const users = await getOpsUsers()
        const u = users.find(x => x.active !== false && x.email && nameMatches((`${x.firstName || ''} ${x.lastName || ''}`.trim() || x.name || '').toLowerCase()))
        if (u) return u.email
      } catch {}
      try {
        const portal = (await get('portal:users')) || []
        const pu = portal.find(x => x.active !== false && x.email && nameMatches((`${x.firstName || ''} ${x.lastName || ''}`.trim() || x.name || '').toLowerCase()))
        if (pu) return pu.email
      } catch {}
      return ''
    }

    const recipients = []
    // 1) The CM who signed (most reliable — name captured on the approval record).
    const cmEmail = (await resolveEmail(cmName)) || (await (async () => { const cm = await findProjectCM(p); return cm?.email || '' })())
    if (cmEmail) recipients.push(cmEmail)
    // 2) The Director.
    let directorEmail = await resolveEmail(directorName)
    if (!directorEmail) {
      const d = (await get('ops:rams-director')) || null
      directorEmail = d?.email || ''
      if (!directorEmail) {
        try { const portal = (await get('portal:users')) || []; const pd = portal.find(u => (u.jobRole || '') === 'Director' && u.active !== false && u.email); if (pd) directorEmail = pd.email } catch {}
      }
    }
    if (directorEmail) recipients.push(directorEmail)

    let uniq = [...new Set(recipients.filter(Boolean))]
    // 3) Absolute fallback so a rejection is never lost.
    if (!uniq.length && process.env.ALERT_EMAIL) uniq = [process.env.ALERT_EMAIL]
    if (!uniq.length) { console.error('sm-reject: no recipients resolved (CM/Director/ALERT_EMAIL all empty)'); return }

    for (const to of uniq) {
      const sent = await sendEmail({
        to,
        subject: `RAMS NOT approved — edits required — ${label}`,
        html: shell(`
          <h2 style="color:#b91c1c">Site Manager requested edits</h2>
          <p style="font-size:15px">The customer's Site Manager${byName ? ` (<strong>${byName}</strong>)` : ''} has <strong>not approved</strong> the RAMS ${fileName ? `(<strong>${fileName}</strong>) ` : ''}for <strong>${label}</strong> and has requested edits:</p>
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 14px;font-size:15px;color:#7f1d1d;white-space:pre-wrap">${(notes || '').replace(/</g, '&lt;')}</div>
          <p style="font-size:15px;margin-top:16px">Please make the required edits and re-issue the RAMS (upload the corrected version, which restarts the approval chain).</p>`),
      })
      if (!sent) console.error('sm-reject: email send failed to', to, '(check RESEND_API_KEY / FORMS_FROM_EMAIL)')
    }
  } catch (e) { console.error('notifySiteManagerRejection failed:', e) }
}

// Site Manager approved → operatives can now sign.
export async function notifyOperativesToSign({ projectNo, fileName }) {
  try {
    const p = await projectByNo(projectNo); if (!p) return
    const users = await getOpsUsers()
    const label = projLabel(p)
    const recipients = users.filter(u => u.active !== false && u.email && userCanAccess(u, projectNo) && u.accessLevel !== 'contracts-manager')
    for (const u of recipients) {
      await sendEmail({
        to: u.email,
        subject: `RAMS ready to sign — ${label}`,
        html: shell(`
          <h2 style="color:#1a1a19">RAMS ready for you to sign</h2>
          <p style="font-size:15px">Hi ${u.firstName || 'there'},</p>
          <p style="font-size:15px">The RAMS ${fileName ? `(<strong>${fileName}</strong>) ` : ''}for <strong>${label}</strong> have been fully approved. Please read and sign onto them in the Site App before starting on site.</p>
          <p style="text-align:center;margin:24px 0"><a href="${SITEAPP_URL}" style="background:#dc2626;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block">Sign the RAMS now</a></p>`),
      })
    }
  } catch (e) { console.error('notifyOperativesToSign failed:', e) }
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
    // Is this operative the project's Contracts Manager? If so, word it as a
    // Rock Roofing project allocation for the Contracts Manager.
    const cmName = (p.data?.contractsManager || '').trim().toLowerCase()
    const opFull = `${op.firstName || ''} ${op.lastName || ''}`.trim().toLowerCase()
    const isProjectCM = !!cmName && (opFull === cmName || (() => {
      const a = opFull.split(/\s+/), b = cmName.split(/\s+/)
      return a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1]
    })())
    if (isProjectCM) {
      await sendEmail({
        to: email,
        subject: `Rock Roofing project allocated — ${label}`,
        html: shell(`
          <h2 style="color:#1a1a19">Rock Roofing project allocated</h2>
          <p style="font-size:15px">Hi ${op.firstName || 'there'},</p>
          <p style="font-size:15px">You've been allocated as <strong>Contracts Manager</strong> on the Rock Roofing project <strong>${label}</strong>.</p>
          <p style="font-size:15px">Open the Site App to manage the project's forms, RAMS approvals, deliveries and tasks.</p>
          <p style="text-align:center;margin:24px 0"><a href="${SITEAPP_URL}" style="background:#ca8a04;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block">Open the Site App</a></p>`),
      })
      return
    }
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
