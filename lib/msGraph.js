// Microsoft Graph - app-only access to the mailboxes in the CRM Sync Mailboxes group.
//
// Access is restricted at the Microsoft end by an application access policy, so even
// though the app holds Mail.Read for the tenant, Exchange refuses any mailbox outside that
// group. Nothing here needs to enforce that - but the code below never asks for a mailbox
// it has not been told about either.

const TOKEN_URL = (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
const GRAPH = 'https://graph.microsoft.com/v1.0'

let cachedToken = null   // { value, expires }

export function graphConfigured() {
  return !!(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET)
}

export async function getGraphToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value
  if (!graphConfigured()) throw new Error('Microsoft Graph is not configured (MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET)')

  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const r = await fetch(TOKEN_URL(process.env.MS_TENANT_ID), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  const d = await r.json()
  if (!r.ok) throw new Error(`Graph token failed: ${d.error_description || d.error || r.status}`)
  cachedToken = { value: d.access_token, expires: Date.now() + (d.expires_in || 3600) * 1000 }
  return cachedToken.value
}

async function graphGet(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (r.status === 429) {
    // Graph throttles hard on large backfills. Respect its own retry hint.
    const wait = parseInt(r.headers.get('retry-after') || '10', 10)
    await new Promise((res) => setTimeout(res, wait * 1000))
    return graphGet(url, token)
  }
  const d = await r.json()
  if (!r.ok) throw new Error(`Graph ${r.status}: ${d.error?.message || 'request failed'}`)
  return d
}

// Members of the sync group, so the code works from one list rather than hard-coded
// addresses - add somebody to the group in Microsoft and they are picked up here.
export async function listSyncMailboxes(groupAddress) {
  const token = await getGraphToken()
  const g = await graphGet(`${GRAPH}/groups?$filter=mail eq '${encodeURIComponent(groupAddress)}'&$select=id,mail`, token)
  const group = (g.value || [])[0]
  if (!group) throw new Error(`Sync group ${groupAddress} not found`)
  const m = await graphGet(`${GRAPH}/groups/${group.id}/members?$select=id,mail,displayName,userPrincipalName&$top=100`, token)
  return (m.value || [])
    .filter((u) => u.mail || u.userPrincipalName)
    .map((u) => ({ email: (u.mail || u.userPrincipalName).toLowerCase(), name: u.displayName || '' }))
}

// Messages from one mailbox, sent and received, newest first, since a given time.
// Deliberately selects only the fields needed - pulling full bodies would be far heavier
// and is not wanted; a preview is enough to recognise an email in a project history.
export async function fetchMessages({ mailbox, since, max = 2000 }) {
  const token = await getGraphToken()
  const select = 'id,conversationId,subject,bodyPreview,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients,webLink,isDraft'
  let url = `${GRAPH}/users/${encodeURIComponent(mailbox)}/messages`
    + `?$select=${select}&$top=50&$orderby=receivedDateTime desc`
  if (since) url += `&$filter=receivedDateTime ge ${since}`

  const out = []
  while (url && out.length < max) {
    const page = await graphGet(url, token)
    for (const m of (page.value || [])) {
      if (m.isDraft) continue
      out.push({
        id: m.id,
        conversationId: m.conversationId || '',
        subject: m.subject || '(no subject)',
        preview: (m.bodyPreview || '').slice(0, 400),
        date: m.receivedDateTime || m.sentDateTime || '',
        from: m.from?.emailAddress?.address?.toLowerCase() || '',
        fromName: m.from?.emailAddress?.name || '',
        to: (m.toRecipients || []).map((r) => r.emailAddress?.address?.toLowerCase()).filter(Boolean),
        cc: (m.ccRecipients || []).map((r) => r.emailAddress?.address?.toLowerCase()).filter(Boolean),
        webLink: m.webLink || '',
        mailbox,
      })
    }
    url = page['@odata.nextLink'] || null
  }
  return out
}
