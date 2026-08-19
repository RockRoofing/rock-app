import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// A landscape summary of the month's WIP: one row per project, the totals, and whether
// the month has been signed off.
//
// Deliberately a SUMMARY, not the whole screen. The page shows every post-valuation cost
// line for every project, which on a busy month runs to hundreds of rows and would make a
// document nobody prints. What Accounts need from a WIP PDF is the figure per project and
// the total.

const INK = rgb(0.10, 0.10, 0.18)
const GREY = rgb(0.45, 0.45, 0.48)
const LINE = rgb(0.85, 0.85, 0.87)
const GREEN = rgb(0.09, 0.44, 0.31)
const RED = rgb(0.86, 0.15, 0.15)

// KEEP THE POUND SIGN. Stripping to printable ASCII turned every "£" into "-", so the
// figures read "-27,400.75" - which on a costs report looks like a negative number rather
// than a currency symbol. pdf-lib's WinAnsi encoding handles £ fine; it is only the
// sanitiser that was removing it.
const san = (s) => String(s == null ? '' : s)
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[^\x20-\x7E\u00A3]/g, ' ')
// A negative reads as -£5,000.00, not £-5,000.00. On a page of costs the second one is
// briefly misread as a currency oddity rather than a credit.
const money = (n) => {
  const v = Number(n) || 0
  return (v < 0 ? '-£' : '£') + Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export async function buildWipPDF({ month, monthLabel, projects = [], totalWip, totalWipProfit, lock, logoUrl }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const W = 842, H = 595            // A4 landscape
  const M = 34
  let page = pdf.addPage([W, H])
  let y = H - M

  let logoImg = null
  if (logoUrl) {
    try {
      const bytes = await fetch(logoUrl).then(r => r.arrayBuffer())
      logoImg = await pdf.embedPng(bytes).catch(() => pdf.embedJpg(bytes))
    } catch { /* a missing logo must not stop the report */ }
  }
  // Scaled from the image. 70x34 on a square logo squashed it, the same way the variation
  // PDF did.
  if (logoImg) {
    const LOGO_H = 40
    const lw = LOGO_H * (logoImg.width / logoImg.height)
    page.drawImage(logoImg, { x: W - M - lw, y: y - LOGO_H, width: lw, height: LOGO_H })
  }

  page.drawText('Work in Progress', { x: M, y: y - 20, size: 19, font: bold, color: INK })
  page.drawText(san(monthLabel || month), { x: M, y: y - 36, size: 11, font, color: GREY })

  // Sign-off state, in words and colour - the first thing anybody checks.
  const statusText = lock
    ? `WIP COMPLETE - signed off${lock.lockedBy ? ` by ${lock.lockedBy}` : ''} on ${new Date(lock.lockedAt).toLocaleDateString('en-GB')}`
    : 'WIP NOT COMPLETE - these figures have not been signed off'
  page.drawText(san(statusText), { x: M, y: y - 52, size: 10, font: bold, color: lock ? GREEN : RED })

  y -= 74

  // Columns, right-aligned where they are money.
  const cols = [
    ['Job', M, 60, 'l'],
    ['Project', M + 64, 210, 'l'],
    ['Valuation', M + 278, 62, 'l'],
    ['Post-val costs', M + 344, 88, 'r'],
    ['Adjustments', M + 436, 78, 'r'],
    ['Margin', M + 518, 50, 'r'],
    ['Profit in WIP', M + 572, 84, 'r'],
    ['WIP', M + 660, 96, 'r'],
  ]
  const drawRow = (cells, f, size, color, yy) => {
    cols.forEach(([, x, w, align], i) => {
      const t = san(cells[i] == null ? '' : cells[i])
      const tw = f.widthOfTextAtSize(t, size)
      page.drawText(t, { x: align === 'r' ? x + w - tw : x, y: yy, size, font: f, color })
    })
  }

  const header = () => {
    page.drawRectangle({ x: M - 4, y: y - 4, width: W - M * 2 + 8, height: 18, color: rgb(0.97, 0.97, 0.97) })
    drawRow(cols.map(c => c[0]), bold, 8.5, GREY, y)
    y -= 18
  }
  header()

  for (const p of projects) {
    // New page before the row runs off the bottom, with the headings repeated.
    if (y < M + 46) {
      page = pdf.addPage([W, H]); y = H - M
      header()
    }
    drawRow([
      p.jobNo || '',
      p.name || '',
      p.valuationDate ? new Date(p.valuationDate).toLocaleDateString('en-GB') : '',
      money(p.postValTotal),
      p.adjTotal ? money(p.adjTotal) : '',
      p.margin != null ? (p.margin * 100).toFixed(1) + '%' : '',
      money(p.wipProfit),
      money(p.wipValue),
    ], font, 8.5, INK, y)
    page.drawLine({ start: { x: M - 4, y: y - 5 }, end: { x: W - M + 4, y: y - 5 }, thickness: 0.4, color: LINE })
    y -= 16
  }

  if (y < M + 40) { page = pdf.addPage([W, H]); y = H - M }
  y -= 6
  page.drawLine({ start: { x: M - 4, y: y + 9 }, end: { x: W - M + 4, y: y + 9 }, thickness: 1.2, color: INK })
  drawRow(['', `${projects.length} project${projects.length === 1 ? '' : 's'}`, '', '', '', '', money(totalWipProfit), money(totalWip)], bold, 10, INK, y - 4)

  y -= 30
  page.drawText(san(`Produced ${new Date().toLocaleString('en-GB')} from the Rock Roofing portal.`), { x: M, y, size: 7.5, font, color: GREY })

  // -------------------------------------------------------------------------
  // The build-up behind each project
  // -------------------------------------------------------------------------
  // The summary above answers "what is the WIP". This answers "why", which is the
  // question anybody reviewing it asks next - and the reason a summary on its own tends
  // to come straight back with "where has that come from".
  //
  // A page per project, so a single job can be printed or sent on its own.
  const detailCols = [
    ['Date', M, 60, 'l'],
    ['Supplier', M + 64, 190, 'l'],
    ['Reference', M + 258, 90, 'l'],
    ['Account', M + 352, 150, 'l'],
    ['Type', M + 506, 90, 'l'],
    ['Amount', M + 600, 156, 'r'],
  ]
  const drawDetail = (cells, f, size, color, yy) => {
    detailCols.forEach(([, x, w, align], i) => {
      let t = san(cells[i] == null ? '' : cells[i])
      // Trim to the column rather than letting it run into the next one.
      while (t && f.widthOfTextAtSize(t, size) > w - 4) t = t.slice(0, -1)
      const tw = f.widthOfTextAtSize(t, size)
      page.drawText(t, { x: align === 'r' ? x + w - tw : x, y: yy, size, font: f, color })
    })
  }

  for (const p of projects) {
    page = pdf.addPage([W, H])
    y = H - M

    page.drawText(san([p.jobNo, p.name].filter(Boolean).join(' - ')), { x: M, y: y - 16, size: 14, font: bold, color: INK })
    page.drawText(san(`Valuation date ${p.valuationDate ? new Date(p.valuationDate).toLocaleDateString('en-GB') : '-'}`
      + `   ·   margin ${p.margin != null ? (p.margin * 100).toFixed(1) + '%' : '-'}${p.marginIsOverride ? ' (override)' : ''}`),
      { x: M, y: y - 30, size: 9, font, color: GREY })
    y -= 48

    const section = (title) => {
      if (y < M + 40) { page = pdf.addPage([W, H]); y = H - M }
      page.drawText(san(title), { x: M, y, size: 10, font: bold, color: INK })
      y -= 14
      page.drawRectangle({ x: M - 4, y: y - 4, width: W - M * 2 + 8, height: 16, color: rgb(0.97, 0.97, 0.97) })
      drawDetail(detailCols.map(c => c[0]), bold, 8, GREY, y)
      y -= 16
    }

    // Post-valuation costs - the costs incurred after the valuation date, which are what
    // the WIP is built from.
    section(`Post-valuation costs (${(p.postValCosts || []).length})`)
    if (!(p.postValCosts || []).length) {
      page.drawText('None.', { x: M, y, size: 8.5, font, color: GREY }); y -= 16
    }
    for (const l of (p.postValCosts || [])) {
      if (y < M + 30) {
        page = pdf.addPage([W, H]); y = H - M
        page.drawRectangle({ x: M - 4, y: y - 4, width: W - M * 2 + 8, height: 16, color: rgb(0.97, 0.97, 0.97) })
        drawDetail(detailCols.map(c => c[0]), bold, 8, GREY, y)
        y -= 16
      }
      drawDetail([
        l.date ? new Date(l.date).toLocaleDateString('en-GB') : '',
        l.supplier, l.reference,
        [l.accountCode, l.accountName].filter(Boolean).join(' '),
        l.type, money(l.amount),
      ], font, 8, INK, y)
      y -= 13
    }
    y -= 2
    page.drawLine({ start: { x: M - 4, y: y + 6 }, end: { x: W - M + 4, y: y + 6 }, thickness: 0.8, color: INK })
    drawDetail(['', 'Total post-valuation costs', '', '', '', money(p.postValTotal)], bold, 9, INK, y - 6)
    y -= 26

    // Manual adjustments - including any "Zeroed" write-down, which is exactly the thing
    // somebody reviewing the WIP needs to see rather than a project quietly reading nil.
    const adj = p.thisMonthAdj || []
    if (adj.length) {
      section(`Manual adjustments (${adj.length})`)
      for (const a of adj) {
        if (y < M + 30) { page = pdf.addPage([W, H]); y = H - M }
        drawDetail([
          '', a.description || '', '', '',
          a.margin != null && a.margin !== '' ? `${a.margin}%` : '',
          money(a.amount),
        ], font, 8, INK, y)
        y -= 13
      }
      y -= 2
      page.drawLine({ start: { x: M - 4, y: y + 6 }, end: { x: W - M + 4, y: y + 6 }, thickness: 0.8, color: INK })
      drawDetail(['', 'Total adjustments', '', '', '', money(p.adjTotal)], bold, 9, INK, y - 6)
      y -= 26
    }

    // How the costs become the WIP figure on the front page.
    if (y < M + 60) { page = pdf.addPage([W, H]); y = H - M }
    page.drawText('Build-up', { x: M, y, size: 10, font: bold, color: INK }); y -= 16
    const buildRows = [
      ['Post-valuation costs', money(p.postValTotal)],
      ...(p.adjTotal ? [['Manual adjustments', money(p.adjTotal)]] : []),
      [`Grossed up at ${p.margin != null ? (p.margin * 100).toFixed(1) + '%' : '0%'} margin`, money(p.wipProfit)],
      ['WIP', money(p.wipValue)],
    ]
    for (const [l, v] of buildRows) {
      const last = l === 'WIP'
      page.drawText(san(l), { x: M, y, size: last ? 10 : 9, font: last ? bold : font, color: INK })
      const tw = (last ? bold : font).widthOfTextAtSize(san(v), last ? 10 : 9)
      page.drawText(san(v), { x: M + 400 - tw, y, size: last ? 10 : 9, font: last ? bold : font, color: last ? GREEN : INK })
      if (last) page.drawLine({ start: { x: M, y: y + 12 }, end: { x: M + 400, y: y + 12 }, thickness: 0.8, color: INK })
      y -= 15
    }
  }

  return await pdf.save()
}
