import { getTokens } from '../../../lib/db'
export default async function handler(req, res) {
  const tokens = await getTokens()
  res.json({ 
    connected: !!tokens?.refresh_token,
    tenant_id: tokens?.tenant_id || null,
    has_access_token: !!tokens?.access_token,
    has_refresh_token: !!tokens?.refresh_token,
    scope: tokens?.scope || null
  })
}
