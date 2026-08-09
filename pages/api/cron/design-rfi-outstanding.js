import { get, set } from '../../../lib/db'
import { allRfiProjectNos, rfiKey, projectRecipients, projectDisplayName, ukDate, outstandingDigestHtml, sendMail } from '../../../lib/designRfiNotify'
import { getPortalUsers } from '../../../lib/db'
import { getExternalUsers } from '../../../lib/designUsers'

const LAST_KEY = 'design:rfis-outstanding-last'  // { date, workingDayCount }

// Runs daily but only ACTS every 3 WORKING days (weekends don't count). For each project
// with UNRESOLVED RFIs, emails everyone with access a table of the outstanding items.
// Projects with none are skipped.
export default async function handler(req, res) {
  const today = ukDate()
  const force = req.query.force === '1'

  // Working-day counter: increment on Mon-Fri; when it reaches 3, send and reset to 0.
  const dow = new Date(today + 'T12:00:00Z').getUTCDay()  // 0 Sun ... 6 Sat
  const isWorkingDay = dow >= 1 && dow <= 5
  let last = await get(LAST_KEY) || { date: '', workingDayCount: 0 }
  if (!force) {
    if (last.date === today) return res.json({ ok: true, skipped: 'already ran today', today })
    let count = last.workingDayCount || 0
    if (isWorkingDay) count += 1
    if (count < 3) {
      await set(LAST_KEY, { date: today, workingDayCount: count })
      return res.json({ ok: true, skipped: `working day ${count}/3`, today })
    }
    // count >= 3: send now and reset the counter.
    await set(LAST_KEY, { date: today, workingDayCount: 0 })
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
  return res.json({ ok: true, today, projectsEmailed, emailsSent })
}
