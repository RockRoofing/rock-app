import { requireRole } from '../../lib/portalAuth'
import { getPortalUsers } from '../../lib/db'
import {
  getRenewalRecipients, setRenewalRecipients,
  getRenewalSchedule, setRenewalSchedule,
  collectDueTrainings, sendRenewalSummary,
  runOperativeRenewalReminders,
} from '../../lib/hsRenewalNotify'

// Recipients + schedule for the weekly CSCS / Working at Height renewals email.
//
// GET                          -> { recipients, schedule, dueCount, overdueCount, portalUsers }
// POST { recipients: [...] }   -> save the list
// POST { dayOfWeek, hour }     -> save the schedule
// POST { action: 'send-now' }  -> send the weekly list immediately
// POST { action: 'send-operative-now' } -> send the operative reminders immediately

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return

  if (req.method === 'GET') {
    const [recipients, schedule, rows, portal] = await Promise.all([
      getRenewalRecipients(), getRenewalSchedule(), collectDueTrainings(), getPortalUsers(),
    ])
    // Portal users offered as tick-box recipients so their addresses do not have to be
    // typed by hand. Stored as plain emails, so a recipient survives the user being
    // renamed - and removing them from the portal does not silently stop the email.
    const portalUsers = (portal || [])
      .filter(u => u.active !== false && u.email)
      .map(u => ({
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || u.email,
        email: u.email,
        role: u.jobRole || u.role || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return res.json({
      recipients, schedule, portalUsers,
      dueCount: rows.length,
      overdueCount: rows.filter(r => r.overdue).length,
    })
  }

  if (req.method === 'POST') {
    const body = req.body || {}

    if (body.action === 'send-now') {
      const result = await sendRenewalSummary()
      return res.json(result)
    }

    // Fire the operative reminders on demand. force bypasses the weekly throttle, so
    // someone reminded recently will be reminded again - the confirm warns about that.
    if (body.action === 'send-operative-now') {
      const result = await runOperativeRenewalReminders({ force: true })
      return res.json(result)
    }

    let recipients = null, schedule = null
    if (Array.isArray(body.recipients)) recipients = await setRenewalRecipients(body.recipients)
    if (body.dayOfWeek !== undefined && body.hour !== undefined) {
      schedule = await setRenewalSchedule({ dayOfWeek: body.dayOfWeek, hour: body.hour })
    }
    if (recipients === null && schedule === null) return res.status(400).json({ error: 'Nothing to save' })

    return res.json({
      ok: true,
      recipients: recipients || (await getRenewalRecipients()),
      schedule: schedule || (await getRenewalSchedule()),
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
