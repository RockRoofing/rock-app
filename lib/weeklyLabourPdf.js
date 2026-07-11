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

export async function buildWeeklyLabourPDF({ weeks, week, logoUrl }) {
  const weekList = Array.isArray(weeks) && weeks.length ? weeks : (week ? [week] : [])
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let logo = null
  if (logoUrl) { try { const b = new Uint8Array(await (await fetch(logoUrl)).arrayBuffer()); logo = /\.png$/i.test(logoUrl) ? await pdf.embedPng(b) : await pdf.embedJpg(b) } catch {} }

  const nameW = 150
  const totalW = A4L[0] - M * 2
  const dayW = (totalW - nameW) / 7
  const rowH = 34      // taller so the company line isn't clipped
  const headerH = 28

  for (let wIdx = 0; wIdx < weekList.length; wIdx++) {
    const wk = weekList[wIdx]
    let page = pdf.addPage(A4L)   // each week starts on a new page
    let y = A4L[1] - M

    if (logo) page.drawImage(logo, { x: M, y: y - 34, width: 34, height: 34 })
    page.drawText('Weekly Labour Allocation', { x: M + (logo ? 46 : 0), y: y - 22, size: 18, font: bold, color: INK })
    y -= 40
    page.drawText(`Week commencing ${parseISO(wk.weekStart).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, { x: M, y, size: 11, font, color: GREY })
    y -= 18

    const drawHeader = () => {
      page.drawRectangle({ x: M, y: y - headerH, width: totalW, height: headerH, color: rgb(0.98, 0.97, 0.95) })
      page.drawText('Operative', { x: M + 6, y: y - 18, size: 10, font: bold, color: INK })
      wk.days.forEach((dk, i) => {
        const x = M + nameW + i * dayW
        const weekend = i >= 5
        if (weekend) page.drawRectangle({ x, y: y - headerH, width: dayW, height: headerH, color: WE })
        page.drawText(DOWFULL[i], { x: x + 6, y: y - 13, size: 9, font: bold, color: weekend ? rgb(0.7, 0.1, 0.1) : INK })
        page.drawText(fmtDM(dk), { x: x + 6, y: y - 23, size: 7.5, font, color: GREY })
      })
      y -= headerH
    }
    drawHeader()

    const ensure = (h) => { if (y - h < M + 20) { page = pdf.addPage(A4L); y = A4L[1] - M; drawHeader() } }

    for (const row of wk.rows) {
      ensure(rowH)
      page.drawText(row.name, { x: M + 6, y: y - 15, size: 9.5, font: bold, color: INK })
      if (row.company) page.drawText(row.company, { x: M + 6, y: y - 26, size: 7, font, color: GREY })
      wk.days.forEach((dk, i) => {
        const x = M + nameW + i * dayW
        const weekend = i >= 5
        if (weekend) page.drawRectangle({ x, y: y - rowH, width: dayW, height: rowH, color: WE })
        const cell = row.cells[i]
        if (cell) {
          const labels = cell.entries.map(e => (e.unnamed ? `${e.unnamed} unnamed` : e.projectName) + (e.half !== 'full' ? ` (${e.half.toUpperCase()})` : ''))
          let ty = y - 12
          for (const l of labels) {
            const txt = l.length > 26 ? l.slice(0, 25) + '…' : l
            page.drawText(txt, { x: x + 4, y: ty, size: 7.5, font, color: rgb(0.12, 0.25, 0.55) })
            ty -= 9
          }
        }
        page.drawLine({ start: { x, y: y - rowH }, end: { x, y }, thickness: 0.4, color: LINE })
      })
      page.drawLine({ start: { x: M, y: y - rowH }, end: { x: M + totalW, y: y - rowH }, thickness: 0.4, color: LINE })
      y -= rowH
    }

    ensure(rowH)
    page.drawText('Total installers', { x: M + 6, y: y - 18, size: 9, font: bold, color: INK })
    wk.days.forEach((dk, i) => {
      const x = M + nameW + i * dayW
      const t = wk.dailyTotals[i]
      page.drawText(String(t || 0), { x: x + 6, y: y - 18, size: 9, font: bold, color: t ? INK : GREY })
    })
    y -= rowH
  }

  if (!weekList.length) { pdf.addPage(A4L) }
  return await pdf.save()
}

// A single operative's own upcoming allocation (for the personalised email attachment).
// Either pass week+row (one week) OR customDays: [{date, entries:[{projectName,half,status}]}].
export async function buildOperativeWeekPDF({ row, week, logoUrl, customDays }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([595.28, 841.89])
  let y = 841.89 - 48
  let logo = null
  if (logoUrl) { try { const b = new Uint8Array(await (await fetch(logoUrl)).arrayBuffer()); logo = /\.png$/i.test(logoUrl) ? await pdf.embedPng(b) : await pdf.embedJpg(b) } catch {} }
  if (logo) page.drawImage(logo, { x: 48, y: y - 34, width: 34, height: 34 })
  page.drawText(customDays ? 'Your Upcoming Work' : 'Your Week', { x: 48 + (logo ? 46 : 0), y: y - 22, size: 20, font: bold, color: INK })
  y -= 46
  page.drawText(row.name, { x: 48, y, size: 13, font: bold, color: INK }); y -= 20

  if (customDays) {
    for (const d of customDays) {
      const weekend = [0, 6].includes(parseISO(d.date).getDay())
      page.drawText(`${DOWFULL[(parseISO(d.date).getDay() + 6) % 7]} ${fmtDM(d.date)}`, { x: 48, y, size: 11, font: bold, color: weekend ? rgb(0.7, 0.1, 0.1) : INK })
      const txt = d.entries.map(e => e.projectName + (e.half !== 'full' ? ` (${e.half.toUpperCase()})` : '') + (e.status === 'provisional' ? ' — provisional' : '')).join(', ')
      page.drawText(txt, { x: 190, y, size: 10, font, color: rgb(0.12, 0.25, 0.55) })
      y -= 20
      if (y < 60) { y = 841.89 - 60 }
    }
    return await pdf.save()
  }

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
