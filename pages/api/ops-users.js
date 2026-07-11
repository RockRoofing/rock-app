import { requireRole } from '../../lib/portalAuth'
import { getOpsUsers, saveOpsUsers } from '../../lib/db'

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

function genPin(existing) {
  const taken = new Set(existing.map(u => String(u.pin)))
  for (let i = 0; i < 500; i++) {
    const pin = String(Math.floor(1000 + Math.random() * 9000)) // 4-digit
    if (!taken.has(pin)) return pin
  }
  // Fallback to 6-digit if 4-digit space somehow exhausted
  for (let i = 0; i < 500; i++) {
    const pin = String(Math.floor(100000 + Math.random() * 900000))
    if (!taken.has(pin)) return pin
  }
  return null
}

async function sendInviteEmail({ to, firstName, pin, isReset }) {
  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  // Replies to invite emails land in this real inbox (from-address is a
  // send-only subdomain). Override with FORMS_REPLY_TO if it ever changes.
  const REPLY_TO = process.env.FORMS_REPLY_TO || 'notifications@rockroofing.co.uk'
  if (!RESEND_KEY) return { sent: false, error: 'Email not configured' }
  const subject = isReset ? 'Your new Rock Roofing Forms PIN' : 'Welcome to Rock Roofing Forms'
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a19">
      <h2 style="color:#1a1a19">Hi ${firstName || 'there'},</h2>
      <p>${isReset ? 'Your PIN has been reset.' : 'You can now complete Rock Roofing forms from your phone.'}</p>
      <p style="font-size:15px">Your temporary PIN is:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:6px;background:#faf9f7;border:1px solid #eee;border-radius:12px;padding:16px;text-align:center;margin:12px 0">${pin}</div>
      <p>Open the Site App and log in with your <strong>mobile number</strong> and this PIN. You'll be asked to choose your own PIN the first time.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${FORMS_URL}" style="background:#ca8a04;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;display:inline-block">Open Rock Roofing Forms</a>
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

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!requireRole(req, res, ['admin'])) return;
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
      if (users.some(u => u.id !== id && String(u.pin) === String(pin))) {
        return res.status(409).json({ error: 'That PIN is already in use — please choose another.' })
      }
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
      if (!requireRole(req, res, ['admin'])) return;
      const idx = users.findIndex(u => u.id === body.id)
      if (idx < 0) return res.status(404).json({ error: 'User not found' })
      const tempPin = genPin(users)
      users[idx] = { ...users[idx], pin: tempPin, mustResetPin: true }
      await saveOpsUsers(users)
      const email = await sendInviteEmail({ to: users[idx].email, firstName: users[idx].firstName, pin: tempPin, isReset: true })
      return res.json({ ok: true, users: users.map(strip), emailSent: email.sent, emailError: email.error, tempPin })
    }

    // ── Create / update a user ────────────────────────────────────────────
    if (!requireRole(req, res, ['admin'])) return;
    const { user } = body
    if (!user || !user.firstName || !user.lastName) return res.status(400).json({ error: 'Missing name' })

    // Update existing
    if (user.id) {
      const idx = users.findIndex(u => u.id === user.id)
      if (idx < 0) return res.status(404).json({ error: 'User not found' })
      // Never overwrite pin/mustResetPin via a plain edit
      const { pin, mustResetPin, ...editable } = user
      users[idx] = { ...users[idx], ...editable }
      await saveOpsUsers(users)
      return res.json({ users: users.map(strip) })
    }

    // Create new — generate temp PIN, email invite
    const tempPin = genPin(users)
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
      active: user.active !== false,
      pin: tempPin,
      mustResetPin: true,
      createdAt: Date.now(),
    }
    users.push(newUser)
    await saveOpsUsers(users)
    const email = await sendInviteEmail({ to: newUser.email, firstName: newUser.firstName, pin: tempPin })
    return res.json({ users: users.map(strip), emailSent: email.sent, emailError: email.error, tempPin, email: newUser.email })
  }

  if (req.method === 'DELETE') {
    if (!requireRole(req, res, ['admin'])) return;
    const { id } = req.body || {}
    let users = await getOpsUsers()
    users = users.filter(u => u.id !== id)
    await saveOpsUsers(users)
    return res.json({ users: users.map(strip) })
  }

  res.status(405).end()
}
