import { get, set } from '../../../lib/db'
import { allRfiProjectNos, pendingKey, projectRecipients, projectDisplayName, ukDate, dailyDigestHtml, sendMail } from '../../../lib/designRfiNotify'

// Runs once at the END OF THE DAY. For each project that has had COMMENTS on RFIs today and
// hasn't been emailed yet today, send ONE digest to everyone with access to that project.
// (New RFIs are emailed immediately at creation time - they are NOT part of this digest.)
export default async function handler(req, res) {
  const today = ukDate()
  const nos = await allRfiProjectNos()
  let projectsEmailed = 0, emailsSent = 0
  for (const no of nos) {
    const pend = await get(pendingKey(no))
    if (!pend || pend.date !== today) continue          // nothing new today
    if (pend.emailedDate === today) continue             // already sent today
    if (!(pend.comments > 0)) continue                   // only comments trigger this digest
    const recipients = await projectRecipients(no)
    const withEmail = recipients.filter(r => r.email)
    if (withEmail.length) {
      const projectName = await projectDisplayName(no)
      for (const r of withEmail) {
        const html = dailyDigestHtml({ name: r.name, projectName, projectNo: no, newRfis: 0, comments: pend.comments })
        const out = await sendMail(r.email, `New comments on RFIs for ${projectName || no}`, html)
        if (out.sent) emailsSent++
      }
      projectsEmailed++
    }
    await set(pendingKey(no), { ...pend, emailedDate: today })
  }
  return res.json({ ok: true, date: today, projectsEmailed, emailsSent })
}
