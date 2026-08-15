import { requireRole } from '../../lib/portalAuth'
import {
  getRenewalRecipients, setRenewalRecipients,
  getRenewalSchedule, setRenewalSchedule,
  collectDueTrainings, sendRenewalSummary,
} from '../../lib/hsRenewalNotify'

// Recipients + schedule for the weekly CSCS / Working at Height renewals email.
//
// GET                          -> { recipients, schedule, dueCount, overdueCount }
// POST { recipients: [...] }   -> save the list
// POST { dayOfWeek, hour }     -> save the schedule
// POST { action: 'send-now' }  -> send the list immediately (test / ad-hoc)

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return

  if (req.method === 'GET') {
    const [recipients, schedule, rows] = await Promise.all([
      getRenewalRecipients(), getRenewalSchedule(), collectDueTrainings(),
    ])
    return res.json({
      recipients, schedule,
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
