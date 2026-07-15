import { requireRole } from '../../lib/portalAuth'
import { getOpsUsers, saveOpsUsers, getOpsProjects } from '../../lib/db'

// Operative users for forms.rockroofing.co.uk.
// Flow: admin adds a user -> system generates a unique temporary PIN and emails
// it with the app link -> operative logs in with temp PIN -> is forced to set
// their own PIN on first login. Admins can reset a PIN at any time.
//
// GET    /api/ops-users                         -> { users } (PINs omitted)
// POST   { user }                               -> create/update, emails invite on create
// POST   { action:'login', pin }                -> { ok, user, mustResetPin }
// POST   { action:'set-pin', id, pin }          -> operative sets own PIN (clears reset flag)
// POST   { action:'reset-pin', id }             -> admin resets to a new temp PIN, emails it
// DELETE { id }                                 -> remove

const FORMS_URL = 'https://siteapp.rockroofing.co.uk'
const MAX_ATTEMPTS = 5           // failed logins before lockout
const LOCKOUT_MINUTES = 15
const LOCKOUT_MS = LOCKOUT_MINUTES * 60 * 1000

// Normalise a UK mobile so "07…", "+447…", "0044 7…", and spaced variants all
// match. Reduces to digits, converts leading 44 to 0.
function normalisePhone(p) {
  if (!p) return ''
  let d = String(p).replace(/\D/g, '')
  if (d.startsWith('0044')) d = '0' + d.slice(4)
  else if (d.startsWith('44')) d = '0' + d.slice(2)
  return d
}

function genPin() {
  // Temporary 4-digit PIN. PINs need not be unique (login is by mobile + PIN),
  // so we simply generate one; the user resets it on first login.
  return String(Math.floor(1000 + Math.random() * 9000))
}

async function sendInviteEmail({ to, firstName, pin, isReset }) {
  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  // Replies to invite emails land in this real inbox (from-address is a
  // send-only subdomain). Override with FORMS_REPLY_TO if it ever changes.
  const REPLY_TO = process.env.FORMS_REPLY_TO || 'notifications@rockroofing.co.uk'
  if (!RESEND_KEY) return { sent: false, error: 'Email not configured' }
  const subject = isReset ? 'Your new Rock Roofing Site App PIN' : 'Welcome to the Rock Roofing Site App'
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a19">
      <h2 style="color:#1a1a19">Hi ${firstName || 'there'},</h2>
      <p>${isReset ? 'Your PIN has been reset.' : 'Welcome to the Rock Roofing Site App. You can now access your projects and complete forms from your phone.'}</p>
      <p style="font-size:15px">Your temporary PIN is:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:6px;background:#faf9f7;border:1px solid #eee;border-radius:12px;padding:16px;text-align:center;margin:12px 0">${pin}</div>
      <p>Open the Site App and log in with your <strong>mobile number</strong> and this PIN. You'll be asked to choose your own PIN the first time.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${FORMS_URL}" style="background:#ca8a04;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;display:inline-block">Open Rock Roofing Site App</a>
      </p>
      <p style="font-size:13px;color:#666">Tip: once it opens, add it to your phone's home screen so you can get to it quickly:
        on iPhone tap Share → "Add to Home Screen"; on Android tap the ⋮ menu → "Add to Home screen".</p>
      <p style="font-size:13px;color:#666">Link: <a href="${FORMS_URL}">${FORMS_URL}</a></p>
    </div>`
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, reply_to: REPLY_TO, subject, html }),
    })
    const data = await r.json()
    return { sent: r.ok, error: r.ok ? null : (data?.message || 'Send failed') }
  } catch (e) {
    return { sent: false, error: e.message }
  }
}

const strip = (u) => { const { pin, ...rest } = u; return rest }

// Given a user's previous and new records, return the ACTIVE project numbers the
// user can now access but couldn't before. 'all' means every active project.
function expandedAccess(prev, after, projects) {
  const activeNos = projects.filter(p => (p.status || 'active') === 'active').map(p => p.projectNo)
  const toSet = (pa) => pa === 'all' || pa == null ? 'all' : (Array.isArray(pa) ? pa.map(String) : [])
  const before = toSet(prev?.projectAccess)
  const now = toSet(after?.projectAccess)
  // Was 'all' before → nothing is newly accessible.
  if (before === 'all') return []
  // Now 'all' → newly accessible = every active project not already in `before`.
  if (now === 'all') return activeNos.filter(no => !before.includes(String(no)))
  // Both are lists → the difference.
  const beforeSet = new Set(before)
  return now.filter(no => !beforeSet.has(String(no)) && activeNos.includes(no))
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!requireRole(req, res, ['management','admin'])) return;
    const users = await getOpsUsers()
    return res.json({ users: users.map(strip) })
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    let users = await getOpsUsers()

    // ── Login ────────────────────────────────────────────────────────────
    if (body.action === 'login') {
      const normPhone = normalisePhone(body.phone)
      if (!normPhone || !body.pin) return res.json({ ok: false, error: 'Enter your mobile and PIN.' })

      // Find the user by mobile first, so lockout is per-person.
      const user = users.find(u => normalisePhone(u.phone) === normPhone && u.active !== false)

      // Lockout check (per user record).
      if (user && user.lockedUntil && user.lockedUntil > Date.now()) {
        const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000)
        return res.json({ ok: false, locked: true, error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` })
      }

      const pinOk = user && String(user.pin) === String(body.pin)
      if (!pinOk) {
        // Record a failed attempt against the matched user (if any).
        if (user) {
          const idx = users.findIndex(u => u.id === user.id)
          const fails = (users[idx].failedAttempts || 0) + 1
          users[idx].failedAttempts = fails
          if (fails >= MAX_ATTEMPTS) {
            users[idx].lockedUntil = Date.now() + LOCKOUT_MS
            users[idx].failedAttempts = 0
          }
          await saveOpsUsers(users)
          if (users[idx].lockedUntil && users[idx].lockedUntil > Date.now()) {
            return res.json({ ok: false, locked: true, error: `Too many attempts. Locked for ${LOCKOUT_MINUTES} minutes.` })
          }
          const left = MAX_ATTEMPTS - fails
          return res.json({ ok: false, error: `Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left.` })
        }
        return res.json({ ok: false, error: 'Mobile or PIN not recognised.' })
      }

      // Success — clear any failed-attempt counters.
      const idx = users.findIndex(u => u.id === user.id)
      if (users[idx].failedAttempts || users[idx].lockedUntil) {
        users[idx].failedAttempts = 0; users[idx].lockedUntil = null
        await saveOpsUsers(users)
      }
      const safe = strip(users[idx])
      safe.name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || ''
      return res.json({ ok: true, user: safe, mustResetPin: !!user.mustResetPin })
    }

    // ── Operative sets their own PIN (first login or change) ───────────────
    if (body.action === 'set-pin') {
      const { id, pin } = body
      if (!pin || !/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be 4–6 digits.' })
      // PINs do NOT need to be unique — login is by mobile number + PIN, so two
      // users may share a PIN as long as their mobiles differ.
      const idx = users.findIndex(u => u.id === id)
      if (idx < 0) return res.status(404).json({ error: 'User not found' })
      users[idx] = { ...users[idx], pin: String(pin), mustResetPin: false }
      await saveOpsUsers(users)
      const safe = strip(users[idx])
      safe.name = [users[idx].firstName, users[idx].lastName].filter(Boolean).join(' ')
      return res.json({ ok: true, user: safe })
    }

    // ── Admin resets a user's PIN to a new temp PIN ───────────────────────
    if (body.action === 'reset-pin') {
      if (!requireRole(req, res, ['management','admin'])) return;
      const idx = users.findIndex(u => u.id === body.id)
      if (idx < 0) return res.status(404).json({ error: 'User not found' })
      const tempPin = genPin()
      users[idx] = { ...users[idx], pin: tempPin, mustResetPin: true }
      await saveOpsUsers(users)
      const email = await sendInviteEmail({ to: users[idx].email, firstName: users[idx].firstName, pin: tempPin, isReset: true })
      return res.json({ ok: true, users: users.map(strip), emailSent: email.sent, emailError: email.error, tempPin })
    }

    // ── Create / update a user ────────────────────────────────────────────
    if (!requireRole(req, res, ['management','admin'])) return;
    const { user } = body
    if (!user || !user.firstName || !user.lastName) return res.status(400).json({ error: 'Missing name' })
    const projects = await getOpsProjects()

    // Update existing
    if (user.id) {
      const idx = users.findIndex(u => u.id === user.id)
      if (idx < 0) return res.status(404).json({ error: 'User not found' })
      const prev = users[idx]
      // Never overwrite pin/mustResetPin via a plain edit
      const { pin, mustResetPin, ...editable } = user
      users[idx] = { ...users[idx], ...editable }
      await saveOpsUsers(users)
      // If project access has expanded, notify the user about the NEW projects
      // (and flag any RAMS ready for them to sign).
      try {
        const after = users[idx]
        const newlyAccessible = expandedAccess(prev, after, projects)
        if (newlyAccessible.length && after.active !== false && after.email) {
          const { notifyUserAddedToProjects } = await import('../../lib/ramsNotify')
          notifyUserAddedToProjects({ user: after, projectNos: newlyAccessible })
        }
      } catch (e) { console.error('notify on user edit failed:', e) }
      return res.json({ users: users.map(strip) })
    }

    // Create new — generate temp PIN, email invite
    const tempPin = genPin()
    if (!tempPin) return res.status(500).json({ error: 'Could not generate a unique PIN' })
    // Mobile must be unique — it's the login identifier.
    if (normalisePhone(user.phone) && users.some(u => normalisePhone(u.phone) === normalisePhone(user.phone))) {
      return res.status(409).json({ error: 'That mobile number is already registered to another user.' })
    }
    const newUser = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role || '',
      accessLevel: user.accessLevel === 'contracts-manager' ? 'contracts-manager' : 'operative',
      phone: user.phone || '',
      email: user.email || '',
      company: user.company || '',
      trades: Array.isArray(user.trades) ? user.trades : [],
      active: user.active !== false,
      projectAccess: user.projectAccess === 'all' || user.projectAccess == null ? 'all' : (Array.isArray(user.projectAccess) ? user.projectAccess : 'all'),
      pin: tempPin,
      mustResetPin: true,
      createdAt: Date.now(),
    }
    users.push(newUser)
    await saveOpsUsers(users)
    const email = await sendInviteEmail({ to: newUser.email, firstName: newUser.firstName, pin: tempPin })
    // Tell the new user which projects they can access + any RAMS ready to sign.
    try {
      const nos = newUser.projectAccess === 'all'
        ? projects.filter(p => (p.status || 'active') === 'active').map(p => p.projectNo)
        : (Array.isArray(newUser.projectAccess) ? newUser.projectAccess : [])
      if (nos.length && newUser.email) {
        const { notifyUserAddedToProjects } = await import('../../lib/ramsNotify')
        notifyUserAddedToProjects({ user: newUser, projectNos: nos })
      }
    } catch (e) { console.error('notify new user failed:', e) }
    return res.json({ users: users.map(strip), emailSent: email.sent, emailError: email.error, tempPin, email: newUser.email })
  }

  if (req.method === 'DELETE') {
    if (!requireRole(req, res, ['management','admin'])) return;
    const { id } = req.body || {}
    let users = await getOpsUsers()
    users = users.filter(u => u.id !== id)
    await saveOpsUsers(users)
    return res.json({ users: users.map(strip) })
  }

  res.status(405).end()
}
