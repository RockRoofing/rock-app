import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { computeApplicationSummary, worksValueToDate, isMeasurableWorks, variationValue, variationValueToDate, materialLineTotal, materialValueToDate } from './applications'

const A4 = [595.28, 841.89]
const M = 44
const GOLD = rgb(0.79, 0.54, 0.02)
const INK = rgb(0.1, 0.1, 0.1)
const GREY = rgb(0.5, 0.5, 0.5)
const LINE = rgb(0.85, 0.85, 0.85)
const HEADBG = rgb(0.96, 0.96, 0.96)

const money = (n) => { const v = parseFloat(n); return isNaN(v) ? '£0.00' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(v) }
const fmtDMY = (d) => { if (!d) return '—'; const [y, m, day] = String(d).split('-'); return day ? `${day}/${m}/${y}` : d }
// pdf-lib's WinAnsi fonts can't encode emoji/unicode — strip anything unsafe.
const san = (s) => String(s == null ? '' : s).replace(/[^\x20-\x7E£–—’‘“”]/g, ' ').replace(/[–—]/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"')

// Build the CUSTOMER copy of an Application for Payment.
// - Materials on Site shows the MARKED-UP total but NO mark-up % column.
// - Variation & supplier-group attachments are appended at the end.
export async function buildApplicationPDF({ app, appNumber, project = {}, prevGross = 0, trackerVariations = [], logoUrl }) {
  const appNo = appNumber != null ? appNumber : (app.appNumber || app.seq || "")
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique)

  let logoImg = null
  if (logoUrl) { try { const b = new Uint8Array(await (await fetch(logoUrl)).arrayBuffer()); logoImg = /\.png$/i.test(logoUrl) ? await pdf.embedPng(b) : await pdf.embedJpg(b) } catch {} }

  let page = pdf.addPage(A4)
  const width = A4[0] - M * 2
  let y = A4[1] - M

  const ensure = (need) => { if (y - need < M + 24) { page = pdf.addPage(A4); y = A4[1] - M } }
  const wrap = (t, size, f, maxW) => {
    const words = san(t).split(/\s+/); const lines = []; let cur = ''
    for (const w of words) { const test = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = w } else cur = test }
    if (cur) lines.push(cur); return lines.length ? lines : ['']
  }
  const textAt = (t, x, size, f, color) => { page.drawText(san(t), { x, y: y - size, size, font: f, color }) }

  // ── Header ────────────────────────────────────────────────────────────────
  if (logoImg) { const w = 48, h = w * (logoImg.height / logoImg.width); page.drawImage(logoImg, { x: M, y: y - h, width: w, height: h }) }
  page.drawText('Application for Payment', { x: M + (logoImg ? 60 : 0), y: y - 22, size: 20, font: bold, color: INK })
  y -= 30
  const jobNo = project.jobNo || ''
  const projName = project.name || project.customerName || ''
  page.drawText(san([jobNo, projName].filter(Boolean).join(' — ')), { x: M + (logoImg ? 60 : 0), y: y - 12, size: 11, font, color: GREY })
  y -= 30

  // Meta line
  const appDate = app.appDate || ''
  const valDate = app.valDate || ''
  const payDate = app.paymentDate || ''
  const finalDate = app.finalDate || ''
  const metaRow = (label, val) => { page.drawText(san(label), { x: M, y: y - 10, size: 9, font: bold, color: GREY }); page.drawText(san(val), { x: M + 130, y: y - 10, size: 9, font, color: INK }); y -= 15 }
  metaRow('Application no.', String(appNo))
  metaRow('Application date', fmtDMY(appDate))
  metaRow('Valuation date', fmtDMY(valDate))
  metaRow('Payment due', fmtDMY(payDate))
  metaRow('Final date for payment', fmtDMY(finalDate))
  y -= 6

  const heading = (t) => { ensure(26); page.drawText(san(t).toUpperCase(), { x: M, y: y - 12, size: 11, font: bold, color: GOLD }); y -= 18; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: LINE }); y -= 10 }
  const newPage = () => { page = pdf.addPage(A4); y = A4[1] - M }
  const rrow = (t, xRight, size, f, color) => { const w = f.widthOfTextAtSize(t, size); page.drawText(t, { x: xRight - w, y: y - (size + 1), size, font: f, color }) }
  // Grid helpers for the data tables: verticals are drawn per-row (page-safe across
  // breaks), horizontals are a light-grey rule under each row.
  const gridVerticals = (xs, topY, botY) => { for (const x of xs) page.drawLine({ start: { x, y: topY }, end: { x, y: botY }, thickness: 0.7, color: rgb(0.1, 0.1, 0.1) }) }
  const hrule = () => page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.5, color: rgb(0.88, 0.88, 0.88) })

  // Compute figures + resolve variations for this app.
  const sum = computeApplicationSummary(app, prevGross)
  const vars = (app.status && app.status !== 'draft' && Array.isArray(app.variations)) ? app.variations
    : buildLiveVars(app, trackerVariations)
  const cw = Array.isArray(app.contractWorks) ? app.contractWorks : []
  const mats = Array.isArray(app.materials) ? app.materials : []

  // ── Summary ─────────────────────────────────────────────────────────────
  // Geometry: a label column then three right-aligned money columns that all fit
  // inside the page width. Right-edges (xR) and column-left boundaries (xL).
  const colW = 108
  const sxR = [M + width - colW * 2 - 8, M + width - colW - 4, M + width]   // right edges of the 3 value cols
  const sxL = [M + width - colW * 3 - 12, M + width - colW * 2 - 8, M + width - colW - 4] // left boundary of each value col
  const VLINE = rgb(0.1, 0.1, 0.1)     // vertical separators — black
  const HLINE = rgb(0.88, 0.88, 0.88)  // horizontal rules — light grey

  heading('Summary')
  {
    const drawHeader = (labels) => {
      page.drawRectangle({ x: M, y: y - 16, width, height: 16, color: HEADBG })
      page.drawText(san(labels[0]), { x: M + 4, y: y - 12, size: 8.5, font: bold, color: GREY })
      for (let i = 0; i < 3; i++) { const t = san(labels[i + 1]); page.drawText(t, { x: sxR[i] - bold.widthOfTextAtSize(t, 8.5), y: y - 12, size: 8.5, font: bold, color: GREY }) }
      y -= 16
    }
    const startY = y                       // remember top for vertical lines
    drawHeader(['', 'Contract Sum', 'Application Total', 'Proj. Final Account'])
    const row = (label, c1, c2, c3, b) => {
      ensure(15)
      page.drawText(san(label), { x: M + 4, y: y - 11, size: 9.5, font: b ? bold : font, color: INK })
      const vals = [c1, c2, c3]
      vals.forEach((txt, i) => { if (txt === '' || txt == null) return; const w = (b ? bold : font).widthOfTextAtSize(txt, 9.5); page.drawText(txt, { x: sxR[i] - w, y: y - 11, size: 9.5, font: b ? bold : font, color: INK }) })
      y -= 15
      page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.5, color: HLINE })
    }
    row('Measured Work', money(sum.measuredContractSum), money(sum.measuredToDate), money(sum.measuredContractSum))
    row('Variations', '', money(sum.variationsToDate), money(sum.variationsFinal))
    row('Materials On Site', '', money(sum.materialsOnSite), '')
    y -= 4
    page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: LINE }); y -= 12
    row('Contract Sum', money(sum.contractSum), '', '', true)
    row('Application Total', '', money(sum.applicationTotal), '', true)
    row('Anticipated Final Account', '', '', money(sum.anticipatedFinalAccount), true)
    // vertical black separators spanning the block
    const botY = y
    for (const x of sxL) page.drawLine({ start: { x, y: startY }, end: { x, y: botY }, thickness: 0.7, color: VLINE })
    page.drawLine({ start: { x: M, y: startY }, end: { x: M, y: botY }, thickness: 0.7, color: VLINE })
    page.drawLine({ start: { x: M + width, y: startY }, end: { x: M + width, y: botY }, thickness: 0.7, color: VLINE })
    y -= 8
  }

  // Certificate block — sits directly under the Summary (no separate heading).
  y -= 6
  {
    const startY = y
    page.drawRectangle({ x: M, y: y - 16, width, height: 16, color: HEADBG })
    const heads = ['', 'Current', 'Previously Cert.', 'This Certificate']
    page.drawText(san(heads[0]), { x: M + 4, y: y - 12, size: 8.5, font: bold, color: GREY })
    for (let i = 0; i < 3; i++) { const t = san(heads[i + 1]); page.drawText(t, { x: sxR[i] - bold.widthOfTextAtSize(t, 8.5), y: y - 12, size: 8.5, font: bold, color: GREY }) }
    y -= 16
    const cRow = (label, key, b) => {
      ensure(15)
      page.drawText(san(label), { x: M + 4, y: y - 11, size: 9.5, font: b ? bold : font, color: INK })
      const vals = [sum.current[key], sum.previously[key], sum.thisCert[key]]
      vals.forEach((v, i) => { const t = money(v); const w = (b ? bold : font).widthOfTextAtSize(t, 9.5); page.drawText(t, { x: sxR[i] - w, y: y - 11, size: 9.5, font: b ? bold : font, color: INK }) })
      y -= 15
      page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.5, color: HLINE })
    }
    cRow('Gross valuation', 'gross')
    cRow(`Main contractor's discount (${app.mcdPct || 0}%)`, 'mcd')
    cRow('Sub-total', 'subTotal')
    cRow(`Retention (${app.retentionPct != null ? app.retentionPct : 5}%)`, 'retention')
    y -= 2; page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: LINE }); y -= 10
    cRow('Total due', 'total', true)
    const botY = y
    for (const x of sxL) page.drawLine({ start: { x, y: startY }, end: { x, y: botY }, thickness: 0.7, color: VLINE })
    page.drawLine({ start: { x: M, y: startY }, end: { x: M, y: botY }, thickness: 0.7, color: VLINE })
    page.drawLine({ start: { x: M + width, y: startY }, end: { x: M + width, y: botY }, thickness: 0.7, color: VLINE })
    y -= 8
  }

  // ── Contract Works ──────────────────────────────────────────────────────
  newPage()
  heading('Contract Works')
  {
    // Right-edge x positions (numbers are right-aligned to these).
    const cCode = M + 2
    const cDesc = M + 26
    const descWrapPx = 230                 // description wrap width in points
    const xQtyR = M + 300
    const xUnit = M + 306                  // unit is left-aligned here
    const xRateR = M + 372
    const xTotalR = M + 442
    const xVtdR = M + width
    page.drawRectangle({ x: M, y: y - 15, width, height: 15, color: HEADBG })
    page.drawText('Code', { x: cCode, y: y - 11, size: 8, font: bold, color: GREY })
    page.drawText('Description', { x: cDesc, y: y - 11, size: 8, font: bold, color: GREY })
    rrow('Qty', xQtyR, 8, bold, GREY)
    page.drawText('Unit', { x: xUnit, y: y - 11, size: 8, font: bold, color: GREY })
    rrow('Rate', xRateR, 8, bold, GREY)
    rrow('Total', xTotalR, 8, bold, GREY)
    rrow('To date', xVtdR, 8, bold, GREY)
    y -= 15
    hrule()
    y -= 3
    // column boundary x's (mid-gaps between columns)
    const cwXs = [M, xUnit - 6, xUnit + 20, (xRateR + xUnit + 20) / 2, xRateR + 6, xTotalR + 6, M + width]
    let cwTotal = 0, cwToDate = 0
    for (const r of cw) {
      const rowTop = y
      if (r.kind === 'heading') { ensure(15); page.drawText(san(r.description), { x: cCode, y: y - 10, size: 9, font: bold, color: INK }); y -= 14; gridVerticals(cwXs, rowTop, y); hrule(); continue }
      ensure(14)
      const measurable = isMeasurableWorks(r)
      page.drawText(san(r.code || ''), { x: cCode, y: y - 10, size: 8.5, font, color: GREY })
      const dl = wrap(r.description || '', 8.5, font, descWrapPx)
      page.drawText(dl[0], { x: cDesc, y: y - 10, size: 8.5, font, color: INK })
      if (measurable) {
        cwTotal += Number(r.total) || 0; cwToDate += worksValueToDate(r)
        rrow(String(r.qty ?? ''), xQtyR, 8.5, font, INK)
        page.drawText(san(r.unit || ''), { x: xUnit, y: y - 10, size: 8.5, font, color: INK })
        rrow(r.rate != null ? Number(r.rate).toFixed(2) : '', xRateR, 8.5, font, INK)
        rrow(money(r.total), xTotalR, 8.5, font, INK)
        rrow(money(worksValueToDate(r)), xVtdR, 8.5, font, INK)
      }
      y -= 14
      for (let i = 1; i < dl.length; i++) { ensure(11); page.drawText(dl[i], { x: cDesc, y: y - 9, size: 8.5, font, color: INK }); y -= 11 }
      // verticals span this row's band on the current page; if a page break happened
      // mid-row, draw from the current page top so the lines still frame the row.
      gridVerticals(cwXs, Math.min(rowTop, A4[1] - M), y)
      hrule()
    }
    y -= 4
    page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: LINE }); y -= 4
    page.drawText('TOTAL CONTRACT WORKS', { x: cDesc, y: y - 11, size: 9, font: bold, color: INK })
    rrow(money(cwTotal), xTotalR, 9, bold, INK)
    rrow(money(cwToDate), xVtdR, 9, bold, INK)
    y -= 16
  }

  // ── Variations (instructed only) — own page ───────────────────────────────
  const instructed = vars.filter(v => v.instructed !== false)
  if (instructed.length) {
    newPage()
    heading('Variations')
    const cVo = M + 2, cDesc = M + 52, descWrapPx = 300
    const xFinalR = M + 448, xVtdR = M + width
    page.drawRectangle({ x: M, y: y - 15, width, height: 15, color: HEADBG })
    page.drawText('VO', { x: cVo, y: y - 11, size: 8, font: bold, color: GREY })
    page.drawText('Description', { x: cDesc, y: y - 11, size: 8, font: bold, color: GREY })
    rrow('Final value', xFinalR, 8, bold, GREY); rrow('To date', xVtdR, 8, bold, GREY)
    y -= 15
    hrule(); y -= 3
    const vXs = [M, cDesc - 4, xFinalR + 6, M + width]
    let vFinal = 0, vToDate = 0
    for (const v of instructed) {
      const rowTop = y
      ensure(16)
      vFinal += variationValue(v); vToDate += variationValueToDate(v)
      page.drawText(san(v.varNumber || '-'), { x: cVo, y: y - 10, size: 8.5, font, color: GREY })
      const dl = wrap(v.description || '', 8.5, font, descWrapPx).slice(0, 4)
      page.drawText(dl[0], { x: cDesc, y: y - 10, size: 8.5, font, color: INK })
      rrow(money(variationValue(v)), xFinalR, 8.5, font, INK)
      rrow(money(variationValueToDate(v)), xVtdR, 8.5, font, INK)
      y -= 14
      for (let i = 1; i < dl.length; i++) { ensure(11); page.drawText(dl[i], { x: cDesc, y: y - 9, size: 8.5, font, color: INK }); y -= 11 }
      y -= 3
      gridVerticals(vXs, Math.min(rowTop, A4[1] - M), y)
      hrule()
    }
    y -= 4
    page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: LINE }); y -= 4
    page.drawText('TOTAL VARIATIONS', { x: cDesc, y: y - 11, size: 9, font: bold, color: INK })
    rrow(money(vFinal), xFinalR, 9, bold, INK)
    rrow(money(vToDate), xVtdR, 9, bold, INK)
    y -= 16
  }

  // ── Materials on Site (customer copy — NO mark-up column) — own page ───────
  if (mats.filter(m => m.kind !== 'group').length) {
    newPage()
    heading('Materials on Site')
    const cDesc = M + 2, descWrapPx = 220
    const cPo = M + 236
    const xQtyR = M + 330, xUnit = M + 336
    const xTotalR = M + 442, xVtdR = M + width
    page.drawRectangle({ x: M, y: y - 15, width, height: 15, color: HEADBG })
    page.drawText('Description', { x: cDesc, y: y - 11, size: 8, font: bold, color: GREY })
    page.drawText('PO', { x: cPo, y: y - 11, size: 8, font: bold, color: GREY })
    rrow('Qty', xQtyR, 8, bold, GREY); page.drawText('Unit', { x: xUnit, y: y - 11, size: 8, font: bold, color: GREY })
    rrow('Total', xTotalR, 8, bold, GREY); rrow('To date', xVtdR, 8, bold, GREY)
    y -= 15
    hrule(); y -= 3
    const mXs = [M, cPo - 6, xQtyR + 6, xUnit + 20, xTotalR + 6, M + width]
    let mTotal = 0, mToDate = 0
    for (const m of mats) {
      if (m.kind === 'group') { ensure(16); const rowTop = y; page.drawRectangle({ x: M, y: y - 14, width, height: 14, color: rgb(0.94, 0.97, 1) }); page.drawText(san(`${m.supplier || 'Supplier'}${m.poNumber ? '  ' + m.poNumber : ''}`), { x: M + 3, y: y - 10, size: 8.5, font: bold, color: rgb(0.11, 0.32, 0.52) }); y -= 14; gridVerticals(mXs, rowTop, y); hrule(); continue }
      const rowTop = y
      ensure(14)
      mTotal += materialLineTotal(m); mToDate += materialValueToDate(m)
      const dl = wrap(m.description || '', 8.5, font, descWrapPx).slice(0, 2)
      page.drawText(dl[0], { x: cDesc, y: y - 10, size: 8.5, font, color: INK })
      page.drawText(san(m.poNumber || ''), { x: cPo, y: y - 10, size: 8, font, color: GREY })
      rrow(String(m.qty ?? ''), xQtyR, 8.5, font, INK)
      page.drawText(san(m.unit || ''), { x: xUnit, y: y - 10, size: 8.5, font, color: INK })
      rrow(money(materialLineTotal(m)), xTotalR, 8.5, font, INK)      // marked-up total; % NOT shown
      rrow(money(materialValueToDate(m)), xVtdR, 8.5, font, INK)
      y -= 14
      for (let i = 1; i < dl.length; i++) { ensure(11); page.drawText(dl[i], { x: cDesc, y: y - 9, size: 8.5, font, color: INK }); y -= 11 }
      gridVerticals(mXs, Math.min(rowTop, A4[1] - M), y)
      hrule()
    }
    y -= 4
    page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: LINE }); y -= 4
    page.drawText('TOTAL MATERIALS ON SITE', { x: cDesc, y: y - 11, size: 9, font: bold, color: INK })
    rrow(money(mTotal), xTotalR, 9, bold, INK)
    rrow(money(mToDate), xVtdR, 9, bold, INK)
    y -= 16
  }

  // ── Attachments ───────────────────────────────────────────────────────────
  const attachments = collectAttachments(app, vars)
  for (const att of attachments) {
    try {
      const url = att.url
      const isPdf = /\.pdf($|\?)/i.test(url) || att.name?.toLowerCase().endsWith('.pdf')
      const bytes = url.startsWith('data:') ? Uint8Array.from(Buffer.from(url.split(',')[1], 'base64')) : new Uint8Array(await (await fetch(url)).arrayBuffer())
      if (isPdf) {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
        const copied = await pdf.copyPages(src, src.getPageIndices())
        for (const pg of copied) pdf.addPage(pg)
      } else {
        let img; try { img = await pdf.embedJpg(bytes) } catch { img = await pdf.embedPng(bytes) }
        const p2 = pdf.addPage(A4)
        p2.drawText(san(att.label || att.name || 'Attachment'), { x: M, y: A4[1] - M, size: 10, font: bold, color: GREY })
        const maxW = width, maxH = A4[1] - M * 2 - 30; let iw = img.width, ih = img.height
        const scale = Math.min(maxW / iw, maxH / ih, 1); iw *= scale; ih *= scale
        p2.drawImage(img, { x: M, y: A4[1] - M - 24 - ih, width: iw, height: ih })
      }
    } catch { /* skip a bad attachment */ }
  }

  // Footer on every page
  const pages = pdf.getPages()
  const foot = `${san([jobNo, projName].filter(Boolean).join(' - '))}  ·  Application ${appNo}  ·  ${fmtDMY(appDate)}`
  pages.forEach((pg, i) => {
    pg.drawText(foot, { x: M, y: 22, size: 7.5, font: italic, color: GREY })
    const pn = `Page ${i + 1} of ${pages.length}`
    pg.drawText(pn, { x: A4[0] - M - font.widthOfTextAtSize(pn, 7.5), y: 22, size: 7.5, font: italic, color: GREY })
  })

  return await pdf.save()
}

// Live variations (draft) merged with per-app pct/attachments.
function buildLiveVars(app, trackerVariations) {
  const perVar = (app && app.variationData) || {}
  const key = (v) => `${(v.varNumber || '').trim()}|${(v.description || v.descriptionFull || '').trim().slice(0, 80)}`
  return (trackerVariations || []).map(v => {
    const stored = perVar[key(v)] || {}
    return {
      varNumber: v.varNumber || '', description: v.descriptionFull || v.description || '',
      instructed: !!v.instructed, materials: v.materials || '0', labour: v.labour || '0', profit: v.profit || '0',
      pctComplete: v.instructed ? (stored.pctComplete != null ? stored.pctComplete : 0) : null,
      attachments: Array.isArray(stored.attachments) ? stored.attachments : [],
    }
  })
}

function collectAttachments(app, vars) {
  const out = []
  for (const v of vars || []) for (const a of (v.attachments || [])) out.push({ url: a.url, name: a.name, label: `Variation ${v.varNumber || ''} — ${a.name || ''}` })
  for (const m of (app.materials || [])) if (m.kind === 'group') for (const a of (m.attachments || [])) out.push({ url: a.url, name: a.name, label: `${m.supplier || 'Supplier'}${m.poNumber ? ' ' + m.poNumber : ''} — ${a.name || ''}` })
  return out
}

// ── table renderers (kept simple; return the new y) ─────────────────────────
