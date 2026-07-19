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
export async function buildApplicationPDF({ app, project = {}, prevGross = 0, trackerVariations = [], logoUrl }) {
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
  metaRow('Application no.', String(app.seq || ''))
  metaRow('Application date', fmtDMY(appDate))
  metaRow('Valuation date', fmtDMY(valDate))
  metaRow('Payment due', fmtDMY(payDate))
  metaRow('Final date for payment', fmtDMY(finalDate))
  y -= 6

  const heading = (t) => { ensure(26); page.drawText(san(t).toUpperCase(), { x: M, y: y - 12, size: 11, font: bold, color: GOLD }); y -= 18; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: LINE }); y -= 10 }

  // Compute figures + resolve variations for this app.
  const sum = computeApplicationSummary(app, prevGross)
  const vars = (app.status && app.status !== 'draft' && Array.isArray(app.variations)) ? app.variations
    : buildLiveVars(app, trackerVariations)
  const cw = Array.isArray(app.contractWorks) ? app.contractWorks : []
  const mats = Array.isArray(app.materials) ? app.materials : []

  // ── Summary ─────────────────────────────────────────────────────────────
  heading('Summary')
  {
    const cols = [M, M + 250, M + 360, M + 470]
    const h = (labels) => { page.drawRectangle({ x: M, y: y - 16, width, height: 16, color: HEADBG }); labels.forEach((l, i) => page.drawText(san(l), { x: cols[i] + 2, y: y - 12, size: 8.5, font: bold, color: GREY })); y -= 20 }
    h(['', 'Contract Sum', 'Application Total', 'Proj. Final Account'])
    const row = (label, c1, c2, c3, b) => {
      ensure(16)
      page.drawText(san(label), { x: cols[0] + 2, y: y - 11, size: 9.5, font: b ? bold : font, color: INK })
      const rc = (txt, x) => { if (txt === '') return; const w = (b ? bold : font).widthOfTextAtSize(txt, 9.5); page.drawText(txt, { x: x + 100 - w, y: y - 11, size: 9.5, font: b ? bold : font, color: INK }) }
      rc(c1, cols[1]); rc(c2, cols[2]); rc(c3, cols[3]); y -= 15
    }
    row('Measured Work', money(sum.measuredContractSum), money(sum.measuredToDate), money(sum.measuredContractSum))
    row('Variations', '', money(sum.variationsToDate), money(sum.variationsFinal))
    row('Materials On Site', '', money(sum.materialsOnSite), '')
    y -= 4
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: LINE }); y -= 12
    row('Contract Sum', money(sum.contractSum), '', '', true)
    row('Application Total', '', money(sum.applicationTotal), '', true)
    row('Anticipated Final Account', '', '', money(sum.anticipatedFinalAccount), true)
    y -= 8
  }

  // Certificate block
  heading('Payment Certificate')
  {
    const cols = [M, M + 250, M + 360, M + 470]
    page.drawRectangle({ x: M, y: y - 16, width, height: 16, color: HEADBG })
    ;['', 'Current', 'Previously Cert.', 'This Certificate'].forEach((l, i) => page.drawText(san(l), { x: cols[i] + 2, y: y - 12, size: 8.5, font: bold, color: GREY }))
    y -= 20
    const cRow = (label, key, b) => {
      ensure(16)
      page.drawText(san(label), { x: cols[0] + 2, y: y - 11, size: 9.5, font: b ? bold : font, color: INK })
      const vals = [sum.current[key], sum.previously[key], sum.thisCert[key]]
      vals.forEach((v, i) => { const t = money(v); const w = (b ? bold : font).widthOfTextAtSize(t, 9.5); page.drawText(t, { x: cols[i + 1] + 100 - w, y: y - 11, size: 9.5, font: b ? bold : font, color: INK }) })
      y -= 15
    }
    cRow('Gross valuation', 'gross')
    cRow(`Main contractor's discount (${app.mcdPct || 0}%)`, 'mcd')
    cRow('Sub-total', 'subTotal')
    cRow(`Retention (${app.retentionPct != null ? app.retentionPct : 5}%)`, 'retention')
    y -= 2; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: LINE }); y -= 10
    cRow('Total due', 'total', true)
    y -= 8
  }

  // Shared row helpers (close over page/y so page-breaks work correctly).
  const newPage = () => { page = pdf.addPage(A4); y = A4[1] - M }
  const rrow = (t, xRight, size, f, color) => { const w = f.widthOfTextAtSize(t, size); page.drawText(t, { x: xRight - w, y: y - (size + 1), size, font: f, color }) }

  // ── Contract Works ──────────────────────────────────────────────────────
  heading('Contract Works')
  {
    const cD = M + 40, cQty = M + 300, cUnit = M + 340, cRate = M + 380, cTotal = M + 450, cVtd = M + width
    page.drawRectangle({ x: M, y: y - 15, width, height: 15, color: HEADBG })
    page.drawText('Code', { x: M + 2, y: y - 11, size: 8, font: bold, color: GREY })
    page.drawText('Description', { x: cD + 2, y: y - 11, size: 8, font: bold, color: GREY })
    ;[['Qty', cUnit - 4], ['Rate', cTotal - 6], ['Total', cVtd - 66], ['To date', cVtd]].forEach(([t, x]) => rrow(t, x, 8, bold, GREY))
    page.drawText('Unit', { x: cUnit + 2, y: y - 11, size: 8, font: bold, color: GREY })
    y -= 18
    for (const r of cw) {
      if (r.kind === 'heading') { ensure(15); page.drawText(san(r.description), { x: M + 2, y: y - 10, size: 9, font: bold, color: INK }); y -= 15; continue }
      ensure(14)
      const measurable = isMeasurableWorks(r)
      page.drawText(san(r.code || ''), { x: M + 2, y: y - 10, size: 8.5, font, color: GREY })
      const dl = san(r.description || '').match(/.{1,52}(\s|$)/g) || ['']
      page.drawText(dl[0].trim(), { x: cD + 2, y: y - 10, size: 8.5, font, color: INK })
      if (measurable) {
        rrow(String(r.qty ?? ''), cUnit - 4, 8.5, font, INK)
        page.drawText(san(r.unit || ''), { x: cUnit + 2, y: y - 10, size: 8.5, font, color: INK })
        rrow(r.rate != null ? Number(r.rate).toFixed(2) : '', cTotal - 6, 8.5, font, INK)
        rrow(money(r.total), cVtd - 66, 8.5, font, INK)
        rrow(money(worksValueToDate(r)), cVtd, 8.5, font, INK)
      }
      y -= 14
      for (let i = 1; i < dl.length; i++) { ensure(12); page.drawText(dl[i].trim(), { x: cD + 2, y: y - 9, size: 8.5, font, color: INK }); y -= 12 }
    }
    y -= 2; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: LINE }); y -= 12
  }

  // ── Variations (instructed only) ──────────────────────────────────────────
  const instructed = vars.filter(v => v.instructed !== false)
  if (instructed.length) {
    heading('Variations')
    const cDesc = M + 46, cFinal = M + 480, cVtd = M + width
    page.drawRectangle({ x: M, y: y - 15, width, height: 15, color: HEADBG })
    page.drawText('VO', { x: M + 2, y: y - 11, size: 8, font: bold, color: GREY })
    page.drawText('Description', { x: cDesc + 2, y: y - 11, size: 8, font: bold, color: GREY })
    rrow('Final value', cFinal, 8, bold, GREY); rrow('To date', cVtd, 8, bold, GREY)
    y -= 18
    for (const v of instructed) {
      ensure(14)
      page.drawText(san(v.varNumber || '-'), { x: M + 2, y: y - 10, size: 8.5, font, color: GREY })
      const dl = (san(v.description || '').match(/.{1,72}(\s|$)/g) || ['']).slice(0, 3)
      page.drawText(dl[0].trim(), { x: cDesc + 2, y: y - 10, size: 8.5, font, color: INK })
      rrow(money(variationValue(v)), cFinal, 8.5, font, INK)
      rrow(money(variationValueToDate(v)), cVtd, 8.5, font, INK)
      y -= 14
      for (let i = 1; i < dl.length; i++) { ensure(12); page.drawText(dl[i].trim(), { x: cDesc + 2, y: y - 9, size: 8.5, font, color: INK }); y -= 12 }
    }
    y -= 2; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: LINE }); y -= 12
  }

  // ── Materials on Site (customer copy — NO mark-up column) ─────────────────
  if (mats.filter(m => m.kind !== 'group').length) {
    heading('Materials on Site')
    const cPo = M + 260, cUnit = M + 375, cTotal = M + width - 70, cVtd = M + width
    page.drawRectangle({ x: M, y: y - 15, width, height: 15, color: HEADBG })
    page.drawText('Description', { x: M + 2, y: y - 11, size: 8, font: bold, color: GREY })
    page.drawText('PO', { x: cPo + 2, y: y - 11, size: 8, font: bold, color: GREY })
    rrow('Qty', cUnit - 6, 8, bold, GREY); page.drawText('Unit', { x: cUnit + 2, y: y - 11, size: 8, font: bold, color: GREY })
    rrow('Total', cTotal, 8, bold, GREY); rrow('To date', cVtd, 8, bold, GREY)
    y -= 18
    for (const m of mats) {
      if (m.kind === 'group') { ensure(16); page.drawRectangle({ x: M, y: y - 14, width, height: 14, color: rgb(0.94, 0.97, 1) }); page.drawText(san(`${m.supplier || 'Supplier'}${m.poNumber ? '  ' + m.poNumber : ''}`), { x: M + 3, y: y - 10, size: 8.5, font: bold, color: rgb(0.11, 0.32, 0.52) }); y -= 16; continue }
      ensure(14)
      page.drawText((san(m.description || '').match(/.{1,42}(\s|$)/) || [''])[0].trim(), { x: M + 2, y: y - 10, size: 8.5, font, color: INK })
      page.drawText(san(m.poNumber || ''), { x: cPo + 2, y: y - 10, size: 8, font, color: GREY })
      rrow(String(m.qty ?? ''), cUnit - 6, 8.5, font, INK)
      page.drawText(san(m.unit || ''), { x: cUnit + 2, y: y - 10, size: 8.5, font, color: INK })
      rrow(money(materialLineTotal(m)), cTotal, 8.5, font, INK)      // marked-up total; % NOT shown
      rrow(money(materialValueToDate(m)), cVtd, 8.5, font, INK)
      y -= 14
    }
    y -= 2; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: LINE }); y -= 12
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
  const foot = `${san([jobNo, projName].filter(Boolean).join(' - '))}  ·  Application ${app.seq || ''}  ·  ${fmtDMY(appDate)}`
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
