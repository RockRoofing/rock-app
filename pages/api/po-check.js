import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken } from '../../lib/xero'

// TEMPORARY diagnostic: inspect what Xero Purchase Orders return, so we can
// design the Deliveries feature against real data. Delete after investigation.
// GET /api/po-check   (must have reconnected Xero with accounting.transactions.read)
export default async function handler(req, res) {
  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'Not connected to Xero' })
    try {
      const nt = await refreshXeroToken(tokens.refresh_token)
      tokens = { ...tokens, ...nt }
      await saveTokens(tokens)
    } catch (e) {
      return res.json({ step: 'refresh', error: 'Token refresh failed — you may need to reconnect Xero with the new permission.', detail: String(e) })
    }

    // Fetch a small page of POs
    const r = await fetch('https://api.xero.com/api.xro/2.0/PurchaseOrders?page=1', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Xero-tenant-id': tokens.tenant_id, Accept: 'application/json' },
    })
    if (!r.ok) {
      const text = await r.text()
      return res.json({ ok: false, status: r.status, hint: r.status === 403 ? 'Scope missing — reconnect Xero (the connect page now requests Purchase Orders).' : 'Xero returned an error.', body: text.slice(0, 500) })
    }
    const data = await r.json()
    const pos = data.PurchaseOrders || []
    // Summarise the shape of the first PO with a line item, without dumping everything
    const sample = pos.find(p => (p.LineItems || []).length) || pos[0]
    const summary = sample ? {
      fieldsPresent: Object.keys(sample),
      PurchaseOrderNumber: sample.PurchaseOrderNumber,
      Status: sample.Status,
      DeliveryDate: sample.DeliveryDate || null,
      DeliveryAddress: sample.DeliveryAddress || null,
      Date: sample.Date,
      hasTracking: (sample.LineItems || []).some(li => (li.Tracking || []).length),
      exampleLineItem: (sample.LineItems || [])[0] ? {
        Description: sample.LineItems[0].Description,
        Quantity: sample.LineItems[0].Quantity,
        Tracking: sample.LineItems[0].Tracking || [],
      } : null,
    } : null
    const statusCounts = {}
    for (const p of pos) statusCounts[p.Status] = (statusCounts[p.Status] || 0) + 1

    return res.json({
      ok: true,
      totalReturned: pos.length,
      statusCounts,
      sampleSummary: summary,
      note: 'This is a temporary diagnostic. It shows whether POs carry PO number, delivery date/address, status, line items (description+qty), and project tracking.',
    })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
}
