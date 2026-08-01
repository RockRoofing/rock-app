import { runNotifications } from '../../../lib/notifications'

// Daily notifications pass. Each rule self-guards to its own due day/offset, and
// 'incomplete' rules only send when the relevant task grid isn't all Yes.
// ?force=1 fires every enabled rule now (testing) - ignores the day check and de-dupe.
export default async function handler(req, res) {
  try {
    const force = req.query.force === '1'
    // Evaluate "today" in UK local time (the cron ticks in UTC).
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
    const g = (t) => p.find(x => x.type === t)?.value
    const today = new Date(Number(g('year')), Number(g('month')) - 1, Number(g('day')))
    const out = await runNotifications({ force, today })
    res.json(out)
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'failed' })
  }
}
