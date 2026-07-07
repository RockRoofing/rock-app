import { get } from '../../lib/db'

export default async function handler(req, res) {
  try {
    const payload = await get('webhook_last_debug')
    return res.status(200).json({ debug: payload || null })
  } catch(e) {
    return res.status(200).json({ error: e.message })
  }
}
