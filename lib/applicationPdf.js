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
const num = (n) => { const v = parseFloat(n); return isNaN(v) ? 0 : v }
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
  // Table gridlines removed — rows are separated by white space instead.
  const gridVerticals = () => {}
  const hrule = () => {}
  // Draw a description line honouring CR/App formatting (bold / underline / red).
  const drawFmt = (text, x, size, fmt = {}) => {
    const f = fmt.bold ? bold : font
    const col = fmt.red ? rgb(0.86, 0.15, 0.15) : INK
    page.drawText(text, { x, y: y - (size + 1.5), size, font: f, color: col })
    if (fmt.underline) { const w = f.widthOfTextAtSize(text, size); page.drawLine({ start: { x, y: y - (size + 3.5) }, end: { x: x + w, y: y - (size + 3.5) }, thickness: 0.6, color: col }) }
  }

  // Compute figures + resolve variations for this app.
  const sum = computeApplicationSummary(app, prevGross)
  const vars = (app.status && app.status !== 'draft' && Array.isArray(app.variations)) ? app.variations
    : buildLiveVars(app, trackerVariations)
  const cw = Array.isArray(app.contractWorks) ? app.contractWorks : []
  const mats = Array.isArray(app.materials) ? app.materials : []

  // ── Summary ─────────────────────────────────────────────────────────────
  // Geometry: a label column then three right-aligned money columns, all inside
  // the page width. sxR = right edge of each of the three value columns.
  const colW = 108
  const sxR = [M + width - colW * 2 - 8, M + width - colW - 4, M + width]

  heading('Summary')
  {
    const drawHeader = (labels) => {
      page.drawRectangle({ x: M, y: y - 16, width, height: 16, color: HEADBG })
      page.drawText(san(labels[0]), { x: M + 4, y: y - 12, size: 8.5, font: bold, color: GREY })
      for (let i = 0; i < 3; i++) { const t = san(labels[i + 1]); page.drawText(t, { x: sxR[i] - bold.widthOfTextAtSize(t, 8.5), y: y - 12, size: 8.5, font: bold, color: GREY }) }
      y -= 16
    }
    drawHeader(['', 'Contract Sum', 'Application Total', 'Proj. Final Account'])
    const row = (label, c1, c2, c3, b) => {
      ensure(17)
      page.drawText(san(label), { x: M + 4, y: y - 11, size: 9.5, font: b ? bold : font, color: INK })
      const vals = [c1, c2, c3]
      vals.forEach((txt, i) => { if (txt === '' || txt == null) return; const w = (b ? bold : font).widthOfTextAtSize(txt, 9.5); page.drawText(txt, { x: sxR[i] - w, y: y - 11, size: 9.5, font: b ? bold : font, color: INK }) })
      y -= 17
    }
    row('Measured Work', money(sum.measuredContractSum), money(sum.measuredToDate), money(sum.measuredContractSum))
    row('Variations', '', money(sum.variationsToDate), money(sum.variationsFinal))
    row('Materials On Site', '', money(sum.materialsOnSite), '')
    y -= 4
    page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: LINE }); y -= 12
    row('Contract Sum', money(sum.contractSum), '', '', true)
    row('Application Total', '', money(sum.applicationTotal), '', true)
    row('Anticipated Final Account', '', '', money(sum.anticipatedFinalAccount), true)
    y -= 8
  }

  // Certificate block — sits directly under the Summary (no separate heading).
  y -= 6
  {
    page.drawRectangle({ x: M, y: y - 16, width, height: 16, color: HEADBG })
    const heads = ['', 'Current', 'Previously Cert.', 'This Certificate']
    page.drawText(san(heads[0]), { x: M + 4, y: y - 12, size: 8.5, font: bold, color: GREY })
    for (let i = 0; i < 3; i++) { const t = san(heads[i + 1]); page.drawText(t, { x: sxR[i] - bold.widthOfTextAtSize(t, 8.5), y: y - 12, size: 8.5, font: bold, color: GREY }) }
    y -= 16
    const cRow = (label, key, b) => {
      ensure(17)
      page.drawText(san(label), { x: M + 4, y: y - 11, size: 9.5, font: b ? bold : font, color: INK })
      const vals = [sum.current[key], sum.previously[key], sum.thisCert[key]]
      vals.forEach((v, i) => { const t = money(v); const w = (b ? bold : font).widthOfTextAtSize(t, 9.5); page.drawText(t, { x: sxR[i] - w, y: y - 11, size: 9.5, font: b ? bold : font, color: INK }) })
      y -= 17
    }
    cRow('Gross valuation', 'gross')
    cRow(`Main contractor's discount (${app.mcdPct || 0}%)`, 'mcd')
    cRow('Sub-total', 'subTotal')
    cRow(`Retention (${app.retentionPct != null ? app.retentionPct : 5}%)`, 'retention')
    y -= 2; page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: LINE }); y -= 10
    cRow('Total due', 'total', true)
    y -= 8
  }

  // ── Contract Works ──────────────────────────────────────────────────────
  newPage()
  heading('Contract Works')
  {
    // Right-edge x positions (numbers are right-aligned to these).
    const cCode = M + 2
    const cDesc = M + 26
    const descWrapPx = 210                 // description wrap width in points
    const xQtyR = M + 262
    const xUnit = M + 268                  // unit is left-aligned here
    const xRateR = M + 332
    const xTotalR = M + 400
    const xPctR = M + 452
    const xVtdR = M + width
    page.drawRectangle({ x: M, y: y - 15, width, height: 15, color: HEADBG })
    page.drawText('Code', { x: cCode, y: y - 11, size: 8, font: bold, color: GREY })
    page.drawText('Description', { x: cDesc, y: y - 11, size: 8, font: bold, color: GREY })
    rrow('Qty', xQtyR, 8, bold, GREY)
    page.drawText('Unit', { x: xUnit, y: y - 11, size: 8, font: bold, color: GREY })
    rrow('Rate', xRateR, 8, bold, GREY)
    rrow('Total', xTotalR, 8, bold, GREY)
    rrow('% Complete', xPctR, 8, bold, GREY)
    rrow('To date', xVtdR, 8, bold, GREY)
    y -= 15
    hrule()
    y -= 3
    let cwTotal = 0, cwToDate = 0
    for (const r of cw) {
      const fmt = { bold: !!r.bold, underline: !!r.underline, red: !!r.red }
      if (r.kind === 'heading') { ensure(18); y -= 4; drawFmt(san(r.description), cCode, 9, { bold: r.bold !== false, underline: !!r.underline, red: !!r.red }); y -= 16; continue }
      ensure(16)
      const measurable = isMeasurableWorks(r)
      page.drawText(san(r.code || ''), { x: cCode, y: y - 10, size: 8.5, font, color: GREY })
      const dl = wrap(r.description || '', 8.5, fmt.bold ? bold : font, descWrapPx)
      drawFmt(dl[0], cDesc, 8.5, fmt)
      if (measurable) {
        cwTotal += Number(r.total) || 0; cwToDate += worksValueToDate(r)
        rrow(String(r.qty ?? ''), xQtyR, 8.5, font, INK)
        page.drawText(san(r.unit || ''), { x: xUnit, y: y - 10, size: 8.5, font, color: INK })
        rrow(r.rate != null ? Number(r.rate).toFixed(2) : '', xRateR, 8.5, font, INK)
        rrow(money(r.total), xTotalR, 8.5, font, INK)
        rrow(`${num(r.pctComplete)}%`, xPctR, 8.5, font, INK)
        rrow(money(worksValueToDate(r)), xVtdR, 8.5, font, INK)
      }
      y -= 14
      for (let i = 1; i < dl.length; i++) { ensure(11); drawFmt(dl[i], cDesc, 8.5, { ...fmt, underline: false }); y -= 11 }
      y -= 8   // breathing space so each item associates cleanly with its rate/total
    }
    y -= 4
    page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: LINE }); y -= 4
    page.drawText('TOTAL CONTRACT WORKS', { x: cDesc, y: y - 11, size: 9, font: bold, color: INK })
    rrow(money(cwTotal), xTotalR, 9, bold, INK)
    rrow(money(cwToDate), xVtdR, 9, bold, INK)
    y -= 16
  }

  // ── Variations — own page (instructed, then not-yet-instructed) ────────────
  const instructed = vars.filter(v => v.instructed !== false)
  const notInstructed = vars.filter(v => v.instructed === false)
  if (instructed.length || notInstructed.length) {
    newPage()
    heading('Variations')
    const cVo = M + 2, voWrapPx = 52, cDesc = M + 62, descWrapPx = 222
    const xStatusL = M + 286           // status is left-aligned
    const xFinalR = M + 404
    const xPctR = M + 452
    const xVtdR = M + width
    const drawVarHeader = () => {
      page.drawRectangle({ x: M, y: y - 15, width, height: 15, color: HEADBG })
      page.drawText('VO', { x: cVo, y: y - 11, size: 8, font: bold, color: GREY })
      page.drawText('Description', { x: cDesc, y: y - 11, size: 8, font: bold, color: GREY })
      page.drawText('Status', { x: xStatusL, y: y - 11, size: 8, font: bold, color: GREY })
      rrow('Final value', xFinalR, 8, bold, GREY)
      rrow('% Complete', xPctR, 8, bold, GREY)
      rrow('Value to date', xVtdR, 8, bold, GREY)
      y -= 18
    }
    const drawVarRow = (v, { instructedRow }) => {
      ensure(18)
      const startY = y
      const vo = wrap(v.varNumber || '-', 8.5, font, voWrapPx)
      const dl = wrap(v.description || '', 8.5, font, descWrapPx).slice(0, 6)
      // First line: VO line 1, description line 1, and the right-hand columns.
      page.drawText(vo[0], { x: cVo, y: y - 10, size: 8.5, font, color: GREY })
      page.drawText(dl[0], { x: cDesc, y: y - 10, size: 8.5, font, color: INK })
      if (instructedRow) {
        page.drawText('Instructed', { x: xStatusL, y: y - 10, size: 8.5, font, color: rgb(0.1, 0.45, 0.2) })
        rrow(money(variationValue(v)), xFinalR, 8.5, font, INK)
        const pct = v.pctComplete != null ? v.pctComplete : 0
        rrow(`${pct}%`, xPctR, 8.5, font, INK)
        rrow(money(variationValueToDate(v)), xVtdR, 8.5, font, INK)
      } else {
        page.drawText('Not instructed', { x: xStatusL, y: y - 10, size: 8.5, font, color: rgb(0.76, 0.29, 0.06) })
        rrow(money(variationValue(v)), xFinalR, 8.5, font, INK)
        rrow('N/A', xPctR, 8.5, font, GREY)
        rrow('N/A', xVtdR, 8.5, font, GREY)
      }
      y -= 14
      // Continuation lines: VO wraps in its column, description in its column.
      const extra = Math.max(vo.length, dl.length) - 1
      for (let i = 1; i <= extra; i++) {
        ensure(11)
        if (vo[i]) page.drawText(vo[i], { x: cVo, y: y - 9, size: 8.5, font, color: GREY })
        if (dl[i]) page.drawText(dl[i], { x: cDesc, y: y - 9, size: 8.5, font, color: INK })
        y -= 11
      }
      y -= 10
    }

    drawVarHeader()
    let vFinal = 0, vToDate = 0
    for (const v of instructed) { vFinal += variationValue(v); vToDate += variationValueToDate(v); drawVarRow(v, { instructedRow: true }) }
    y -= 4
    page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: LINE }); y -= 4
    page.drawText('TOTAL VARIATIONS', { x: cDesc, y: y - 11, size: 9, font: bold, color: INK })
    rrow(money(vFinal), xFinalR, 9, bold, INK)
    rrow(money(vToDate), xVtdR, 9, bold, INK)
    y -= 34   // clear gap before the "not yet instructed" section

    if (notInstructed.length) {
      ensure(40)
      page.drawText('VARIATIONS NOT YET INSTRUCTED', { x: M, y: y - 11, size: 9.5, font: bold, color: GOLD }); y -= 16
      page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: LINE }); y -= 10
      drawVarHeader()
      let niFinal = 0
      for (const v of notInstructed) { niFinal += variationValue(v); drawVarRow(v, { instructedRow: false }) }
      y -= 4
      page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: LINE }); y -= 4
      page.drawText('TOTAL NOT YET INSTRUCTED', { x: cDesc, y: y - 11, size: 9, font: bold, color: INK })
      rrow(money(niFinal), xFinalR, 9, bold, INK)
      rrow('N/A', xVtdR, 9, bold, GREY)
      y -= 16
    }
    // Note pointing to the appended supporting documents, if any variation has docs.
    if ((vars || []).some(v => Array.isArray(v.attachments) && v.attachments.length > 0)) {
      ensure(16)
      page.drawText('See attached supporting information for each variation at the end of this document.',
        { x: M, y: y - 11, size: 8.5, font: italic, color: GREY })
      y -= 16
    }
  }

  // ── Materials on Site (customer copy — NO mark-up % column) — own page ─────
  if (mats.filter(m => m.kind !== 'group').length) {
    newPage()
    heading('Materials on Site')
    // Description | PO | Qty | Unit | Rate | Total | Claimed | Value to date
    const cDesc = M + 2, descWrapPx = 150
    const cPo = M + 162
    const xQtyR = M + 250, xUnit = M + 256
    const xRateR = M + 340
    const xTotalR = M + 410
    const xClaimedR = M + 452
    const xVtdR = M + width
    const drawMatHeader = () => {
      page.drawRectangle({ x: M, y: y - 15, width, height: 15, color: HEADBG })
      page.drawText('Description', { x: cDesc, y: y - 11, size: 8, font: bold, color: GREY })
      page.drawText('PO', { x: cPo, y: y - 11, size: 8, font: bold, color: GREY })
      rrow('Qty', xQtyR, 8, bold, GREY)
      page.drawText('Unit', { x: xUnit, y: y - 11, size: 8, font: bold, color: GREY })
      rrow('Rate', xRateR, 8, bold, GREY)
      rrow('Total', xTotalR, 8, bold, GREY)
      rrow('Claimed', xClaimedR, 8, bold, GREY)
      rrow('Value to date', xVtdR, 8, bold, GREY)
      y -= 18
    }
    drawMatHeader()
    let mTotal = 0, mToDate = 0
    for (const m of mats) {
      if (m.kind === 'group') { ensure(20); y -= 4; page.drawText(san(`${m.supplier || 'Supplier'}${m.poNumber ? '  ' + m.poNumber : ''}`), { x: M + 3, y: y - 10, size: 8.5, font: bold, color: rgb(0.11, 0.32, 0.52) }); y -= 16; continue }
      ensure(16)
      mTotal += materialLineTotal(m); mToDate += materialValueToDate(m)
      const dl = wrap(m.description || '', 8.5, font, descWrapPx).slice(0, 2)
      page.drawText(dl[0], { x: cDesc, y: y - 10, size: 8.5, font, color: INK })
      page.drawText(san(m.poNumber || ''), { x: cPo, y: y - 10, size: 8, font, color: GREY })
      rrow(String(m.qty ?? ''), xQtyR, 8.5, font, INK)
      page.drawText(san(m.unit || ''), { x: xUnit, y: y - 10, size: 8.5, font, color: INK })
      // Customer-facing rate = marked-up unit rate (so Qty × Rate reconciles to Total,
      // without exposing the mark-up %).
      const qty = num(m.qty)
      const markedRate = qty ? materialLineTotal(m) / qty : num(m.rate) * (1 + num(m.markupPct) / 100)
      rrow(m.rate != null ? markedRate.toFixed(2) : '', xRateR, 8.5, font, INK)
      rrow(money(materialLineTotal(m)), xTotalR, 8.5, font, INK)
      const claimed = m.pctComplete == null ? 100 : num(m.pctComplete)
      rrow(`${claimed}%`, xClaimedR, 8.5, font, INK)
      rrow(money(materialValueToDate(m)), xVtdR, 8.5, font, INK)
      y -= 14
      for (let i = 1; i < dl.length; i++) { ensure(11); page.drawText(dl[i], { x: cDesc, y: y - 9, size: 8.5, font, color: INK }); y -= 11 }
      y -= 7
    }
    y -= 4
    page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: LINE }); y -= 4
    page.drawText('TOTAL MATERIALS ON SITE', { x: cDesc, y: y - 11, size: 9, font: bold, color: INK })
    rrow(money(mTotal), xTotalR, 9, bold, INK)
    rrow(money(mToDate), xVtdR, 9, bold, INK)
    y -= 16
  }

  // ── Variation Supporting Documents ──────────────────────────────────────────
  // Each variation with attachments gets a header (VO number – Description – Total),
  // then its documents rendered DIRECTLY BELOW the header on the same page, scaled to
  // fit, so the header relates to the document shown. A new page starts only when
  // there isn't room for the next item.
  const varsWithDocs = (vars || []).filter(v => Array.isArray(v.attachments) && v.attachments.length > 0)
  const groupDocs = []
  for (const m of (app.materials || [])) if (m.kind === 'group') for (const a of (m.attachments || [])) {
    groupDocs.push({ url: a.url, name: a.name, label: `${m.supplier || 'Supplier'}${m.poNumber ? ' ' + m.poNumber : ''}` })
  }

  if (varsWithDocs.length > 0 || groupDocs.length > 0) {
    // Fresh page for the section; a local cursor for this section only.
    let sp = pdf.addPage(A4)
    let sy = A4[1] - M
    const secW = A4[0] - M * 2
    const newSecPage = () => { sp = pdf.addPage(A4); sy = A4[1] - M }
    const need = (h) => { if (sy - h < M + 20) newSecPage() }

    // Section title.
    sp.drawText('Variation Supporting Documents', { x: M, y: sy - 18, size: 18, font: bold, color: INK })
    sp.drawLine({ start: { x: M, y: sy - 28 }, end: { x: A4[0] - M, y: sy - 28 }, thickness: 0.8, color: LINE })
    sy -= 48

    // Draws a header block (VO – wrapped description – total – status). Returns the
    // height used. If forceNew, always starts a new page first.
    const drawVarHeader = (label, valueText, statusText) => {
      // Estimate height: label line + wrapped desc + total + status + padding.
      const descLines = wrap(label, 12, bold, secW)
      const blockH = 18 + descLines.length * 15 + 16 + 14 + 10
      need(blockH + 60)   // ensure header + at least some of the doc fits
      // separator above (except at very top of a page)
      let ly = sy
      descLines.forEach((ln, i) => {
        sp.drawText(ln, { x: M, y: ly - 12, size: 12, font: bold, color: INK }); ly -= 15
      })
      ly -= 2
      sp.drawText(`Total: ${valueText}`, { x: M, y: ly - 11, size: 11, font: bold, color: GOLD }); ly -= 15
      sp.drawText(statusText, { x: M, y: ly - 10, size: 9, font, color: GREY }); ly -= 12
      sp.drawLine({ start: { x: M, y: ly - 2 }, end: { x: A4[0] - M, y: ly - 2 }, thickness: 0.6, color: LINE })
      sy = ly - 12
    }

    // Embeds one attachment beneath the current cursor, scaled to fit the remaining
    // space (and capped so it doesn't exceed ~70% of a page height, per request). A
    // multi-page PDF attachment is appended as full pages after the on-page section.
    const drawAttachment = async (att, caption) => {
      try {
        const url = att.url
        const isPdf = /\.pdf($|\?)/i.test(url) || att.name?.toLowerCase().endsWith('.pdf')
        const bytes = url.startsWith('data:') ? Uint8Array.from(Buffer.from(url.split(',')[1], 'base64')) : new Uint8Array(await (await fetch(url)).arrayBuffer())
        if (isPdf) {
          // Embed the PDF's pages INLINE, immediately after this variation's header,
          // so the document stays with the variation it belongs to. A small caption
          // is drawn at the top of the first embedded page.
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
          const copied = await pdf.copyPages(src, src.getPageIndices())
          copied.forEach((pg, i) => {
            pdf.addPage(pg)
            if (i === 0 && caption) {
              try { pg.drawText(san(caption), { x: M, y: pg.getHeight() - 14, size: 8, font: italic, color: GREY }) } catch {}
            }
          })
          // Continue the flowing section on a fresh page after the embedded PDF.
          newSecPage()
          return
        }
        let img; try { img = await pdf.embedJpg(bytes) } catch { img = await pdf.embedPng(bytes) }
        // Caption line.
        need(14 + 120)
        if (caption) { sp.drawText(san(caption), { x: M + 4, y: sy - 10, size: 8.5, font: italic, color: GREY }); sy -= 14 }
        // Fit width to page; cap height at 70% of usable page height; if it doesn't
        // fit in the remaining space, move to a new page first.
        const usableH = A4[1] - M * 2
        let iw = img.width, ih = img.height
        let scale = Math.min(secW / iw, (usableH * 0.7) / ih, 1)
        iw *= scale; ih *= scale
        if (sy - ih < M + 20) { newSecPage(); if (caption) { sp.drawText(san(caption), { x: M + 4, y: sy - 10, size: 8.5, font: italic, color: GREY }); sy -= 14 } }
        sp.drawImage(img, { x: M, y: sy - ih, width: iw, height: ih })
        sy -= ih + 14
      } catch { /* skip a bad attachment */ }
    }

    for (const v of varsWithDocs) {
      drawVarHeader(`${v.varNumber || 'VO'} — ${v.description || ''}`, money(variationValue(v)), v.instructed ? 'Instructed' : 'Not yet instructed')
      for (const a of v.attachments) await drawAttachment({ url: a.url, name: a.name }, a.name || '')
      sy -= 8
    }
    if (groupDocs.length) {
      drawVarHeader('Material / supplier documents', '', '')
      for (const g of groupDocs) await drawAttachment(g, `${g.label} — ${g.name || ''}`)
    }
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

// ── table renderers (kept simple; return the new y) ─────────────────────────
