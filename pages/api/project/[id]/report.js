import { getTokens, saveTokens, getProject, getEffectiveValuationDate } from '../../../../lib/db'
import { refreshXeroToken, getXeroProjects, getProjectExpenses, getProjectInvoices } from '../../../../lib/xero'
import ExcelJS from 'exceljs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { id } = req.query

  let tokens = await getTokens()
  if (!tokens) return res.status(401).json({ error: 'Not connected' })
  try {
    const newTokens = await refreshXeroToken(tokens.refresh_token)
    tokens = { ...tokens, ...newTokens }
    await saveTokens(tokens)
  } catch (e) {}

  const xeroProjects = await getXeroProjects(tokens.access_token)
  const xp = xeroProjects.find(p => p.projectId === id)
  const settings = await getProject(id) || {}
  const jobNo = extractJobNo(xp?.name || '')

  let costs = []
  try {
    const { charged } = await getProjectExpenses(tokens.access_token, id)
    costs = (charged || []).map(c => ({
      date: c.dateUtc ? new Date(c.dateUtc) : null,
      description: c.description,
      amount: c.amount?.value || 0,
      supplier: c.contactName || '',
      type: c.expenseType || 'Expense'
    }))
  } catch (e) {}

  let invoices = []
  try {
    const raw = await getProjectInvoices(tokens.access_token, jobNo)
    invoices = raw.map(inv => ({
      invoiceNumber: inv.InvoiceNumber,
      reference: inv.Reference,
      contact: inv.Contact?.Name,
      date: inv.DateString ? new Date(inv.DateString) : null,
      total: inv.Total,
      status: inv.Status
    }))
  } catch (e) {}

  const vDate = getEffectiveValuationDate(settings)
  const costsToDate = costs.filter(c => !vDate || c.date <= vDate).reduce((s, c) => s + c.amount, 0)
  const costsAfterDate = costs.filter(c => vDate && c.date > vDate).reduce((s, c) => s + c.amount, 0)
  const totalInvoiced = invoices.reduce((s, i) => s + (i.total || 0), 0)
  const contractValue = parseFloat(settings.contractValue || 0)
  const instructedVars = (settings.variations || []).filter(v => v.instructed).reduce((s, v) => s + (parseFloat(v.materials || 0) + parseFloat(v.labour || 0) + parseFloat(v.profit || 0)), 0)
  const afa = contractValue + instructedVars
  const currentMargin = afa > 0 ? (afa - costsToDate) / afa : 0
  const remainingToClaim = afa - totalInvoiced
  const retPct = parseFloat(settings.retentionPct || 0)
  const totalRetention = totalInvoiced * retPct
  const now = new Date()
  const pc1 = settings.pcDate ? new Date(settings.pcDate) : null
  const pc2 = settings.defectsDate ? new Date(settings.defectsDate) : null
  const retentionReleased = (pc1 && pc1 <= now ? totalRetention / 2 : 0) + (pc2 && pc2 <= now ? totalRetention / 2 : 0)
  const retentionOutstanding = totalRetention - retentionReleased
  const wip = currentMargin < 1 ? costsAfterDate / (1 - currentMargin) : costsAfterDate

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Rock Roofing Ltd'

  // ─── SUMMARY SHEET ───────────────────────────────────────────────
  const summary = wb.addWorksheet('Summary')
  const RR_RED = 'FFE63946'
  const DARK = 'FF1A1A2E'
  const LIGHT_GREY = 'FFF8F8F8'
  const WHITE = 'FFFFFFFF'

  const headerStyle = { font: { bold: true, color: { argb: WHITE }, size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }, alignment: { vertical: 'middle' } }
  const subHeaderStyle = { font: { bold: true, size: 10 }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8F0' } } }
  const labelStyle = { font: { color: { argb: 'FF555555' }, size: 10 } }
  const valueStyle = { font: { bold: true, size: 10 } }
  const moneyFormat = '£#,##0.00'
  const pctFormat = '0.0%'

  summary.columns = [{ width: 30 }, { width: 20 }, { width: 20 }, { width: 20 }]
  summary.addRow(['Rock Roofing Ltd', '', `Valuation Date: ${vDate ? vDate.toLocaleDateString('en-GB') : 'Not set'}`, `Generated: ${new Date().toLocaleDateString('en-GB')}`])
  summary.getRow(1).font = { bold: true, size: 12 }
  summary.addRow(['Project Financial Review', '', '', ''])
  summary.getRow(2).font = { bold: true, size: 14, color: { argb: RR_RED } }
  summary.addRow([])

  const addSection = (title) => {
    const r = summary.addRow([title])
    r.getCell(1).style = subHeaderStyle
    summary.mergeCells(r.number, 1, r.number, 4)
  }

  const addRow = (label, value, format) => {
    const r = summary.addRow([label, value])
    r.getCell(1).style = labelStyle
    r.getCell(2).style = { ...valueStyle, numFmt: format }
  }

  addSection('Project Information')
  addRow('Project No', jobNo)
  addRow('Project Name', xp?.name || '')
  addRow('Customer', settings.customerName || xp?.contactName || '')
  addRow('Region', settings.region || '')
  addRow('Estimator', settings.estimator || '')
  addRow('QS', settings.qsName || '')
  addRow('Contracts Manager', settings.contractsManager || '')
  summary.addRow([])

  addSection('Financial Summary')
  addRow('Original Contract Value', contractValue, moneyFormat)
  addRow('Variations (Instructed)', instructedVars, moneyFormat)
  addRow('Anticipated Final Account', afa, moneyFormat)
  addRow('Total Invoiced to Date', totalInvoiced, moneyFormat)
  addRow('Remaining to Claim', remainingToClaim, moneyFormat)
  addRow('Current Profit Margin', currentMargin, pctFormat)
  addRow('WIP (to month end)', wip, moneyFormat)
  summary.addRow([])

  addSection('Budget vs Spend')
  addRow('Labour Budget', parseFloat(settings.labourBudget || 0), moneyFormat)
  addRow('Labour Spend', 0, moneyFormat)
  addRow('Labour Remaining', parseFloat(settings.labourBudget || 0), moneyFormat)
  addRow('Materials Budget', parseFloat(settings.materialsBudget || 0), moneyFormat)
  addRow('Materials Spend', costsToDate, moneyFormat)
  addRow('Materials Remaining', parseFloat(settings.materialsBudget || 0) - costsToDate, moneyFormat)
  summary.addRow([])

  addSection('Retention')
  addRow('Retention %', retPct, pctFormat)
  addRow('Total Retention', totalRetention, moneyFormat)
  addRow('Retention Released', retentionReleased, moneyFormat)
  addRow('Retention Outstanding', retentionOutstanding, moneyFormat)
  addRow('PC Date (1st half)', pc1 ? pc1.toLocaleDateString('en-GB') : '—')
  addRow('Defects End Date (2nd half)', pc2 ? pc2.toLocaleDateString('en-GB') : '—')

  // ─── VARIATIONS SHEET ───────────────────────────────────────────
  const varSheet = wb.addWorksheet('Variations')
  varSheet.columns = [{ width: 8 }, { width: 40 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }]
  const varHeader = varSheet.addRow(['Ref', 'Description', 'Materials', 'Labour', 'Profit', 'Total', 'Status'])
  varHeader.eachCell(cell => { cell.style = { ...subHeaderStyle, font: { bold: true } } })
  ;(settings.variations || []).forEach((v, i) => {
    const mat = parseFloat(v.materials || 0)
    const lab = parseFloat(v.labour || 0)
    const profit = parseFloat(v.profit || 0)
    const total = mat + lab + profit
    const r = varSheet.addRow([`V${String(i + 1).padStart(2, '0')}`, v.description, mat, lab, profit, total, v.instructed ? 'Instructed' : 'Not Instructed'])
    r.getCell(3).numFmt = moneyFormat
    r.getCell(4).numFmt = moneyFormat
    r.getCell(5).numFmt = moneyFormat
    r.getCell(6).numFmt = moneyFormat
    if (!v.instructed) r.eachCell(c => { c.font = { color: { argb: 'FF888888' } } })
  })
  const varTotalRow = varSheet.addRow(['', 'Total Instructed', '', '', '', instructedVars])
  varTotalRow.getCell(6).numFmt = moneyFormat
  varTotalRow.font = { bold: true }

  // ─── EXPENSES SHEET ─────────────────────────────────────────────
  const expSheet = wb.addWorksheet('Expenses')
  expSheet.columns = [{ width: 14 }, { width: 30 }, { width: 30 }, { width: 16 }, { width: 14 }, { width: 12 }]
  const expHeader = expSheet.addRow(['Date', 'Supplier', 'Description', 'Amount', 'Type', 'Period'])
  expHeader.eachCell(cell => { cell.style = { ...subHeaderStyle, font: { bold: true } } })
  costs.forEach(c => {
    const isAfter = vDate && c.date && c.date > vDate
    const r = expSheet.addRow([c.date ? c.date.toLocaleDateString('en-GB') : '', c.supplier, c.description, c.amount, c.type, isAfter ? 'WIP' : 'Claimed'])
    r.getCell(4).numFmt = moneyFormat
    if (isAfter) r.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFdbeafe' } } })
  })
  const expTotalRow = expSheet.addRow(['', '', 'TOTAL', costs.reduce((s, c) => s + c.amount, 0)])
  expTotalRow.getCell(4).numFmt = moneyFormat
  expTotalRow.font = { bold: true }

  // ─── INCOME SHEET ───────────────────────────────────────────────
  const incSheet = wb.addWorksheet('Income')
  incSheet.columns = [{ width: 14 }, { width: 16 }, { width: 30 }, { width: 28 }, { width: 16 }, { width: 12 }]
  const incHeader = incSheet.addRow(['Date', 'Invoice No', 'Reference', 'Customer', 'Amount', 'Status'])
  incHeader.eachCell(cell => { cell.style = { ...subHeaderStyle, font: { bold: true } } })
  invoices.forEach(inv => {
    const r = incSheet.addRow([inv.date ? inv.date.toLocaleDateString('en-GB') : '', inv.invoiceNumber, inv.reference, inv.contact, inv.total, inv.status])
    r.getCell(5).numFmt = moneyFormat
  })
  const incTotalRow = incSheet.addRow(['', '', '', 'TOTAL', totalInvoiced])
  incTotalRow.getCell(5).numFmt = moneyFormat
  incTotalRow.font = { bold: true }

  // Send file
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${jobNo}_Financial_Report_${new Date().toISOString().slice(0,10)}.xlsx"`)
  await wb.xlsx.write(res)
  res.end()
}

function extractJobNo(name) {
  const match = name.match(/^(J\d+|RR\d+)/i)
  return match ? match[1].toUpperCase() : name.split(/[-–\s]/)[0]
}
