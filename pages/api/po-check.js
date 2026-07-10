import { get, getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, fetchPurchaseOrders } from '../../lib/xero'

// TEMPORARY diagnostic: explains why POs are / aren't appearing on the
// Delivery Schedule. Shows go-live, and for each recent AUTHORISED PO whether
// it qualifies (order date >= go-live) and whether it's already imported.
// GET /api/po-check   — delete after use.
export default async function handler(req, res) {
  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'Not connected to Xero' })
    try { const nt = await refreshXeroToken(tokens.refresh_token); tokens = { ...tokens, ...nt }; await saveTokens(tokens) }
    catch (e) { return res.json({ error: 'Token refresh failed — reconnect Xero.', detail: String(e) }) }

    const goLive = await get('ops:deliveries:golive')
    const goLiveDay = goLive ? new Date(goLive).toISOString().slice(0, 10) : null
    const deliveries = (await get('ops:deliveries')) || []
    const importedIds = new Set(deliveries.filter(d => d.purchaseOrderId).map(d => d.purchaseOrderId))

    let pos = []
    try { pos = await fetchPurchaseOrders(tokens.access_token, tokens.tenant_id, { status: 'AUTHORISED' }) }
    catch (e) { return res.json({ error: 'PO fetch failed', detail: e.message }) }

    // Show the 15 most recent AUTHORISED POs and why each does/doesn't qualify
    const recent = pos.slice(0, 15).map(po => ({
      poNumber: po.poNumber,
      status: po.status,
      orderDate: po.orderDate,
      alreadyImported: importedIds.has(po.purchaseOrderId),
      qualifies: !!(po.orderDate && goLiveDay && po.orderDate >= goLiveDay && !importedIds.has(po.purchaseOrderId)),
      reasonIfNot: !po.orderDate ? 'no order date on PO'
        : !goLiveDay ? 'go-live not set (run a sync once to set it)'
        : po.orderDate < goLiveDay ? `order date ${po.orderDate} is BEFORE go-live ${goLiveDay}`
        : importedIds.has(po.purchaseOrderId) ? 'already imported'
        : 'qualifies — should appear on next sync',
    }))

    return res.json({
      goLiveTimestamp: goLive || null,
      goLiveDay,
      totalAuthorisedReturned: pos.length,
      alreadyImportedCount: deliveries.filter(d => d.source === 'xero').length,
      recentAuthorisedPOs: recent,
      note: 'If your PO shows "order date ... is BEFORE go-live", that is why it is not appearing. Tell me and I can adjust the cutoff.',
    })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
}
