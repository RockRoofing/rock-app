import { saveTokens } from '../../../lib/db'

export default async function handler(req, res) {
  const { code } = req.query
  if (!code) return res.status(400).json({ error: 'No code provided' })

  const redirectUri = process.env.NEXT_PUBLIC_APP_URL    
    ? `${process.env.NEXT_PUBLIC_APP_URL}/xero-callback`   
    : 'https://rockroofing-app.vercel.app/xero-callback'

  try {
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: process.env.XERO_CLIENT_ID,
        client_secret: process.env.XERO_CLIENT_SECRET
      })
    })
    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      return res.status(400).json({ error: 'Token exchange failed: ' + err })
    }
    const tokens = await tokenRes.json()
    const connRes = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const connections = connRes.ok ? await connRes.json() : []
    const tenantId = connections[0]?.tenantId || null
    await saveTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      expires_at: Date.now() + (tokens.expires_in * 1000),
      tenant_id: tenantId
    })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
