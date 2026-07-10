import { get, getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, fetchPurchaseOrders } from '../../lib/xero'

// TEMPORARY diagnostic for the ID-based Deliveries sync.
// Shows: baseline size, imported rows, and for each recent AUTHORISED PO
// whether its id is already "seen" (baseline/backlog) or would be added.
// GET /api/po-check   — delete after use.
export default async function handler(req, res) {
  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'Not connected to Xero' })
    try { const nt = await refreshXeroToken(tokens.refresh_token); tokens = { ...tokens, ...nt }; await saveTokens(tokens) }
    catch (e) { return res.json({ error: 'Token refresh failed — reconnect Xero.', detail: String(e) }) }

    const seen = (await get('ops:deliveries:seenPoIds')) || []
    const seenSet = new Set(seen)
    const deliveries = (await get('ops:deliveries')) || []
    const importedIds = new Set(deliveries.filter(d => d.purchaseOrderId).map(d => d.purchaseOrderId))

    let pos = []
    try { pos = await fetchPurchaseOrders(tokens.access_token, tokens.tenant_id, { status: 'AUTHORISED' }) }
    catch (e) { return res.json({ error: 'PO fetch failed', detail: e.message }) }

    const recent = pos.slice(0, 15).map(po => ({
      poNumber: po.poNumber,
      poId: po.purchaseOrderId,
      inBaseline_seen: seenSet.has(po.purchaseOrderId),
      alreadyImported: importedIds.has(po.purchaseOrderId),
      wouldBeAddedOnNextSync: !seenSet.has(po.purchaseOrderId) && !importedIds.has(po.purchaseOrderId),
    }))

    return res.json({
      baselineExists: seen.length > 0,
      baselineSize: seen.length,
      importedRowCount: deliveries.filter(d => d.source === 'xero').length,
      totalAuthorisedReturned: pos.length,
      firstSyncWillBaselineEverything: seen.length === 0,
      recentAuthorisedPOs: recent,
      note: seen.length === 0
        ? 'No baseline yet. The NEXT sync will set the baseline (record all current POs, add none). Approve a PO AFTER that sync to see it come in.'
        : 'If your PO shows inBaseline_seen:true, it was approved before the baseline sync and is treated as backlog. Approve a NEW one to test, or tell me its PO number to force-add it.',
    })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
}
