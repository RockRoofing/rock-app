import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const A4L = [841.89, 595.28] // landscape
const M = 36
const GOLD = rgb(0.79, 0.54, 0.02)
const INK = rgb(0.1, 0.1, 0.1)
const GREY = rgb(0.5, 0.5, 0.5)
const LINE = rgb(0.8, 0.8, 0.8)
const WE = rgb(0.95, 0.94, 0.92)

const DOWFULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const fmtDM = (s) => { const d = parseISO(s); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) }

export async function buildWeeklyLabourPDF({ week, logoUrl }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let page = pdf.addPage(A4L)
  let y = A4L[1] - M

  let logo = null
  if (logoUrl) { try { const b = new Uint8Array(await (await fetch(logoUrl)).arrayBuffer()); logo = /\.png$/i.test(logoUrl) ? await pdf.embedPng(b) : await pdf.embedJpg(b) } catch {} }

  if (logo) page.drawImage(logo, { x: M, y: y - 34, width: 34, height: 34 })
  page.drawText('Weekly Labour Allocation', { x: M + (logo ? 46 : 0), y: y - 22, size: 18, font: bold, color: INK })
  y -= 40
  page.drawText(`Week commencing ${parseISO(week.weekStart).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, { x: M, y, size: 11, font, color: GREY })
  y -= 18

  const nameW = 150
  const totalW = A4L[0] - M * 2
  const dayW = (totalW - nameW) / 7

  const rowH = 24
  const headerH = 26

  const drawHeader = () => {
    // header row
    page.drawRectangle({ x: M, y: y - headerH, width: totalW, height: headerH, color: rgb(0.98, 0.97, 0.95) })
    page.drawText('Operative', { x: M + 6, y: y - 17, size: 10, font: bold, color: INK })
    week.days.forEach((dk, i) => {
      const x = M + nameW + i * dayW
      const weekend = i >= 5
      if (weekend) page.drawRectangle({ x, y: y - headerH, width: dayW, height: headerH, color: WE })
      page.drawText(DOWFULL[i], { x: x + 6, y: y - 12, size: 9, font: bold, color: weekend ? rgb(0.7, 0.1, 0.1) : INK })
      page.drawText(fmtDM(dk), { x: x + 6, y: y - 21, size: 7.5, font, color: GREY })
    })
    y -= headerH
  }
  drawHeader()

  const ensure = (h) => { if (y - h < M + 20) { page = pdf.addPage(A4L); y = A4L[1] - M; drawHeader() } }

  for (const row of week.rows) {
    ensure(rowH)
    // name cell
    page.drawText(row.name, { x: M + 6, y: y - 16, size: 9.5, font: bold, color: INK })
    if (row.company) page.drawText(row.company, { x: M + 6, y: y - 24, size: 6.5, font, color: GREY })
    week.days.forEach((dk, i) => {
      const x = M + nameW + i * dayW
      const weekend = i >= 5
      if (weekend) page.drawRectangle({ x, y: y - rowH, width: dayW, height: rowH, color: WE })
      const cell = row.cells[i]
      if (cell) {
        const labels = cell.entries.map(e => e.projectName + (e.half !== 'full' ? ` (${e.half.toUpperCase()})` : ''))
        let ty = y - 10
        for (const l of labels) {
          const txt = l.length > 26 ? l.slice(0, 25) + '…' : l
          page.drawText(txt, { x: x + 4, y: ty, size: 7, font, color: rgb(0.12, 0.25, 0.55) })
          ty -= 8
        }
      }
      page.drawLine({ start: { x, y: y - rowH }, end: { x, y }, thickness: 0.4, color: LINE })
    })
    page.drawLine({ start: { x: M, y: y - rowH }, end: { x: M + totalW, y: y - rowH }, thickness: 0.4, color: LINE })
    y -= rowH
  }

  // totals row
  ensure(rowH)
  page.drawText('Total installers', { x: M + 6, y: y - 16, size: 9, font: bold, color: INK })
  week.days.forEach((dk, i) => {
    const x = M + nameW + i * dayW
    const t = week.dailyTotals[i]
    page.drawText(String(t || 0), { x: x + 6, y: y - 16, size: 9, font: bold, color: t ? INK : GREY })
  })
  y -= rowH

  return await pdf.save()
}

// A single operative's own week (for the personalised email attachment).
export async function buildOperativeWeekPDF({ row, week, logoUrl }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([595.28, 841.89])
  let y = 841.89 - 48
  let logo = null
  if (logoUrl) { try { const b = new Uint8Array(await (await fetch(logoUrl)).arrayBuffer()); logo = /\.png$/i.test(logoUrl) ? await pdf.embedPng(b) : await pdf.embedJpg(b) } catch {} }
  if (logo) page.drawImage(logo, { x: 48, y: y - 34, width: 34, height: 34 })
  page.drawText('Your Week', { x: 48 + (logo ? 46 : 0), y: y - 22, size: 20, font: bold, color: INK })
  y -= 46
  page.drawText(row.name, { x: 48, y, size: 13, font: bold, color: INK }); y -= 16
  page.drawText(`Week commencing ${parseISO(week.weekStart).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, { x: 48, y, size: 10, font, color: GREY }); y -= 22

  week.days.forEach((dk, i) => {
    const cell = row.cells[i]
    const weekend = i >= 5
    page.drawText(`${DOWFULL[i]} ${fmtDM(dk)}`, { x: 48, y, size: 11, font: bold, color: weekend ? rgb(0.7, 0.1, 0.1) : INK })
    const txt = cell ? cell.entries.map(e => e.projectName + (e.half !== 'full' ? ` (${e.half.toUpperCase()})` : '')).join(', ') : '—'
    page.drawText(txt, { x: 170, y, size: 11, font, color: cell ? rgb(0.12, 0.25, 0.55) : GREY })
    y -= 22
  })
  return await pdf.save()
}
