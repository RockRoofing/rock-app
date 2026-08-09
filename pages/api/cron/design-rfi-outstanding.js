import { get, set } from '../../../lib/db'
import { allRfiProjectNos, rfiKey, projectRecipients, projectDisplayName, ukDate, outstandingDigestHtml, sendMail } from '../../../lib/designRfiNotify'
import { getPortalUsers } from '../../../lib/db'
import { getExternalUsers } from '../../../lib/designUsers'

const LAST_KEY = 'design:rfis-outstanding-last'  // { date: 'YYYY-MM-DD' }

// Runs daily but only ACTS every 3rd day. For each project with UNRESOLVED RFIs, emails
// everyone with access a table of the outstanding items. Projects with none are skipped.
export default async function handler(req, res) {
  const today = ukDate()
  const force = req.query.force === '1'

  // Gate to every 3 days using a simple day counter, and guard against double-runs.
  const last = await get(LAST_KEY)
  const dayNum = Math.floor(Date.parse(today + 'T00:00:00Z') / 86400000)
  if (!force) {
    if (dayNum % 3 !== 0) return res.json({ ok: true, skipped: 'not a send day', today })
    if (last && last.date === today) return res.json({ ok: true, skipped: 'already ran today', today })
  }

  // Build a personName lookup across all design people.
  const [portal, ext] = await Promise.all([getPortalUsers(), getExternalUsers()])
  const nameById = {}
  for (const p of (portal || [])) nameById[p.id] = p.name || [p.firstName, p.lastName].filter(Boolean).join(' ')
  for (const e of (ext || [])) nameById[e.id] = e.name
  const personName = (id) => nameById[id] || ''

  const nos = await allRfiProjectNos()
  let projectsEmailed = 0, emailsSent = 0
  for (const no of nos) {
    const rfis = (await get(rfiKey(no))) || []
    const outstanding = rfis.filter(r => r.status !== 'resolved')
    if (!outstanding.length) continue                    // skip - nothing outstanding
    const recipients = (await projectRecipients(no)).filter(r => r.email)
    if (!recipients.length) continue
    const projectName = await projectDisplayName(no)
    for (const r of recipients) {
      const html = outstandingDigestHtml({ name: r.name, projectName, projectNo: no, rfis: outstanding, personName })
      const out = await sendMail(r.email, `Outstanding RFIs for ${projectName || no}`, html)
      if (out.sent) emailsSent++
    }
    projectsEmailed++
  }
  await set(LAST_KEY, { date: today })
  return res.json({ ok: true, today, projectsEmailed, emailsSent })
}
