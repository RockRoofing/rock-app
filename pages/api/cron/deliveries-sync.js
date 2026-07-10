import { get, set, getTokens, saveTokens } from '../../../lib/db'
import { refreshXeroToken, fetchPurchaseOrders } from '../../../lib/xero'

// Scheduled sync: pulls newly-approved POs into the Delivery Schedule without
// anyone opening the page. Mirrors the ID-based logic in /api/deliveries.
// Scheduled hourly via vercel.json crons.
async function getDeliveries() { return (await get('ops:deliveries')) || [] }
async function saveDeliveries(v) { await set('ops:deliveries', v) }
async function getSeenIds() { return (await get('ops:deliveries:seenPoIds')) || [] }
async function setSeenIds(ids) { await set('ops:deliveries:seenPoIds', ids) }

export default async function handler(req, res) {
  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(200).json({ ok: false, reason: 'not connected' })
    try { const nt = await refreshXeroToken(tokens.refresh_token); tokens = { ...tokens, ...nt }; await saveTokens(tokens) } catch {}

    let pos = []
    try { pos = await fetchPurchaseOrders(tokens.access_token, tokens.tenant_id, { status: 'AUTHORISED' }) }
    catch (e) { return res.status(200).json({ ok: false, reason: 'po fetch failed' }) }

    let seen = await getSeenIds()
    // If no baseline yet, set it and add nothing (matches the page's first-run).
    if (seen.length === 0) {
      await setSeenIds(pos.map(p => p.purchaseOrderId))
      return res.status(200).json({ ok: true, baseline: pos.length, added: 0 })
    }

    const seenSet = new Set(seen)
    let deliveries = await getDeliveries()
    const existingPoIds = new Set(deliveries.filter(d => d.purchaseOrderId).map(d => d.purchaseOrderId))
    let added = 0
    for (const po of pos) {
      if (seenSet.has(po.purchaseOrderId) || existingPoIds.has(po.purchaseOrderId)) { seenSet.add(po.purchaseOrderId); continue }
      deliveries.push({
        id: `po_${po.purchaseOrderId}`,
        purchaseOrderId: po.purchaseOrderId,
        source: 'xero',
        poNumber: po.poNumber,
        supplier: po.supplier,
        orderDate: po.orderDate || '',
        deliveryAddress: po.deliveryAddress || '',
        requiredDeliveryDate: po.deliveryDate || '',
        lineItems: po.lineItems || [],
        projectName: po.tracking?.name || '',
        projectNo: po.tracking?.jobNo || '',
        poSent: false, supplierConfirmedDate: false, secondCheck: false,
        actualDeliveryDate: '', attachments: [], comments: '',
        createdAt: Date.now(),
      })
      seenSet.add(po.purchaseOrderId)
      added++
    }
    if (added) await saveDeliveries(deliveries)
    await setSeenIds([...seenSet])
    return res.status(200).json({ ok: true, added })
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) })
  }
}
