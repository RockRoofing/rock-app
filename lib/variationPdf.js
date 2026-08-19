import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// The customer copy of a variation. Laid out like the spreadsheet it replaces: company
// details top left, the header block, the priced items, then the clarifications in red
// underneath.
//
// It does NOT show the workings. The workings are how we arrived at the rate and are ours;
// what the customer gets is the rate, the quantity and the total, which is what the old
// document showed too.

const INK = rgb(0.10, 0.10, 0.18)
const GREY = rgb(0.45, 0.45, 0.48)
const LINE = rgb(0.75, 0.75, 0.78)
// Everything on the customer's copy is black. Red on a document going out reads as a
// warning or a correction; on the old spreadsheet it was just how the template happened
// to be filled in.
const RED = INK

const san = (s) => String(s == null ? '' : s)
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[^\x20-\x7E\u00A3]/g, ' ')

const money = (n) => {
  const v = Number(n) || 0
  return (v < 0 ? '-£' : '£') + Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const dmy = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB') }

export async function buildVariationPDF({ variation, project, logoUrl }) {
  const b = variation.builder || {}
  const items = b.items || []
  const clar = (b.clarifications || []).filter(c => String(c || '').trim())

  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const W = 595, H = 842            // A4 portrait
  const M = 40
  const width = W - M * 2
  let page = pdf.addPage([W, H])
  let y = H - M

  let logoImg = null
  if (logoUrl) {
    try {
      const bytes = await fetch(logoUrl).then(r => r.arrayBuffer())
      logoImg = await pdf.embedPng(bytes).catch(() => pdf.embedJpg(bytes))
    } catch { /* a missing logo must not stop the document */ }
  }
  if (logoImg) page.drawImage(logoImg, { x: W - M - 92, y: y - 46, width: 92, height: 46 })

  // Our details, as on the old sheet.
  const co = [
    'ROCK ROOFING LIMITED', '483 Green Lanes', 'London, N13 4BS',
    'Tel: 03301658 9324', 'info@rockroofing.co.uk', 'www.rockroofing.co.uk',
    'VAT: 232438175', 'Reg: 11344304',
  ]
  co.forEach((l, i) => page.drawText(san(l), { x: M, y: y - 9 - i * 10, size: i === 0 ? 8.5 : 7.5, font: i === 0 ? bold : font, color: INK }))

  page.drawText('Variation', { x: W / 2 - 22, y: y - 30, size: 12, font: bold, color: rgb(0.09, 0.44, 0.31) })
  y -= 96

  // Header block: two columns of label/value in a bordered box, like the original.
  const rowH = 20
  const leftW = width * 0.62
  const hdr = [
    ['Contract:', [project.jobNo, project.name].filter(Boolean).join(' - '), 'Variation No:', variation.varNumber || ''],
    ['Sub-Contract Ref:', b.subContractRef || '', 'Date:', dmy(b.date)],
    ['Variation Description:', variation.description || '', 'Requested by:', b.requestedBy || ''],
  ]
  hdr.forEach(([l1, v1, l2, v2], i) => {
    const yy = y - i * rowH
    page.drawRectangle({ x: M, y: yy - rowH + 4, width, height: rowH, borderColor: LINE, borderWidth: 0.7 })
    page.drawLine({ start: { x: M + leftW, y: yy - rowH + 4 }, end: { x: M + leftW, y: yy + 4 }, thickness: 0.7, color: LINE })
    page.drawText(san(l1), { x: M + 4, y: yy - 9, size: 8, font, color: INK })
    page.drawText(san(v1), { x: M + 92, y: yy - 9, size: 8, font: bold, color: RED })
    page.drawText(san(l2), { x: M + leftW + 4, y: yy - 9, size: 8, font, color: INK })
    page.drawText(san(v2), { x: M + leftW + 74, y: yy - 9, size: 8, font: bold, color: RED })
  })
  y -= rowH * hdr.length + 8

  // Items.
  const cols = [
    ['Item', M, 32, 'l'],
    ['Description', M + 32, 268, 'l'],
    ['Quantity', M + 300, 54, 'r'],
    ['Unit', M + 354, 40, 'l'],
    ['Rate', M + 394, 58, 'r'],
    ['Total', M + 452, 63, 'r'],
  ]
  const row = (cells, f, size, color, yy) => {
    cols.forEach(([, x, w, align], i) => {
      let t = san(cells[i] == null ? '' : cells[i])
      while (t && f.widthOfTextAtSize(t, size) > w - 5) t = t.slice(0, -1)
      const tw = f.widthOfTextAtSize(t, size)
      page.drawText(t, { x: align === 'r' ? x + w - tw : x + 3, y: yy, size, font: f, color })
    })
  }
  const headRow = () => {
    page.drawRectangle({ x: M, y: y - 5, width, height: 16, borderColor: LINE, borderWidth: 0.7, color: rgb(0.96, 0.96, 0.96) })
    row(cols.map(c => c[0]), bold, 7.5, INK, y)
    y -= 20
  }
  headRow()

  // DOUBLE-HEIGHT ROWS. Single 16pt lines put the descriptions on top of each other and
  // made a priced variation hard to read at a glance - which is the one thing a customer
  // does with it.
  const ROW_H = 32
  items.forEach((it, i) => {
    if (y < M + 140) { page = pdf.addPage([W, H]); y = H - M; headRow() }
    page.drawRectangle({ x: M, y: y - ROW_H + 11, width, height: ROW_H, borderColor: LINE, borderWidth: 0.5 })
    // Text sits on the vertical centre of the taller row rather than at the top of it.
    row([String(i + 1), it.description || '', String(Number(it.qty) || ''), it.unit || '', money(it.rate), money(it.total)], font, 8, INK, y - 8)
    y -= ROW_H
  })

  // Total, with room between it and the last item so it reads as a separate figure.
  y -= 18
  page.drawRectangle({ x: M + 300, y: y - 6, width: width - 300, height: 18, borderColor: INK, borderWidth: 0.9 })
  page.drawText('Total', { x: M + 306, y: y - 1, size: 9, font: bold, color: INK })
  const total = items.reduce((s, it) => s + (Number(it.total) || 0), 0)
  const tw = bold.widthOfTextAtSize(money(total), 9)
  page.drawText(money(total), { x: M + width - 3 - tw, y: y - 1, size: 9, font: bold, color: INK })
  y -= 40

  // Clarifications, lettered, in red like the original.
  if (clar.length) {
    if (y < M + 90) { page = pdf.addPage([W, H]); y = H - M }
    page.drawText('Clarifications', { x: M, y, size: 8.5, font: bold, color: RED })
    y -= 14
    clar.forEach((c, i) => {
      // Wrap by measured width rather than a character count, so a long clarification
      // does not run off the page.
      const maxW = width - 18
      const words = san(c).split(' ')
      let line = ''
      const lines = []
      for (const w of words) {
        const test = line ? `${line} ${w}` : w
        if (font.widthOfTextAtSize(test, 7.5) > maxW) { lines.push(line); line = w } else line = test
      }
      if (line) lines.push(line)
      if (y - lines.length * 10 < M) { page = pdf.addPage([W, H]); y = H - M }
      page.drawText(`${String.fromCharCode(97 + i)}`, { x: M, y, size: 7.5, font: bold, color: RED })
      lines.forEach((l, li) => page.drawText(l, { x: M + 14, y: y - li * 10, size: 7.5, font, color: RED }))
      y -= lines.length * 10 + 3
    })
  }

  y -= 12
  page.drawText(san(`Produced ${new Date().toLocaleDateString('en-GB')} from the Rock Roofing portal.`), { x: M, y, size: 6.5, font, color: GREY })

  return await pdf.save()
}
