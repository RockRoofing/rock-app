import { get, set, getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, fetchPurchaseOrders, getProjectsFromCategories } from '../../lib/xero'

// Deliveries schedule. One row per Purchase Order.
//   - Auto: AUTHORISED POs from go-live onwards are pulled in on sync.
//   - Manual: rows added by hand (verbal/outside-Xero orders).
// Once a PO row exists it stays (even if its Xero status later changes) until
// marked complete (has an actual delivery date). Line items carry description +
// quantity ONLY (no cost).
//
// GET  /api/deliveries              -> { deliveries, projects }
// GET  /api/deliveries?sync=true    -> pull new POs first, then return
// POST /api/deliveries { delivery } -> add/update one (manual or edits)
// DELETE /api/deliveries { id }     -> remove

async function getDeliveries() { return (await get('ops:deliveries')) || [] }
async function saveDeliveries(v) { await set('ops:deliveries', v) }
async function getGoLive() { return await get('ops:deliveries:golive') }
async function setGoLive(ts) { await set('ops:deliveries:golive', ts) }

async function xeroCtx() {
  let tokens = await getTokens()
  if (!tokens) return null
  try { const nt = await refreshXeroToken(tokens.refresh_token); tokens = { ...tokens, ...nt }; await saveTokens(tokens) } catch {}
  return tokens
}

async function syncPOs() {
  const tokens = await xeroCtx()
  if (!tokens) return { error: 'Not connected to Xero' }

  // Establish go-live on first ever sync so the old back-catalogue is excluded.
  let goLive = await getGoLive()
  const firstRun = !goLive
  if (firstRun) { goLive = Date.now(); await setGoLive(goLive) }

  let deliveries = await getDeliveries()
  const existingPoIds = new Set(deliveries.filter(d => d.purchaseOrderId).map(d => d.purchaseOrderId))

  let pos = []
  try { pos = await fetchPurchaseOrders(tokens.access_token, tokens.tenant_id, { status: 'AUTHORISED' }) } catch (e) { return { error: e.message } }

  // On the very first run we set go-live and add nothing (only NEW POs from now).
  // After that, add AUTHORISED POs updated at/after go-live that we haven't seen.
  if (!firstRun) {
    for (const po of pos) {
      if (existingPoIds.has(po.purchaseOrderId)) continue
      const updated = po.updatedUTC ? Date.parse(po.updatedUTC) : Date.now()
      if (updated < goLive) continue   // pre-go-live backlog: skip
      deliveries.push({
        id: `po_${po.purchaseOrderId}`,
        purchaseOrderId: po.purchaseOrderId,
        source: 'xero',
        poNumber: po.poNumber,
        supplier: po.supplier,
        orderDate: po.orderDate || '',
        deliveryAddress: po.deliveryAddress || '',
        requiredDeliveryDate: po.deliveryDate || '',   // from Xero, manually adjustable
        lineItems: po.lineItems || [],
        // project: auto from tracking if present, else blank for manual assign
        projectName: po.tracking?.name || '',
        projectNo: po.tracking?.jobNo || '',
        poSent: false,
        supplierConfirmedDate: false,
        secondCheck: false,
        actualDeliveryDate: '',
        attachments: [],
        comments: '',
        createdAt: Date.now(),
      })
    }
    await saveDeliveries(deliveries)
  }
  return { ok: true, firstRun }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    let syncInfo = null
    if (req.query.sync === 'true') syncInfo = await syncPOs()
    const deliveries = await getDeliveries()
    // Xero project categories for the manual project dropdown (names match Xero)
    let projects = []
    try {
      const tokens = await xeroCtx()
      if (tokens) {
        const cats = await getProjectsFromCategories(tokens.access_token, tokens.tenant_id)
        projects = cats.filter(c => c.status !== 'DELETED').map(c => ({ name: c.name, jobNo: c.jobNo }))
      }
    } catch {}
    return res.json({ deliveries, projects, syncInfo })
  }

  if (req.method === 'POST') {
    const { delivery } = req.body || {}
    if (!delivery) return res.status(400).json({ error: 'Missing delivery' })
    let deliveries = await getDeliveries()
    if (!delivery.id) {
      delivery.id = `man_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
      delivery.source = 'manual'
      delivery.createdAt = Date.now()
      deliveries.push(delivery)
    } else {
      const idx = deliveries.findIndex(d => d.id === delivery.id)
      if (idx >= 0) deliveries[idx] = { ...deliveries[idx], ...delivery }
      else deliveries.push(delivery)
    }
    await saveDeliveries(deliveries)
    return res.json({ ok: true, id: delivery.id })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let deliveries = await getDeliveries()
    deliveries = deliveries.filter(d => d.id !== id)
    await saveDeliveries(deliveries)
    return res.json({ ok: true })
  }

  res.status(405).end()
}
