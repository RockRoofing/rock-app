import { get, set } from '../../../lib/db'
import { allCalculationProjectNos, calcPendingKey, projectRecipients, projectDisplayName, ukDate, calculationDigestHtml, sendMail } from '../../../lib/designRfiNotify'

// Runs once at the END OF THE DAY. For each project that has had COMMENTS on Calculations
// today and hasn't been emailed yet today, send ONE digest to everyone with access.
export default async function handler(req, res) {
  const today = ukDate()
  const nos = await allCalculationProjectNos()
  let projectsEmailed = 0, emailsSent = 0
  for (const no of nos) {
    const pend = await get(calcPendingKey(no))
    if (!pend || pend.date !== today) continue
    if (pend.emailedDate === today) continue
    if (!(pend.comments > 0)) continue
    const recipients = (await projectRecipients(no)).filter(r => r.email)
    if (recipients.length) {
      const projectName = await projectDisplayName(no)
      for (const r of recipients) {
        const html = calculationDigestHtml({ name: r.name, projectName, projectNo: no, comments: pend.comments })
        const out = await sendMail(r.email, `New comments on Calculations for ${projectName || no}`, html)
        if (out.sent) emailsSent++
      }
      projectsEmailed++
    }
    await set(calcPendingKey(no), { ...pend, emailedDate: today })
  }
  return res.json({ ok: true, date: today, projectsEmailed, emailsSent })
}
