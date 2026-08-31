// v2 - categories migration
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_API = 'https://api.xero.com'
const CLIENT_ID = process.env.XERO_CLIENT_ID
const CLIENT_SECRET = process.env.XERO_CLIENT_SECRET

export const TRACKING_CATEGORY_NAME = 'Projects'
export const LABOUR_ACCOUNTS = ['321', '320']
export const COST_OF_SALE_ACCOUNTS = ['321', '322', '310', '311', '320', '331', '330', '329', '333', '334', '335', '336']

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function fetchWithRetry(url, options, retries = 6) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, options)
    if (res.status === 429) {
      // Xero tells us exactly how long to wait via Retry-After (seconds).
      const ra = parseInt(res.headers.get('Retry-After') || res.headers.get('retry-after') || '0', 10)
      const wait = ra > 0 ? (ra * 1000 + 500) : Math.min(Math.pow(2, i) * 3000, 60000)
      await sleep(wait)
      continue
    }
    return res
  }
  throw new Error('Rate limit exceeded after retries')
}

export async function refreshXeroToken(refreshToken) {
  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  })
  if (!res.ok) throw new Error('Token refresh failed')
  return res.json()
}

export async function getProjectsFromCategories(accessToken, tenantId) {
  const res = await fetchWithRetry(
    `${XERO_API}/api.xro/2.0/TrackingCategories?includeArchived=true`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Xero-Tenant-Id': tenantId,
        Accept: 'application/json'
      }
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`TrackingCategories failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  const categories = data.TrackingCategories || []
  const projectCat = categories.find(
    c => c.Name?.toLowerCase() === TRACKING_CATEGORY_NAME.toLowerCase()
  )
  if (!projectCat) throw new Error(`Tracking category "${TRACKING_CATEGORY_NAME}" not found in Xero`)

  const trackingCategoryId = projectCat.TrackingCategoryID

  return (projectCat.Options || []).map(opt => ({
    trackingOptionId: opt.TrackingOptionID,
    trackingCategoryId,
    name: opt.Name,
    jobNo: extractJobNo(opt.Name),
    status: opt.Status
  }))
}

export async function fetchBillsByCategory(accessToken, tenantId, trackingOptionId, fromDate = null, toDate = null, trackingCategoryId = null) {
  let total = 0
  let labourTotal = 0
  let materialsTotal = 0
  const lines = []
  let page = 1

  while (true) {
    let url = `${XERO_API}/api.xro/2.0/Invoices?Type=ACCPAY&page=${page}&pageSize=100`
    if (fromDate) url += `&DateFrom=${toDateString(new Date(fromDate))}`
    if (toDate) url += `&DateTo=${toDateString(new Date(toDate))}`
    if (trackingCategoryId) {
      url += `&TrackingCategoryID=${trackingCategoryId}&TrackingOptionID=${trackingOptionId}`
    }

    const res = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Xero-Tenant-Id': tenantId,
        Accept: 'application/json'
      }
    })
    if (!res.ok) break
    const data = await res.json()
    const invoices = data.Invoices || []
    if (invoices.length === 0) break

    for (const inv of invoices) {
      await sleep(100)
      const r2 = await fetchWithRetry(
        `${XERO_API}/api.xro/2.0/Invoices/${inv.InvoiceID}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-Tenant-Id': tenantId,
            Accept: 'application/json'
          }
        }
      )
      if (!r2.ok) continue
      const d2 = await r2.json()
      const full = (d2.Invoices || [])[0]
      if (!full) continue

      const matchedLines = (full.LineItems || []).filter(line =>
        (line.Tracking || []).some(t => t.TrackingOptionID === trackingOptionId)
      )
      if (matchedLines.length === 0) continue

      for (const line of matchedLines) {
        if (!COST_OF_SALE_ACCOUNTS.includes(line.AccountCode)) continue
        if (line.AccountCode === '320') continue
        const amount = line.LineAmount || 0
        const isLabour = LABOUR_ACCOUNTS.includes(line.AccountCode)
        total += amount
        if (isLabour) labourTotal += amount
        else materialsTotal += amount
        lines.push({
          date: full.DateString,
          supplier: full.Contact?.Name || '',
          description: line.Description || '',
          amount,
          accountCode: line.AccountCode,
          type: isLabour ? 'Labour' : 'Materials'
        })
      }
    }

    if (invoices.length < 100) break
    page++
    await sleep(300)
  }

  return { total, labourTotal, materialsTotal, lines }
}

export async function fetchLabourJournalsByCategory(accessToken, tenantId, trackingOptionId, fromDate = null, toDate = null) {
  let total = 0
  const lines = []
  let page = 1

  while (true) {
    const url = `${XERO_API}/api.xro/2.0/Journals?offset=${(page - 1) * 100}`
    const res = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Xero-Tenant-Id': tenantId,
        Accept: 'application/json'
      }
    })
    if (!res.ok) break
    const data = await res.json()
    const journals = data.Journals || []
    if (journals.length === 0) break

    const fromDateObj = fromDate ? new Date(fromDate) : null
    const toDateObj = toDate ? new Date(toDate) : null

    for (const j of journals) {
      const jDate = new Date(j.JournalDate)
      if (fromDateObj && jDate <= fromDateObj) continue
      if (toDateObj && jDate > toDateObj) continue

      for (const line of j.JournalLines || []) {
        if (line.AccountCode !== '320') continue
        const tracked = (line.TrackingCategories || []).some(
          t => t.TrackingOptionID === trackingOptionId
        )
        if (!tracked) continue
        const amount = line.NetAmount || 0
        if (amount === 0) continue
        total += amount
        lines.push({
          date: j.JournalDate,
          supplier: 'Direct Wages',
          description: line.Description || 'Labour journal',
          amount,
          accountCode: '320',
          type: 'Direct wages'
        })
      }
    }

    if (journals.length < 100) break
    page++
    await sleep(300)
  }

  return { total, lines }
}

// Fetch the FILED VAT return(s) from Xero for completed periods. We try the known
// endpoints and record each status so the diag shows exactly which works for this org.
export async function fetchFiledVatReturns(accessToken, tenantId, fromDateStr, toDateStr) {
  const H = { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' }
  const diag = { tried: [], lastError: null }
  const returns = []

  const tryUrl = async (label, url) => {
    try {
      const res = await fetchWithRetry(url, { headers: H })
      const text = await res.text().catch(() => '')
      let json = null, bodySnippet = ''
      try { json = JSON.parse(text) } catch { bodySnippet = text.slice(0, 140) }
      diag.tried.push({ label, status: res.status, ...(bodySnippet ? { body: bodySnippet } : {}) })
      if (res.ok && json) return json
      if (!res.ok) diag.lastError = `${label} HTTP ${res.status}: ${bodySnippet || text.slice(0, 140)}`
      return null
    } catch (e) { diag.tried.push({ label, error: e.message }); diag.lastError = `${label}: ${e.message}`; return null }
  }

  const list = await tryUrl('Reports/TaxReturns', `${XERO_API}/api.xro/2.0/Reports/TaxReturns`)
  let summary = null
  if (!list && fromDateStr && toDateStr) {
    summary = await tryUrl('Reports/TaxSummary', `${XERO_API}/api.xro/2.0/Reports/TaxSummary?fromDate=${fromDateStr}&toDate=${toDateStr}`)
  }

  const parseReport = (rep) => {
    if (!rep) return
    const reps = rep.Reports || (rep.Report ? [rep.Report] : [rep])
    for (const r of reps) {
      let box1 = null, box4 = null, box5 = null
      const walk = (rows) => {
        for (const row of (rows || [])) {
          if (row.Rows) walk(row.Rows)
          const cells = row.Cells || []
          if (!cells.length) continue
          const label = String(cells[0]?.Value || '').toLowerCase()
          const num = parseFloat(String(cells[cells.length - 1]?.Value || '').replace(/[^0-9.-]/g, ''))
          if (isNaN(num)) continue
          if (label.includes('box 1') || label.includes('due in the period on sales')) box1 = num
          else if (label.includes('box 4') || label.includes('reclaimed in the period on purchases')) box4 = num
          else if (label.includes('box 5') || label.includes('to reclaim') || label.includes('net vat')) box5 = num
        }
      }
      walk(r.Rows)
      if (box1 != null || box4 != null || box5 != null) {
        const netVat = box5 != null ? box5 : ((box1 || 0) - (box4 || 0))
        returns.push({
          periodKey: (r.ReportDate || fromDateStr || '').slice(0, 7),
          reportDate: r.ReportDate || null,
          box1: box1 || 0, box4: box4 || 0, box5: box5 != null ? box5 : null, netVat,
        })
      }
    }
  }
  parseReport(list); parseReport(summary)
  return { returns, diag }
}

// LIVE VAT position (what a return WOULD show if filed now), computed from transaction
// tax - no special report scope needed. Output VAT (sales) minus input VAT (purchases).
// Negative net = refund due from HMRC. Grouped by month.
export async function fetchVatPosition(accessToken, tenantId, fromDateStr, toDateStr) {
  const H = { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' }
  const fromMs = fromDateStr ? new Date(fromDateStr).getTime() : 0
  const toMs = toDateStr ? new Date(toDateStr + 'T23:59:59').getTime() : Date.now()
  const meta = { pages: 0, lastError: null, counts: {} }
  const byMonth = {}   // { 'YYYY-MM': { outputVat, inputVat, outputNet, inputNet } }

  const parseMs = (v) => { if (!v) return NaN; const m = String(v).match(/\/Date\((\d+)/); return m ? parseInt(m[1]) : new Date(v).getTime() }
  const bucket = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
  const addVat = (ms, field, tax, net) => {
    const mk = bucket(ms)
    if (!byMonth[mk]) byMonth[mk] = { outputVat: 0, inputVat: 0, outputNet: 0, inputNet: 0 }
    byMonth[mk][field] += tax
    byMonth[mk][field === 'outputVat' ? 'outputNet' : 'inputNet'] += net
  }

  async function pullTyped(endpoint, { type, statuses, field, sign, key }) {
    let page = 1, count = 0
    while (page <= 300) {
      const where = type ? `&where=${encodeURIComponent(`Type=="${type}"`)}` : ''
      const url = `${XERO_API}/api.xro/2.0/${endpoint}?page=${page}&pageSize=100${where}`
      let res
      try { res = await fetchWithRetry(url, { headers: H }) } catch (e) { meta.lastError = `${key}: ${e.message}`; break }
      meta.pages++
      if (!res.ok) { const t = await res.text().catch(() => ''); meta.lastError = `${key} HTTP ${res.status}: ${t.slice(0, 120)}`; break }
      const data = await res.json()
      const batch = data[endpoint] || []
      if (batch.length === 0) break
      for (const doc of batch) {
        if (statuses && !statuses.includes(doc.Status)) continue
        const ms = parseMs(doc.DateString || doc.Date)
        if (isNaN(ms) || ms < fromMs || ms > toMs) continue
        const tax = Math.abs(Number(doc.TotalTax || 0)) * sign
        const net = Math.abs(Number(doc.SubTotal || 0)) * sign
        if (!tax && !net) continue
        addVat(ms, field, tax, net)
        count++
      }
      if (batch.length < 100) break
      page++
      await sleep(200)
    }
    meta.counts[key] = count
  }

  // OUTPUT VAT (on sales)
  await pullTyped('Invoices', { type: 'ACCREC', statuses: ['AUTHORISED', 'PAID'], field: 'outputVat', sign: 1, key: 'salesInvoices' })
  await pullTyped('CreditNotes', { type: 'ACCRECCREDIT', statuses: ['AUTHORISED', 'PAID'], field: 'outputVat', sign: -1, key: 'salesCreditNotes' })
  // INPUT VAT (on purchases)
  await pullTyped('Invoices', { type: 'ACCPAY', statuses: ['AUTHORISED', 'PAID'], field: 'inputVat', sign: 1, key: 'purchaseBills' })
  await pullTyped('CreditNotes', { type: 'ACCPAYCREDIT', statuses: ['AUTHORISED', 'PAID'], field: 'inputVat', sign: -1, key: 'purchaseCreditNotes' })

  // Net + refund per month.
  const months = {}
  for (const mk of Object.keys(byMonth)) {
    const m = byMonth[mk]
    const netVat = Math.round((m.outputVat - m.inputVat) * 100) / 100
    months[mk] = {
      outputVat: Math.round(m.outputVat * 100) / 100,
      inputVat: Math.round(m.inputVat * 100) / 100,
      netVat,                       // positive = you owe HMRC; negative = refund due
      refund: netVat < 0 ? -netVat : 0,
      payable: netVat > 0 ? netVat : 0,
      outputNet: Math.round(m.outputNet * 100) / 100,
      inputNet: Math.round(m.inputNet * 100) / 100,
    }
  }
  return { months, meta }
}
//  - ACCREC invoices (sales invoices), line items coded to a sales code
//  - Manual journals (where WIP is posted), journal lines coded to a sales code
// Grouped by account code + month, amounts as POSITIVE sales. fromDateStr limits how
// far back we look. Returns { byCodeMonth, meta }.
export async function fetchSalesLedgerFromInvoicesAndJournals(accessToken, tenantId, fromDateStr, codeSet) {
  const wanted = new Set([...codeSet].map(String))
  const fromMs = fromDateStr ? new Date(fromDateStr).getTime() : 0
  const byCodeMonth = {}
  const meta = { invoicePages: 0, invoicesSeen: 0, journalPages: 0, journalsSeen: 0, invoiceLines: 0, journalLines: 0, lastError: null }
  const H = { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' }

  const parseMs = (v) => {
    if (!v) return NaN
    const m = String(v).match(/\/Date\((\d+)/)
    return m ? parseInt(m[1]) : new Date(v).getTime()
  }
  const add = (code, ms, entry) => {
    const c = String(code)
    if (!wanted.has(c)) return
    const d = new Date(ms)
    const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    entry.date = `${mk}-${String(d.getUTCDate()).padStart(2, '0')}`
    if (!byCodeMonth[c]) byCodeMonth[c] = {}
    if (!byCodeMonth[c][mk]) byCodeMonth[c][mk] = []
    byCodeMonth[c][mk].push(entry)
  }

  // --- ACCREC invoices ---
  try {
    let page = 1
    while (page <= 200) {
      const url = `${XERO_API}/api.xro/2.0/Invoices?Type=ACCREC&page=${page}&pageSize=100`
      const res = await fetchWithRetry(url, { headers: H })
      if (!res.ok) { const t = await res.text().catch(() => ''); meta.lastError = `Invoices HTTP ${res.status}: ${t.slice(0, 120)}`; break }
      const data = await res.json()
      const batch = data.Invoices || []
      meta.invoicePages++
      if (batch.length === 0) break
      meta.invoicesSeen += batch.length
      for (const inv of batch) {
        // Only invoices the P&L counts: AUTHORISED or PAID. Exclude DRAFT/SUBMITTED/VOIDED/DELETED.
        if (inv.Status !== 'AUTHORISED' && inv.Status !== 'PAID') continue
        const ms = parseMs(inv.DateString || inv.Date)
        if (isNaN(ms) || ms < fromMs) continue
        for (const li of (inv.LineItems || [])) {
          const code = String(li.AccountCode || '')
          if (!wanted.has(code)) continue
          const amt = Number(li.LineAmount || 0)
          if (!amt) continue
          meta.invoiceLines++
          add(code, ms, {
            description: li.Description || inv.Reference || inv.Contact?.Name || 'Invoice',
            reference: inv.InvoiceNumber || inv.Reference || '',
            sourceType: 'Invoice',
            amount: amt,   // ACCREC line amounts are positive sales
          })
        }
      }
      if (batch.length < 100) break
      page++
      await sleep(250)
    }
  } catch (e) { meta.lastError = (meta.lastError || '') + ' inv:' + e.message }

  // --- Manual journals (WIP etc.) ---
  try {
    let page = 1
    while (page <= 200) {
      const url = `${XERO_API}/api.xro/2.0/ManualJournals?page=${page}&pageSize=100`
      const res = await fetchWithRetry(url, { headers: H })
      if (!res.ok) { const t = await res.text().catch(() => ''); meta.lastError = (meta.lastError || '') + ` MJ HTTP ${res.status}: ${t.slice(0, 120)}`; break }
      const data = await res.json()
      const batch = data.ManualJournals || []
      meta.journalPages++
      if (batch.length === 0) break
      meta.journalsSeen += batch.length
      for (const mj of batch) {
        if (mj.Status && mj.Status !== 'POSTED') continue
        const ms = parseMs(mj.DateString || mj.Date)
        if (isNaN(ms) || ms < fromMs) continue
        for (const jl of (mj.JournalLines || [])) {
          const code = String(jl.AccountCode || '')
          if (!wanted.has(code)) continue
          // Xero manual-journal LineAmount: positive=debit, negative=credit. A sale is
          // a CREDIT (negative) -> flip to positive; a reversal is a DEBIT -> negative.
          const raw = Number(jl.LineAmount || 0)
          if (!raw) continue
          meta.journalLines++
          add(code, ms, {
            description: jl.Description || mj.Narration || 'Manual journal (WIP)',
            reference: mj.Narration || '',
            sourceType: 'Manual journal',
            amount: -raw,
          })
        }
      }
      if (batch.length < 100) break
      page++
      await sleep(250)
    }
  } catch (e) { meta.lastError = (meta.lastError || '') + ' mj:' + e.message }

  // --- ACCREC credit notes (sales credits/reductions) ---
  try {
    let page = 1
    while (page <= 100) {
      const url = `${XERO_API}/api.xro/2.0/CreditNotes?where=${encodeURIComponent('Type=="ACCRECCREDIT"')}&page=${page}&pageSize=100`
      const res = await fetchWithRetry(url, { headers: H })
      if (!res.ok) { const t = await res.text().catch(() => ''); meta.lastError = (meta.lastError || '') + ` CN HTTP ${res.status}: ${t.slice(0, 120)}`; break }
      const data = await res.json()
      const batch = data.CreditNotes || []
      meta.creditNotePages = (meta.creditNotePages || 0) + 1
      if (batch.length === 0) break
      meta.creditNotesSeen = (meta.creditNotesSeen || 0) + batch.length
      for (const cn of batch) {
        if (cn.Status !== 'AUTHORISED' && cn.Status !== 'PAID') continue
        const ms = parseMs(cn.DateString || cn.Date)
        if (isNaN(ms) || ms < fromMs) continue
        for (const li of (cn.LineItems || [])) {
          const code = String(li.AccountCode || '')
          if (!wanted.has(code)) continue
          const amt = Number(li.LineAmount || 0)
          if (!amt) continue
          meta.creditNoteLines = (meta.creditNoteLines || 0) + 1
          add(code, ms, {
            description: li.Description || cn.Reference || cn.Contact?.Name || 'Credit note',
            reference: cn.CreditNoteNumber || cn.Reference || '',
            sourceType: 'Credit note',
            amount: -Math.abs(amt),   // credit notes REDUCE sales
          })
        }
      }
      if (batch.length < 100) break
      page++
      await sleep(250)
    }
  } catch (e) { meta.lastError = (meta.lastError || '') + ' cn:' + e.message }

  // --- Bank transactions (receive/spend money) coded to a sales code ---
  // The P&L code-200 total includes these, so we must too for the table to match.
  try {
    let page = 1
    while (page <= 200) {
      const url = `${XERO_API}/api.xro/2.0/BankTransactions?page=${page}&pageSize=100`
      const res = await fetchWithRetry(url, { headers: H })
      if (!res.ok) { const t = await res.text().catch(() => ''); meta.lastError = (meta.lastError || '') + ` BT HTTP ${res.status}: ${t.slice(0, 120)}`; break }
      const data = await res.json()
      const batch = data.BankTransactions || []
      meta.bankTxnPages = (meta.bankTxnPages || 0) + 1
      if (batch.length === 0) break
      meta.bankTxnsSeen = (meta.bankTxnsSeen || 0) + batch.length
      for (const bt of batch) {
        if (bt.Status === 'DELETED' || bt.Status === 'VOIDED') continue
        const ms = parseMs(bt.DateString || bt.Date)
        if (isNaN(ms) || ms < fromMs) continue
        // RECEIVE = money in (a sale, positive). SPEND = money out (reduction, negative).
        const dir = bt.Type && bt.Type.startsWith('SPEND') ? -1 : 1
        for (const li of (bt.LineItems || [])) {
          const code = String(li.AccountCode || '')
          if (!wanted.has(code)) continue
          const amt = Number(li.LineAmount || 0)
          if (!amt) continue
          meta.bankTxnLines = (meta.bankTxnLines || 0) + 1
          add(code, ms, {
            description: li.Description || bt.Reference || bt.Contact?.Name || 'Bank receipt',
            reference: bt.Reference || '',
            sourceType: dir > 0 ? 'Bank receipt' : 'Bank payment',
            amount: dir * Math.abs(amt),
          })
        }
      }
      if (batch.length < 100) break
      page++
      await sleep(250)
    }
  } catch (e) { meta.lastError = (meta.lastError || '') + ' bt:' + e.message }

  return { byCodeMonth, meta }
}

export async function getInvoicesByCategory(accessToken, tenantId, trackingOptionId, trackingCategoryId = null) {
  const invoices = []
  let page = 1
  const allIds = []

  while (true) {
    let url = `${XERO_API}/api.xro/2.0/Invoices?Type=ACCREC&page=${page}&pageSize=100`
    if (trackingCategoryId) {
      url += `&TrackingCategoryID=${trackingCategoryId}&TrackingOptionID=${trackingOptionId}`
    }
    const res = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Xero-Tenant-Id': tenantId,
        Accept: 'application/json'
      }
    })
    if (!res.ok) break
    const data = await res.json()
    const batch = data.Invoices || []
    if (batch.length === 0) break
    for (const inv of batch) allIds.push(inv.InvoiceID)
    if (batch.length < 100) break
    page++
    await sleep(300)
  }

  for (const invoiceId of allIds) {
    await sleep(100)
    const res = await fetchWithRetry(
      `${XERO_API}/api.xro/2.0/Invoices/${invoiceId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Xero-Tenant-Id': tenantId,
          Accept: 'application/json'
        }
      }
    )
    if (!res.ok) continue
    const data = await res.json()
    const inv = (data.Invoices || [])[0]
    if (!inv) continue
    const hasTracking = (inv.LineItems || []).some(line =>
      (line.Tracking || []).some(t => t.TrackingOptionID === trackingOptionId)
    )
    if (!hasTracking) continue
    invoices.push(inv)
  }

  return invoices
}

export async function getXeroProjects(accessToken, tenantId) {
  let all = []
  for (const state of ['INPROGRESS', 'CLOSED']) {
    let page = 1
    while (true) {
      const res = await fetchWithRetry(`${XERO_API}/projects.xro/1.0/projects?page=${page}&pageSize=50&states=${state}`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId }
      })
      if (!res.ok) break
      const data = await res.json()
      const items = data.items || []
      all = all.concat(items)
      if (items.length < 50) break
      page++
    }
  }
  const seen = new Set()
  return all.filter(p => {
    if (seen.has(p.projectId)) return false
    seen.add(p.projectId)
    return true
  })
}

export function extractJobNo(name) {
  if (!name) return null
  const match = name.match(/^(J\d+|RR\d+)/i)
  return match ? match[1].toUpperCase() : name.split(/[-–\s]/)[0]
}

function toDateString(date) {
  return date.toISOString().split('T')[0]
}

// Fetch Purchase Orders from Xero, newest first. Returns a normalised shape.
// Line items carry description + quantity only (NO cost) so callers can pass
// them to the Site App safely. Delivery date/address come straight from the PO.
export async function fetchPurchaseOrders(accessToken, tenantId, { status = null } = {}) {
  const parseXeroDate = (s) => {
    if (!s) return null
    const m = /\/Date\((\d+)/.exec(String(s))
    if (m) return new Date(Number(m[1])).toISOString().slice(0, 10)
    const d = new Date(s)
    return isNaN(d) ? null : d.toISOString().slice(0, 10)
  }
  const all = []
  let page = 1
  // Xero returns up to 100 POs per page — must page through ALL of them,
  // otherwise POs beyond the first 100 are never seen (baseline gaps).
  while (true) {
    let url = `${XERO_API}/api.xro/2.0/PurchaseOrders?page=${page}&order=${encodeURIComponent('UpdatedDateUTC DESC')}`
    if (status) url += `&Status=${encodeURIComponent(status)}`
    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`PurchaseOrders failed: ${res.status} ${text}`)
    }
    const data = await res.json()
    const batch = data.PurchaseOrders || []
    all.push(...batch)
    if (batch.length < 100) break   // last page
    page++
    if (page > 100) break           // safety cap (10k POs)
  }
  return all.map(p => ({
    purchaseOrderId: p.PurchaseOrderID,
    poNumber: p.PurchaseOrderNumber || '',
    status: p.Status,
    orderDate: parseXeroDate(p.DateString || p.Date),
    deliveryDate: parseXeroDate(p.DeliveryDateString || p.DeliveryDate),
    deliveryAddress: p.DeliveryAddress || '',
    supplier: p.Contact?.Name || '',
    updatedUTC: p.UpdatedDateUTC || '',
    tracking: (() => {
      for (const li of (p.LineItems || [])) {
        const t = (li.Tracking || []).find(x => (x.Name || '').toLowerCase() === TRACKING_CATEGORY_NAME.toLowerCase())
        if (t) return { name: t.Option, jobNo: extractJobNo(t.Option) }
      }
      return null
    })(),
    lineItems: (p.LineItems || []).map(li => ({ description: li.Description || '', quantity: li.Quantity ?? null, unit: li.Unit || li.UnitOfMeasure || '', unitAmount: li.UnitAmount ?? null })),
  }))
}

// ── Profit & Loss report by account, for a date range. ONE API call.
// Chart of Accounts -> { accountName(lowercased): code }. Used to attach account
// CODES to P&L lines (the P&L report itself only gives names). Cheap, 1 call.
export async function fetchAccountCodeMap(accessToken, tenantId) {
  const url = `${XERO_API}/api.xro/2.0/Accounts`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' } })
  if (!res.ok) return {}
  const data = await res.json()
  const map = {}
  for (const a of (data.Accounts || [])) {
    if (a.Name && a.Code) map[String(a.Name).trim().toLowerCase()] = String(a.Code)
  }
  return map
}

// Full Chart of Accounts, limited to accounts that belong on the P&L and can be
// categorised: SALES/REVENUE (income) and EXPENSE (cost of sale, overheads,
// expenses). Balance-sheet accounts (ASSET, LIABILITY, EQUITY) and bank accounts
// are excluded — they are never a project cost or a sale.
export async function fetchChartOfAccounts(accessToken, tenantId) {
  const url = `${XERO_API}/api.xro/2.0/Accounts`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' } })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Accounts fetch failed: ${res.status} ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  const PL_CLASSES = new Set(['EXPENSE', 'REVENUE'])
  const PL_TYPES = new Set(['EXPENSE', 'DIRECTCOSTS', 'OVERHEADS', 'REVENUE', 'SALES', 'OTHERINCOME'])
  return (data.Accounts || [])
    .filter(a => a.Code)
    // Keep P&L accounts only (revenue + expense); exclude balance-sheet accounts.
    .filter(a => PL_CLASSES.has(String(a.Class || '').toUpperCase()) || PL_TYPES.has(String(a.Type || '').toUpperCase()))
    .map(a => ({
      code: String(a.Code),
      name: String(a.Name || '').trim(),
      type: a.Type || '',
      class: a.Class || '',
      status: a.Status || '',
    }))
}

// Returns per-account amounts WITH their P&L section, plus pre-computed section
// totals, so the reconciliation can use only Cost of Sales (not overheads).
// If a nameToCode map is supplied, also returns byCode { code: amount } for
// income + cost-of-sales lines, so the grey P&L reference can be filtered by the
// app's Account Categorisation (which is code-based).
export async function fetchProfitAndLoss(accessToken, tenantId, fromDate, toDate, nameToCode) {
  const url = `${XERO_API}/api.xro/2.0/Reports/ProfitAndLoss?fromDate=${fromDate}&toDate=${toDate}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' }
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`ProfitAndLoss failed: ${res.status} ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  const report = (data.Reports || [])[0]
  const accounts = {}          // accountName -> amount (kept for backwards-compat)
  const bySection = {}         // sectionTitle -> { accountName: amount }
  const byCode = {}            // accountCode -> amount (income + cost of sales + overheads)
  const codeSection = {}       // accountCode -> 'income' | 'cos' | 'overheads'
  let incomeTotal = 0, costOfSalesTotal = 0, overheadsTotal = 0
  if (report) {
    for (const section of (report.Rows || [])) {
      const title = (section.Title || '').trim()
      const tl = title.toLowerCase()
      const isIncome = tl.includes('income') || tl.includes('revenue') || tl.includes('turnover')
      const isCos = tl.includes('cost of sales') || tl.includes('cost of goods') || tl.includes('direct costs')
      const isOverhead = tl.includes('overhead') || tl.includes('operating expense') || tl.includes('expense') || tl.includes('admin')
      for (const row of (section.Rows || [])) {
        if (row.RowType !== 'Row') continue
        const cells = row.Cells || []
        const name = cells[0]?.Value || ''
        const val = parseFloat(String(cells[cells.length - 1]?.Value || '0').replace(/,/g, '')) || 0
        if (!name) continue
        accounts[name] = (accounts[name] || 0) + val
        bySection[title] = bySection[title] || {}
        bySection[title][name] = (bySection[title][name] || 0) + val
        if (isIncome) incomeTotal += val
        else if (isCos) costOfSalesTotal += val
        else if (isOverhead) overheadsTotal += val
        // byCode now covers income, cost-of-sales AND overheads/expenses, so the
        // reconciliation can compare every categorised code (incl. Overheads) and
        // detect P&L codes the app has no line data for (accruals / journals).
        if ((isIncome || isCos || isOverhead) && nameToCode) {
          const code = nameToCode[String(name).trim().toLowerCase()]
          if (code) {
            byCode[code] = (byCode[code] || 0) + val
            codeSection[code] = isIncome ? 'income' : isCos ? 'cos' : 'overheads'
          }
        }
      }
    }
  }
  return { accounts, bySection, byCode, codeSection, incomeTotal, costOfSalesTotal, overheadsTotal, sectionTitles: Object.keys(bySection) }
}

// Bank Summary report for a period: cash received (money in) and cash spent (money
// out) across all bank accounts, plus opening/closing balances. Xero's BankSummary
// returns one row per bank account with columns: Opening, Cash Received, Cash Spent,
// Closing (FX gains ignored). We sum across accounts.
export async function fetchBankSummary(accessToken, tenantId, fromDate, toDate) {
  const url = `${XERO_API}/api.xro/2.0/Reports/BankSummary?fromDate=${fromDate}&toDate=${toDate}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' }
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`BankSummary failed: ${res.status} ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  const report = (data.Reports || [])[0]
  const num = (v) => parseFloat(String(v == null ? '0' : v).replace(/,/g, '')) || 0
  let cashIn = 0, cashOut = 0, opening = 0, closing = 0
  if (report) {
    // Identify columns from the header row.
    const header = (report.Rows || []).find(r => r.RowType === 'Header')
    const cols = (header?.Cells || []).map(c => String(c.Value || '').toLowerCase())
    const idxOpening = cols.findIndex(c => c.includes('opening'))
    const idxIn = cols.findIndex(c => c.includes('received') || c.includes('cash in'))
    const idxOut = cols.findIndex(c => c.includes('spent') || c.includes('cash out'))
    const idxClosing = cols.findIndex(c => c.includes('closing'))
    for (const section of (report.Rows || [])) {
      for (const row of (section.Rows || [])) {
        if (row.RowType !== 'Row' && row.RowType !== 'SummaryRow') continue
        const cells = row.Cells || []
        const label = String(cells[0]?.Value || '').toLowerCase()
        // Skip the grand-total summary row to avoid double counting; we sum accounts.
        if (row.RowType === 'SummaryRow' || label.includes('total')) continue
        if (idxIn >= 0) cashIn += num(cells[idxIn]?.Value)
        if (idxOut >= 0) cashOut += num(cells[idxOut]?.Value)
        if (idxOpening >= 0) opening += num(cells[idxOpening]?.Value)
        if (idxClosing >= 0) closing += num(cells[idxClosing]?.Value)
      }
    }
  }
  // Cash spent is reported as a negative; return money-out as a positive number.
  return { cashIn, cashOut: Math.abs(cashOut), opening, closing }
}

// Per-account balances (bank + credit card) from the Balance Sheet report.
// Returns { accounts: [{ name, balance, isCard }], bankTotal, cardTotal, ok, error }.
// Cards are detected by name ("credit card", "visa", "mastercard", "amex", "cc")
// or by a negative balance sitting in a bank-type row. Positive balance = money you
// have; a card balance is stored as its Balance Sheet sign (liabilities negative).
export async function fetchBankAndCardBalances(accessToken, tenantId, asAtDate) {
  const date = asAtDate || new Date().toISOString().slice(0, 10)
  const url = `${XERO_API}/api.xro/2.0/Reports/BalanceSheet?date=${date}`
  let res
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' } })
  } catch (e) {
    return { accounts: [], bankTotal: 0, cardTotal: 0, ok: false, error: 'network: ' + e.message }
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    return { accounts: [], bankTotal: 0, cardTotal: 0, ok: false, error: `${res.status} ${t.slice(0, 160)}` }
  }
  const data = await res.json()
  const report = (data.Reports || [])[0]
  const num = (v) => parseFloat(String(v == null ? '0' : v).replace(/,/g, '')) || 0
  const accounts = []
  const cardHints = ['credit card', 'creditcard', 'visa', 'mastercard', 'amex', 'american express', ' cc', 'cc ', 'card']
  const looksLikeCard = (name) => { const n = (name || '').toLowerCase(); return cardHints.some(h => n.includes(h)) }
  if (report) {
    for (const section of (report.Rows || [])) {
      const title = String(section.Title || '').toLowerCase()
      // Bank section holds both current accounts and credit cards in Xero's Balance Sheet.
      const isBankSection = title.includes('bank')
      if (!isBankSection) continue
      for (const row of (section.Rows || [])) {
        if (row.RowType !== 'Row') continue
        const cells = row.Cells || []
        const name = cells[0]?.Value || ''
        if (!name) continue
        const balance = num(cells[cells.length - 1]?.Value)
        if (String(name).toLowerCase().includes('total')) continue
        accounts.push({ name, balance, isCard: looksLikeCard(name) || balance < 0 })
      }
    }
  }
  const bankTotal = accounts.filter(a => !a.isCard).reduce((s, a) => s + a.balance, 0)
  const cardTotal = accounts.filter(a => a.isCard).reduce((s, a) => s + a.balance, 0)
  return { accounts, bankTotal, cardTotal, ok: true, error: null }
}

// EVERY balance sheet line, with the section it sits under.
//
// Deliberately generic: NO account codes are assumed anywhere. Xero's Balance Sheet
// report gives whatever sections and rows that tenant's chart of accounts produces, and
// they are returned as-is. A different company with a different chart works unchanged -
// which is the point if this is ever sold on.
//
// Rows carry an AccountID in the report's Attributes where Xero supplies one; that is
// stable within a tenant and is the right key to store a selection against. Name is kept
// as a fallback and for display.
export async function fetchBalanceSheetAccounts(accessToken, tenantId, asAtDate) {
  const date = asAtDate || new Date().toISOString().slice(0, 10)
  const url = `${XERO_API}/api.xro/2.0/Reports/BalanceSheet?date=${date}`
  let res
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' } })
  } catch (e) {
    return { accounts: [], ok: false, error: 'network: ' + e.message, asAt: date }
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    // A 401 here is the balance sheet scope, not a broken connection - say so plainly.
    const msg = res.status === 401
      ? 'Xero has not granted accounting.reports.balancesheet.read. Reconnect from /connect - adding the scope does not apply to an existing connection.'
      : `${res.status} ${t.slice(0, 160)}`
    return { accounts: [], ok: false, error: msg, asAt: date }
  }
  const data = await res.json()
  const report = (data.Reports || [])[0]
  const num = (v) => parseFloat(String(v == null ? '0' : v).replace(/,/g, '')) || 0
  const accounts = []
  for (const section of (report?.Rows || [])) {
    const sectionTitle = String(section.Title || '').trim()
    for (const row of (section.Rows || [])) {
      if (row.RowType !== 'Row') continue          // skips Header and SummaryRow
      const cells = row.Cells || []
      const name = String(cells[0]?.Value || '').trim()
      if (!name || name.toLowerCase().startsWith('total')) continue
      // Xero puts the account id in the first cell's Attributes.
      const attrs = cells[0]?.Attributes || []
      const idAttr = attrs.find(a => /account/i.test(a.Id || ''))
      accounts.push({
        id: idAttr?.Value || `name:${name}`,
        name,
        section: sectionTitle,
        balance: num(cells[cells.length - 1]?.Value),
      })
    }
  }
  return { accounts, ok: true, error: null, asAt: date }
}

// All OUTSTANDING accounts-payable bills (money we owe) with due dates. Returns
// authorised bills that still have an amount due, PLUS authorised ACCPAY credit notes
// with a remaining balance as NEGATIVE lines - so the net total reconciles to Xero's
// "Awaiting payment" figure (which nets credit notes against bills). Used by "Bills to Pay".
// `diag` is written into, not returned, so callers that ignore it are unaffected. The
// overpayment and credit-note fetches are each wrapped so one failing does not lose the
// bills - but a swallowed error then looks exactly like "there are none", which is how a
// broken type check went unnoticed. The reason now comes back to the caller.
export async function fetchOutstandingBills(accessToken, tenantId, diag = {}) {
  const bills = await fetchOutstandingInvoicesOfType(accessToken, tenantId, 'ACCPAY')
  let credits = []
  try {
    credits = await fetchOutstandingCreditNotes(accessToken, tenantId, 'ACCPAYCREDIT')
  } catch (e) {
    // If credit notes can't be fetched, still return bills (total just won't net).
    console.error('ACCPAY credit notes fetch failed:', e.message)
    diag.creditNoteError = e.message
  }
  // OVERPAYMENTS are a SEPARATE Xero endpoint, not a type of invoice, so they were
  // never fetched at all - the page was short by every supplier overpayment on the
  // ledger. Same economic shape as a credit note: money sitting with the supplier that
  // offsets future bills, so it comes back NEGATIVE and reduces the total.
  let overpayments = []
  try {
    overpayments = await fetchOutstandingOverpayments(accessToken, tenantId, diag)
  } catch (e) {
    console.error('ACCPAY overpayments fetch failed:', e.message)
    diag.overpaymentError = e.message
  }
  diag.counts = { bills: bills.length, credits: credits.length, overpayments: overpayments.length }
  return [...bills, ...credits, ...overpayments]
}

// Unallocated SUPPLIER overpayments - we paid a supplier more than we owed, so the
// balance sits with them.
//
// Xero's Overpayment Type is "SPEND-OVERPAYMENT" / "RECEIVE-OVERPAYMENT" - NOT plain
// "SPEND". An exact match on 'SPEND' silently rejected every one of them, so the page
// stayed short by the whole overpayment balance. fetchBankTransactions above already
// uses startsWith('SPEND') for exactly this reason.
async function fetchOutstandingOverpayments(accessToken, tenantId, diag = {}) {
  const out = []
  let seen = 0, skippedType = 0, skippedNil = 0, skippedStatus = 0
  const statusSeen = {}
  let page = 1
  // NO Status FILTER.
  //
  // An overpayment is money that has ALREADY LEFT THE BANK, so Xero marks it PAID, not
  // AUTHORISED. The Status=="AUTHORISED" clause - copied from the credit-note fetch,
  // where it IS right because a credit note is not a payment - excluded every one of
  // them. The fetch succeeded, returned nothing, and looked exactly like "there are no
  // overpayments".
  //
  // RemainingCredit > 0 is the real test of "still outstanding" anyway: it is what is
  // left unallocated, whatever the status says. Only VOIDED and DELETED are dropped.
  while (page <= 50) {
    const url = `${XERO_API}/api.xro/2.0/Overpayments?page=${page}&pageSize=100`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' } })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      // A 401 here while invoices succeed on the SAME token is always a missing scope,
      // never a bad connection - so say so rather than making somebody decode Xero's
      // "AuthorizationUnsuccessful".
      if (res.status === 401) throw new Error('Xero has not granted accounting.transactions.read, which Overpayments needs. Reconnect Xero from /connect to grant it - adding the scope does not apply to an existing connection.')
      throw new Error(`Overpayments failed: ${res.status} ${t.slice(0, 160)}`)
    }
    const data = await res.json()
    const list = data.Overpayments || []
    if (!list.length) break
    for (const op of list) {
      const st = String(op.Status || '').toUpperCase()
      statusSeen[st || '(none)'] = (statusSeen[st || '(none)'] || 0) + 1
      if (st === 'VOIDED' || st === 'DELETED') { skippedStatus += 1; continue }
      // Prefix, not equality. Covers SPEND-OVERPAYMENT and SPEND-PREPAYMENT.
      if (!String(op.Type || '').toUpperCase().startsWith('SPEND')) { skippedType += 1; continue }
      const remaining = parseFloat(op.RemainingCredit != null ? op.RemainingCredit : (op.Total || 0))
      if (!(remaining > 0)) { skippedNil += 1; continue }             // only unallocated
      const d = xeroDateToISO(op.DateString || op.Date)
      out.push({
        id: op.OverpaymentID,
        type: 'ACCPAY',                                   // group with bills for the page guard
        isCreditNote: true,                               // behaves like a credit: negative, green
        isOverpayment: true,
        number: op.Reference || 'Overpayment',
        contact: op.Contact?.Name || '',
        date: d,
        // An overpayment has no due date - it is already paid. Using its own date keeps
        // it inside any date range that covers when it happened, rather than being
        // dropped as undated the moment a range is set.
        dueDate: d,
        total: -Math.abs(parseFloat(op.Total || 0)),
        amountDue: -Math.abs(remaining),                  // NEGATIVE - reduces the total
        reference: op.Reference || '',
        lineCodes: (op.LineItems || []).map(li => String(li.AccountCode || '')).filter(Boolean),
      })
    }
    seen += list.length
    if (list.length < 100) break
    page++
  }
  // Logged, because a silent zero is indistinguishable from "there are none" - which is
  // exactly what the broken type check looked like.
  const summary = `${seen} returned, ${out.length} kept, ${skippedType} not SPEND, ${skippedNil} fully allocated, ${skippedStatus} voided, statuses ${JSON.stringify(statusSeen)}`
  console.log('Overpayments:', summary)
  diag.overpaymentDetail = summary
  return out
}
// All OUTSTANDING accounts-receivable invoices (money owed to us) with due dates.
// Used by "Invoices Owed".
// PAID SALES INVOICES, for measuring how long each customer actually takes.
//
// Xero gives FullyPaidOnDate on a PAID invoice, and that against the due date is the only
// honest measure of payment performance - terms tell you what was agreed, this tells you
// what happens. Nothing else in the app captures it; the existing pulls take PAID
// invoices for VAT totals only and discard the date.
//
// monthsBack limits the window: two years is enough to see a pattern without a customer's
// behaviour three years ago dragging the average.
export async function fetchPaidReceivables(accessToken, tenantId, monthsBack = 24) {
  const since = new Date()
  since.setMonth(since.getMonth() - monthsBack)
  const out = []
  let page = 1
  const where = encodeURIComponent(`Type=="ACCREC" AND Status=="PAID" AND FullyPaidOnDate>=DateTime(${since.getFullYear()},${since.getMonth() + 1},1)`)
  while (page <= 50) {
    let res
    try {
      res = await fetch(`${XERO_API}/api.xro/2.0/Invoices?where=${where}&page=${page}&pageSize=100`,
        { headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' } })
    } catch (e) { return { invoices: out, ok: false, error: 'network: ' + e.message } }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { invoices: out, ok: false, error: `${res.status} ${t.slice(0, 140)}` }
    }
    const data = await res.json()
    const batch = data.Invoices || []
    if (!batch.length) break
    for (const inv of batch) {
      const paid = xeroDateToISO(inv.FullyPaidOnDate)
      const due = xeroDateToISO(inv.DueDate)
      if (!paid || !due) continue                      // cannot measure without both
      out.push({
        id: inv.InvoiceID,
        number: inv.InvoiceNumber || '',
        contact: inv.Contact?.Name || '',
        contactId: inv.Contact?.ContactID || '',
        date: xeroDateToISO(inv.Date),
        dueDate: due,
        paidDate: paid,
        total: Math.abs(Number(inv.Total) || 0),
        reference: inv.Reference || '',
      })
    }
    if (batch.length < 100) break
    page += 1
  }
  return { invoices: out, ok: true, error: null }
}

export async function fetchOutstandingReceivables(accessToken, tenantId) {
  return fetchOutstandingInvoicesOfType(accessToken, tenantId, 'ACCREC')
}

// Outstanding credit notes of a type (ACCPAYCREDIT for supplier credits). Returned as
// NEGATIVE amountDue lines so they reduce the bills total, matching Xero.
async function fetchOutstandingCreditNotes(accessToken, tenantId, type) {
  const out = []
  let page = 1
  const where = encodeURIComponent('Status=="AUTHORISED"')
  while (page <= 50) {
    const url = `${XERO_API}/api.xro/2.0/CreditNotes?where=${where}&page=${page}&pageSize=100`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' } })
    if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`CreditNotes failed: ${res.status} ${t.slice(0, 160)}`) }
    const data = await res.json()
    const list = data.CreditNotes || []
    if (!list.length) break
    for (const cn of list) {
      if (cn.Type && cn.Type !== type) continue          // supplier credit notes only
      const remaining = parseFloat(cn.RemainingCredit != null ? cn.RemainingCredit : (cn.Total || 0))
      if (!(remaining > 0)) continue                      // only unallocated credit
      out.push({
        id: cn.CreditNoteID,
        type: 'ACCPAY',                                   // group with bills for the page guard
        isCreditNote: true,
        number: cn.CreditNoteNumber || cn.Reference || '',
        contact: cn.Contact?.Name || '',
        date: xeroDateToISO(cn.DateString || cn.Date),
        dueDate: xeroDateToISO(cn.DueDateString || cn.DueDate || cn.DateString || cn.Date),
        total: -Math.abs(parseFloat(cn.Total || 0)),
        amountDue: -Math.abs(remaining),                  // NEGATIVE - reduces the total
        reference: cn.Reference || '',
        // Account codes, same as a bill. Without these a credit note has no codes at
        // all, so any account filter would drop it and the total would go UP - a credit
        // silently vanishing is worse than one showing under a code you did not pick.
        lineCodes: (cn.LineItems || []).map(li => String(li.AccountCode || '')).filter(Boolean),
      })
    }
    if (list.length < 100) break
    page++
  }
  return out
}

async function fetchOutstandingInvoicesOfType(accessToken, tenantId, type) {
  const out = []
  let page = 1
  // Only AUTHORISED (approved) invoices can be outstanding; DRAFT/DELETED/VOIDED/PAID
  // are excluded. AmountDue > 0 means still to pay/collect.
  const where = encodeURIComponent('Status=="AUTHORISED"')
  while (page <= 50) {
    const url = `${XERO_API}/api.xro/2.0/Invoices?Type=${type}&where=${where}&page=${page}&pageSize=100`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' } })
    if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Invoices(${type}) failed: ${res.status} ${t.slice(0, 160)}`) }
    const data = await res.json()
    const list = data.Invoices || []
    if (!list.length) break
    for (const inv of list) {
      // Defensive: only keep the exact type requested, in case Xero ignores the
      // Type query param or returns mixed results. This guarantees bills (ACCPAY)
      // and receivables (ACCREC) never cross-contaminate.
      if (inv.Type && inv.Type !== type) continue
      const due = parseFloat(inv.AmountDue || 0)
      if (!(due > 0)) continue
      // Detect CIS labour: any line on account 321 (CIS Labour Expense). LineItems are
      // returned by this list endpoint, so no extra per-bill fetch is needed.
      const lineCodes = (inv.LineItems || []).map(li => String(li.AccountCode || '')).filter(Boolean)
      const hasCisLabour = lineCodes.includes('321')
      // Project = the tracking option on the bill's line items (first one found). Xero
      // returns Tracking on the list endpoint, so no extra fetch is needed.
      let trackingProject = ''
      for (const li of (inv.LineItems || [])) {
        const t = (li.Tracking || [])[0]
        if (t && (t.Option || t.TrackingOptionName)) { trackingProject = t.Option || t.TrackingOptionName; break }
      }
      out.push({
        id: inv.InvoiceID,
        type: inv.Type || type,
        number: inv.InvoiceNumber || inv.Reference || '',
        contact: inv.Contact?.Name || '',
        date: xeroDateToISO(inv.DateString || inv.Date),
        dueDate: xeroDateToISO(inv.DueDateString || inv.DueDate),
        total: parseFloat(inv.Total || 0),
        amountDue: due,
        reference: inv.Reference || '',
        cisAuto: hasCisLabour,
        project: trackingProject,   // project tracking option (for cash-flow overlap)
        lineCodes,   // diagnostic: account codes on this bill's lines
      })
    }
    if (list.length < 100) break
    page++
  }
  return out
}

// Xero dates come as "/Date(1699...+0000)/" or ISO; normalise to yyyy-mm-dd.
function xeroDateToISO(v) {
  if (!v) return ''
  const m = String(v).match(/\/Date\((\d+)/)
  const d = m ? new Date(parseInt(m[1])) : new Date(v)
  if (isNaN(d)) return ''
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// General-ledger pull via the read-only Journals endpoint. Returns EVERY posted
// journal line (bills, bank, manual journals, credit notes, payroll - everything
// that makes up a P&L account), grouped by account code and month. Summed per
// account/month this reconciles exactly to the Profit & Loss for that account.
//
// The Journals endpoint has no server-side date/account filter - it pages the whole
// ledger 100 lines at a time via offset. We filter client-side to [fromDateStr, now]
// and to the supplied set of account codes (overheads) to keep the stored data small.
//
// Returns: { byCodeMonth: { [code]: { [YYYY-MM]: [ {date, description, reference, amount} ] } }, journalCount }
export async function fetchGeneralLedgerByAccountMonth(accessToken, tenantId, fromDateStr, codeSet = null) {
  const byCodeMonth = {}
  let offset = 0
  let journalCount = 0
  let pages = 0
  let lastError = null
  let totalJournalsSeen = 0
  const fromMs = fromDateStr ? new Date(fromDateStr).getTime() : 0
  const wanted = codeSet ? new Set([...codeSet].map(String)) : null

  const parseMs = (v) => {
    if (!v) return NaN
    const m = String(v).match(/\/Date\((\d+)/)
    return m ? parseInt(m[1]) : new Date(v).getTime()
  }

  while (pages < 2000) {
    // Journals is offset-paged (100 at a time), ordered by JournalNumber ascending.
    // We page forward and keep only lines in [fromMs, now] for the wanted codes.
    const url = `${XERO_API}/api.xro/2.0/Journals?offset=${offset}`
    let res
    try {
      res = await fetchWithRetry(url, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' },
      })
    } catch (e) { lastError = `fetch threw: ${e.message}`; break }
    if (!res.ok) { const t = await res.text().catch(() => ''); lastError = `HTTP ${res.status}: ${t.slice(0, 200)}`; break }
    const data = await res.json()
    const journals = data.Journals || []
    pages++
    if (journals.length === 0) break
    totalJournalsSeen += journals.length

    for (const j of journals) {
      journalCount = Math.max(journalCount, j.JournalNumber || 0)
      const ms = parseMs(j.JournalDate)
      if (isNaN(ms)) continue
      if (ms < fromMs) continue
      const d = new Date(ms)
      const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      const dateStr = `${mk}-${String(d.getUTCDate()).padStart(2, '0')}`
      for (const line of j.JournalLines || []) {
        const code = String(line.AccountCode || '')
        if (!code) continue
        if (wanted && !wanted.has(code)) continue
        const amount = line.NetAmount || 0
        if (amount === 0) continue
        if (!byCodeMonth[code]) byCodeMonth[code] = {}
        if (!byCodeMonth[code][mk]) byCodeMonth[code][mk] = []
        byCodeMonth[code][mk].push({
          date: dateStr,
          description: line.Description || j.Reference || j.SourceType || '',
          reference: j.Reference || '',
          sourceType: j.SourceType || '',
          amount,
        })
      }
    }

    const maxNum = journals.reduce((mx, j) => Math.max(mx, j.JournalNumber || 0), offset)
    if (maxNum <= offset) break
    offset = maxNum
    if (journals.length < 100) break
    await sleep(300)
  }

  return { byCodeMonth, journalCount, pages, totalJournalsSeen, lastError }
}
