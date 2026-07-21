import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const A4 = [595.28, 841.89]
const M = 40
const GOLD = rgb(0.79, 0.54, 0.02)
const INK = rgb(0.1, 0.1, 0.1)
const GREY = rgb(0.5, 0.5, 0.5)
const LINE = rgb(0.87, 0.87, 0.87)

// Strip characters the standard WinAnsi font can't encode (emoji etc.), and map
// common smart punctuation to plain ASCII so PDF generation never throws.
const san = (s) => {
  if (s == null) return ''
  return String(s)
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .replace(/[\u2022\u25CF\u25AA]/g, '-')
    .replace(/[^\x00-\xFF]/g, '')
}

// subs: [{ formId, formTitle, projectName, operative, submittedAt, answers:{} }]
// labels: { [formId]: { [key]: label } }
export async function buildSubmissionsPDF({ subs, labels, logoUrl }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique)

  let logo = null
  if (logoUrl) {
    try {
      const b = new Uint8Array(await (await fetch(logoUrl)).arrayBuffer())
      logo = /\.png$/i.test(logoUrl) ? await pdf.embedPng(b) : await pdf.embedJpg(b)
    } catch {}
  }

  const width = A4[0] - M * 2
  let page, y

  const newPage = () => { page = pdf.addPage(A4); y = A4[1] - M }
  const ensure = (h) => { if (y - h < M + 20) newPage() }

  const wrap = (t, size, f, maxW) => {
    const words = san(t).split(/\s+/); const lines = []; let cur = ''
    for (const w of words) { const test = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = w } else cur = test }
    if (cur) lines.push(cur); return lines.length ? lines : ['']
  }

  const fmtTs = (ts) => { try { return new Date(ts).toLocaleString('en-GB') } catch { return '' } }

  const lbl = (formId, k) => (labels && labels[formId] && labels[formId][k]) || k

  const isPhotos = (v) => Array.isArray(v) && typeof v[0] === 'string' && /^https?:|^data:/.test(v[0])
  const answerText = (v) => {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '-'
    if (typeof v === 'object' && !Array.isArray(v)) return v.name ? `${v.name} (${v.date || ''})` : JSON.stringify(v)
    if (Array.isArray(v)) return v.join(', ')
    return String(v)
  }

  const drawPhotos = async (urls) => {
    const gap = 8, perRow = 3
    const cellW = (width - gap * (perRow - 1)) / perRow
    let col = 0, rowH = 0, rowImgs = []
    const flushRow = () => {
      if (!rowImgs.length) return
      ensure(rowH + 8)
      let x = M
      for (const im of rowImgs) { page.drawImage(im.img, { x, y: y - im.h, width: im.w, height: im.h }); x += cellW + gap }
      y -= rowH + 8
      rowImgs = []; rowH = 0; col = 0
    }
    for (const u of urls) {
      try {
        const bytes = u.startsWith('data:') ? Uint8Array.from(Buffer.from(u.split(',')[1], 'base64')) : new Uint8Array(await (await fetch(u)).arrayBuffer())
        let img; try { img = await pdf.embedJpg(bytes) } catch { img = await pdf.embedPng(bytes) }
        const scale = Math.min(cellW / img.width, 1)
        const w = img.width * scale, h = img.height * scale
        rowImgs.push({ img, w, h }); rowH = Math.max(rowH, h); col++
        if (col >= perRow) flushRow()
      } catch { /* skip bad image */ }
    }
    flushRow()
  }

  for (let s = 0; s < subs.length; s++) {
    const sub = subs[s]
    newPage()   // one submission per page block (may overflow onto more pages)

    // Header: logo + title/meta.
    const logoH = 46
    if (logo) { const r = logoH / logo.height; page.drawImage(logo, { x: M, y: y - logoH, width: logo.width * r, height: logoH }) }
    const hx = M + (logo ? logo.width * (logoH / logo.height) + 16 : 0)
    page.drawText(san(sub.formTitle || 'Submission'), { x: hx, y: y - 20, size: 17, font: bold, color: INK })
    let my = y - 36
    for (const line of [sub.projectName, sub.operative ? `Operative: ${sub.operative}` : '', sub.submittedAt ? `Submitted: ${fmtTs(sub.submittedAt)}` : ''].filter(Boolean)) {
      page.drawText(san(line), { x: hx, y: my, size: 10, font, color: GREY }); my -= 13
    }
    y = Math.min(my, y - logoH) - 6
    page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 2, color: GOLD }); y -= 16

    // Q/A rows.
    const entries = Object.entries(sub.answers || {}).filter(([, v]) => !(v == null || v === '' || (Array.isArray(v) && !v.length)))
    if (!entries.length) { page.drawText('(No answers)', { x: M, y: y - 12, size: 11, font: italic, color: GREY }); y -= 20 }
    for (const [k, v] of entries) {
      const qLines = wrap(lbl(sub.formId, k).toUpperCase(), 9, bold, width * 0.32 - 8)
      if (isPhotos(v)) {
        ensure(qLines.length * 12 + 20)
        qLines.forEach((ln, i) => page.drawText(ln, { x: M, y: y - 10 - i * 11, size: 9, font: bold, color: GREY }))
        y -= qLines.length * 11 + 6
        await drawPhotos(v)
        y -= 4
        page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.5, color: LINE }); y -= 10
      } else {
        const aLines = wrap(answerText(v), 11, font, width * 0.64)
        const rowH = Math.max(qLines.length * 11, aLines.length * 13) + 12
        ensure(rowH)
        qLines.forEach((ln, i) => page.drawText(ln, { x: M, y: y - 10 - i * 11, size: 9, font: bold, color: GREY }))
        aLines.forEach((ln, i) => page.drawText(ln, { x: M + width * 0.36, y: y - 10 - i * 13, size: 11, font, color: INK }))
        y -= rowH
        page.drawLine({ start: { x: M, y: y + 2 }, end: { x: M + width, y: y + 2 }, thickness: 0.5, color: LINE }); y -= 8
      }
    }
  }

  // Footer page numbers.
  const pages = pdf.getPages()
  pages.forEach((pg, i) => {
    const pn = `Page ${i + 1} of ${pages.length}`
    pg.drawText(pn, { x: A4[0] - M - font.widthOfTextAtSize(pn, 7.5), y: 22, size: 7.5, font: italic, color: GREY })
    pg.drawText('Rock Roofing', { x: M, y: 22, size: 7.5, font: italic, color: GREY })
  })

  return await pdf.save()
}
