import { get } from '../../lib/db'
import withTenant from '../../lib/withTenant'

async function handler(req, res) {
  try {
    const payload = await get('webhook_last_debug')
    return res.status(200).json({ debug: payload || null })
  } catch(e) {
    return res.status(200).json({ error: e.message })
  }
}

export default withTenant(handler)
