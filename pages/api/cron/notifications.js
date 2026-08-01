import { runNotifications } from '../../../lib/notifications'

// Daily notifications pass. Each rule self-guards to its own due day/offset, and
// 'incomplete' rules only send when the relevant task grid isn't all Yes.
// ?force=1 fires every enabled rule now (testing) - ignores the day check and de-dupe.
export default async function handler(req, res) {
  try {
    const force = req.query.force === '1'
    const out = await runNotifications({ force })
    res.json(out)
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'failed' })
  }
}
