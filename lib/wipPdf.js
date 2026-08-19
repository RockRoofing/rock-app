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

const san = (s) => String(s == null ? '' : s).replace(/[^\x20-\x7E]/g, '-')
const money = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
  if (logoImg) page.drawImage(logoImg, { x: W - M - 70, y: y - 34, width: 70, height: 34 })

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

  return await pdf.save()
}
