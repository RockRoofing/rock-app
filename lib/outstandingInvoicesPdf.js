import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const A4 = [595.28, 841.89]
const M = 44
const GOLD = rgb(0.79, 0.54, 0.02)
const INK = rgb(0.1, 0.1, 0.1)
const GREY = rgb(0.5, 0.5, 0.5)
const RED = rgb(0.72, 0.11, 0.11)
const LINE = rgb(0.85, 0.85, 0.85)
const HEADBG = rgb(0.97, 0.97, 0.97)

const money = (n) => { const v = parseFloat(n); return isNaN(v) ? '£0.00' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(v) }
const fmtDate = (s) => {
  if (!s) return '—'
  let d = null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(s)
  else { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m) d = new Date(+m[3], +m[2] - 1, +m[1]) }
  return d && !isNaN(d) ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : String(s)
}
const fmtDT = (ms) => { try { return new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

// invoices: [{ invoiceNumber, reference, customer, date, dueDate, overdueBy, expectedDate,
//              paid, due, highRisk, qsName, comments:[{author,at,text,source}], emails:[...] }]
export async function buildOutstandingInvoicesPDF({ invoices, includeComments = true, logoUrl, title = 'Outstanding Invoices' }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique)
  let page = pdf.addPage(A4)
  let y = A4[1] - M
  const W = A4[0] - M * 2

  let logoImg = null
  if (logoUrl) { try { const b = new Uint8Array(await (await fetch(logoUrl)).arrayBuffer()); logoImg = /\.png$/i.test(logoUrl) ? await pdf.embedPng(b) : await pdf.embedJpg(b) } catch {} }

  const newPage = () => { page = pdf.addPage(A4); y = A4[1] - M }
  const ensure = (h) => { if (y - h < M + 20) newPage() }
  // Standard PDF fonts use WinAnsi encoding, which can't encode emoji or many
  // unicode symbols (e.g. 📧 in logged chase-email comments). Replace known ones
  // and strip anything else outside the safe range so the PDF never fails.
  const san = (t) => String(t ?? '')
    .replace(/\uD83D\uDCE7/g, '[email]')   // 📧
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')  // smart quotes
    .replace(/[\u2013\u2014]/g, '-')       // en/em dash
    .replace(/\u2026/g, '...')             // ellipsis
    .replace(/\u2022/g, '*')               // bullet
    .replace(/[^\x00-\xFF]/g, '')          // drop anything else WinAnsi can't encode
  const wrap = (t, size, f, w = W) => {
    const words = san(t).split(/\s+/); const lines = []; let line = ''
    for (const word of words) { const tt = line ? line + ' ' + word : word; if (f.widthOfTextAtSize(tt, size) > w) { if (line) lines.push(line); line = word } else line = tt }
    if (line) lines.push(line); return lines.length ? lines : ['']
  }
  const text = (t, { f = font, size = 10, color = INK, indent = 0, gap = 4, w = W } = {}) => {
    for (const line of wrap(t, size, f, w)) { ensure(size + gap); page.drawText(line, { x: M + indent, y: y - size, size, font: f, color }); y -= size + gap }
  }

  // ── Header ──
  const totalDue = invoices.reduce((s, i) => s + (i.due || 0), 0)
  const overdue = invoices.filter(i => i.overdueBy)
  const overdueDue = overdue.reduce((s, i) => s + (i.due || 0), 0)

  const lh = 38
  if (logoImg) page.drawImage(logoImg, { x: M, y: y - lh, width: lh, height: lh })
  page.drawText(san(title), { x: M + (logoImg ? 50 : 0), y: y - 22, size: 18, font: bold, color: INK })
  y -= lh + 4
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1, color: GOLD }); y -= 14
  text(`Generated ${fmtDT(Date.now())}`, { color: GREY, size: 9 })
  y -= 6

  // ── Summary band ──
  const stats = [
    ['Outstanding invoices', String(invoices.length)],
    ['Total due', money(totalDue)],
    ['Overdue invoices', String(overdue.length)],
    ['Overdue value', money(overdueDue)],
  ]
  const cw = W / 4
  ensure(46)
  page.drawRectangle({ x: M, y: y - 40, width: W, height: 40, color: HEADBG })
  stats.forEach(([label, val], i) => {
    page.drawText(label, { x: M + i * cw + 8, y: y - 15, size: 8, font, color: GREY })
    page.drawText(val, { x: M + i * cw + 8, y: y - 31, size: 13, font: bold, color: (i >= 2 && overdue.length) ? RED : INK })
  })
  y -= 54

  // ── Summary table ──
  page.drawText('Summary', { x: M, y: y - 12, size: 12, font: bold, color: GOLD }); y -= 22

  // columns: Inv | Ref | To | Due date | Overdue | Due
  const cols = [
    { key: 'invoiceNumber', label: 'Inv', w: 52 },
    { key: 'reference', label: 'Ref', w: 150 },
    { key: 'customer', label: 'To', w: 130 },
    { key: 'dueDate', label: 'Due date', w: 66, fmt: fmtDate },
    { key: 'overdueBy', label: 'Overdue', w: 55, align: 'r' },
    { key: 'due', label: 'Due', w: W - 52 - 150 - 130 - 66 - 55, align: 'r', fmt: money },
  ]
  const drawHeadRow = () => {
    ensure(20)
    page.drawRectangle({ x: M, y: y - 16, width: W, height: 16, color: HEADBG })
    let x = M + 4
    for (const c of cols) { page.drawText(c.label, { x: c.align === 'r' ? x + c.w - 4 - bold.widthOfTextAtSize(c.label, 8) : x, y: y - 12, size: 8, font: bold, color: GREY }); x += c.w }
    y -= 18
  }
  drawHeadRow()
  invoices.forEach((inv, idx) => {
    ensure(15)
    if (idx % 2 === 1) page.drawRectangle({ x: M, y: y - 13, width: W, height: 13, color: rgb(0.98, 0.98, 0.98) })
    let x = M + 4
    for (const c of cols) {
      let v = inv[c.key]
      if (c.key === 'overdueBy') v = inv.overdueBy ? `${inv.overdueBy}d` : ''
      else if (c.fmt) v = c.fmt(v)
      else v = v == null ? '' : String(v)
      const size = 8
      const maxChars = Math.floor(c.w / 4.2)
      if (v.length > maxChars) v = v.slice(0, maxChars - 1) + '…'
      v = san(v)
      const col = (c.key === 'overdueBy' || c.key === 'dueDate') && inv.overdueBy ? RED : INK
      const tx = c.align === 'r' ? x + c.w - 4 - font.widthOfTextAtSize(v, size) : x
      page.drawText(v, { x: tx, y: y - 10, size, font, color: col })
      x += c.w
    }
    y -= 14
  })

  // ── Per-invoice appendix ──
  if (includeComments) {
    for (const inv of invoices) {
      newPage()
      // title
      page.drawText(san(`Invoice ${inv.invoiceNumber || ''}`), { x: M, y: y - 18, size: 15, font: bold, color: INK })
      if (inv.highRisk) {
        const t = 'HIGH RISK'
        const wdt = bold.widthOfTextAtSize(t, 8) + 10
        page.drawRectangle({ x: A4[0] - M - wdt, y: y - 20, width: wdt, height: 16, color: rgb(1, 0.95, 0.95), borderColor: RED, borderWidth: 1 })
        page.drawText(t, { x: A4[0] - M - wdt + 5, y: y - 16, size: 8, font: bold, color: RED })
      }
      y -= 26
      page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.8, color: GOLD }); y -= 14

      const rows = [
        ['Reference', inv.reference || '—'],
        ['Customer', inv.customer || '—'],
        ['Invoice date', fmtDate(inv.date)],
        ['Due date', fmtDate(inv.dueDate) + (inv.overdueBy ? `  (overdue by ${inv.overdueBy} days)` : '')],
        ['Expected date', inv.expectedDate ? fmtDate(inv.expectedDate) : '—'],
        ['Paid', money(inv.paid)],
        ['Due', money(inv.due)],
        ['QS', inv.qsName || '—'],
      ]
      for (const [k, v] of rows) {
        ensure(15)
        page.drawText(san(k), { x: M, y: y - 11, size: 9.5, font: bold, color: GREY })
        page.drawText(san(String(v)), { x: M + 110, y: y - 11, size: 9.5, font, color: (k === 'Due date' && inv.overdueBy) ? RED : INK })
        y -= 15
      }
      y -= 6

      // comments
      page.drawText('Comments', { x: M, y: y - 12, size: 11, font: bold, color: GOLD }); y -= 18
      const comments = (inv.comments || []).slice().sort((a, b) => (a.at || 0) - (b.at || 0))
      if (!comments.length) text('No comments recorded.', { color: GREY, size: 9, f: italic })
      else for (const c of comments) {
        ensure(20)
        page.drawText(san(`${c.author || 'Unknown'}${c.source === 'email-bcc' ? ' (via email)' : ''}`), { x: M, y: y - 10, size: 9, font: bold, color: INK })
        const ds = fmtDT(c.at)
        page.drawText(ds, { x: A4[0] - M - font.widthOfTextAtSize(ds, 8), y: y - 10, size: 8, font, color: GREY })
        y -= 13
        text(c.text || '', { size: 9, color: rgb(0.2, 0.2, 0.2), gap: 3 })
        y -= 5
      }

      // emails sent (timeline) — placeholder until chase emails are built
      y -= 4
      page.drawText('Emails sent', { x: M, y: y - 12, size: 11, font: bold, color: GOLD }); y -= 18
      const emails = inv.emails || []
      if (!emails.length) text('No chase emails sent yet.', { color: GREY, size: 9, f: italic })
      else for (const e of emails) {
        ensure(14)
        text(`${fmtDT(e.at)} — ${e.type || 'email'} to ${e.to || ''}`, { size: 9, gap: 3 })
      }
    }
  }

  // footer on every page
  const pages = pdf.getPages()
  pages.forEach((p, i) => {
    p.drawText(`Rock Roofing — Outstanding Invoices · Page ${i + 1} of ${pages.length} · ${fmtDT(Date.now())}`, { x: M, y: 22, size: 7.5, font, color: GREY })
  })

  return await pdf.save()
}
