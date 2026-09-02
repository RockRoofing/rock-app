import { requireRole } from '../../lib/portalAuth'
import { readRegistry } from '../../lib/projectRegistry'

// READ-ONLY AUDIT OF THE SALES INVOICE STORE.
//
// `invoiced:lines:<trackingOptionId>` is meant to hold CUSTOMER invoices only. Two
// writers put supplier bills in it: getInvoicesByCategory (lib/xero.js) and
// deep-sync's fetchSalesInvoices. Both send `?Type=ACCREC` as a bare query param,
// which Xero IGNORES - the type has to be inside the `where` clause - and neither
// checks inv.Type afterwards. Their only test is "does this document have a line
// tagged to this project", which a supplier bill tagged to the project passes.
//
// Those rows carry no `type` field, so nothing downstream can tell them apart by
// looking at the row. But the app already separates bills from invoices by STORE:
// every supplier bill is in `costs:bills:<id>` and/or `bank:outstanding-bills`, and
// both sides carry the same Xero InvoiceID. So the contamination is an ID set
// intersection against data we already hold. No Xero call, nothing overwritten.
//
// THIS ENDPOINT WRITES NOTHING. In particular it must never touch dashboard:cache -
// rebuilding that key is what flips the Cash Flow onto the contaminated source.

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

async function scanKeys(redis, pattern) {
  const found = []
  let cursor = 0
  let guard = 0
  do {
    const [next, batch] = await redis.scan(cursor, { match: pattern, count: 500 })
    cursor = typeof next === 'string' ? parseInt(next) : next
    if (Array.isArray(batch)) found.push(...batch)
    guard++
  } while (cursor !== 0 && guard < 200)
  return found
}

// Chunked parallel reads. Sequential gets over ~200 project stores plus ~200 bill
// stores is 400 round trips and risks the function timing out. Mapped, never
// destructured - a Promise.all destructuring mismatch is how variables silently
// shift onto the wrong values.
async function getMany(redis, keys, size = 20) {
  const out = []
  for (let i = 0; i < keys.length; i += size) {
    const chunk = keys.slice(i, i + size)
    const vals = await Promise.all(chunk.map(k => redis.get(k).catch(() => null)))
    for (let j = 0; j < chunk.length; j++) out.push({ key: chunk[j], value: vals[j] })
  }
  return out
}

const num = (v) => Number(v) || 0
const normContact = (s) => String(s || '').trim().toLowerCase()

// Both id field names are in use: sync-invoices and deep-sync write xeroInvoiceId,
// wip-sync writes invoiceId. Reading only one of them would miss half the rows.
const rowId = (r) => String(r?.xeroInvoiceId || r?.invoiceId || '') || null

export default async function handler(req, res) {
  if (!requireRole(req, res, ['admin'])) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })

  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  try {
    const registry = await readRegistry(redis)

    // ---- 1. Every supplier bill we hold, by Xero InvoiceID --------------------
    const billIds = new Set()
    const billContacts = new Set()
    const billMeta = {}   // id -> { supplier, ref, date }

    const outstanding = await redis.get('bank:outstanding-bills').catch(() => null)
    for (const b of ((outstanding && outstanding.items) || [])) {
      const id = String(b.id || '')
      if (id) { billIds.add(id); billMeta[id] = { supplier: b.contact || '', ref: b.number || b.reference || '', date: b.date || '' } }
      if (b.contact) billContacts.add(normContact(b.contact))
    }

    const billKeys = await scanKeys(redis, 'costs:bills:*')
    const billStores = await getMany(redis, billKeys)
    for (const entry of billStores) {
      const v = entry.value
      for (const l of ((v && v.lines) || [])) {
        const id = String(l.xeroInvoiceId || '')
        if (id) { billIds.add(id); if (!billMeta[id]) billMeta[id] = { supplier: l.supplier || '', ref: l.reference || '', date: l.date || '' } }
        if (l.supplier) billContacts.add(normContact(l.supplier))
      }
    }

    // ---- 2. Contacts that are genuinely customers ----------------------------
    // A name appearing in the receivables store is a customer, whatever else it
    // does. Without this, anyone who both buys from us and sells to us would be
    // flagged on the contact test. The ID test is unaffected either way.
    const custContacts = new Set()
    const recStore = await redis.get('bank:outstanding-receivables').catch(() => null)
    for (const i of ((recStore && recStore.items) || [])) {
      if (i.contact) custContacts.add(normContact(i.contact))
    }

    // ---- 3. Walk the sales invoice store -------------------------------------
    const lineKeys = await scanKeys(redis, 'invoiced:lines:*')
    const projects = []
    const flagged = []
    let rowsScanned = 0
    let totalFlaggedDue = 0
    let totalFlaggedValue = 0

    const lineStores = await getMany(redis, lineKeys)
    for (const entry of lineStores) {
      const pid = entry.key.slice('invoiced:lines:'.length)
      const rows = entry.value
      if (!Array.isArray(rows)) continue
      const reg = registry[pid] || {}
      const jobNo = reg.jobNo || ''
      const name = reg.name || (pid === '__UNASSIGNED__' ? 'Unassigned (no project tag in Xero)' : pid)

      let pFlagged = 0, pDue = 0, pValue = 0, pTotal = 0
      for (const r of rows) {
        rowsScanned++
        pTotal += num(r.total)
        const id = rowId(r)
        const contact = normContact(r.contact)
        const idMatch = !!(id && billIds.has(id))
        const contactMatch = !idMatch && !!contact && billContacts.has(contact) && !custContacts.has(contact)
        if (!idMatch && !contactMatch) continue
        pFlagged++
        pDue += num(r.amountDue)
        pValue += num(r.total)
        flagged.push({
          projectId: pid,
          jobNo,
          project: name,
          basis: idMatch ? 'id' : 'contact',
          contact: r.contact || '',
          number: r.invoiceNumber || '',
          reference: r.reference || '',
          date: r.date || '',
          dueDate: r.dueDate || '',
          total: num(r.total),
          amountDue: num(r.amountDue),
          status: r.status || '',
          xeroId: id || '',
          billSupplier: (id && billMeta[id] && billMeta[id].supplier) || '',
        })
      }

      totalFlaggedDue += pDue
      totalFlaggedValue += pValue
      projects.push({
        projectId: pid, jobNo, project: name,
        rows: rows.length, flagged: pFlagged,
        flaggedDue: Math.round(pDue),
        flaggedValue: Math.round(pValue),
        invoicedTotal: Math.round(pTotal),
      })
    }

    flagged.sort((a, b) => Math.abs(b.amountDue) - Math.abs(a.amountDue) || Math.abs(b.total) - Math.abs(a.total))
    projects.sort((a, b) => b.flaggedDue - a.flaggedDue || b.flaggedValue - a.flaggedValue)

    return res.json({
      ok: true,
      scannedAt: new Date().toISOString(),
      counts: {
        lineKeys: lineKeys.length,
        billKeys: billKeys.length,
        billIds: billIds.size,
        rowsScanned,
        flaggedRows: flagged.length,
        projectsAffected: projects.filter(p => p.flagged > 0).length,
      },
      totals: {
        // What the Cash Flow's arrears row would pick up: outstanding amount on
        // rows that are actually supplier bills.
        flaggedDue: Math.round(totalFlaggedDue),
        // Full value, which is what inflates invoiced:latest -> WIP and margin.
        flaggedValue: Math.round(totalFlaggedValue),
      },
      projects,
      flagged,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
