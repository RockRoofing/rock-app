import { requireRole } from '../../lib/portalAuth'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken, getProjectsFromCategories } from '../../lib/xero'
import { invoiceLineKey, mergeDedupe } from '../../lib/costDedupe'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

// RFC-4180-ish CSV line parser (handles quoted fields with commas + "" escapes).
function parseCSVLine(line) {
  const out = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false }
      else cur += c
    } else {
      if (c === '"') q = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out
}
const num = (x) => { const n = parseFloat(String(x || '').replace(/,/g, '')); return isNaN(n) ? 0 : n }
const parseDate = (s) => {
  if (!s) return null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s.trim())
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return s
}

// Turn a Xero TaxType into a short label.
function taxLabel(t) {
  const s = (t || '').toLowerCase()
  if (s.includes('reverse charge')) return '0% reverse charge'
  if (s.includes('zero rated')) return '0% zero-rated'
  if (s === 'no vat' || s.includes('no vat')) return 'No VAT'
  if (s.includes('exempt')) return 'Exempt'
  const m = /@?\s*(\d+(?:\.\d+)?)\s*%/.exec(t || '')
  if (m) return `${parseFloat(m[1])}%`
  return t || '—'
}

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { fileData } = req.body
    if (!fileData) return res.status(400).json({ error: 'No file provided' })

    const csv = Buffer.from(fileData, 'base64').toString('utf8')
    const rows = csv.split(/\r?\n/).filter(l => l.trim())
    if (rows.length < 2) return res.status(400).json({ error: 'Empty file' })

    const headers = parseCSVLine(rows[0]).map(h => h.trim())
    const H = (name) => headers.indexOf(name)
    const col = {
      invoiceNumber: H('InvoiceNumber'), invoiceDate: H('InvoiceDate'), dueDate: H('DueDate'),
      total: H('Total'), taxTotal: H('TaxTotal'),
      amountPaid: H('InvoiceAmountPaid'), amountDue: H('InvoiceAmountDue'),
      trackingOption1: H('TrackingOption1'), contact: H('ContactName'),
      status: H('Status'), type: H('Type'), reference: H('Reference'), taxType: H('TaxType'),
    }
    if (col.invoiceNumber === -1 || col.total === -1 || col.trackingOption1 === -1) {
      return res.status(400).json({ error: 'Unrecognised file — please upload the Xero "Sales Invoices" export (CSV).' })
    }

    // ── Parse: one CSV row per line item; dedupe invoices; collect line tax types ──
    // Keyed by TrackingOption1 (project) -> InvoiceNumber -> invoice record.
    const byProject = new Map()   // trackingName -> Map(invNo -> {invoice})
    for (let i = 1; i < rows.length; i++) {
      const c = parseCSVLine(rows[i])
      if (c.length < 3) continue
      const type = (c[col.type] || '').toLowerCase()
      // Only real sales invoices + credit notes count toward invoiced totals.
      const isInvoice = type.includes('sales invoice')
      const isCredit = type.includes('credit note')
      if (!isInvoice && !isCredit) continue          // skip overpayments/prepayments

      // Invoices with no Projects tag can't be attributed to a project — collect
      // them under a reserved "Unassigned" bucket so they're still visible (e.g.
      // retention invoices raised without the tracking category).
      const tracking = (c[col.trackingOption1] || '').trim() || '__UNASSIGNED__'

      const invNo = (c[col.invoiceNumber] || '').trim()
      if (!invNo) continue

      if (!byProject.has(tracking)) byProject.set(tracking, new Map())
      const invMap = byProject.get(tracking)

      const taxTypeLabel = taxLabel(c[col.taxType])
      if (!invMap.has(invNo)) {
        invMap.set(invNo, {
          invoiceNumber: invNo,
          date: parseDate(c[col.invoiceDate]),
          dueDate: parseDate(c[col.dueDate]),
          contact: c[col.contact] || '',
          reference: c[col.reference] || '',
          total: num(c[col.total]) * (isCredit ? -1 : 1),
          totalTax: num(c[col.taxTotal]) * (isCredit ? -1 : 1),
          amountPaid: num(c[col.amountPaid]),
          amountDue: num(c[col.amountDue]),
          status: c[col.status] || '',
          isCredit,
          taxTypes: new Set([taxTypeLabel]),
        })
      } else {
        // Same invoice, another line — just record its tax type.
        invMap.get(invNo).taxTypes.add(taxTypeLabel)
      }
    }

    if (byProject.size === 0) {
      return res.status(400).json({ error: 'No project-tagged invoices found in the file.' })
    }

    // ── Match tracking names to the app's projects (single lightweight Xero call) ──
    let trackingByName = new Map()
    try {
      let tokens = await getTokens()
      if (tokens) {
        try { const nt = await refreshXeroToken(tokens.refresh_token); tokens = { ...tokens, ...nt }; await saveTokens(tokens) } catch {}
        const cats = await getProjectsFromCategories(tokens.access_token, tokens.tenant_id)
        for (const cp of cats) trackingByName.set((cp.name || '').trim().toLowerCase(), cp.trackingOptionId)
      }
    } catch (e) { console.error('tracking lookup failed:', e.message) }

    const redis = await getRedis()
    if (!redis) return res.status(500).json({ error: 'No Redis connection' })

    const now = new Date().toISOString()
    const summary = []
    let matched = 0, unmatched = 0

    for (const [tracking, invMap] of byProject.entries()) {
      const invoices = [...invMap.values()]
      const totalInvoiced = invoices.reduce((s, v) => s + v.total, 0)
      const vatTotal = invoices.reduce((s, v) => s + v.totalTax, 0)
      const paidTotal = invoices.reduce((s, v) => s + v.amountPaid, 0)
      const dueTotal = invoices.reduce((s, v) => s + v.amountDue, 0)
      const labels = [...new Set(invoices.flatMap(v => [...v.taxTypes]).filter(x => x && x !== '—'))]
      const vatRateLabel = labels.length === 0 ? '—' : labels.length === 1 ? labels[0] : 'Mixed'

      // Resolve the cache key (trackingOptionId). The reserved Unassigned bucket
      // stores under a fixed key; a genuinely unmatched project is skipped.
      const trackingOptionId = tracking === '__UNASSIGNED__'
        ? '__UNASSIGNED__'
        : trackingByName.get(tracking.toLowerCase())
      if (!trackingOptionId) { unmatched++; summary.push({ project: tracking, matched: false, invoices: invoices.length }); continue }
      matched++

      const newLines = invoices.map(v => ({
        invoiceId: null, invoiceNumber: v.invoiceNumber, date: v.date, dueDate: v.dueDate,
        total: v.total, subTotal: v.total - v.totalTax, totalTax: v.totalTax,
        vatLabel: [...v.taxTypes][0] || '—',
        amountPaid: v.amountPaid, amountDue: v.amountDue,
        status: v.status, contact: v.contact, reference: v.reference,
        isCredit: v.isCredit, jobNo: tracking,
      }))
      // MERGE with any existing invoices (partial exports accumulate — Xero caps
      // exports at 500 lines). Dedupe by invoice number; a re-uploaded invoice
      // refreshes its paid/due rather than duplicating.
      const existing = (await redis.get(`invoiced:lines:${trackingOptionId}`).catch(() => null)) || []
      const { merged: allLines } = mergeDedupe(existing, newLines, invoiceLineKey)

      // Recompute the summary totals from the FULL merged set.
      const mTotal = allLines.reduce((s, l) => s + (l.total || 0), 0)
      const mVat = allLines.reduce((s, l) => s + (l.totalTax || 0), 0)
      const mPaid = allLines.reduce((s, l) => s + (l.amountPaid || 0), 0)
      const mDue = allLines.reduce((s, l) => s + (l.amountDue || 0), 0)
      const mLabels = [...new Set(allLines.map(l => l.vatLabel).filter(x => x && x !== '—'))]
      const mVatLabel = mLabels.length === 0 ? '—' : mLabels.length === 1 ? mLabels[0] : 'Mixed'

      await redis.set(`invoiced:latest:${trackingOptionId}`, {
        totalInvoiced: mTotal, invoicedExVat: mTotal - mVat, vatTotal: mVat, paidTotal: mPaid, dueTotal: mDue,
        vatRateLabel: mVatLabel, invoiceCount: allLines.length,
        calculatedAt: now, source: 'csv_bulk_import',
      })
      await redis.set(`invoiced:lines:${trackingOptionId}`, allLines)
      summary.push({ project: tracking, matched: true, invoices: allLines.length, invoiced: mTotal, paid: mPaid, due: mDue, vatRateLabel: mVatLabel })
    }

    await redis.del('dashboard:cache')

    return res.json({
      ok: true,
      projectsMatched: matched,
      projectsUnmatched: unmatched,
      totalInvoicesProcessed: [...byProject.values()].reduce((s, m) => s + m.size, 0),
      summary: summary.sort((a, b) => (b.invoiced || 0) - (a.invoiced || 0)),
    })
  } catch (e) {
    console.error('import-invoices-bulk error:', e)
    return res.status(500).json({ error: e.message || 'Import failed' })
  }
}
