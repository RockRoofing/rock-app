import { getTokens, saveTokens } from '../../../lib/db'
import { refreshXeroToken } from '../../../lib/xero'

export default async function handler(req, res) {
  let tokens = await getTokens()
  const newTokens = await refreshXeroToken(tokens.refresh_token)
  tokens = { ...tokens, ...newTokens }
  await saveTokens(tokens)

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  const fromDate = ninetyDaysAgo.toISOString().split('T')[0]

  let page = 1
  let total = 0
  while (true) {
    const r = await fetch(
      `https://api.xero.com/api.xro/2.0/Invoices?Type=ACCPAY&Statuses=PAID&page=${page}&pageSize=100&fromDate=${fromDate}`,
      { headers: { Authorization: `Bearer ${tokens.access_token}`, 'xero-tenant-id': tokens.tenant_id, Accept: 'application/json' } }
    )
    const d = await r.json()
    const count = d.Invoices?.length || 0
    total += count
    if (count < 100) break
    page++
    await new Promise(r => setTimeout(r, 500))
  }

  res.json({ totalPaidBills90Days: total, pages: page })
}
