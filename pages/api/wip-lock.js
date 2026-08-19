import { requireRole } from '../../lib/portalAuth'
import { getPortalUsers } from '../../lib/db'
import { canAccessArea } from '../../lib/roles'

// Locking a month's WIP.
//
// A lock is a record, not a restriction: it says "these figures are final and Accounts can
// work from them". It does NOT stop the commercial team editing afterwards - a genuine
// correction found on the 3rd should not need an unlock ceremony - but unlocking is
// explicit, so nobody can quietly change a signed-off month without it showing.
export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return
  if (req.method !== 'POST') return res.status(405).end()

  const { Redis } = await import('@upstash/redis')
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return res.status(500).json({ error: 'Storage not configured' })
  const redis = new Redis({ url, token })

  const { month, action, by, totalWip } = req.body || {}
  if (!month) return res.status(400).json({ error: 'month required' })
  const KEY = `wip:lock:${month}`

  if (action === 'unlock') {
    await redis.del(KEY)
    return res.json({ ok: true, lock: null })
  }

  const lock = { month, lockedAt: Date.now(), lockedBy: by || '', totalWip: Number(totalWip) || 0 }
  await redis.set(KEY, lock)

  // Tell everyone who works from these figures. Anyone with bookkeeping access - that is
  // who is waiting on it, and the whole point of the button is that they stop asking.
  let notified = []
  let notifyError = null
  try {
    const users = await getPortalUsers()
    const to = (users || [])
      // The real access map, not a guess. canAccessArea('bookkeeping') is accounts,
      // management and admin - exactly the people who work from these figures.
      .filter(u => u.email && canAccessArea(u.role, 'bookkeeping'))
      .map(u => u.email)
    if (to.length && process.env.RESEND_API_KEY) {
      const FROM = process.env.NOTIFY_FROM_EMAIL || process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
      const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      const money = '£' + (Number(totalWip) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to, subject: `WIP complete - ${label}`,
          html: `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;color:#1a1a2e;line-height:1.6">`
            + `<p><strong>${label} WIP is complete.</strong></p>`
            + `<p>Total WIP: <strong>${money}</strong></p>`
            + `<p>Signed off by ${by || 'the commercial team'}.</p>`
            + `<p>You can view it in Bookkeeping &rarr; WIP.</p>`
            + `<div style="margin-top:18px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:12px;color:#888">Sent automatically from the Rock Roofing portal.</div></div>`,
        }),
      })
      notified = to
    }
  } catch (e) {
    // The lock still stands if the email fails - but SAY SO. This swallowed the error
    // silently, and the wrong import name meant it reported "nobody has Bookkeeping
    // access" when the real problem was that the lookup had thrown. A quiet catch turned
    // a typo into a plausible-sounding business answer.
    notifyError = e?.message || 'Notification failed'
  }

  return res.json({ ok: true, lock, notified, notifyError })
}
