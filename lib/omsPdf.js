import { PDFDocument, StandardFonts, rgb, PDFName, PDFArray, PDFDict, PDFNumber, PDFString } from 'pdf-lib'

// Builds a single professional O&M Manual PDF combining, in order:
//   1. Technical Submittal (current, non-superseded)
//   2. Rock Roofing Construction Issue drawings (constructionIssue === true, current)
//   3. Calculations (current)
//   4. Leak Test Certs
//   5. Warranties
// Structure: Front cover -> Contents (with page numbers) -> for each section a cover
// sheet (with its page number) then the merged documents for that section.

const INK = rgb(0.11, 0.11, 0.1)
const GREY = rgb(0.42, 0.42, 0.42)
const BRAND = rgb(0.11, 0.44, 0.31)       // Rock Roofing green (#1c704f)
const BRAND_DK = rgb(0.08, 0.35, 0.24)
const LIGHT = rgb(0.90, 0.95, 0.93)       // pale green tint for panels
const A4 = [595.28, 841.89]

const isImg = (f) => (f.contentType || '').startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(f.name || f.url || '')

async function fetchBytes(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error('fetch failed')
  return new Uint8Array(await r.arrayBuffer())
}

// Draw one image, scaled to fit an A4 page with margins, on its own page of `doc`.
async function addImagePage(doc, bytes, name) {
  let img
  try { img = await doc.embedJpg(bytes) } catch { img = await doc.embedPng(bytes) }
  const page = doc.addPage(A4)
  const M = 36
  const maxW = A4[0] - M * 2, maxH = A4[1] - M * 2
  let iw = img.width, ih = img.height
  const scale = Math.min(maxW / iw, maxH / ih, 1)
  iw *= scale; ih *= scale
  page.drawImage(img, { x: (A4[0] - iw) / 2, y: (A4[1] - ih) / 2, width: iw, height: ih })
}

// Append every page of a source document (PDF -> copy pages; image -> one image page)
// into `doc`. Returns the number of pages added.
async function appendDoc(doc, file) {
  const before = doc.getPageCount()
  try {
    const bytes = await fetchBytes(file.url)
    if (isImg(file)) {
      await addImagePage(doc, bytes, file.name)
    } else {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
      const copied = await doc.copyPages(src, src.getPageIndices())
      for (const pg of copied) doc.addPage(pg)
    }
  } catch (e) {
    // Unreadable file: add a placeholder page so the manual still makes sense.
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage(A4)
    page.drawText(`[Could not include: ${file.name || 'document'}]`, { x: 40, y: A4[1] - 80, size: 12, font, color: GREY })
  }
  return doc.getPageCount() - before
}

function wrap(font, size, str, maxW) {
  const words = String(str || '').split(/\s+/)
  const lines = []; let line = ''
  for (const w of words) {
    const t = line ? line + ' ' + w : w
    if (font.widthOfTextAtSize(t, size) > maxW && line) { lines.push(line); line = w } else line = t
  }
  if (line) lines.push(line)
  return lines
}

// Section cover sheet page. Big title + the manual page number it sits at.
async function drawSectionCover(doc, { number, title, pageNo, fonts }) {
  const page = doc.addPage(A4)
  const { bold, reg } = fonts
  const W = A4[0]
  page.drawRectangle({ x: 0, y: A4[1] - 210, width: W, height: 210, color: LIGHT })
  page.drawRectangle({ x: 0, y: A4[1] - 210, width: 10, height: 210, color: BRAND })
  page.drawText(`SECTION ${number}`, { x: 56, y: A4[1] - 120, size: 16, font: bold, color: BRAND })
  const titleLines = wrap(bold, 30, title, W - 112)
  let ty = A4[1] - 160
  for (const ln of titleLines) { page.drawText(ln, { x: 56, y: ty, size: 30, font: bold, color: INK }); ty -= 34 }
  // Footer
  page.drawText('Operation & Maintenance Manual', { x: 56, y: 40, size: 8, font: reg, color: GREY })
}

export async function buildOMManual({ project, sections, logoUrl, rockRoofing, mainContractor, revision }) {
  // sections: [{ title, files: [{name,url,contentType}] }] - already filtered/ordered.

  // --- Pass 1: build the BODY (section cover + docs) into a temp doc, recording where
  // each section starts. We reserve 2 leading pages (cover + contents) so page numbers
  // in the contents are the real, final page numbers. ---
  const RESERVED = 2
  const body = await PDFDocument.create()
  const bFonts = { bold: await body.embedFont(StandardFonts.HelveticaBold), reg: await body.embedFont(StandardFonts.Helvetica) }

  const toc = []           // { number, title, pageNo, pages }
  let i = 0
  for (const sec of sections) {
    i++
    const startPageNo = RESERVED + body.getPageCount() + 1  // 1-based page number in the FINAL doc
    await drawSectionCover(body, { number: i, title: sec.title, pageNo: startPageNo, fonts: bFonts })
    let docPages = 1  // the cover sheet
    for (const f of (sec.files || [])) docPages += await appendDoc(body, f)
    toc.push({ number: i, title: sec.title, pageNo: startPageNo, pages: docPages })
  }

  // --- Pass 2: assemble the FINAL doc: cover, contents, then the body pages. ---
  const out = await PDFDocument.create()
  const bold = await out.embedFont(StandardFonts.HelveticaBold)
  const reg = await out.embedFont(StandardFonts.Helvetica)
  const W = A4[0], H = A4[1], M = 56

  // ---- Front cover ----
  const cover = out.addPage(A4)
  cover.drawRectangle({ x: 0, y: 0, width: W, height: 14, color: BRAND })
  cover.drawRectangle({ x: 0, y: H - 14, width: W, height: 14, color: BRAND })
  let cy = H - 70
  if (logoUrl) {
    try {
      const lb = await fetchBytes(logoUrl)
      const logo = /\.png$/i.test(logoUrl) ? await out.embedPng(lb) : await out.embedJpg(lb)
      const lw = 180, lh = (logo.height / logo.width) * lw
      cover.drawImage(logo, { x: (W - lw) / 2, y: cy - lh, width: lw, height: lh })
      cy -= lh + 50
    } catch { cy -= 20 }
  }
  const centre = (txt, size, font, color, gap = size + 10) => {
    const tw = font.widthOfTextAtSize(txt, size)
    cover.drawText(txt, { x: (W - tw) / 2, y: cy, size, font, color }); cy -= gap
  }
  centre('OPERATION & MAINTENANCE', 26, bold, INK, 32)
  centre('MANUAL', 26, bold, INK, 60)
  // Project name (wrapped, centred)
  const nameLines = wrap(bold, 20, project.projectName || '', W - M * 2)
  for (const ln of nameLines) { const tw = bold.widthOfTextAtSize(ln, 20); cover.drawText(ln, { x: (W - tw) / 2, y: cy, size: 20, font: bold, color: BRAND }); cy -= 26 }
  cy -= 6
  if (project.projectNo) centre(`Project No: ${project.projectNo}`, 12, reg, GREY, 22)
  // Address (wrapped, centred)
  const addrLines = wrap(reg, 12, project.projectAddress || '', W - M * 2)
  for (const ln of addrLines) { const tw = reg.widthOfTextAtSize(ln, 12); cover.drawText(ln, { x: (W - tw) / 2, y: cy, size: 12, font: reg, color: GREY }); cy -= 17 }

  // Two company boxes near the bottom: Rock Roofing (contractor) + Main Contractor.
  const boxY = 120, boxH = 150, boxW = (W - M * 2 - 20) / 2
  const drawCompanyBox = (x, heading, lines) => {
    cover.drawRectangle({ x, y: boxY, width: boxW, height: boxH, color: LIGHT, borderColor: rgb(0.85, 0.85, 0.88), borderWidth: 1 })
    cover.drawText(heading, { x: x + 14, y: boxY + boxH - 24, size: 11, font: bold, color: BRAND })
    let ly = boxY + boxH - 46
    for (const ln of lines.filter(Boolean)) {
      for (const w of wrap(reg, 9.5, ln, boxW - 28)) { cover.drawText(w, { x: x + 14, y: ly, size: 9.5, font: reg, color: INK }); ly -= 13 }
    }
  }
  drawCompanyBox(M, 'ROOFING CONTRACTOR', [rockRoofing.name, rockRoofing.address, rockRoofing.phone, rockRoofing.email, rockRoofing.web])
  drawCompanyBox(M + boxW + 20, 'MAIN CONTRACTOR', mainContractor.company ? [mainContractor.company, mainContractor.address] : ['(Not recorded)'])
  cover.drawText(`Issued: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, { x: M, y: 92, size: 9, font: reg, color: GREY })
  if (revision != null) {
    const revStr = `Revision ${revision}`
    cover.drawText(revStr, { x: W - M - bold.widthOfTextAtSize(revStr, 11), y: 92, size: 11, font: bold, color: BRAND })
  }

  // ---- Contents page ----
  const toc2 = out.addPage(A4)
  toc2.drawRectangle({ x: 0, y: H - 90, width: W, height: 90, color: LIGHT })
  toc2.drawRectangle({ x: 0, y: H - 90, width: 10, height: 90, color: BRAND })
  toc2.drawText('CONTENTS', { x: M, y: H - 60, size: 24, font: bold, color: INK })
  let ry = H - 140
  toc2.drawText('Section', { x: M, y: ry, size: 10, font: bold, color: GREY })
  toc2.drawText('Page', { x: W - M - 40, y: ry, size: 10, font: bold, color: GREY })
  ry -= 8
  toc2.drawLine({ start: { x: M, y: ry }, end: { x: W - M, y: ry }, thickness: 1, color: rgb(0.85, 0.85, 0.88) })
  ry -= 26
  const tocRects = []   // { targetIndex, x, y, w, h } for clickable links
  for (const t of toc) {
    toc2.drawText(`${t.number}.`, { x: M, y: ry, size: 12, font: bold, color: BRAND })
    toc2.drawText(t.title, { x: M + 26, y: ry, size: 12, font: reg, color: INK })
    const pStr = String(t.pageNo)
    toc2.drawText(pStr, { x: W - M - reg.widthOfTextAtSize(pStr, 12), y: ry, size: 12, font: bold, color: INK })
    // dotted leader
    const dotsStart = M + 26 + reg.widthOfTextAtSize(t.title, 12) + 8
    const dotsEnd = W - M - 24
    if (dotsEnd > dotsStart) {
      let dx = dotsStart
      while (dx < dotsEnd) { toc2.drawText('.', { x: dx, y: ry, size: 12, font: reg, color: rgb(0.7, 0.7, 0.72) }); dx += 6 }
    }
    // clickable area spans the whole row
    tocRects.push({ targetIndex: t.pageNo - 1, x: M, y: ry - 6, w: W - M * 2, h: 26 })
    ry -= 16
    toc2.drawText(`${t.pages} page${t.pages === 1 ? '' : 's'}`, { x: M + 26, y: ry, size: 8.5, font: reg, color: GREY })
    ry -= 24
    if (ry < 90) ry = 90
  }
  toc2.drawText('Operation & Maintenance Manual', { x: M, y: 40, size: 8, font: reg, color: GREY })

  // ---- Copy the body pages in after cover + contents ----
  const bodyDoc = await PDFDocument.load(await body.save())
  const copied = await out.copyPages(bodyDoc, bodyDoc.getPageIndices())
  for (const pg of copied) out.addPage(pg)

  // ---- Make the contents rows clickable (internal GoTo links) ----
  try {
    const allPages = out.getPages()
    const annots = tocRects.map(r => {
      const target = allPages[r.targetIndex]
      if (!target) return null
      const dest = PDFArray.withContext(out.context)
      dest.push(target.ref)
      dest.push(PDFName.of('Fit'))
      const dict = PDFDict.withContext(out.context)
      dict.set(PDFName.of('Type'), PDFName.of('Annot'))
      dict.set(PDFName.of('Subtype'), PDFName.of('Link'))
      const rect = PDFArray.withContext(out.context)
      rect.push(PDFNumber.of(r.x)); rect.push(PDFNumber.of(r.y)); rect.push(PDFNumber.of(r.x + r.w)); rect.push(PDFNumber.of(r.y + r.h))
      dict.set(PDFName.of('Rect'), rect)
      const border = PDFArray.withContext(out.context)
      border.push(PDFNumber.of(0)); border.push(PDFNumber.of(0)); border.push(PDFNumber.of(0))
      dict.set(PDFName.of('Border'), border)
      dict.set(PDFName.of('Dest'), dest)
      return out.context.register(dict)
    }).filter(Boolean)
    if (annots.length) {
      const arr = PDFArray.withContext(out.context)
      for (const a of annots) arr.push(a)
      toc2.node.set(PDFName.of('Annots'), arr)
    }
  } catch (e) { /* links are a nice-to-have; never fail the build over them */ }

  // ---- Page-number footer on every page from the contents onward ----
  const pages = out.getPages()
  for (let p = 0; p < pages.length; p++) {
    const n = p + 1
    if (n >= 2) {
      const label = String(n)
      pages[p].drawText(label, { x: W - M - reg.widthOfTextAtSize(label, 12) / 2, y: 22, size: 12, font: bold, color: GREY })
    }
  }

  return await out.save()
}
