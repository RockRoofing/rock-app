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

// Full Chart of Accounts, limited to accounts that can be a PROJECT COST — i.e.
// P&L expense accounts (Class EXPENSE: direct costs, overheads, expenses). Balance-
// sheet accounts (assets, liabilities, equity) and bank/revenue accounts are excluded
// because they never appear as a cost against a project.
export async function fetchChartOfAccounts(accessToken, tenantId) {
  const url = `${XERO_API}/api.xro/2.0/Accounts`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' } })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Accounts fetch failed: ${res.status} ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  const COST_TYPES = new Set(['EXPENSE', 'DIRECTCOSTS', 'OVERHEADS'])
  return (data.Accounts || [])
    .filter(a => a.Code)
    // Keep expense-class / cost-of-sale accounts only.
    .filter(a => String(a.Class || '').toUpperCase() === 'EXPENSE' || COST_TYPES.has(String(a.Type || '').toUpperCase()))
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
  const byCode = {}            // accountCode -> amount (income + cost of sales)
  let incomeTotal = 0, costOfSalesTotal = 0
  if (report) {
    for (const section of (report.Rows || [])) {
      const title = (section.Title || '').trim()
      const tl = title.toLowerCase()
      const isIncome = tl.includes('income') || tl.includes('revenue') || tl.includes('turnover')
      const isCos = tl.includes('cost of sales') || tl.includes('cost of goods') || tl.includes('direct costs')
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
        if (isCos) costOfSalesTotal += val
        if ((isIncome || isCos) && nameToCode) {
          const code = nameToCode[String(name).trim().toLowerCase()]
          if (code) byCode[code] = (byCode[code] || 0) + val
        }
      }
    }
  }
  return { accounts, bySection, byCode, incomeTotal, costOfSalesTotal, sectionTitles: Object.keys(bySection) }
}
