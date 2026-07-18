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

async function getSeenIds() { return (await get('ops:deliveries:seenPoIds')) || [] }
async function setSeenIds(ids) { await set('ops:deliveries:seenPoIds', ids) }

async function syncPOs() {
  const tokens = await xeroCtx()
  if (!tokens) return { error: 'Not connected to Xero' }

  let pos = []
  try { pos = await fetchPurchaseOrders(tokens.access_token, tokens.tenant_id, { status: 'AUTHORISED' }) } catch (e) { return { error: e.message } }

  let deliveries = await getDeliveries()
  const existingPoIds = new Set(deliveries.filter(d => d.purchaseOrderId).map(d => d.purchaseOrderId))

  // ID-based "going forward" rule (dates on POs are unreliable):
  //  - First ever sync: record every current AUTHORISED PO id as "seen",
  //    add nothing. This draws the line — everything existing now is backlog.
  //  - Later syncs: any AUTHORISED PO whose id we've never seen is NEW -> add it.
  let seen = await getSeenIds()
  const firstRun = seen.length === 0
  const seenSet = new Set(seen)

  if (firstRun) {
    await setSeenIds(pos.map(p => p.purchaseOrderId))
    return { ok: true, firstRun, baseline: pos.length }
  }

  let added = 0, updated = 0
  const byPoId = new Map(deliveries.filter(d => d.purchaseOrderId).map(d => [d.purchaseOrderId, d]))
  for (const po of pos) {
    const trackNo = po.tracking?.jobNo || ''
    const trackName = po.tracking?.name || ''
    const existing = byPoId.get(po.purchaseOrderId)
    if (existing) {
      // Already known. Keep it as backlog, BUT refresh its project allocation from
      // Xero's current tracking category if it changed there (e.g. the category
      // was added/changed on the PO after it was first synced).
      if (trackNo && matchProject(existing.projectNo) !== matchProject(trackNo)) {
        existing.projectNo = trackNo
        existing.projectName = trackName || existing.projectName || ''
        updated++
      } else if (!existing.projectNo && trackNo) {
        existing.projectNo = trackNo
        existing.projectName = trackName || existing.projectName || ''
        updated++
      }
      seenSet.add(po.purchaseOrderId)
      continue
    }
    if (seenSet.has(po.purchaseOrderId)) continue      // seen but not in list (removed) -> skip
    // NEW PO -> add it (regardless of any date)
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
      projectName: trackName,
      projectNo: trackNo,
      poSent: false,
      supplierConfirmedDate: false,
      secondCheck: false,
      actualDeliveryDate: '',
      attachments: [],
      comments: '',
      createdAt: Date.now(),
    })
    seenSet.add(po.purchaseOrderId)
    added++
  }
  await saveDeliveries(deliveries)
  await setSeenIds([...seenSet])
  return { ok: true, firstRun: false, added, updated }
}
function matchProject(s) { return String(s || '').trim().replace(/^[#jJ]/, '').toLowerCase() }

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
    const body = req.body || {}

    // One-time cleanup: capture ALL current AUTHORISED PO ids as baseline and
    // remove xero-synced rows, so the schedule restarts cleanly from now.
    // (Fixes an earlier gap where only the first 100 POs were baselined.)
    if (body.action === 'rebaseline') {
      const tokens = await xeroCtx()
      if (!tokens) return res.status(400).json({ error: 'Not connected to Xero' })
      let pos = []
      try { pos = await fetchPurchaseOrders(tokens.access_token, tokens.tenant_id, { status: 'AUTHORISED' }) }
      catch (e) { return res.status(502).json({ error: e.message }) }
      await setSeenIds(pos.map(p => p.purchaseOrderId))
      let deliveries = await getDeliveries()
      const kept = deliveries.filter(d => d.source !== 'xero')
      await saveDeliveries(kept)
      return res.json({ ok: true, baselineSize: pos.length, removedRows: deliveries.length - kept.length })
    }

    // Clean-up: remove all Xero-synced rows and reset go-live to now, so the
    // schedule starts fresh from this moment. Manual rows are kept.
    if (body.action === 'reset-synced') {
      let deliveries = await getDeliveries()
      const kept = deliveries.filter(d => d.source !== 'xero')
      await saveDeliveries(kept)
      await setSeenIds([])   // clear baseline so next sync re-establishes "from now"
      return res.json({ ok: true, removed: deliveries.length - kept.length, kept: kept.length })
    }

    const { delivery } = body
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
