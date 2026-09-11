import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { projectLabel } from './variationInstruct'

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

// WRAP BY MEASURED WIDTH, IN ONE PLACE.
//
// The clarifications block already did this correctly and nothing else did: the header
// description was drawn as a single line and ran straight through the column divider
// into "Requested by", and item descriptions were silently CUT with
// `while (too wide) t = t.slice(0, -1)` - which loses text without saying so.
//
// Measured width rather than a character count, because 8pt Helvetica "W" and "i" are
// nothing like the same width and a character limit either wastes half the column or
// overflows it.
//
// Breaks inside a word where a single word is wider than the column, so a long
// reference or a pasted URL cannot overflow either.
function wrapToWidth(text, f, size, maxW) {
  const out = []
  for (const para of String(text == null ? '' : text).split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) { out.push(''); continue }
    let line = ''
    for (const w of words) {
      const test = line ? `${line} ${w}` : w
      if (f.widthOfTextAtSize(test, size) <= maxW) { line = test; continue }
      if (line) out.push(line)
      // A single word too wide for the column: break it rather than overflow.
      let rest = w
      while (f.widthOfTextAtSize(rest, size) > maxW) {
        let cut = rest.length
        while (cut > 1 && f.widthOfTextAtSize(rest.slice(0, cut), size) > maxW) cut--
        out.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    if (line) out.push(line)
  }
  return out.length ? out : ['']
}

export async function buildVariationPDF({ variation, project, logoUrl }) {
  const b = variation.builder || {}
  const items = b.items || []
  const clar = (b.clarifications || []).filter(c => String(c || '').trim())
  // Photos taken on site and attached in the builder. Kept on the builder block rather
  // than on variation.attachments, which applicationPdf.js uses for a different purpose:
  // a variation with attachments there does NOT get its variation PDF generated, so
  // putting photos in that array would quietly drop the variation document from the
  // application.
  const photos = (b.photos || []).filter(ph => ph && ph.url)

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
  // SCALED FROM THE IMAGE, not to a fixed box. The logo is square (565x565) and was being
  // drawn 92 wide by 46 tall - squashed to half its height. Fitting it to a maximum
  // height and letting the width follow keeps it in proportion whatever the file is.
  if (logoImg) {
    const LOGO_H = 54
    const lw = LOGO_H * (logoImg.width / logoImg.height)
    page.drawImage(logoImg, { x: W - M - lw, y: y - LOGO_H, width: lw, height: LOGO_H })
  }

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
    ['Contract:', projectLabel(project.jobNo, project.name), 'Variation No:', variation.varNumber || ''],
    ['Sub-Contract Ref:', b.subContractRef || '', 'Date:', dmy(b.date)],
    ['Variation Description:', variation.description || '', 'Requested by:', b.requestedBy || ''],
  ]
  // The box grows to fit the text instead of the text running out of the box. A long
  // Variation Description now takes as many lines as it needs and the row deepens.
  const V1_X = M + 92, V2_X = M + leftW + 74
  const v1MaxW = (M + leftW) - V1_X - 6
  const v2MaxW = (M + width) - V2_X - 6
  let hy = y
  hdr.forEach(([l1, v1, l2, v2]) => {
    const w1 = wrapToWidth(san(v1), bold, 8, v1MaxW)
    const w2 = wrapToWidth(san(v2), bold, 8, v2MaxW)
    const lineCount = Math.max(w1.length, w2.length)
    const h = Math.max(rowH, lineCount * 10 + 10)
    page.drawRectangle({ x: M, y: hy - h + 4, width, height: h, borderColor: LINE, borderWidth: 0.7 })
    page.drawLine({ start: { x: M + leftW, y: hy - h + 4 }, end: { x: M + leftW, y: hy + 4 }, thickness: 0.7, color: LINE })
    // Labels stay on the first line; the values flow beneath.
    page.drawText(san(l1), { x: M + 4, y: hy - 9, size: 8, font, color: INK })
    page.drawText(san(l2), { x: M + leftW + 4, y: hy - 9, size: 8, font, color: INK })
    w1.forEach((t, li) => page.drawText(t, { x: V1_X, y: hy - 9 - li * 10, size: 8, font: bold, color: RED }))
    w2.forEach((t, li) => page.drawText(t, { x: V2_X, y: hy - 9 - li * 10, size: 8, font: bold, color: RED }))
    hy -= h
  })
  y = hy - 8

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
      // Narrow columns (Unit, Quantity) still clip, but they now END IN AN ELLIPSIS so
      // a clipped value is visible as clipped rather than looking like the whole thing.
      if (t && f.widthOfTextAtSize(t, size) > w - 5) {
        while (t && f.widthOfTextAtSize(`${t}...`, size) > w - 5) t = t.slice(0, -1)
        if (t) t = `${t}...`
      }
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
  const DESC_X = M + 32, DESC_W = 268
  items.forEach((it, i) => {
    // The description wraps and the ROW grows to hold it. It used to be cut to fit -
    // a customer reading a priced variation would simply never see the rest of it.
    const descLines = wrapToWidth(san(it.description || ''), font, 8, DESC_W - 6)
    const h = Math.max(ROW_H, descLines.length * 10 + 14)
    // Page break measured against THIS row's height, not a fixed one, so a tall row
    // cannot start too near the bottom and run off the page.
    if (y - h < M + 120) { page = pdf.addPage([W, H]); y = H - M; headRow() }
    page.drawRectangle({ x: M, y: y - h + 11, width, height: h, borderColor: LINE, borderWidth: 0.5 })
    // Everything except the description, which is drawn line by line beneath.
    row([String(i + 1), '', String(Number(it.qty) || ''), it.unit || '', money(it.rate), money(it.total)], font, 8, INK, y - 8)
    descLines.forEach((t, li) => page.drawText(t, { x: DESC_X + 3, y: y - 8 - li * 10, size: 8, font, color: INK }))
    y -= h
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
      // Same helper as the header and the item rows - this block had the only correct
      // wrap in the file and now it shares it rather than keeping a private copy.
      const lines = wrapToWidth(san(c), font, 7.5, width - 18)
      if (y - lines.length * 10 < M) { page = pdf.addPage([W, H]); y = H - M }
      page.drawText(`${String.fromCharCode(97 + i)}`, { x: M, y, size: 7.5, font: bold, color: RED })
      lines.forEach((l, li) => page.drawText(l, { x: M + 14, y: y - li * 10, size: 7.5, font, color: RED }))
      y -= lines.length * 10 + 3
    })
  }

  // PHOTOS.
  //
  // Appended after the priced work so the document still reads as a variation first
  // and evidence second. Every route to this PDF - Download, Send to customer, the
  // instruction email - builds it here, so they all carry the photos without any of
  // them needing to know about them.
  if (photos.length) {
    // A fresh page. Photos on the end of a half-full page of pricing look like an
    // afterthought and the first one gets squeezed.
    page = pdf.addPage([W, H]); y = H - M
    page.drawText('Photos', { x: M, y, size: 8.5, font: bold, color: INK })
    y -= 16
    for (const ph of photos) {
      let img = null
      try {
        const bytes = String(ph.url).startsWith('data:')
          ? Uint8Array.from(Buffer.from(String(ph.url).split(',')[1], 'base64'))
          : new Uint8Array(await (await fetch(ph.url)).arrayBuffer())
        // Try JPEG then PNG. A photo off a phone is one or the other, and pdf-lib
        // needs to be told which.
        try { img = await pdf.embedJpg(bytes) } catch { img = await pdf.embedPng(bytes) }
      } catch {
        // A photo that will not load must not take the whole document down with it.
        // Say so on the page instead of silently producing a variation with evidence
        // missing and no indication any was meant to be there.
        if (y < M + 20) { page = pdf.addPage([W, H]); y = H - M }
        page.drawText(san(`[${ph.name || 'photo'} could not be loaded]`), { x: M, y, size: 7.5, font, color: RED })
        y -= 14
        continue
      }
      const caption = san(ph.name || '')
      // Scale to the page width, and cap the height so two portrait photos can share
      // a page rather than one filling it.
      const maxW = width
      const maxH = (H - M * 2) * 0.62
      const scale = Math.min(maxW / img.width, maxH / img.height, 1)
      const iw = img.width * scale, ih = img.height * scale
      const needed = ih + (caption ? 12 : 0) + 14
      if (y - needed < M) { page = pdf.addPage([W, H]); y = H - M }
      if (caption) { page.drawText(caption, { x: M, y: y - 8, size: 7.5, font, color: GREY }); y -= 12 }
      page.drawImage(img, { x: M, y: y - ih, width: iw, height: ih })
      y -= ih + 14
    }
  }

  // THE DIGITAL INSTRUCTION.
  //
  // Printed on the document itself, not held only in the portal - the whole point of
  // capturing it is that it can be produced later, and a record that only exists on a
  // screen we control is worth less than one on the document both sides hold.
  const ins = b.instruction
  if (ins) {
    if (y < M + 96) { page = pdf.addPage([W, H]); y = H - M }
    y -= 6
    const boxH = 74
    page.drawRectangle({ x: M, y: y - boxH + 12, width, height: boxH, borderColor: INK, borderWidth: 1, color: rgb(0.96, 0.98, 0.96) })
    page.drawText('INSTRUCTED', { x: M + 10, y: y - 2, size: 9.5, font: bold, color: rgb(0.08, 0.44, 0.24) })
    const who = [ins.byName, ins.byRole, ins.byCompany].filter(Boolean).join(', ')
    const when = ins.at ? new Date(ins.at) : null
    const lines = [
      `Instructed by ${who || 'the customer'}`,
      when ? `on ${when.toLocaleDateString('en-GB')} at ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '',
      ins.byEmail ? `via the authenticated link sent to ${ins.byEmail}` : '',
      ins.ip ? `Recorded from ${ins.ip}. This is a digital instruction and is retained as a record of authorisation.` : '',
    ].filter(Boolean)
    lines.forEach((l, i) => page.drawText(san(l), { x: M + 10, y: y - 16 - i * 11, size: 7.5, font, color: INK }))
    y -= boxH + 12
  }

  // WHO RAISED IT, and how to reach them. "Produced from the Rock Roofing portal" told the
  // customer nothing they could act on - a variation they want to query should carry the
  // name and number of the person who priced it.
  y -= 14
  const rb = b.raisedBy || {}
  const when = b.raisedAt ? new Date(b.raisedAt) : (b.date ? new Date(b.date) : new Date())
  const foot = [
    `Raised ${when.toLocaleDateString('en-GB')}${b.raisedAt ? ` at ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`
      + (rb.name ? ` by ${rb.name}` : ''),
    [rb.phone, rb.email].filter(Boolean).join('   ·   '),
    'Any queries on this variation, please contact us using the details above.',
  ].filter(Boolean)
  foot.forEach((l, i) => page.drawText(san(l), { x: M, y: y - i * 10, size: 7.5, font, color: i === 0 ? INK : GREY }))

  return await pdf.save()
}
