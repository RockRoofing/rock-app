import { get, set } from '../../lib/db'

// Procurement Schedule. Rows can be added manually or copied once from an IHM
// Procurement section (on Meeting Complete). Once copied, the live page is master.
//
// GET    /api/procurement                 -> { items }
// POST   /api/procurement { item }        -> add/update one
// POST   /api/procurement { action:'sync-ihm', projectNo, projectName, items:[...] }
// DELETE /api/procurement { id }          -> remove

async function getItems() { return (await get('ops:procurement')) || [] }
async function saveItems(v) { await set('ops:procurement', v) }

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.json({ items: await getItems() })
  }

  if (req.method === 'POST') {
    const body = req.body || {}

    if (body.action === 'sync-ihm') {
      const { projectNo, projectName, items: incoming } = body
      let items = await getItems()
      const existingIds = new Set(items.map(i => i.id))
      ;(incoming || []).forEach((it, i) => {
        if (!it || (!it.package && !it.supplier)) return
        const id = `ihmproc_${projectNo}_${i}`
        if (existingIds.has(id)) return   // copy once
        items.push({
          id,
          sourceIhm: projectNo,
          projectNo,
          projectName: projectName || '',
          package: it.package || '',
          supplier: it.supplier || '',
          assignee: it.assignee || '',
          designBy: it.designBy || '',
          designComplete: !!it.designComplete,
          orderBy: it.orderBy || '',
          leadInWeeks: it.leadInWeeks || '',
          requiredOnSite: it.requiredOnSite || '',
          orderPlaced: !!it.orderPlaced,
          supplierContact: it.supplierContact || '',
          comments: it.comments || '',
          attachments: [],
          createdAt: Date.now(),
        })
      })
      await saveItems(items)
      return res.json({ ok: true })
    }

    const { item } = body
    if (!item) return res.status(400).json({ error: 'Missing item' })
    let items = await getItems()
    if (!item.id) {
      if (!item.package && !item.supplier) return res.status(400).json({ error: 'Activity/Package or Supplier required' })
      item.id = `man_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
      item.source = 'manual'
      item.createdAt = Date.now()
      items.push(item)
    } else {
      const idx = items.findIndex(i => i.id === item.id)
      if (idx >= 0) items[idx] = { ...items[idx], ...item }
      else { item.createdAt = Date.now(); items.push(item) }
    }
    await saveItems(items)
    return res.json({ ok: true, id: item.id })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let items = await getItems()
    items = items.filter(i => i.id !== id)
    await saveItems(items)
    return res.json({ ok: true })
  }

  res.status(405).end()
}
