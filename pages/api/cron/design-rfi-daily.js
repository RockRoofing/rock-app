import { get, set } from '../../../lib/db'
import { allRfiProjectNos, pendingKey, projectRecipients, projectDisplayName, ukDate, dailyDigestHtml, sendMail } from '../../../lib/designRfiNotify'

// Runs a few times a day. For each project that has had a new RFI or comment TODAY and
// hasn't been emailed yet today, send ONE digest to everyone with access to that project.
// This is the "only once per day" guard - once emailedDate == today, it won't send again.
export default async function handler(req, res) {
  const today = ukDate()
  const nos = await allRfiProjectNos()
  let projectsEmailed = 0, emailsSent = 0
  for (const no of nos) {
    const pend = await get(pendingKey(no))
    if (!pend || pend.date !== today) continue          // nothing new today
    if (pend.emailedDate === today) continue             // already sent today
    if (!(pend.newRfis > 0 || pend.comments > 0)) continue
    const recipients = await projectRecipients(no)
    const withEmail = recipients.filter(r => r.email)
    if (withEmail.length) {
      const projectName = await projectDisplayName(no)
      for (const r of withEmail) {
        const html = dailyDigestHtml({ name: r.name, projectName, projectNo: no, newRfis: pend.newRfis, comments: pend.comments })
        const subject = pend.newRfis > 0 && pend.comments === 0
          ? `New RFIs added for ${projectName || no}`
          : pend.comments > 0 && pend.newRfis === 0
            ? `New comments on RFIs for ${projectName || no}`
            : `RFI updates for ${projectName || no}`
        const out = await sendMail(r.email, subject, html)
        if (out.sent) emailsSent++
      }
      projectsEmailed++
    }
    // Mark emailed for today regardless, so we don't retry the same batch on the next run.
    await set(pendingKey(no), { ...pend, emailedDate: today })
  }
  return res.json({ ok: true, date: today, projectsEmailed, emailsSent })
}
