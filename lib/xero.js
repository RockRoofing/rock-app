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

// Sales ledger from sources the app is ALREADY authorised for (no /Journals endpoint):
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
    const modifiedSince = fromDateStr ? new Date(fromDateStr).toISOString() : null
    while (page <= 200) {
      const url = `${XERO_API}/api.xro/2.0/Invoices?Type=ACCREC&page=${page}&pageSize=100`
      const res = await fetchWithRetry(url, { headers: modifiedSince ? { ...H, 'If-Modified-Since': modifiedSince } : H })
      if (!res.ok) { const t = await res.text().catch(() => ''); meta.lastError = `Invoices HTTP ${res.status}: ${t.slice(0, 120)}`; break }
      const data = await res.json()
      const batch = data.Invoices || []
      meta.invoicePages++
      if (batch.length === 0) break
      meta.invoicesSeen += batch.length
      for (const inv of batch) {
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
          // Your WIP journals post the sale to the sales code as a POSITIVE LineAmount,
          // so use it as-is: sales positive, any reversal (negative) reduces sales.
          const raw = Number(jl.LineAmount || 0)
          if (!raw) continue
          meta.journalLines++
          add(code, ms, {
            description: jl.Description || mj.Narration || 'Manual journal (WIP)',
            reference: mj.Narration || '',
            sourceType: 'Manual journal',
            amount: raw,
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
    const modifiedSince = fromDateStr ? new Date(fromDateStr).toISOString() : null
    while (page <= 100) {
      const url = `${XERO_API}/api.xro/2.0/CreditNotes?where=${encodeURIComponent('Type=="ACCRECCREDIT"')}&page=${page}&pageSize=100`
      const res = await fetchWithRetry(url, { headers: modifiedSince ? { ...H, 'If-Modified-Since': modifiedSince } : H })
      if (!res.ok) { const t = await res.text().catch(() => ''); meta.lastError = (meta.lastError || '') + ` CN HTTP ${res.status}: ${t.slice(0, 120)}`; break }
      const data = await res.json()
      const batch = data.CreditNotes || []
      meta.creditNotePages = (meta.creditNotePages || 0) + 1
      if (batch.length === 0) break
      meta.creditNotesSeen = (meta.creditNotesSeen || 0) + batch.length
      for (const cn of batch) {
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

// All OUTSTANDING accounts-payable bills (money we owe) with due dates. Returns
// authorised bills that still have an amount due, PLUS authorised ACCPAY credit notes
// with a remaining balance as NEGATIVE lines - so the net total reconciles to Xero's
// "Awaiting payment" figure (which nets credit notes against bills). Used by "Bills to Pay".
export async function fetchOutstandingBills(accessToken, tenantId) {
  const bills = await fetchOutstandingInvoicesOfType(accessToken, tenantId, 'ACCPAY')
  let credits = []
  try {
    credits = await fetchOutstandingCreditNotes(accessToken, tenantId, 'ACCPAYCREDIT')
  } catch (e) {
    // If credit notes can't be fetched, still return bills (total just won't net).
    console.error('ACCPAY credit notes fetch failed:', e.message)
  }
  return [...bills, ...credits]
}
// All OUTSTANDING accounts-receivable invoices (money owed to us) with due dates.
// Used by "Invoices Owed".
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
