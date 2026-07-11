import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { buildIssuePDF } from './issuePdf'

const A4 = [595.28, 841.89]
const M = 48
const GOLD = rgb(0.79, 0.54, 0.02)
const INK = rgb(0.1, 0.1, 0.1)
const GREY = rgb(0.5, 0.5, 0.5)
const LINE = rgb(0.85, 0.85, 0.85)

const fmtDMY = (d) => { if (!d) return '—'; const [y, m, day] = String(d).split('-'); return day ? `${day}/${m}/${y}` : d }
const money = (n) => { const v = parseFloat(n); return isNaN(v) ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(v) }

export async function buildProjectReportPDF({ report, logoUrl, openIssues }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique)
  let page = pdf.addPage(A4)
  let y = A4[1] - M
  const width = A4[0] - M * 2

  let logoImg = null
  if (logoUrl) { try { const b = new Uint8Array(await (await fetch(logoUrl)).arrayBuffer()); logoImg = /\.png$/i.test(logoUrl) ? await pdf.embedPng(b) : await pdf.embedJpg(b) } catch {} }

  const newPage = () => { page = pdf.addPage(A4); y = A4[1] - M }
  const ensure = (h) => { if (y - h < M) newPage() }
  const wrap = (text, size, f) => {
    const words = String(text ?? '').split(/\s+/); const lines = []; let line = ''
    for (const w of words) { const t = line ? line + ' ' + w : w; if (f.widthOfTextAtSize(t, size) > width) { if (line) lines.push(line); line = w } else line = t }
    if (line) lines.push(line); return lines.length ? lines : ['']
  }
  const text = (t, { f = font, size = 10, color = INK, indent = 0, gap = 4 } = {}) => {
    for (const line of wrap(t, size, f)) { ensure(size + gap); page.drawText(line, { x: M + indent, y: y - size, size, font: f, color }); y -= size + gap }
  }
  const gap = (n = 6) => { y -= n }
  const heading = (t) => { gap(6); ensure(20); page.drawText(t.toUpperCase(), { x: M, y: y - 12, size: 11, font: bold, color: GOLD }); y -= 18; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: LINE }); gap(8) }

  // Header
  const lh = 40
  if (logoImg) page.drawImage(logoImg, { x: M, y: y - lh, width: lh, height: lh })
  page.drawText('Project Site Report', { x: M + (logoImg ? 56 : 0), y: y - 24, size: 20, font: bold, color: INK })
  y -= lh + 6
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1, color: GOLD }); gap(12)

  text(`${report.projectName || ''}${report.projectNo ? ` — ${report.projectNo}` : ''}`, { f: bold, size: 13 })
  if (report.projectAddress) text(report.projectAddress, { color: GREY, size: 9.5 })
  if (report.customerName) text(`Customer: ${report.customerName}`, { color: GREY, size: 9.5 })
  if (report.reportId) text(`Report: ${report.reportId}`, { color: GREY, size: 9.5 })
  text(`Completion date: ${fmtDMY(report.date)}`, { color: GREY, size: 9.5 })
  text(`Completed by: ${report.completedBy || '—'}`, { color: GREY, size: 9.5 })
  // status pill
  gap(4); ensure(24)
  const done = report.status === 'complete'
  const bc = done ? rgb(0.06, 0.65, 0.35) : rgb(0.79, 0.54, 0.02)
  const bbg = done ? rgb(0.86, 0.99, 0.91) : rgb(1, 0.98, 0.92)
  page.drawRectangle({ x: M, y: y - 22, width: 130, height: 22, color: bbg, borderColor: bc, borderWidth: 1 })
  page.drawText(done ? 'STATUS: SUBMITTED' : 'STATUS: DRAFT', { x: M + 8, y: y - 15, size: 9.5, font: bold, color: bc })
  y -= 26

  // Variations to instruct
  heading('Variations priced awaiting instruction')
  const vs = report.variationsSnapshot || []
  if (!vs.length) text('None.', { color: GREY, size: 10 })
  else {
    text('No. · Description · Instructed · Total', { f: bold, size: 9 })
    for (const v of vs) text(`${v.varNumber || '—'} · ${v.description || ''} · ${v.instructed ? 'Yes' : 'No'} · ${money(v.total)}`, { size: 9.5, indent: 6 })
  }

  // Open issues — only those included (sent/marked sent to customer). Match the appended forms.
  heading('Issues still to be resolved')
  const includedIds = new Set((openIssues || []).map(i => i.id))
  const iss = (report.issuesSnapshot || []).filter(s => !s.id || includedIds.has(s.id))
  if (!iss.length) text('None.', { color: GREY, size: 10 })
  else {
    text('Date Created · Issue Name · Type · Required Resolution · Status', { f: bold, size: 9 })
    for (const i of iss) text(`${fmtDMY(i.dateCreated)} · ${i.issueName || ''} · ${(i.issueTypes || []).join(', ')} · Req: ${fmtDMY(i.requiredDate)} · ${i.status || 'Open'}`, { size: 9.5, indent: 6 })
    gap(4)
    text('The full issue forms for the open issues listed above are appended at the end of this report.', { f: italic, size: 9, color: GREY })
  }

  // Site communications
  heading('Site communications')
  text(report.siteComms || '—', { size: 10 })

  // Works completed
  heading('Works completed')
  text(report.worksCompleted || '—', { size: 10 })

  // Photos
  const photos = (report.photos || []).filter(p => typeof p === 'string' && /^https?:|^data:/.test(p))
  if (photos.length) {
    heading('Photos')
    for (const p of photos) {
      try {
        let bytes
        if (p.startsWith('data:')) bytes = Uint8Array.from(Buffer.from(p.split(',')[1], 'base64'))
        else bytes = new Uint8Array(await (await fetch(p)).arrayBuffer())
        let img; try { img = await pdf.embedJpg(bytes) } catch { img = await pdf.embedPng(bytes) }
        const maxW = width, maxH = 280; let iw = img.width, ih = img.height
        const scale = Math.min(maxW / iw, maxH / ih, 1); iw *= scale; ih *= scale
        ensure(ih + 10); page.drawImage(img, { x: M, y: y - ih, width: iw, height: ih }); y -= ih + 12
      } catch {}
    }
  }

  // Approval
  heading('Approval')
  text('I can confirm that the information I have provided is true and that I have completed all sections accurately and diligently.', { size: 9.5, color: GREY })
  gap(4)
  text(`Name: ${report.approvalName || '—'}`, { f: bold, size: 10 })
  text(`Date: ${fmtDMY(report.approvalDate)}`, { size: 10 })

  // Append the full open-issue forms after the signature/approval page.
  const issuesToAppend = (openIssues || []).filter(Boolean)
  for (const issue of issuesToAppend) {
    try {
      const issueBytes = await buildIssuePDF({ issue, project: { projectName: report.projectName, projectNo: report.projectNo }, logoUrl })
      const src = await PDFDocument.load(issueBytes, { ignoreEncryption: true })
      const copied = await pdf.copyPages(src, src.getPageIndices())
      for (const pg of copied) pdf.addPage(pg)
    } catch (e) { /* skip a bad issue form */ }
  }

  // Digital signature / revision footer on EVERY page (incl. appended issue forms)
  const stamp = () => {
    const pages = pdf.getPages()
    for (const pg of pages) {
      const revText = `Digitally signed · Rev ${report.revision || 0} · Last amended ${new Date(report.updatedAt || Date.now()).toLocaleString('en-GB')} by ${report.approvalName || report.completedBy || '—'}`
      pg.drawText(revText, { x: M, y: 24, size: 7.5, font: italic, color: GREY })
    }
  }
  stamp()

  return await pdf.save()
}
