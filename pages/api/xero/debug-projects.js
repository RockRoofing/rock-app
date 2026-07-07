import { getTokens, saveTokens } from '../../../lib/db'
import { refreshXeroToken } from '../../../lib/xero'

export default async function handler(req, res) {
  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'No tokens' })
    const newTokens = await refreshXeroToken(tokens.refresh_token)
    tokens = { ...tokens, ...newTokens }
    await saveTokens(tokens)

    const projectId = req.query.projectId
    const endpoint = req.query.endpoint || 'tasks'
    const page = req.query.page || 1
    const pageSize = req.query.pageSize || 5

    if (!projectId) {
      const url = `https://api.xero.com/projects.xro/1.0/projects?states=INPROGRESS&pageSize=5`
      const r = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Xero-Tenant-Id': tokens.tenant_id,
          'Accept': 'application/json'
        }
      })
      const data = await r.json()
      return res.json({ status: r.status, url, data })
    }

    const url = `https://api.xero.com/projects.xro/1.0/projects/${projectId}/${endpoint}?page=${page}&pageSize=${pageSize}`
    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Xero-Tenant-Id': tokens.tenant_id,
        'Accept': 'application/json'
      }
    })
    const text = await r.text()
    res.json({ status: r.status, url, preview: text.slice(0, 2000) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
