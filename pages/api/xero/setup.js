import { saveTokens, getTokens } from '../../../lib/db'

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { access_token, refresh_token, scope } = req.body
    if (!access_token || !refresh_token) {
      return res.status(400).json({ error: 'access_token and refresh_token required' })
    }
    await saveTokens({ access_token, refresh_token, scope: scope || '' })
    res.json({ ok: true, message: 'Tokens saved successfully' })
  } else if (req.method === 'GET') {
    const tokens = await getTokens()
    res.json({ connected: !!tokens, hasRefreshToken: !!(tokens?.refresh_token) })
  } else {
    res.status(405).end()
  }
}
