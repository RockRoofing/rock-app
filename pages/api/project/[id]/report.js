import withTenant from '../../../../lib/withTenant'
import { getClient } from '../../../../lib/db'
import { projectVariations, varNumberOf } from '../../../../lib/variationInstruct'
import { isInstructed } from '../../../../lib/applications'
import ExcelJS from 'exceljs'

// PROJECT FINANCIAL REVIEW - Excel download.
//
// REWRITTEN. What it used to do, and why it produced a file with two empty tabs:
//
//   1. It imported getProjectExpenses and getProjectInvoices from lib/xero.js.
//      NEITHER IS EXPORTED FROM THERE. Both calls threw immediately.
//   2. Both sat inside `try { } catch (e) {}` with an EMPTY catch, so the throw
//      was swallowed, costs and invoices stayed empty, and the workbook
//      downloaded looking entirely normal with two blank tabs and a zero total.
//      A silent catch turned a broken import into a plausible-looking report.
//   3. It read the Xero PROJECTS api (/projects.xro/1.0/projects). Rock has
//      never used Xero Projects - the app works from TRACKING CATEGORIES, via
//      getProjectsFromCategories, in 18 other files. So the project lookup
//      returned nothing, jobNo came out empty, and even a working invoice
//      lookup would have been searching for a blank job number.
//   4. Labour Spend was hardcoded to 0 and Materials Spend was set to ALL
//      costs, so the summary was wrong too, not only the two empty tabs.
//
// This was the last file in the codebase still on that path - a survivor from
// before the move to tracking categories.
//
// WHAT IT DOES NOW
// ----------------
// It reads the SAME RECORD Project Financials displays and formats it. It does
// not recompute AFA, margin, WIP, costs or invoiced. Not because recomputing is
// hard, but because a second implementation of a rule is how this project has
// produced nearly every wrong number it has ever had. The report cannot
// disagree with the screen, because it is reading what the screen read.
//
// That record also carries the cost and invoice LINES, so the Expenses and
// Income tabs come from the same single read. No Xero call at all, which makes
// it faster and removes the token refresh that used to be the first thing able
// to fail.
//
// If the data has not been built, it says so plainly rather than returning an
// empty workbook. A blank file that looks fine is what went wrong before.

async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end()
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'Project id required' })

  const redis = await getClient()

  // Stored as a BARE ARRAY, not { projects: [...] }.
  let snap = null
  try { snap = await redis.get('dashboard:cache') } catch {}
  const rows = Array.isArray(snap) ? snap : (snap && Array.isArray(snap.projects) ? snap.projects : [])
  if (!rows.length) {
    return res.status(503).json({
      error: 'Financial data has not been built yet. Open Project Financials once, then download again.',
    })
  }

  const p = rows.find(r => String(r.xeroId) === String(id)
    || String(r.trackingOptionId) === String(id)
    || String(r.jobNo) === String(id))
  if (!p) return res.status(404).json({ error: 'That project is not in the current financial data.' })

  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
  const costLines = Array.isArray(p._costLines) ? p._costLines : []
  const invoiceLines = Array.isArray(p._invoiceLines) ? p._invoiceLines : []
  const vars = projectVariations(p) || []

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const dateOut = (d) => {
    if (!d) return ''
    const s = String(d)
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    // Text month, so a date cannot read as DD/MM here and MM/DD somewhere else.
    return m ? `${m[3]} ${MON[Number(m[2]) - 1]} ${m[1]}` : s
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Rock Roofing Ltd'
  const RR_RED = 'FFE63946'
  const subHeaderStyle = { font: { bold: true, size: 10 }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8F0' } } }
  const labelStyle = { font: { color: { argb: 'FF555555' }, size: 10 } }
  const valueStyle = { font: { bold: true, size: 10 } }
  const moneyFormat = '\u00A3#,##0.00'
  const pctFormat = '0.0%'

  // --- SUMMARY ---------------------------------------------------------
  const summary = wb.addWorksheet('Summary')
  summary.columns = [{ width: 32 }, { width: 22 }, { width: 22 }, { width: 22 }]
  summary.addRow(['Rock Roofing Ltd', '', '', `Generated: ${dateOut(new Date().toISOString().slice(0, 10))}`])
  summary.getRow(1).font = { bold: true, size: 12 }
  summary.addRow(['Project Financial Review'])
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
    r.getCell(2).style = format ? { ...valueStyle, numFmt: format } : { ...valueStyle }
  }

  addSection('Project Information')
  addRow('Project No', p.jobNo || '')
  addRow('Project Name', p.name || '')
  addRow('Customer', p.customer || '')
  addRow('Status', p.status || '')
  addRow('Estimator', p.estimatorResolved || p.estimator || '')
  addRow('QS', p.qsResolved || p.qsName || '')
  addRow('Contracts Manager', p.cmResolved || p.contractsManager || '')
  addRow('Order Reference', p.orderRef || '')
  summary.addRow([])

  addSection('Financial Summary')
  addRow('Original Contract Value', num(p.contractValue), moneyFormat)
  addRow('Variations (instructed)', vars.filter(v => isInstructed(v)).reduce((s, v) => s + num(v.materials) + num(v.labour) + num(v.profit), 0), moneyFormat)
  addRow('Anticipated Final Account', num(p.afaShown != null ? p.afaShown : p.afa), moneyFormat)
  addRow('Gross Invoiced to Date', num(p.grossInvoiced), moneyFormat)
  addRow('Remaining to Claim', num(p.remainingToClaim), moneyFormat)
  if (p.currentMargin == null) addRow('Current Margin', 'n/a')
  else addRow('Current Margin', num(p.currentMargin), pctFormat)
  addRow('WIP', num(p.wip), moneyFormat)
  summary.addRow([])

  addSection('Budget vs Spend')
  addRow('Labour Budget', num(p.labourBudget), moneyFormat)
  addRow('Labour Spend', num(p.labourSpend), moneyFormat)
  addRow('Labour Remaining', num(p.labourBudget) - num(p.labourSpend), moneyFormat)
  addRow('Materials Budget', num(p.materialsBudget), moneyFormat)
  addRow('Materials Spend', num(p.materialsSpend), moneyFormat)
  addRow('Materials Remaining', num(p.materialsBudget) - num(p.materialsSpend), moneyFormat)
  addRow('Total Costs', num(p.totalCosts), moneyFormat)
  summary.addRow([])

  addSection('Retention and Dates')
  addRow('Retention %', num(p.retentionPct), pctFormat)
  addRow('Valuation Day', p.valuationDay || '')
  addRow('PC Date', p.pcDateTBC ? 'TBC' : dateOut(p.pcDate))
  addRow('Defects End Date', p.defectsDateTBC ? 'TBC' : dateOut(p.defectsDate))

  // --- VARIATIONS ------------------------------------------------------
  const varSheet = wb.addWorksheet('Variations')
  varSheet.columns = [{ width: 10 }, { width: 46 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 17 }]
  const varHeader = varSheet.addRow(['Ref', 'Description', 'Materials', 'Labour', 'Profit', 'Total', 'Status'])
  varHeader.eachCell(c => { c.style = { ...subHeaderStyle, font: { bold: true } } })
  let instructedTotal = 0
  vars.forEach((v, i) => {
    const mat = num(v.materials), lab = num(v.labour), profit = num(v.profit)
    const total = mat + lab + profit
    const inst = isInstructed(v)
    if (inst) instructedTotal += total
    // The stored number where there is one, not the row position. Renumbering by
    // position is how a V03 quietly becomes a V02.
    const ref = varNumberOf(v) || `V${String(i + 1).padStart(2, '0')}`
    const r = varSheet.addRow([ref, v.description || '', mat, lab, profit, total, inst ? 'Instructed' : 'Not instructed'])
    for (const c of [3, 4, 5, 6]) r.getCell(c).numFmt = moneyFormat
    if (!inst) r.eachCell(c => { c.font = { color: { argb: 'FF888888' } } })
  })
  const varTotal = varSheet.addRow(['', 'Total instructed', '', '', '', instructedTotal, ''])
  varTotal.getCell(6).numFmt = moneyFormat
  varTotal.font = { bold: true }
  if (!vars.length) varSheet.addRow(['', 'No variations recorded against this project.'])

  // --- EXPENSES --------------------------------------------------------
  const expSheet = wb.addWorksheet('Expenses')
  expSheet.columns = [{ width: 14 }, { width: 30 }, { width: 46 }, { width: 16 }, { width: 15 }, { width: 12 }, { width: 10 }]
  const expHeader = expSheet.addRow(['Date', 'Supplier', 'Description', 'Reference', 'Amount', 'Type', 'Account'])
  expHeader.eachCell(c => { c.style = { ...subHeaderStyle, font: { bold: true } } })
  const costSorted = costLines.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  costSorted.forEach(c => {
    const r = expSheet.addRow([dateOut(c.date), c.supplier || '', c.description || '', c.reference || '', num(c.amount), c.type || '', String(c.accountCode || '')])
    r.getCell(5).numFmt = moneyFormat
  })
  const expTotal = expSheet.addRow(['', '', '', 'TOTAL', costSorted.reduce((s, c) => s + num(c.amount), 0), '', ''])
  expTotal.getCell(5).numFmt = moneyFormat
  expTotal.font = { bold: true }
  if (!costSorted.length) expSheet.addRow(['No cost lines recorded against this project.'])

  // --- INCOME ----------------------------------------------------------
  const incSheet = wb.addWorksheet('Income')
  incSheet.columns = [{ width: 14 }, { width: 16 }, { width: 30 }, { width: 30 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 12 }]
  const incHeader = incSheet.addRow(['Date', 'Invoice No', 'Reference', 'Customer', 'Total', 'Paid', 'Due', 'Status'])
  incHeader.eachCell(c => { c.style = { ...subHeaderStyle, font: { bold: true } } })
  const invSorted = invoiceLines.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  invSorted.forEach(inv => {
    const r = incSheet.addRow([dateOut(inv.date), inv.invoiceNumber || '', inv.reference || '', inv.contact || '', num(inv.total), num(inv.amountPaid), num(inv.amountDue), inv.status || ''])
    for (const c of [5, 6, 7]) r.getCell(c).numFmt = moneyFormat
  })
  const incTotal = incSheet.addRow(['', '', '', 'TOTAL',
    invSorted.reduce((s, i) => s + num(i.total), 0),
    invSorted.reduce((s, i) => s + num(i.amountPaid), 0),
    invSorted.reduce((s, i) => s + num(i.amountDue), 0), ''])
  for (const c of [5, 6, 7]) incTotal.getCell(c).numFmt = moneyFormat
  incTotal.font = { bold: true }
  if (!invSorted.length) incSheet.addRow(['No sales invoices recorded against this project.'])

  const safeJob = String(p.jobNo || 'project').replace(/[^A-Za-z0-9_-]/g, '')
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${safeJob}_Financial_Report_${new Date().toISOString().slice(0, 10)}.xlsx"`)
  await wb.xlsx.write(res)
  res.end()
}

export default withTenant(handler)
